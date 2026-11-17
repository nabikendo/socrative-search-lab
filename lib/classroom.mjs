import { deviceLabel, clientIp, MODES, SecurityError } from './security.mjs';

// Rotas da sala de aula: painel de presença em tempo real (Sprint 2), pedido de ajuda (Sprint 4)
// e configuração de segurança com o diagnóstico /diag/https (Sprint 5).
const STATE_LABEL = { online: 'Em prova', submitted: 'Enviou', left: 'Saiu (desconectado)', absent: 'Não entrou' };
const EVENT_LABEL = {
  entered: 'Entrou', returned: 'Voltou', left: 'Saiu', submitted: 'Enviou a prova', device_released: 'Dispositivo liberado pelo professor',
  device_rebound: 'Entrou em outro aparelho', device_conflict: 'Tentativa em outro aparelho', help: 'Pediu ajuda', help_answered: 'Ajuda atendida',
};

export function registerClassroomRoutes(ctx) {
  const { route, readJson, readBody, HttpError, limit, store, presence, security, secure, csvCell, lanUrls } = ctx;
  const needExam = (id) => store.getExam(id) ?? (() => { throw new HttpError(404, 'exam_not_found', 'Prova não encontrada.'); })();
  const needSession = (id) => store.getSession(id) ?? (() => { throw new HttpError(404, 'session_not_found', 'Participante não encontrado.'); })();

  // ---------- painel de presença
  route('GET', '/api/exams/:id/presence', { admin: true }, ({ params }) => presence.snapshot(needExam(params.id).id));
  route('GET', '/api/exams/:id/presence/stream', { admin: true }, ({ params, req, res }) => {
    presence.hub.subscribe(needExam(params.id).id, req, res);
    return null;
  });
  route('GET', '/api/exams/:id/presence.csv', { admin: true }, ({ params, res }) => {
    const exam = needExam(params.id);
    const snap = presence.snapshot(exam.id);
    const when = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR') : '');
    const lines = [
      ['Chamada', exam.title, `Gerada em ${new Date().toLocaleString('pt-BR')}`, `${snap.counts.entered} de ${snap.counts.total} alunos entraram`],
      [],
      ['Nº', 'Aluno', 'Turma', 'Situação', 'Entrada', 'Última atividade', 'Envio', 'Aparelho', 'IP', 'Pedidos de ajuda', 'Tentativas em outro aparelho'],
      ...snap.students.map((s) => [s.number, s.name, s.className, STATE_LABEL[s.state] + (s.outsideRoster ? ' (fora da lista)' : ''), when(s.enteredAt), when(s.lastSeenAt), when(s.submittedAt), s.device, s.ip, s.helpCount, s.conflicts]),
    ];
    const csv = '﻿' + lines.map((row) => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
    const slug = exam.title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'prova';
    res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="chamada-${slug}.csv"`, 'cache-control': 'no-store' });
    res.end(csv);
    return null;
  });
  // Liberar dispositivo: o aparelho atual perde o acesso e o próximo que entrar com o número fica vinculado.
  route('POST', '/api/sessions/:id/release-device', { admin: true }, ({ params }) => {
    const session = needSession(params.id);
    if (session.status === 'submitted') throw new HttpError(409, 'already_submitted', 'Este aluno já enviou a prova.');
    presence.release(session);
    return { ok: true };
  });
  route('POST', '/api/sessions/:id/help/answer', { admin: true }, ({ params }) => {
    presence.answerHelp(needSession(params.id));
    return { ok: true };
  });

  // ---------- aluno: pedir ajuda e avisar que fechou a página
  route('POST', '/api/session/help', async ({ req }) => {
    limit(req, 'help', 30);
    const input = await readJson(req);
    const session = ctx.studentSession(input);
    if (session.status === 'submitted') throw new HttpError(409, 'session_closed', 'Prova já enviada.');
    presence.setHelp(session, input.on !== false);
    return { help: input.on !== false };
  });
  route('POST', '/api/session/leave', async ({ req }) => {
    limit(req, 'leave', 60);
    try { presence.markLeft(ctx.studentSession(await readJson(req))); } catch { /* sessão já inválida: nada a registrar */ }
    return { ok: true };
  });

  // ---------- segurança
  const securityView = (req) => ({
    ...security.get(), modes: MODES,
    https: { running: !!secure.server, port: secure.port, fingerprint: secure.cert?.fingerprint ?? null, validTo: secure.cert?.validTo ?? null, error: secure.error },
    urls: { http: lanUrls(req.socket.localPort, 'http'), https: secure.server ? lanUrls(secure.port, 'https') : [] },
    diagnostics: security.diagnostics(),
  });
  route('GET', '/api/security', { admin: true }, ({ req }) => securityView(req));
  route('PUT', '/api/security', { admin: true }, async ({ req }) => {
    const input = await readJson(req);
    if ((input.mode === 'https' || input.mode === 'auto') && !secure.server) {
      throw new HttpError(409, 'https_unavailable', 'O HTTPS não está disponível neste computador agora' + (secure.error ? `: ${secure.error}` : '.'));
    }
    try { security.set({ mode: input.mode, tokenTtlMinutes: input.tokenTtlMinutes }); }
    catch (error) { if (error instanceof SecurityError) throw new HttpError(400, error.code, error.message); throw error; }
    store.addAudit('security_changed', 'security', JSON.stringify(security.get()));
    return securityView(req);
  });
  route('DELETE', '/api/security/diagnostics', { admin: true }, () => { security.clearDiagnostics(); return { ok: true }; });

  // ---------- /diag/https: página sem PIN para testar HTTPS num Chromebook real
  const page = (res, title, body, status = 200) => {
    res.writeHead(status, {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https: http:; base-uri 'none'; frame-ancestors 'none'",
    });
    res.end(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:640px;margin:0 auto;padding:24px 16px;color:#1d1d1f;background:#f5f5f7}h1{font-size:24px}
.card{background:#fff;border:1px solid #d2d2d7;border-radius:14px;padding:18px;margin:14px 0}.ok{border-color:#34c759}.warn{border-color:#ff9f0a}
a.btn,button{display:inline-block;font:inherit;padding:10px 16px;border-radius:10px;border:0;background:#007aff;color:#fff;text-decoration:none;cursor:pointer;margin:4px 6px 4px 0}
button.sec{background:#e8e8ed;color:#1d1d1f}code{background:#e8e8ed;padding:2px 6px;border-radius:6px;word-break:break-all}li{margin:6px 0}</style></head><body>${body}</body></html>`);
    return null;
  };
  const resultForm = (outcome, label, cls = '') => `<form method="post" action="/diag/https/result"><input type="hidden" name="outcome" value="${outcome}"><button class="${cls}">${esc(label)}</button></form>`;
  route('GET', '/diag/https', ({ req, res }) => {
    limit(req, 'diag', 60);
    if (req.socket.encrypted) {
      security.addDiagnostic({ outcome: 'ok', device: deviceLabel(req.headers['user-agent']), ip: clientIp(req) });
      return page(res, 'HTTPS funcionou', `<h1>✅ HTTPS funcionou neste aparelho</h1>
<div class="card ok"><p>Este ${esc(deviceLabel(req.headers['user-agent']))} abriu a página segura do Atlas. O resultado já foi registrado no computador do professor.</p>
<p>Se o navegador mostrou um aviso de segurança antes, anote: os alunos também verão esse aviso e precisarão tocar em <strong>Avançado › Continuar</strong>.</p></div>
${resultForm('warning', 'Funcionou, mas precisei aceitar um aviso', 'sec')}`);
    }
    const host = String(req.socket.localAddress || '').replace(/^::ffff:/, '');
    const target = secure.server ? `https://${host}:${secure.port}/diag/https` : null;
    return page(res, 'Diagnóstico HTTPS do Atlas', `<h1>Diagnóstico HTTPS do Atlas</h1>
<div class="card"><p>Use esta página num <strong>Chromebook da escola</strong> (ou no aparelho dos alunos) para saber se a rede da sala pode usar HTTPS.</p>
<ol><li>Toque no botão abaixo.</li><li>Se aparecer <em>“Sua conexão não é particular”</em>, toque em <strong>Avançado</strong> e depois em <strong>Continuar</strong>.</li>
<li>Se abrir uma página com ✅, o HTTPS funciona. Se o Chromebook <strong>não deixar continuar</strong>, volte aqui e registre que foi bloqueado.</li></ol>
${target ? `<p><a class="btn" href="${target}">Testar HTTPS neste aparelho</a></p><p>Endereço: <code>${target}</code></p>
<p>Impressão digital do certificado (para conferir): <code>${esc(secure.cert?.fingerprint ?? '')}</code></p>` : `<p><strong>O HTTPS não está disponível neste computador agora.</strong> ${esc(secure.error ?? '')}</p>`}</div>
<div class="card warn"><p>Não conseguiu abrir a página segura?</p>${resultForm('blocked', 'Foi bloqueado: não consegui continuar', 'sec')}${resultForm('uncertain', 'Não sei / deu outro erro', 'sec')}</div>`);
  });
  route('POST', '/diag/https/result', async ({ req, res }) => {
    limit(req, 'diag-result', 20);
    const form = new URLSearchParams((await readBody(req, 4000)).toString('utf8'));
    const outcome = form.get('outcome');
    // Só uma página aberta por HTTPS pode registrar "funcionou"; pela página HTTP só dá para relatar falha.
    const allowed = req.socket.encrypted ? ['warning'] : ['blocked', 'uncertain'];
    if (!allowed.includes(outcome)) throw new HttpError(400, 'invalid_outcome');
    security.addDiagnostic({ outcome, device: deviceLabel(req.headers['user-agent']), ip: clientIp(req) });
    return page(res, 'Resultado registrado', '<h1>Resultado registrado</h1><div class="card"><p>Obrigado. O professor vê este resultado em Configurações › Segurança.</p></div>');
  });

  return { STATE_LABEL, EVENT_LABEL };
}

const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
