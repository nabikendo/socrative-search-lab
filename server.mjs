import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readSheet } from 'read-excel-file/node';
import { openStore } from './lib/store.mjs';
import { detectKind, convertDocx, MAX_DOCUMENT_BYTES } from './lib/documents.mjs';
import { ExamError, normalizeQuestions, scoreSession, studentQuestions } from './shared/exam.js';
import { parseRosterRows } from './shared/roster.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const ONLINE_MS = 30_000;
const ADMIN_TTL_MS = 12 * 3600_000;

class HttpError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}

export function createApp({ dataDir = path.join(root, 'data'), pin = process.env.ATLAS_PIN || String(crypto.randomInt(100000, 1000000)) } = {}) {
  const store = openStore(dataDir);
  const adminSessions = new Map();
  const lastSeen = new Map(); // batimentos ficam só na memória: não geram escrita em disco
  const buckets = new Map();

  // ---------- utilidades
  const same = (a, b) => {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
  };
  function limit(req, name, max, windowMs = 60_000) {
    const key = `${name}:${req.socket.remoteAddress}`;
    const t = Date.now();
    const b = buckets.get(key);
    if (!b || b.reset < t) { buckets.set(key, { count: 1, reset: t + windowMs }); return; }
    if (++b.count > max) throw new HttpError(429, 'too_many_requests', 'Muitas tentativas. Aguarde um minuto.');
  }
  setInterval(() => { const t = Date.now(); for (const [k, v] of buckets) if (v.reset < t) buckets.delete(k); for (const [k, v] of adminSessions) if (v < t) adminSessions.delete(k); }, 60_000).unref();

  const cookie = (req, name) => (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
  const isAdmin = (req) => { const t = cookie(req, 'atlas_admin'); return !!t && (adminSessions.get(t) ?? 0) > Date.now(); };

  async function readBody(req, maxBytes) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBytes) throw new HttpError(413, 'payload_too_large', 'Arquivo grande demais.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  async function readJson(req) {
    const raw = await readBody(req, 1_000_000);
    if (!raw.length) return {};
    try { return JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'invalid_json'); }
  }

  const sendJson = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
  };

  // ---------- regras
  const isOnline = (s) => s.status !== 'submitted' && Date.now() - Math.max(s.lastSeen, lastSeen.get(s.id) || 0) < ONLINE_MS;
  const publicExam = (exam) => ({
    id: exam.id, title: exam.title,
    questions: studentQuestions(exam.questions),
    document: exam.document ? { id: exam.document.id, name: exam.document.name, kind: exam.document.kind, html: exam.document.kind === 'docx' ? store.getDocument(exam.document.id)?.html : undefined } : null,
  });
  function openExamWithCode(code) {
    const exam = store.getOpenExam();
    if (!exam) throw new HttpError(409, 'exam_closed', 'A prova ainda não está aberta.');
    if (!same(String(code ?? ''), exam.accessCode)) throw new HttpError(403, 'invalid_code', 'Código incorreto.');
    return exam;
  }
  function studentSession(input) {
    const session = store.getSession(String(input.sessionId || ''));
    if (!session || !same(session.token, String(input.token || ''))) throw new HttpError(401, 'invalid_session');
    return session;
  }
  const needExam = (id) => store.getExam(id) ?? (() => { throw new HttpError(404, 'exam_not_found'); })();
  const needSession = (id) => store.getSession(id) ?? (() => { throw new HttpError(404, 'session_not_found'); })();

  function resultsFor(exam) {
    const roster = new Map(store.getRoster().map((r) => [r.number, r]));
    const answers = store.answersForExam(exam.id);
    const grades = store.gradesForExam(exam.id);
    return store.listSessions(exam.id).map((s) => {
      const given = answers[s.id] || {};
      const result = scoreSession(exam, given, grades[s.id]);
      return {
        sessionId: s.id, number: s.number, name: roster.get(s.number)?.name || 'Aluno fora da lista', className: roster.get(s.number)?.className || '',
        status: s.status, online: isOnline(s), startedAt: s.startedAt, submittedAt: s.submittedAt,
        answered: Object.values(given).filter(Boolean).length, total: exam.questions.length,
        score: result.score, max: result.max, pending: result.pending, detail: result.detail, answers: given, grades: grades[s.id] || {},
      };
    });
  }

  const csvCell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // evita execução de fórmulas ao abrir no Excel
    return /[";\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const decimal = (n) => String(n).replace('.', ',');
  function examCsv(exam) {
    const rows = [['numero', 'nome', 'turma', 'status', 'inicio', 'envio', 'nota', 'maximo', 'pendentes', ...exam.questions.map((q, i) => `Q${i + 1} — ${q.text}`)]];
    for (const r of resultsFor(exam)) {
      rows.push([r.number, r.name, r.className, r.status === 'submitted' ? 'enviada' : 'em andamento', r.startedAt, r.submittedAt || '', decimal(r.score), decimal(r.max), r.pending, ...exam.questions.map((q) => r.answers[q.id] || '')]);
    }
    return '\uFEFF' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
  }

  function lanUrls(port) {
    const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
    return Object.values(os.networkInterfaces()).flat().filter((i) => i?.family === 'IPv4' && !i.internal)
      .map((i) => i.address).sort((a, b) => rank(a) - rank(b)).map((ip) => `http://${ip}:${port}`);
  }

  // ---------- rotas
  const routes = [];
  const route = (method, pattern, opts, handler) => {
    if (typeof opts === 'function') { handler = opts; opts = {}; }
    const keys = [];
    const regex = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, regex, keys, admin: !!opts.admin, handler });
  };

  // público
  route('GET', '/api/health', () => ({ ok: true }));
  route('GET', '/api/open-exam', () => {
    const exam = store.getOpenExam();
    return { exam: exam ? { title: exam.title } : null };
  });
  route('POST', '/api/identify', async ({ req }) => {
    limit(req, 'identify', 30);
    const input = await readJson(req);
    const exam = openExamWithCode(input.code);
    const student = store.findStudent(String(input.number ?? '').trim());
    if (!student) throw new HttpError(404, 'student_not_found', 'Número não encontrado na lista.');
    return { student: { number: student.number, name: student.name }, exam: { title: exam.title } };
  });
  route('POST', '/api/session/start', async ({ req }) => {
    limit(req, 'start', 30);
    const input = await readJson(req);
    const exam = openExamWithCode(input.code);
    const student = store.findStudent(String(input.number ?? '').trim());
    if (!student) throw new HttpError(404, 'student_not_found', 'Número não encontrado na lista.');

    let session = store.findSession(exam.id, student.number);
    if (!session) session = store.createSession(exam.id, student.number);
    else if (session.status === 'submitted') throw new HttpError(409, 'already_submitted', 'Esta prova já foi enviada. Fale com o professor.');
    else if (!same(session.token, String(input.token || ''))) {
      if (isOnline(session)) throw new HttpError(409, 'session_in_use', 'Este número já está em uso em outro aparelho.');
      session = store.rotateToken(session.id); // aluno trocou de aparelho depois que o anterior ficou inativo
    }
    lastSeen.set(session.id, Date.now());
    return { session: { id: session.id, token: session.token }, student: { number: student.number, name: student.name }, exam: publicExam(exam), answers: store.getAnswers(session.id) };
  });
  route('POST', '/api/session/heartbeat', async ({ req }) => {
    const session = studentSession(await readJson(req));
    lastSeen.set(session.id, Date.now());
    const exam = store.getExam(session.examId);
    return { ok: true, examOpen: exam?.status === 'open', submitted: session.status === 'submitted' };
  });
  route('POST', '/api/answer', async ({ req }) => {
    const input = await readJson(req);
    const session = studentSession(input);
    if (session.status === 'submitted') throw new HttpError(409, 'session_closed', 'Prova já enviada.');
    const exam = store.getExam(session.examId);
    if (exam.status !== 'open') throw new HttpError(409, 'exam_closed', 'O professor encerrou a prova.');
    const question = exam.questions.find((x) => x.id === String(input.questionId));
    if (!question) throw new HttpError(400, 'unknown_question');
    const answer = String(input.answer ?? '').slice(0, 5000);
    if (question.type === 'choice' && answer && !question.options.includes(answer)) throw new HttpError(400, 'invalid_answer');
    store.saveAnswer(session.id, question.id, answer);
    lastSeen.set(session.id, Date.now());
    return { ok: true };
  });
  route('POST', '/api/session/submit', async ({ req }) => {
    const session = studentSession(await readJson(req));
    store.submit(session.id);
    return { ok: true };
  });
  route('GET', '/api/document/:id', ({ req, res, params }) => {
    const doc = store.getDocument(params.id);
    const exam = doc && store.getExam(doc.exam_id);
    if (!doc || doc.kind !== 'pdf' || !(isAdmin(req) || exam?.status === 'open')) throw new HttpError(404, 'document_not_found');
    const file = path.join(store.documentDir, doc.file);
    if (!fs.existsSync(file)) throw new HttpError(404, 'document_not_found');
    res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': fs.statSync(file).size, 'cache-control': 'no-store', 'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(doc.name)}` });
    fs.createReadStream(file).pipe(res);
    return null;
  });

  // autenticação do professor
  route('POST', '/api/auth/login', async ({ req, res }) => {
    limit(req, 'login', 8);
    const input = await readJson(req);
    if (!same(String(input.pin ?? ''), pin)) throw new HttpError(403, 'invalid_pin', 'PIN incorreto.');
    const token = crypto.randomBytes(32).toString('hex');
    adminSessions.set(token, Date.now() + ADMIN_TTL_MS);
    sendJson(res, 200, { ok: true }, { 'set-cookie': `atlas_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ADMIN_TTL_MS / 1000}` });
    return null;
  });
  route('POST', '/api/auth/logout', ({ req, res }) => {
    adminSessions.delete(cookie(req, 'atlas_admin'));
    sendJson(res, 200, { ok: true }, { 'set-cookie': 'atlas_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    return null;
  });
  route('GET', '/api/auth/status', ({ req }) => ({ authenticated: isAdmin(req) }));

  // professor
  route('GET', '/api/network', { admin: true }, ({ req }) => ({ urls: lanUrls(req.socket.localPort) }));
  route('GET', '/api/roster', { admin: true }, () => ({ roster: store.getRoster() }));
  route('POST', '/api/roster', { admin: true }, async ({ req }) => {
    const input = await readJson(req);
    if (!Array.isArray(input.roster) || !input.roster.length) throw new HttpError(400, 'roster_required', 'A lista está vazia.');
    const rows = parseRosterRows(input.roster.map((r) => [r.number, r.name, r.className]));
    if (!rows.length) throw new HttpError(400, 'roster_invalid', 'Nenhum aluno válido na lista.');
    return { ok: true, count: store.replaceRoster(rows) };
  });
  route('POST', '/api/roster/parse-xlsx', { admin: true }, async ({ req }) => {
    const buffer = await readBody(req, 5_000_000);
    try { return { roster: parseRosterRows(await readSheet(buffer)) }; }
    catch { throw new HttpError(422, 'invalid_spreadsheet', 'Não consegui ler esta planilha. Use um arquivo .xlsx.'); }
  });

  route('GET', '/api/exams', { admin: true }, () => ({ exams: store.listExams().map(({ questions, document, ...e }) => ({ ...e, questionCount: questions.length, document })) }));
  route('GET', '/api/exams/:id', { admin: true }, ({ params }) => ({ exam: needExam(params.id) }));
  route('POST', '/api/exams', { admin: true }, async ({ req }) => {
    const input = await readJson(req);
    const title = String(input.title ?? '').trim().slice(0, 120);
    if (!title) throw new HttpError(400, 'title_required', 'Dê um título à prova.');
    if (input.id) {
      const current = needExam(String(input.id));
      if (store.hasSessions(current.id)) {
        if (JSON.stringify(normalizeQuestions(input.questions)) !== JSON.stringify(current.questions)) throw new HttpError(409, 'exam_has_sessions', 'Já existem respostas. Duplique a prova para alterar as questões.');
      }
    }
    return { ok: true, exam: store.saveExam({ id: input.id ? String(input.id) : null, title, questions: input.questions }) };
  });
  route('DELETE', '/api/exams/:id', { admin: true }, ({ params }) => {
    needExam(params.id);
    if (store.hasSessions(params.id)) throw new HttpError(409, 'exam_has_sessions', 'Esta prova já tem respostas e não pode ser excluída.');
    store.deleteExam(params.id);
    return { ok: true };
  });
  route('POST', '/api/exams/:id/open', { admin: true }, ({ params }) => { needExam(params.id); return { ok: true, code: store.openExam(params.id) }; });
  route('POST', '/api/exams/:id/close', { admin: true }, ({ params }) => { needExam(params.id); store.closeExam(params.id); return { ok: true }; });
  route('POST', '/api/exams/:id/document', { admin: true }, async ({ req, url, params }) => {
    needExam(params.id);
    const buffer = await readBody(req, MAX_DOCUMENT_BYTES);
    const kind = detectKind(buffer);
    if (!kind) throw new HttpError(415, 'unsupported_document', 'Envie um arquivo PDF ou DOCX válido.');
    const name = (url.searchParams.get('name') || `prova.${kind}`).replace(/[\\/\r\n"]/g, '_').slice(0, 120);
    let html;
    if (kind === 'docx') {
      try { html = await convertDocx(buffer); } catch { throw new HttpError(422, 'invalid_document', 'Não consegui ler este DOCX.'); }
    }
    const file = `${crypto.randomBytes(16).toString('hex')}.${kind}`;
    fs.writeFileSync(path.join(store.documentDir, file), buffer);
    return { ok: true, document: store.setDocument(params.id, { name, kind, size: buffer.length, file, html }) };
  });
  route('DELETE', '/api/exams/:id/document', { admin: true }, ({ params }) => { needExam(params.id); store.removeDocument(params.id); return { ok: true }; });
  route('GET', '/api/exams/:id/results', { admin: true }, ({ params }) => {
    const exam = needExam(params.id);
    return { exam: { id: exam.id, title: exam.title, status: exam.status, questions: exam.questions }, results: resultsFor(exam) };
  });
  route('GET', '/api/exams/:id/export.csv', { admin: true }, ({ res, params }) => {
    const exam = needExam(params.id);
    const slug = exam.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'prova';
    res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${slug}.csv"`, 'cache-control': 'no-store' });
    res.end(examCsv(exam));
    return null;
  });
  route('POST', '/api/grade', { admin: true }, async ({ req }) => {
    const input = await readJson(req);
    const session = needSession(String(input.sessionId || ''));
    const question = needExam(session.examId).questions.find((x) => x.id === String(input.questionId));
    if (!question) throw new HttpError(400, 'unknown_question');
    if (input.score === null || input.score === '') { store.setGrade(session.id, question.id, null); return { ok: true }; }
    const score = Number(input.score);
    if (!Number.isFinite(score) || score < 0 || score > question.weight) throw new HttpError(400, 'invalid_score', `A nota deve estar entre 0 e ${question.weight}.`);
    store.setGrade(session.id, question.id, score);
    return { ok: true };
  });
  route('POST', '/api/sessions/:id/reopen', { admin: true }, ({ params }) => { needSession(params.id); store.reopen(params.id); return { ok: true }; });


  // ---------- arquivos estáticos
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
  const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self' blob:; frame-src 'self'; object-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
  function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname).replace(/\/+$/, '') || '/';
    if (rel === '/') rel = '/index.html';
    else if (rel === '/professor') rel = '/professor.html';
    else if (rel === '/prova') rel = '/prova.html';
    const file = path.normalize(path.join(dist, rel));
    if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) throw new HttpError(404, 'not_found');
    const ext = path.extname(file);
    const headers = { 'content-type': TYPES[ext] || 'application/octet-stream', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
    if (ext === '.html') { headers['content-security-policy'] = CSP; headers['cache-control'] = 'no-cache'; }
    else if (rel.startsWith('/assets/')) headers['cache-control'] = 'public, max-age=31536000, immutable';
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  const sameOrigin = (origin, host) => { try { return new URL(origin).host === host; } catch { return false; } };

  // ---------- servidor
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed');
        return serveStatic(req, res, url.pathname);
      }
      const method = req.method === 'HEAD' ? 'GET' : req.method;
      const origin = req.headers.origin;
      if (method !== 'GET' && origin && !sameOrigin(origin, req.headers.host)) throw new HttpError(403, 'bad_origin');
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = url.pathname.match(r.regex);
        if (!m) continue;
        if (r.admin && !isAdmin(req)) throw new HttpError(401, 'teacher_auth_required', 'Entre com o PIN do professor.');
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const result = await r.handler({ req, res, url, params });
        if (result !== null && result !== undefined) sendJson(res, 200, result);
        return;
      }
      throw new HttpError(404, 'api_not_found');
    } catch (error) {
      if (res.headersSent) return res.end();
      if (error instanceof HttpError) return sendJson(res, error.status, { error: error.code, message: error.message });
      if (error instanceof ExamError) return sendJson(res, 400, { error: error.code, message: error.message });
      console.error(error);
      sendJson(res, 500, { error: 'server_error', message: 'Erro interno do servidor.' });
    }
  });

  const backupTimer = setInterval(() => store.snapshot(), 5 * 60_000);
  backupTimer.unref();
  const close = () => new Promise((resolve) => { clearInterval(backupTimer); server.close(() => { store.close(); resolve(); }); server.closeAllConnections?.(); });
  return { server, store, pin, close };
}

// ---------- execução direta: `npm start`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8080);
  const app = createApp({ dataDir: process.env.ATLAS_DATA_DIR || path.join(root, 'data') });
  if (!fs.existsSync(path.join(dist, 'index.html'))) console.warn('Aviso: a pasta dist/ não existe. Rode "npm run build" antes de iniciar.');
  app.server.listen(port, '0.0.0.0', () => {
    console.log(`\n  Atlas está no ar.\n`);
    console.log(`  Professor   http://localhost:${port}/professor`);
    for (const ip of Object.values(os.networkInterfaces()).flat().filter((i) => i?.family === 'IPv4' && !i.internal)) console.log(`  Alunos      http://${ip.address}:${port}/prova`);
    console.log(`\n  PIN do professor: ${app.pin}\n`);
  });
  const stop = async () => { await app.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
