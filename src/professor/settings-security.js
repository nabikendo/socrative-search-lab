import { api } from '../lib/api.js';
import { h, clear, toast } from '../lib/dom.js';
import { confirmAction } from '../lib/confirm.js';
import { card, field, button, badge, notice } from './settings-kit.js';

const MODES = {
  http: { title: 'HTTP com proteções (padrão)', text: 'Funciona em qualquer aparelho, sem avisos. Sem criptografia: exige rede controlada (hotspot do professor).' },
  auto: { title: 'Automático', text: 'O QR Code usa HTTPS; quem não conseguir abrir pode usar o endereço HTTP. Os alunos verão um aviso de certificado.' },
  https: { title: 'Somente HTTPS', text: 'Tudo criptografado. Cada aparelho precisa aceitar o aviso do certificado. Só use se o diagnóstico funcionou nos Chromebooks.' },
};
const OUTCOME = { ok: ['Funcionou', 'ok'], warning: ['Funcionou com aviso', 'warn'], blocked: ['Bloqueado', 'danger'], uncertain: ['Incerto', ''] };

export async function render(panel, { status }) {
  let data;
  try { data = await api('/api/security'); }
  catch (error) { clear(panel, notice(error.message, 'danger')); return; }

  async function setMode(mode) {
    if (mode === data.mode) return;
    if (mode !== 'http') {
      const { confirmed } = await confirmAction({
        title: `Usar o modo ${MODES[mode].title}?`,
        lead: 'Os alunos vão abrir um endereço https:// e verão o aviso “Sua conexão não é particular”. Em cada aparelho será preciso tocar em Avançado › Continuar. Confirme antes com o diagnóstico num Chromebook da escola.',
        confirmLabel: 'Mudar o modo',
      });
      if (!confirmed) return;
    }
    try { data = await api('/api/security', { method: 'PUT', body: { mode } }); toast('Modo de segurança alterado. Gere o QR Code de novo na aba Prova.'); }
    catch (error) { status(error.message); }
    draw();
  }

  function draw() {
    const modes = h('div', { class: 'stack-s security-modes', role: 'radiogroup', 'aria-label': 'Modo de segurança' },
      data.modes.map((mode) => h('label', { class: 'security-mode' + (data.mode === mode ? ' active' : '') },
        h('input', { type: 'radio', name: 'security-mode', value: mode, checked: data.mode === mode, disabled: mode !== 'http' && !data.https.running, onchange: () => setMode(mode) }),
        h('span', { class: 'stack-s' }, h('strong', {}, MODES[mode].title), h('span', { class: 'caption' }, MODES[mode].text)))));

    const ttl = h('input', { type: 'number', min: 2, max: 120, step: 1, value: data.tokenTtlMinutes, style: 'max-width:120px' });
    const saveTtl = button('Salvar', async () => {
      data = await api('/api/security', { method: 'PUT', body: { tokenTtlMinutes: Number(ttl.value) } });
      toast('Validade do acesso salva.'); draw();
    }, { status });

    const diagUrl = data.urls.http[0] ? `${data.urls.http[0]}/diag/https` : null;
    const results = data.diagnostics.length
      ? h('div', { class: 'list' }, data.diagnostics.map((entry) => h('div', { class: 'list-row' },
        h('span', { class: `badge ${OUTCOME[entry.outcome]?.[1] ?? ''}` }, OUTCOME[entry.outcome]?.[0] ?? entry.outcome),
        h('span', { class: 'grow' }, entry.device || 'Aparelho'), h('span', { class: 'meta' }, `${entry.ip} · ${new Date(entry.at).toLocaleString('pt-BR')}`))))
      : h('p', { class: 'caption' }, 'Nenhum teste feito ainda.');

    clear(panel,
      card('Modo de segurança da rede', 'Define como os aparelhos dos alunos se conectam a este computador.',
        modes,
        !data.https.running ? notice('O HTTPS não está disponível neste computador agora' + (data.https.error ? `: ${data.https.error}` : '.'), 'warn') : null,
        notice('Em qualquer modo, estas proteções ficam sempre ligadas: acesso do aluno com validade curta, vínculo do aluno ao primeiro aparelho (troca só com “Liberar dispositivo”), registro de IP, entrada, saída e troca de aparelho, e alerta quando o mesmo aluno tenta entrar em dois aparelhos.'),
        notice('Requisito, não recomendação: use uma rede controlada (o hotspot do professor ou um Wi-Fi só da turma, com senha). Veja AUDIT.md.', 'warn')),
      card('Validade do acesso do aluno', 'Quanto tempo o acesso de um aparelho continua válido sem sinal. Enquanto a prova está aberta, ele se renova sozinho a cada 10 segundos.',
        h('div', { class: 'row' }, field('Minutos (2 a 120)', ttl), saveTtl)),
      card('Diagnóstico HTTPS', 'Descubra se os Chromebooks da escola aceitam o certificado do Atlas antes de mudar o modo.',
        diagUrl ? h('p', {}, 'Num Chromebook na mesma rede, abra: ', h('code', { class: 'mono-name' }, diagUrl)) : notice('Conecte este computador ao Wi-Fi da sala para ver o endereço.', 'warn'),
        data.https.running ? h('p', { class: 'caption' }, `Certificado autoassinado deste computador · impressão digital ${data.https.fingerprint} · válido até ${new Date(data.https.validTo).toLocaleDateString('pt-BR')} · porta HTTPS ${data.https.port}`) : null,
        h('h3', { class: 'headline' }, 'Resultados dos aparelhos'), results,
        data.diagnostics.length ? button('Limpar resultados', async () => { await api('/api/security/diagnostics', { method: 'DELETE' }); data.diagnostics = []; draw(); }, { kind: 'quiet', status }) : null));
  }
  draw();
}
