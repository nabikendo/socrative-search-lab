import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readSheet } from 'read-excel-file/node';
import { openStore, BackupError } from './lib/store.mjs';
import { detectKind, convertDocx, MAX_DOCUMENT_BYTES } from './lib/documents.mjs';
import { ExamError, normalizeQuestions, scoreSession, studentQuestions } from './shared/exam.js';
import { parseRosterRows } from './shared/roster.js';
import { skillLabel } from './shared/skills.js';

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
  const devices = new Map(); // aparelhos de alunos que abriram a página (para o diagnóstico de rede)

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
    id: exam.id, title: exam.title, shuffle: exam.shuffle, feedback: exam.feedback,
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
        sessionId: s.id, number: s.number, name: s.name || roster.get(s.number)?.name || 'Aluno fora da lista', className: s.className || roster.get(s.number)?.className || '',
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

  function simplePdf(lines) {
    const clean = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '?');
    const wrapped = lines.flatMap((line) => {
      const text = clean(line);
      if (!text) return [''];
      const parts = [];
      for (let i = 0; i < text.length; i += 88) parts.push(text.slice(i, i + 88));
      return parts;
    });
    const pageLines = [];
    for (let i = 0; i < wrapped.length; i += 48) pageLines.push(wrapped.slice(i, i + 48));
    const objects = [];
    const add = (value) => { objects.push(value); return objects.length; };
    const catalog = add('');
    const pages = add('');
    const regular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const pageIds = [];
    for (const page of pageLines) {
      let stream = 'BT\n/F1 10 Tf\n50 790 Td\n14 TL\n';
      page.forEach((line, index) => {
        if (index === 0 && pageIds.length === 0) stream += '/F2 14 Tf\n';
        stream += `(${line.replace(/[\\()]/g, '\\$&')}) Tj\nT*\n`;
        if (index === 0 && pageIds.length === 0) stream += '/F1 10 Tf\n';
      });
      stream += 'ET';
      const streamId = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
      pageIds.push(add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${streamId} 0 R >>`));
    }
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`;
    objects[pages - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
    let output = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, i) => { offsets.push(Buffer.byteLength(output, 'latin1')); output += `${i + 1} 0 obj\n${object}\nendobj\n`; });
    const xref = Buffer.byteLength(output, 'latin1');
    output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => { output += `${String(offset).padStart(10, '0')} 00000 n \n`; });
    output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(output, 'latin1');
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
  const seenDevice = (req) => {
    const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    if (ip && ip !== '127.0.0.1' && ip !== '::1') devices.set(ip, Date.now());
  };
  route('GET', '/api/open-exam', ({ req }) => {
    seenDevice(req);
    const exam = store.getOpenExam();
    return { exam: exam ? { title: exam.title } : null };
  });
  route('POST', '/api/identify', async ({ req }) => {
    limit(req, 'identify', 30);
    const input = await readJson(req);
    const exam = openExamWithCode(input.code);
    const number = String(input.number ?? '').trim();
    const student = exam.classId ? store.classRoster(exam.classId).find((r) => r.number === number) : store.findStudent(number);
    if (!student) throw new HttpError(404, 'student_not_found', 'Número não encontrado na lista.');
    return { student: { number: student.number, name: student.name }, exam: { title: exam.title } };
  });
  route('POST', '/api/session/start', async ({ req }) => {
    limit(req, 'start', 30);
    const input = await readJson(req);
    const exam = openExamWithCode(input.code);
    const student = exam.classId ? store.classRoster(exam.classId).find((r) => r.number === String(input.number ?? '').trim()) : store.findStudent(String(input.number ?? '').trim());
    if (!student) throw new HttpError(404, 'student_not_found', 'Número não encontrado na lista.');

    let session = store.findSession(exam.id, student.number);
    if (!session) session = store.createSession(exam.id, student.number, student);
    else if (session.status === 'submitted') throw new HttpError(409, 'already_submitted', 'Esta prova já foi enviada. Fale com o professor.');
    else if (!same(session.token, String(input.token || ''))) {
      if (isOnline(session)) throw new HttpError(409, 'session_in_use', 'Este número já está em uso em outro aparelho.');
      session = store.rotateToken(session.id); // aluno trocou de aparelho depois que o anterior ficou inativo
    }
    lastSeen.set(session.id, Date.now());
    return { session: { id: session.id, token: session.token }, student: { number: student.number, name: student.name, className: student.className }, exam: publicExam(exam), answers: store.getAnswers(session.id) };
  });
  route('POST', '/api/session/heartbeat', async ({ req }) => {
    const session = studentSession(await readJson(req));
    seenDevice(req);
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
  route('POST', '/api/session/feedback', async ({ req }) => {
    const input = await readJson(req);
    const session = studentSession(input);
    const exam = needExam(session.examId);
    if (!exam.feedback) throw new HttpError(403, 'feedback_disabled');
    if (!store.getAnswers(session.id)[String(input.questionId || '')]) throw new HttpError(404, 'answer_required');
    const question = exam.questions.find((x) => x.id === String(input.questionId));
    if (!question || (question.type === 'choice' && !question.correct) || (question.type === 'text' && !question.explanation)) throw new HttpError(404, 'feedback_unavailable');
    return { correct: question.correct || null, explanation: question.explanation || '' };
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
  route('GET', '/api/classes', { admin: true }, () => ({ classes: store.listClasses() }));
  route('POST', '/api/classes', { admin: true }, async ({ req }) => {
    const input = await readJson(req);
    const rows = parseRosterRows((input.roster || []).map((r) => [r.number, r.name]));
    if (!rows.length) throw new HttpError(400, 'roster_required', 'A lista está vazia.');
    try { return { ok: true, class: store.saveClass(input.name, rows, input.id || null) }; }
    catch (error) { throw new HttpError(409, 'class_name_conflict', error.message || 'Não foi possível salvar a turma.'); }
  });
  route('GET', '/api/classes/:id/roster', { admin: true }, ({ params }) => {
    if (!store.getClass(params.id)) throw new HttpError(404, 'class_not_found');
    return { roster: store.classRoster(params.id) };
  });
  route('POST', '/api/roster', { admin: true }, async ({ req }) => {
    const input = await readJson(req);
    if (!Array.isArray(input.roster) || !input.roster.length) throw new HttpError(400, 'roster_required', 'A lista está vazia.');
    const rows = parseRosterRows(input.roster.map((r) => [r.number, r.name, r.className]));
    if (!rows.length) throw new HttpError(400, 'roster_invalid', 'Nenhum aluno válido na lista.');
    return { ok: true, count: store.replaceRoster(rows) };
  });
  route('POST', '/api/roster/parse-xlsx', { admin: true }, async ({ req }) => {
    const buffer = await readBody(req, 5_000_000);
    try {
      const sheet = await readSheet(buffer);
      const counts = new Map();
      for (const row of sheet) {
        const number = String(row?.[0] ?? '').trim();
        if (/^\d{1,3}$/.test(number)) counts.set(String(Number(number)), (counts.get(String(Number(number))) || 0) + 1);
      }
      return { roster: parseRosterRows(sheet), duplicates: [...counts].filter(([, count]) => count > 1).map(([number, count]) => ({ number, count })) };
    }
    catch { throw new HttpError(422, 'invalid_spreadsheet', 'Não consegui ler esta planilha. Use um arquivo .xlsx.'); }
  });
  route('GET', '/api/question-bank', { admin: true }, () => ({ questions: store.listBankQuestions() }));
  route('POST', '/api/question-bank', { admin: true }, async ({ req }) => {
    try { return { question: store.saveBankQuestion(await readJson(req)) }; }
    catch (error) { throw new HttpError(400, error.code || 'invalid_question', error.message); }
  });
  route('DELETE', '/api/question-bank/:id', { admin: true }, ({ params }) => { store.deleteBankQuestion(params.id); return { ok: true }; });

  route('GET', '/api/exams', { admin: true }, () => ({ exams: store.listExams().map(({ questions, document, ...e }) => ({ ...e, questionCount: questions.length, document })) }));
  route('GET', '/api/exams/:id', { admin: true }, ({ params }) => ({ exam: needExam(params.id) }));
  route('POST', '/api/exams', { admin: true }, async ({ req }) => {
    const input = await readJson(req);
    const title = String(input.title ?? '').trim().slice(0, 120);
    if (!title) throw new HttpError(400, 'title_required', 'Dê um título à prova.');
    const existingDocument = input.id ? needExam(String(input.id)).document : null;
    if (!Array.isArray(input.questions) || (!input.questions.length && !existingDocument)) {
      throw new HttpError(400, 'questions_or_document_required', 'Adicione questões ou anexe o PDF da prova antes de salvar.');
    }
    if (input.id) {
      const current = needExam(String(input.id));
      if (store.hasSessions(current.id)) {
        const classChanged = input.classId !== undefined && (input.classId || null) !== current.classId;
        const feedbackChanged = input.feedback !== undefined && !!input.feedback !== current.feedback;
        if (JSON.stringify(normalizeQuestions(input.questions)) !== JSON.stringify(current.questions) || classChanged || feedbackChanged) throw new HttpError(409, 'exam_has_sessions', 'Já existem respostas. Duplique a prova para alterar questões, turma ou feedback.');
      }
    }
    if (input.classId && !store.getClass(String(input.classId))) throw new HttpError(400, 'class_not_found');
    return { ok: true, exam: store.saveExam({ id: input.id ? String(input.id) : null, title, questions: input.questions, shuffle: input.shuffle, classId: input.classId, feedback: input.feedback }) };
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
  route('GET', '/api/sessions/:id/report.pdf', { admin: true }, ({ res, params }) => {
    const session = needSession(params.id);
    const exam = needExam(session.examId);
    const result = resultsFor(exam).find((r) => r.sessionId === session.id);
    const lines = [
      'ATLAS - RELATORIO INDIVIDUAL', `Prova: ${exam.title}`, `Estudante: ${result.name} - numero ${result.number}`,
      `Turma: ${result.className || 'Nao informada'}`, `Situacao: ${result.status === 'submitted' ? 'Entregue' : 'Em andamento'}`,
      `Nota: ${result.score} / ${result.max}`, '', 'RESPOSTAS',
      ...exam.questions.flatMap((q, i) => [`${i + 1}. ${q.text}`, `Habilidade: ${skillLabel(q.skill) || 'Nao informada'} | Nota: ${result.detail[q.id]?.earned ?? 'Pendente'} / ${q.weight}`, `Resposta: ${result.answers[q.id] || 'Sem resposta'}`, '']),
    ];
    const pdf = simplePdf(lines);
    res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': pdf.length, 'content-disposition': `attachment; filename="atlas-relatorio-${session.number}.pdf"`, 'cache-control': 'no-store' });
    res.end(pdf); return null;
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

  // diagnóstico de rede: ajuda o professor a descobrir por que os alunos não entram
  route('GET', '/api/diagnostics', { admin: true }, async ({ req }) => {
    const port = req.socket.localPort;
    const VIRTUAL = /docker|veth|vmnet|vbox|virtual|wsl|hyper-v|vethernet|tailscale|zerotier|loopback|tun|tap/i;
    const interfaces = Object.entries(os.networkInterfaces()).flatMap(([name, list]) => (list || [])
      .filter((i) => i.family === 'IPv4' && !i.internal).map((i) => ({ name, address: i.address, virtual: VIRTUAL.test(name), linkLocal: i.address.startsWith('169.254.') })));
    const urls = await Promise.all(lanUrls(port).map(async (url) => {
      try { const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) }); return { url, reachable: r.ok }; }
      catch { return { url, reachable: false }; }
    }));
    const t = Date.now();
    const seen = [...devices].filter(([, at]) => t - at < 60_000).map(([ip, at]) => ({ ip, secondsAgo: Math.round((t - at) / 1000) })).sort((a, b) => a.secondsAgo - b.secondsAgo);
    for (const [ip, at] of devices) if (t - at > 3600_000) devices.delete(ip);
    const classStudents = store.listClasses().reduce((sum, c) => sum + c.students, 0);
    return { port, interfaces, urls, devices: seen, examOpen: !!store.getOpenExam(), students: store.getRoster().length + classStudents };
  });

  // backup manual: um único arquivo .atlas com banco e anexos
  route('GET', '/api/backup', { admin: true }, ({ res }) => {
    const day = new Date().toISOString().slice(0, 10);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="atlas-backup-${day}.atlas"`, 'cache-control': 'no-store' });
    res.end(JSON.stringify(store.exportBackup()));
    return null;
  });
  route('POST', '/api/restore', { admin: true }, async ({ req }) => {
    const raw = await readBody(req, 400_000_000);
    let input;
    try { input = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(422, 'invalid_backup', 'Este arquivo não é um backup válido do Atlas.'); }
    try { return { ok: true, ...store.restoreBackup(input) }; }
    catch (error) { if (error instanceof BackupError) throw new HttpError(422, 'invalid_backup', error.message); throw error; }
  });

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

// ---------- execução direta: `npm start` ou os arquivos "Iniciar-Atlas"
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8080);
  const dataDir = process.env.ATLAS_DATA_DIR || path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  // PIN fixo: fica guardado em data/pin.txt para o professor não precisar decorar um novo a cada aula.
  const pinFile = path.join(dataDir, 'pin.txt');
  let pin = process.env.ATLAS_PIN || (fs.existsSync(pinFile) ? fs.readFileSync(pinFile, 'utf8').trim() : '');
  if (!pin) { pin = String(crypto.randomInt(100000, 1000000)); fs.writeFileSync(pinFile, pin + '\n'); }

  const app = createApp({ dataDir, pin });
  if (!fs.existsSync(path.join(dist, 'index.html'))) console.warn('Aviso: faltam as telas do Atlas (pasta dist). Rode "npm run build" ou use o arquivo Iniciar-Atlas.');
  app.server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') console.error(`\n  A porta ${port} já está em uso. Provavelmente o Atlas já está aberto em outra janela.\n  Feche a outra janela e tente de novo (ou use outra porta: PORT=3000).\n`);
    else console.error(error);
    process.exit(1);
  });
  app.server.listen(port, '0.0.0.0', () => {
    const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i?.family === 'IPv4' && !i.internal).map((i) => i.address);
    console.log('  O Atlas está no ar.\n');
    console.log('  PROFESSOR (neste computador)');
    console.log(`    http://localhost:${port}/professor`);
    console.log(`    PIN: ${app.pin}\n`);
    console.log('  ALUNOS (celular, tablet ou Chromebook na mesma rede Wi-Fi)');
    for (const ip of ips) console.log(`    http://${ip}:${port}/prova`);
    if (!ips.length) console.log('    Nenhuma rede encontrada: conecte este computador ao Wi-Fi da sala.');
    console.log('\n  Dica: o painel do professor mostra um QR Code para os alunos.\n');
  });
  const stop = async () => { await app.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

