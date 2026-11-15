import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readSheet } from 'read-excel-file/node';
import JSZip from 'jszip';
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

export function createApp({ dataDir = path.join(root, 'data'), pin = process.env.ATLAS_PIN || String(crypto.randomInt(100000, 1000000)), desktopProfiles, exportDir } = {}) {
  const store = openStore(dataDir);
  const adminSessions = new Map();
  const lastSeen = new Map(); // batimentos ficam só na memória: não geram escrita em disco
  const buckets = new Map();
  const awayNow = new Map(); // alunos que saíram da página da prova agora (sessionId -> início)
  let watchedExamId = null; // prova aberta que acompanhamos para copiar quando ela terminar sozinha
  const awayLogged = new Set(); // evita contar duas vezes o mesmo retorno reenviado
  const devices = new Map(); // aparelhos de alunos que abriram a página (para o diagnóstico de rede)

  // ---------- utilidades
  const same = (a, b) => {
    const ha = crypto.hash('sha256', String(a), 'buffer');
    const hb = crypto.hash('sha256', String(b), 'buffer');
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
    store.activateSchedules();
    const exam = store.getOpenExam();
    if (!exam) throw new HttpError(409, 'exam_closed', 'A prova ainda não está aberta.');
    if (!same(String(code ?? ''), exam.accessCode)) throw new HttpError(403, 'invalid_code', 'Código incorreto.');
    if (exam.status === 'paused') throw new HttpError(423, 'exam_paused', 'A prova está pausada. Aguarde o professor.');
    return exam;
  }
  function studentSession(input) {
    const session = store.getSession(String(input.sessionId || ''));
    if (!session || !same(session.token, String(input.token || ''))) throw new HttpError(401, 'invalid_session');
    return session;
  }
  function accommodation(studentId) {
    return studentId ? store.getAccommodation(studentId) : {};
  }
  function applicationEnded(exam, studentId) {
    return exam.scheduledEnd && Date.now() >= Date.parse(exam.scheduledEnd) + Number(accommodation(studentId).extraMinutes || 0) * 60_000;
  }
  const needExam = (id) => store.getExam(id) ?? (() => { throw new HttpError(404, 'exam_not_found'); })();
  const needSession = (id) => store.getSession(id) ?? (() => { throw new HttpError(404, 'session_not_found'); })();

  function resultsFor(exam) {
    const roster = new Map(store.getRoster().map((r) => [r.number, r]));
    const answers = store.answersForExam(exam.id);
    const grades = store.gradesForExam(exam.id);
    const awaySummary = store.awaySummary();
    return store.listSessions(exam.id).map((s) => {
      const given = { ...(answers[s.id] || {}) };
      for (const question of exam.questions) if (question.type === 'multi' && typeof given[question.id] === 'string') {
        try { given[question.id] = JSON.parse(given[question.id]); } catch { given[question.id] = []; }
      }
      const result = scoreSession(exam, given, grades[s.id]);
      return {
        sessionId: s.id, number: s.number, name: s.name || roster.get(s.number)?.name || 'Aluno fora da lista', className: s.className || roster.get(s.number)?.className || '',
        away: { now: awayNow.has(s.id) && isOnline(s) && s.status !== 'submitted', count: awaySummary[s.id]?.count || 0, seconds: awaySummary[s.id]?.seconds || 0, events: awaySummary[s.id]?.events || [] },
        status: s.status, online: isOnline(s), startedAt: s.startedAt, submittedAt: s.submittedAt,
        answered: Object.values(given).filter((value)=>Array.isArray(value)?value.length>0:String(value??'').trim().length>0).length, total: exam.questions.length,
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
    const rows = [['numero', 'nome', 'turma', 'status', 'inicio', 'envio', 'nota', 'maximo', 'pendentes', 'saidas_da_pagina', 'segundos_fora', ...exam.questions.map((q, i) => `Q${i + 1} — ${q.text}`)]];
    for (const r of resultsFor(exam)) {
      rows.push([r.number, r.name, r.className, r.status === 'submitted' ? 'enviada' : 'em andamento', r.startedAt, r.submittedAt || '', decimal(r.score), decimal(r.max), r.pending, r.away.count, r.away.seconds, ...exam.questions.map((q) => r.answers[q.id] || '')]);
    }
    return '\uFEFF' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
  }

  function examXlsx(exam) {
    const results=resultsFor(exam);
    const rows=[['Número','Estudante','Turma','Situação','Início','Entrega','Nota','Máximo','Pendentes','Saídas da página','Segundos fora',...exam.questions.map((q,i)=>`Q${i+1} — ${q.text}`)],...results.map(r=>[r.number,r.name,r.className,r.status==='submitted'?'Entregue':r.status==='paused'?'Pausada':'Em andamento',r.startedAt,r.submittedAt||'',r.score,r.max,r.pending,r.away.count,r.away.seconds,...exam.questions.map(q=>Array.isArray(r.answers[q.id])?r.answers[q.id].join(', '):r.answers[q.id]||'')])];
    const xml=(value)=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
    const column=(index)=>{let name='';for(index++;index;index=Math.floor((index-1)/26))name=String.fromCharCode(65+(index-1)%26)+name;return name;};
    const sheet=rows.map((row,r)=>`<row r="${r+1}">${row.map((value,c)=>{const ref=`${column(c)}${r+1}`;if(typeof value==='number'&&Number.isFinite(value))return `<c r="${ref}"><v>${value}</v></c>`;return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;}).join('')}</row>`).join('');
    const zip=new JSZip();
    zip.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
    zip.file('_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    zip.file('xl/workbook.xml','<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Resultados" sheetId="1" r:id="rId1"/></sheets></workbook>');
    zip.file('xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
    zip.file('xl/worksheets/sheet1.xml',`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`);
    return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
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

  // 2026-11-15-08-30, no horário do computador (Temporal no Node 26 e no Electron novo; Date como reserva)
  function localStamp() {
    if (globalThis.Temporal) return Temporal.Now.plainDateTimeISO().toString({ smallestUnit: 'minute' }).replace(/[:T]/g, '-');
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}-${p(d.getMinutes())}`;
  }

  // cópia automática ao encerrar: planilha de notas + backup completo, numa pasta que pode ficar no OneDrive ou pendrive
  function saveCopy(exam) {
    if (!exportDir) return;
    try {
      fs.mkdirSync(exportDir, { recursive: true });
      const stamp = localStamp();
      const safe = String(exam.title || 'prova').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'prova';
      const name = `${safe}-${stamp}`;
      fs.writeFileSync(path.join(exportDir, `${name}.csv`), examCsv(exam), 'utf8');
      fs.writeFileSync(path.join(exportDir, `${name}.atlas`), JSON.stringify(store.exportBackup()));
      store.addAudit('exam_copy_saved', exam.id, name);
      pruneCopies();
    } catch (error) { console.error('Não foi possível salvar a cópia automática:', error.message); }
  }

  // guarda só as últimas 40 cópias para a pasta não crescer sem fim
  function pruneCopies(keep = 40) {
    const groups = new Map();
    for (const file of fs.readdirSync(exportDir)) {
      if (!/\.(csv|atlas)$/.test(file)) continue;
      const name = file.replace(/\.(csv|atlas)$/, '');
      const time = fs.statSync(path.join(exportDir, file)).mtimeMs;
      groups.set(name, Math.max(groups.get(name) || 0, time));
    }
    const old = [...groups].sort((a, b) => b[1] - a[1]).slice(keep).map(([name]) => name);
    for (const name of old) for (const ext of ['csv', 'atlas']) fs.rmSync(path.join(exportDir, `${name}.${ext}`), { force: true });
  }

  // 80 -> "1 min 20 s" (Intl.DurationFormat)
  function spokenDuration(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds));
    const parts = { hours: Math.floor(s / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60 };
    const present = Object.fromEntries(Object.entries(parts).filter(([, value]) => value));
    return new Intl.DurationFormat('pt-BR', { style: 'short' }).format(Object.keys(present).length ? present : { seconds: 0 });
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
    routes.push({ method, pattern: new URLPattern({ pathname: pattern }), admin: !!opts.admin, handler });
  };

  // público
  route('GET', '/api/health', () => ({ ok: true }));
  const seenDevice = (req) => {
    const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    if (ip && ip !== '127.0.0.1' && ip !== '::1') devices.set(ip, Date.now());
  };
  route('GET', '/api/open-exam', ({ req }) => {
    seenDevice(req);
    store.activateSchedules();
    const exam = store.getOpenExam();
    return { exam: exam ? { title: exam.title, paused:exam.status==='paused' } : null };
  });
  route('POST', '/api/join-requests', async ({ req }) => {
    limit(req, 'join-request', 10);
    const input = await readJson(req);
    const exam = openExamWithCode(input.code);
    const number = String(input.number || '').trim();
    const name = String(input.name || '').trim().slice(0,180);
    if (!/^\d{1,4}$/.test(number) || name.length < 2) throw new HttpError(400, 'invalid_student_request', 'Informe seu número e nome completo.');
    const students = exam.classId ? store.classRoster(exam.classId) : store.getRoster();
    if (students.some((s) => s.number === number)) throw new HttpError(409, 'student_already_listed', 'Você já está na lista. Tente entrar novamente.');
    try { store.createJoinRequest(exam.id, exam.classId, number, name); }
    catch { throw new HttpError(409, 'request_already_exists', 'Já existe uma solicitação para esse número. Aguarde o professor.'); }
    return { ok:true, message:'Pedido enviado ao professor. Aguarde a autorização e tente entrar novamente.' };
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

    if (applicationEnded(exam, student.id)) throw new HttpError(409, 'exam_closed', 'Seu tempo de prova terminou.');
    let session = store.findSession(exam.id, student.number);
    if (!session) session = store.createSession(exam.id, student.number, student);
    else if (session.status === 'submitted') throw new HttpError(409, 'already_submitted', 'Esta prova já foi enviada. Fale com o professor.');
    else if (!same(session.token, String(input.token || ''))) {
      if (isOnline(session)) throw new HttpError(409, 'session_in_use', 'Este número já está em uso em outro aparelho.');
      session = store.rotateToken(session.id); // aluno trocou de aparelho depois que o anterior ficou inativo
    }
    lastSeen.set(session.id, Date.now());
    return { session: { id: session.id, token: session.token }, student: { number: student.number, name: student.name, className: student.className, accommodation: accommodation(session.studentId) }, exam: publicExam(exam), answers: store.getAnswers(session.id) };
  });
  route('POST', '/api/session/heartbeat', async ({ req }) => {
    const session = studentSession(await readJson(req));
    seenDevice(req);
    store.activateSchedules();
    lastSeen.set(session.id, Date.now());
    const exam = store.getExam(session.examId);
    const endsAt = exam?.scheduledEnd ? Date.parse(exam.scheduledEnd) + Number(accommodation(session.studentId).extraMinutes || 0) * 60_000 : null;
    return { ok: true, serverNow: Date.now(), endsAt, examOpen: exam?.status === 'open' && !applicationEnded(exam, session.studentId), examPaused:exam?.status==='paused', studentPaused:session.status==='paused', submitted: session.status === 'submitted',
      receipt: session.submittedAt ? { number: session.id, submittedAt: session.submittedAt } : null };
  });
  route('POST', '/api/session/away', async ({ req }) => {
    limit(req, 'away', 120);
    const input = await readJson(req);
    const session = studentSession(input);
    const exam = store.getExam(session.examId);
    if (session.status === 'submitted' || !exam || !['open', 'paused'].includes(exam.status)) { awayNow.delete(session.id); return { ok: true }; }
    lastSeen.set(session.id, Date.now());
    if (input.state === 'away') { awayNow.set(session.id, Date.now()); return { ok: true }; }
    if (input.state !== 'back') throw new HttpError(400, 'invalid_state');
    awayNow.delete(session.id);
    const seconds = Math.min(Math.max(Math.round(Number(input.seconds) || 0), 0), 6 * 3600);
    const key = `${session.id}:${String(input.id || '').slice(0, 40)}`;
    if (seconds >= 1 && input.id && !awayLogged.has(key)) {
      if (awayLogged.size > 5000) awayLogged.clear();
      awayLogged.add(key);
      store.addAudit('student_away', session.id, String(seconds));
    }
    return { ok: true };
  });
  route('POST', '/api/session/restore', async ({ req }) => {
    limit(req, 'restore', 60);
    const session = studentSession(await readJson(req));
    store.activateSchedules();
    const exam = needExam(session.examId);
    if (session.status === 'submitted') return { receipt: { number: session.id, submittedAt: session.submittedAt } };
    if (!['open', 'paused'].includes(exam.status)) throw new HttpError(409, 'exam_closed', 'A prova foi encerrada.');
    lastSeen.set(session.id, Date.now());
    return {
      session: { id: session.id, token: session.token },
      student: { number: session.number, name: session.name, className: session.className, accommodation: accommodation(session.studentId) },
      exam: publicExam(exam), answers: store.getAnswers(session.id),
      paused: exam.status === 'paused' || session.status === 'paused',
      timeEnded: !!applicationEnded(exam, session.studentId),
    };
  });
  route('POST', '/api/session/review', async ({ req }) => {
    limit(req, 'review', 60);
    const session = studentSession(await readJson(req));
    const exam = needExam(session.examId);
    if (session.status !== 'submitted' || exam.status !== 'closed' || !exam.releaseAt || Date.parse(exam.releaseAt) > Date.now()) {
      throw new HttpError(409, 'review_unavailable', 'A devolutiva ainda não foi liberada.');
    }
    const result = resultsFor(exam).find((entry) => entry.sessionId === session.id);
    return { score: result.score, max: result.max, pending: result.pending, questions: exam.questions.map((question) => ({
      text: question.text, answer: result.answers[question.id], correct: question.correct,
      explanation: question.explanation, annulled: !!exam.annulled[question.id],
    })) };
  });
  route('POST', '/api/answer', async ({ req }) => {
    const input = await readJson(req);
    const session = studentSession(input);
    if (session.status === 'submitted') throw new HttpError(409, 'session_closed', 'Prova já enviada.');
    if (session.status === 'paused') throw new HttpError(423, 'session_paused', 'Sua prova foi pausada pelo professor.');
    const exam = store.getExam(session.examId);
    if (exam.status === 'paused') throw new HttpError(423, 'exam_paused', 'A prova está pausada pelo professor.');
    if (exam.status !== 'open' || applicationEnded(exam, session.studentId)) throw new HttpError(409, 'exam_closed', 'O tempo de prova terminou ou o professor encerrou a aplicação.');
    const question = exam.questions.find((x) => x.id === String(input.questionId));
    if (!question) throw new HttpError(400, 'unknown_question');
    let answer;
    if (question.type === 'multi') {
      if (!Array.isArray(input.answer) || input.answer.length > question.options.length || input.answer.some((value)=>!question.options.includes(value))) throw new HttpError(400,'invalid_answer');
      answer=JSON.stringify([...new Set(input.answer)]);
    } else {
      answer = String(input.answer ?? '').slice(0, 5000);
      if (question.type === 'choice' && answer && !question.options.includes(answer)) throw new HttpError(400, 'invalid_answer');
      if (question.type === 'numeric' && answer && !Number.isFinite(Number(answer.replace(',','.')))) throw new HttpError(400,'invalid_answer');
    }
    store.saveAnswer(session.id, question.id, answer);
    lastSeen.set(session.id, Date.now());
    return { ok: true };
  });
  route('POST', '/api/session/feedback', async ({ req }) => {
    const input = await readJson(req);
    const session = studentSession(input);
    const exam = needExam(session.examId);
    if (!exam.feedback) throw new HttpError(403, 'feedback_disabled');
    const question = exam.questions.find((x) => x.id === String(input.questionId));
    if (!question) throw new HttpError(404,'feedback_unavailable');
    const rawAnswer=store.getAnswers(session.id)[question.id];
    if (!rawAnswer || (question.type==='multi' && JSON.parse(rawAnswer).length===0)) throw new HttpError(404,'answer_required');
    if ((question.type === 'choice' && !question.correct) || (question.type === 'multi' && !question.correct?.length) || (question.type==='numeric'&&question.correct===undefined) || (question.type === 'text' && !question.explanation)) throw new HttpError(404, 'feedback_unavailable');
    return { correct: question.correct || null, explanation: question.explanation || '' };
  });
  route('POST', '/api/session/submit', async ({ req }) => {
    const session = studentSession(await readJson(req));
    if (session.status === 'paused' || store.getExam(session.examId)?.status === 'paused') throw new HttpError(423, 'exam_paused', 'A prova está pausada pelo professor.');
    store.submit(session.id);
    awayNow.delete(session.id);
    return { ok: true, receipt: { number: session.id, submittedAt: store.getSession(session.id).submittedAt } };
  });
  let ocrRunning = false;
  route('POST', '/api/documents/ocr-page', { admin: true }, async ({ req }) => {
    const image = await readBody(req, 8_000_000);
    if (!image.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
      throw new HttpError(415, 'invalid_image', 'A página precisa estar em formato PNG.');
    }
    if (ocrRunning) throw new HttpError(429, 'ocr_busy', 'Já há uma página sendo reconhecida.');
    ocrRunning = true;
    try {
      const text = await new Promise((resolve, reject) => {
        const child = execFile(process.env.ATLAS_TESSERACT || 'tesseract', ['stdin', 'stdout', '-l', 'por'], {
          timeout: 60_000, maxBuffer: 1_000_000, windowsHide: true,
        }, (error, stdout) => error ? reject(error) : resolve(stdout));
        child.stdin.on('error', () => {});
        child.stdin.end(image);
      });
      return { text };
    } catch (error) {
      if (error.killed) throw new HttpError(504, 'ocr_timeout', 'O reconhecimento desta página demorou demais.');
      throw new HttpError(503, 'ocr_unavailable', 'Para usar OCR, instale o Tesseract com o idioma português (por) e reinicie o Atlas.');
    } finally {
      ocrRunning = false;
    }
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

  if (desktopProfiles) {
    const localOnly = (req) => {
      if (req.socket.remoteAddress !== '127.0.0.1' || !/^127\.0\.0\.1:\d+$/.test(req.headers.host || '')) {
        throw new HttpError(403, 'local_only', 'Abra o aplicativo Atlas neste computador.');
      }
    };
    route('GET', '/api/desktop/profiles', { admin: true }, ({ req }) => {
      localOnly(req);
      return desktopProfiles.list();
    });
    route('POST', '/api/desktop/profiles', { admin: true }, async ({ req }) => {
      localOnly(req);
      const input = await readJson(req);
      const name = String(input.name ?? '').trim();
      const profilePin = String(input.pin ?? '');
      if (!name || name.length > 70 || !/^\d{6}$/.test(profilePin)) {
        throw new HttpError(400, 'invalid_profile', 'Informe um nome e um PIN de seis dígitos.');
      }
      if (!desktopProfiles.create(name, profilePin)) throw new HttpError(409, 'profile_exists', 'Já existe um perfil com esse nome.');
      return desktopProfiles.list();
    });
    route('POST', '/api/desktop/profiles/switch', { admin: true }, async ({ req }) => {
      localOnly(req);
      const input = await readJson(req);
      if (store.getOpenExam()) throw new HttpError(409, 'exam_in_progress', 'Encerre a aplicação atual antes de trocar de perfil.');
      if (!desktopProfiles.switch(String(input.id ?? ''))) throw new HttpError(404, 'profile_not_found', 'Perfil não encontrado.');
      return { ok: true };
    });
  }

  // professor
  route('GET', '/api/network', { admin: true }, ({ req }) => ({ urls: lanUrls(req.socket.localPort) }));
  route('GET', '/api/roster', { admin: true }, () => ({ roster: store.getRoster() }));
  route('GET', '/api/classes', { admin: true }, ({ url }) => ({ classes: store.listClasses({ includeArchived:url.searchParams.get('all') === '1' }) }));
  route('GET', '/api/join-requests', { admin:true }, () => ({ requests:store.pendingJoinRequests() }));
  route('POST', '/api/join-requests/:id/approve', { admin:true }, ({ params }) => {
    const request = store.getJoinRequest(params.id);
    if (!request) throw new HttpError(404, 'request_not_found');
    try { store.approveJoinRequest(params.id); }
    catch (error) { throw new HttpError(409, 'request_approval_failed', error.message); }
    store.addAudit('student_admitted', request.exam_id, `Nº ${request.number}: ${request.name} autorizado pelo professor.`);
    return { ok:true };
  });
  route('POST', '/api/join-requests/:id/reject', { admin:true }, ({ params }) => {
    if (!store.getJoinRequest(params.id)) throw new HttpError(404, 'request_not_found');
    store.rejectJoinRequest(params.id);
    return { ok:true };
  });
  route('POST', '/api/classes', { admin: true }, async ({ req }) => {
    const input = await readJson(req);
    const rows = parseRosterRows((input.roster || []).map((r) => [r.number, r.name]));
    if (!rows.length && (input.id || input.createEmpty !== true)) throw new HttpError(400, 'roster_required', 'A lista está vazia.');
    try { return { ok: true, class: store.saveClass(input.name, rows, input.id || null) }; }
    catch (error) { throw new HttpError(409, 'class_name_conflict', error.message || 'Não foi possível salvar a turma.'); }
  });
  route('GET', '/api/classes/:id/roster', { admin: true }, ({ params }) => {
    if (!store.getClass(params.id)) throw new HttpError(404, 'class_not_found');
    return { roster: store.classRoster(params.id) };
  });
  route('POST', '/api/classes/:id/archive', { admin: true }, async ({ req, params }) => {
    if (!store.getClass(params.id)) throw new HttpError(404, 'class_not_found');
    const archived = !!(await readJson(req)).archived;
    store.archiveClass(params.id, archived);
    store.addAudit(archived ? 'class_archived' : 'class_restored', params.id, archived ? 'Turma arquivada.' : 'Turma restaurada.');
    return { ok:true };
  });
  route('DELETE', '/api/classes/:id', { admin: true }, ({ params }) => {
    if (!store.getClass(params.id)) throw new HttpError(404, 'class_not_found');
    if (!store.deleteUnusedClass(params.id)) {
      throw new HttpError(409, 'class_has_exams', 'A turma está vinculada a provas. Use Arquivar turma para preservar os registros.');
    }
    store.addAudit('class_deleted', params.id, 'Turma sem provas excluída.');
    return { ok: true };
  });
  route('POST', '/api/classes/:id/students/:number/update', { admin:true }, async ({ req, params }) => {
    const input=await readJson(req);
    const name = String(input.name || '').trim().slice(0, 180);
    const nextNumber=String(input.number || params.number).trim();
    if (name.length < 2) throw new HttpError(400, 'invalid_student_name', 'Informe o nome completo do aluno.');
    if (!/^\d{1,4}$/.test(nextNumber)) throw new HttpError(400,'invalid_student_number','O número de chamada deve ter de 1 a 4 algarismos.');
    let student;
    try { student=store.updateStudent(params.id, params.number, name, nextNumber); }
    catch { throw new HttpError(409,'student_number_conflict','Já existe esse número na turma.'); }
    if (!student) throw new HttpError(404, 'student_not_found');
    store.addAudit('student_record_changed', params.id, `Nº ${params.number} → ${nextNumber}; nome: ${name}.`);
    return { ok:true, student };
  });
  route('POST', '/api/classes/:id/students/:number/move', { admin:true }, async ({ req, params }) => {
    const targetId = String((await readJson(req)).targetClassId || '');
    try {
      const student = store.moveStudent(params.id, targetId, params.number);
      store.addAudit('student_moved', params.id, `Nº ${params.number} movido para ${targetId}; histórico preservado.`);
      return { ok:true, student };
    } catch (error) { throw new HttpError(409, 'student_move_failed', error.message); }
  });
  route('GET', '/api/students/search', { admin:true }, ({ url }) => ({ students: store.searchStudents(url.searchParams.get('q') || '') }));
  route('POST', '/api/classes/:id/students/:number/accommodation', { admin: true }, async ({ req, params }) => {
    const input = await readJson(req);
    const student = store.classRoster(params.id).find((entry) => entry.number === params.number);
    if (!student?.id) throw new HttpError(404, 'student_not_found');
    const extraMinutes = Number(input.extraMinutes);
    if (!Number.isInteger(extraMinutes) || extraMinutes < 0 || extraMinutes > 180) throw new HttpError(400, 'invalid_extra_time', 'Informe de 0 a 180 minutos adicionais.');
    store.setAccommodation(student.id, { extraMinutes, largeText: input.largeText === true, highContrast: input.highContrast === true });
    return { ok: true };
  });
  route('GET', '/api/students/:id/history', { admin:true }, ({ params }) => {
    const history = store.studentHistory(params.id);
    if (!history.length) throw new HttpError(404, 'student_history_not_found');
    const entries = history.map((entry) => {
      const exam = needExam(entry.examId);
      entry.original = exam.original;
      if (entry.status !== 'submitted') return entry;
      const result = scoreSession(exam, store.getAnswers(entry.sessionId), store.gradesForExam(exam.id)[entry.sessionId]);
      const totals = new Map();
      for (const question of exam.questions) {
        if (!question.skill || exam.annulled?.[question.id] || result.detail[question.id]?.earned == null) continue;
        const total = totals.get(question.skill) || { skill: question.skill, label: skillLabel(question.skill), earned: 0, max: 0 };
        total.earned += result.detail[question.id].earned;
        total.max += question.weight;
        totals.set(question.skill, total);
      }
      return { ...entry, skills: [...totals.values()].map((total) => ({ ...total, percent: Math.round(100 * total.earned / total.max) })) };
    });
    const targets = new Set(entries.flatMap((entry) => (entry.skills || []).filter((point) => point.percent < 60).map((point) => point.skill)));
    const recovery = targets.size
      ? store.listBankQuestions().filter((question) => targets.has(question.skill)).slice(0, 20)
      : [];
    return { history: entries, recovery };
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
  route('GET', '/api/exams/:id/rehearsal', { admin: true }, ({ params }) => ({ exam: publicExam(needExam(params.id)) }));
  route('POST', '/api/exams/:id/release', { admin: true }, async ({ req, params }) => {
    const { date } = await readJson(req);
    const exam = needExam(params.id);
    const instant = typeof date === 'string' ? Date.parse(date) : NaN;
    if (exam.status !== 'closed' || !Number.isFinite(instant)) throw new HttpError(400, 'invalid_release_date', 'Encerre a prova e escolha a data da devolutiva.');
    store.setReleaseAt(exam.id, new Date(instant).toISOString());
    return { ok: true };
  });
  route('POST', '/api/exams/:id/version', { admin: true }, async ({ req, params }) => {
    const original = needExam(params.id);
    const input = await readJson(req);
    const secondCall = input.kind === 'second-call';
    const title = `${original.title.slice(0, 99)} (${secondCall ? 'segunda chamada' : 'nova versão'})`;
    const document = original.document && store.getDocument(original.document.id);
    const duplicate = store.saveExam({ title, questions: original.questions, classId: original.classId, shuffle: original.shuffle, feedback: original.feedback });
    let file;
    try {
      if (document) {
        file = `${crypto.randomBytes(16).toString('hex')}.${document.kind}`;
        fs.copyFileSync(path.join(store.documentDir, document.file), path.join(store.documentDir, file), fs.constants.COPYFILE_EXCL);
        store.setDocument(duplicate.id, { name: document.name, kind: document.kind, size: document.size, html: document.html, file });
      }
      store.linkOriginal(duplicate.id, { id: original.id, title: original.title, kind: secondCall ? 'second-call' : 'version' });
      return { exam: store.getExam(duplicate.id) };
    } catch (error) {
      store.deleteExam(duplicate.id);
      if (file) fs.rmSync(path.join(store.documentDir, file), { force: true });
      throw error;
    }
  });
  route('POST', '/api/exams/:id/annul-question', { admin: true }, async ({ req, params }) => {
    const input = await readJson(req);
    const exam = needExam(params.id);
    const reason = String(input.reason || '').trim();
    if (exam.status !== 'closed') throw new HttpError(409, 'exam_not_closed', 'Encerre a prova antes de anular uma questão.');
    if (!exam.questions.some((question) => question.id === input.questionId) ||
        !['credit', 'remove'].includes(input.mode) || !reason || reason.length > 500) {
      throw new HttpError(400, 'invalid_annulment', 'Selecione uma questão, escolha como recalcular e informe o motivo.');
    }
    store.annulQuestion(exam, input.questionId, input.mode, reason);
    return { ok: true };
  });
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
    const exam = needExam(params.id);
    if (['open', 'paused'].includes(exam.status)) throw new HttpError(409, 'exam_in_progress', 'Encerre a prova antes de excluí-la.');
    if (store.hasSessions(params.id)) throw new HttpError(409, 'exam_has_sessions', 'Esta prova já tem respostas e não pode ser excluída.');
    store.deleteExam(params.id);
    return { ok: true };
  });
  route('POST', '/api/exams/:id/open', { admin: true }, ({ params }) => { const exam=needExam(params.id);const code=store.openExam(params.id);store.addAudit('exam_opened',exam.id,'Prova aberta para os alunos.');return { ok: true, code }; });
  route('POST', '/api/exams/:id/close', { admin: true }, ({ params }) => { const exam=needExam(params.id);store.closeExam(params.id);store.addAudit('exam_closed',exam.id,'Prova encerrada pelo professor.');watchedExamId=null;saveCopy(needExam(params.id));return { ok: true }; });
  route('POST', '/api/exams/:id/pause', { admin:true }, ({ params }) => {
    const exam=needExam(params.id);
    if (exam.status!=='open') throw new HttpError(409,'exam_not_open');
    store.pauseExam(exam.id); store.addAudit('exam_paused',exam.id,'Prova pausada pelo professor.');
    return {ok:true};
  });
  route('POST', '/api/exams/:id/resume', { admin:true }, ({ params }) => {
    const exam=needExam(params.id);
    if (exam.status!=='paused') throw new HttpError(409,'exam_not_paused');
    store.resumeExam(exam.id); store.addAudit('exam_resumed',exam.id,'Prova retomada pelo professor.');
    return {ok:true};
  });
  route('POST', '/api/exams/:id/document', { admin: true }, async ({ req, url, params }) => {
    const ensureEditable = () => {
      const exam = needExam(params.id);
      if (['open', 'paused'].includes(exam.status) || store.hasSessions(exam.id)) {
        throw new HttpError(409, 'exam_document_locked', 'Duplique a prova para alterar o documento de uma aplicação já iniciada.');
      }
    };
    ensureEditable();
    const buffer = await readBody(req, MAX_DOCUMENT_BYTES);
    const kind = detectKind(buffer);
    if (!kind) throw new HttpError(415, 'unsupported_document', 'Envie um arquivo PDF ou DOCX válido.');
    const name = (url.searchParams.get('name') || `prova.${kind}`).replace(/[\\/\r\n"]/g, '_').slice(0, 120);
    let html;
    if (kind === 'docx') {
      try { html = await convertDocx(buffer); } catch { throw new HttpError(422, 'invalid_document', 'Não consegui ler este DOCX.'); }
    }
    ensureEditable();
    const file = `${crypto.randomBytes(16).toString('hex')}.${kind}`;
    fs.writeFileSync(path.join(store.documentDir, file), buffer);
    return { ok: true, document: store.setDocument(params.id, { name, kind, size: buffer.length, file, html }) };
  });
  route('DELETE', '/api/exams/:id/document', { admin: true }, ({ params }) => {
    const exam = needExam(params.id);
    if (['open', 'paused'].includes(exam.status) || store.hasSessions(exam.id)) {
      throw new HttpError(409, 'exam_document_locked', 'Duplique a prova para alterar o documento de uma aplicação já iniciada.');
    }
    if (!exam.questions.length) throw new HttpError(409, 'document_required', 'Adicione e salve questões antes de retirar o único documento da prova.');
    store.removeDocument(exam.id);
    return { ok: true };
  });
  route('GET', '/api/exams/:id/results', { admin: true }, ({ params }) => {
    const exam = needExam(params.id);
    const participants = exam.classId ? store.classRoster(exam.classId) : store.getRoster();
    return { exam: { id: exam.id, title: exam.title, status: exam.status, questions: exam.questions, annulled: exam.annulled, releaseAt: exam.releaseAt }, results: resultsFor(exam), participants };
  });
  route('GET', '/api/reports/compare', {admin:true}, ({url}) => {
    const ids=[...new Set(String(url.searchParams.get('ids')||'').split(',').filter(Boolean))].slice(0,2);
    if(ids.length!==2)throw new HttpError(400,'two_exams_required','Selecione duas provas para comparar.');
    const from=url.searchParams.get('from')?Date.parse(`${url.searchParams.get('from')}T00:00:00Z`):null;const to=url.searchParams.get('to')?Date.parse(`${url.searchParams.get('to')}T23:59:59.999Z`):null;
    if((from!==null&&!Number.isFinite(from))||(to!==null&&!Number.isFinite(to))||(from!==null&&to!==null&&from>to))throw new HttpError(400,'invalid_report_period','Confira o período escolhido.');
    return {exams:ids.map((id)=>{const exam=needExam(id);const results=resultsFor(exam);const submitted=results.filter((r)=>r.status==='submitted'&&(!from||Date.parse(r.submittedAt)>=from)&&(!to||Date.parse(r.submittedAt)<=to));const average=submitted.length?Math.round(submitted.reduce((sum,r)=>sum+(r.max?r.score/r.max:0),0)/submitted.length*100):null;const students=exam.classId?store.classRoster(exam.classId).length:store.getRoster().length;return {id,title:exam.title,className:results[0]?.className||'',createdAt:exam.createdAt,sent:submitted.length,students,average};})};
  });
  route('GET', '/api/exams/:id/projector', { admin: true }, ({ params }) => {
    const exam = needExam(params.id);
    const results = resultsFor(exam);
    const total = exam.classId ? store.classRoster(exam.classId).length : store.getRoster().length;
    const questions = exam.questions.map((q, index) => ({
      index: index + 1,
      answered: results.reduce((n, result) => n + (result.answers[q.id] ? 1 : 0), 0),
      total: results.length,
    }));
    return {
      title: exam.title, status: exam.status, code: exam.status === 'open' ? exam.accessCode : null,
      total, started: results.length, online: results.filter((r) => r.online).length,
      submitted: results.filter((r) => r.status === 'submitted').length,
      questions, scheduledStart: exam.scheduledStart, scheduledEnd: exam.scheduledEnd,
    };
  });
  route('GET', '/api/exams/:id/export.csv', { admin: true }, ({ res, params, url }) => {
    const exam = needExam(params.id);
    const template = url.searchParams.has('columns') ? (() => {
      const scale = Number(url.searchParams.get('scale'));
      const columns = url.searchParams.get('columns').split(',');
      const headers = { number: 'Número', name: 'Estudante', className: 'Turma', date: 'Entrega', score: 'Nota' };
      if (!(scale > 0 && scale <= 1000) || !columns.length || new Set(columns).size !== columns.length ||
          columns.some((column) => !Object.hasOwn(headers, column))) throw new HttpError(400, 'invalid_export_template', 'Confira a escala e as colunas da escola.');
      const rows = [columns.map((column) => headers[column]), ...resultsFor(exam).map((result) => columns.map((column) => {
        if (column === 'score') return result.status === 'submitted' && result.max && !result.pending ? decimal(Number((scale * result.score / result.max).toFixed(2))) : '';
        return column === 'date' ? result.submittedAt || '' : result[column];
      }))];
      return '\uFEFF' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
    })() : null;
    const slug = exam.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'prova';
    res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${slug}.csv"`, 'cache-control': 'no-store' });
    res.end(template ?? examCsv(exam));
    return null;
  });
  route('GET','/api/exams/:id/export.xlsx',{admin:true},async({res,params})=>{
    const exam=needExam(params.id);const slug=exam.title.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\w]+/g,'-').toLowerCase()||'prova';const bytes=await examXlsx(exam);
    res.writeHead(200,{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','content-disposition':`attachment; filename="${slug}.xlsx"`,'content-length':bytes.length,'cache-control':'no-store'});res.end(bytes);return null;
  });
  route('GET','/api/exams/:id/report.pdf',{admin:true},({res,params})=>{
    const exam=needExam(params.id);const results=resultsFor(exam);const submitted=results.filter((r)=>r.status==='submitted');const average=submitted.length?submitted.reduce((sum,r)=>sum+(r.max?r.score/r.max:0),0)/submitted.length*100:null;
    const lines=['ATLAS - RELATORIO DA TURMA',`Prova: ${exam.title}`,`Turma: ${results[0]?.className||'Nao informada'}`,`Criada em: ${exam.createdAt||'Nao informada'}`,`Entregues: ${submitted.length}`,`Estudantes inscritos: ${exam.classId?store.classRoster(exam.classId).length:store.getRoster().length}`,`Media da turma: ${average===null?'Sem envios':`${average.toFixed(1)}%`}`,'','RESULTADOS',...results.map((r)=>`${r.number} ${r.name} - ${r.status==='submitted'?'Entregue':'Pendente'} - ${r.score}/${r.max} - ${r.pending} pendente(s)`)];
    const pdf=simplePdf(lines);res.writeHead(200,{'content-type':'application/pdf','content-length':pdf.length,'content-disposition':`attachment; filename="atlas-relatorio-turma-${exam.id}.pdf"`,'cache-control':'no-store'});res.end(pdf);return null;
  });
  route('GET', '/api/sessions/:id/report.pdf', { admin: true }, ({ res, params }) => {
    const session = needSession(params.id);
    const exam = needExam(session.examId);
    const result = resultsFor(exam).find((r) => r.sessionId === session.id);
    const lines = [
      'ATLAS - RELATORIO INDIVIDUAL', `Prova: ${exam.title}`, `Estudante: ${result.name} - numero ${result.number}`,
      `Turma: ${result.className || 'Nao informada'}`, `Situacao: ${result.status === 'submitted' ? 'Entregue' : 'Em andamento'}`,
      `Nota: ${result.score} / ${result.max}`, `Saidas da pagina da prova: ${result.away.count} (${spokenDuration(result.away.seconds)} fora)`, '', 'RESPOSTAS',
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
    const reason=String(input.reason||'').trim().slice(0,500);
    if(reason.length<4)throw new HttpError(400,'grade_reason_required','Informe o motivo da alteração da nota (mínimo 4 caracteres).');
    if (input.score === null || input.score === '') { store.setGrade(session.id, question.id, null);store.addAudit('grade_cleared',session.examId,`Aluno ${session.number}, questão ${question.id}: ${reason}`);return { ok: true }; }
    const score = Number(input.score);
    if (!Number.isFinite(score) || score < 0 || score > question.weight) throw new HttpError(400, 'invalid_score', `A nota deve estar entre 0 e ${question.weight}.`);
    store.setGrade(session.id, question.id, score);
    store.addAudit('grade_changed',session.examId,`Aluno ${session.number}, questão ${question.id}, nota ${score}/${question.weight}: ${reason}`);
    return { ok: true };
  });
  route('POST','/api/grade/batch',{admin:true},async({req})=>{
    const input=await readJson(req);const reason=String(input.reason||'').trim().slice(0,500);const items=Array.isArray(input.items)?input.items:[];
    if(reason.length<4)throw new HttpError(400,'grade_reason_required','Informe um motivo para a correção em lote.');
    if(!items.length||items.length>500)throw new HttpError(400,'invalid_batch','Selecione de 1 a 500 notas.');
    const validated=items.map((item)=>{const session=needSession(String(item.sessionId||''));const question=needExam(session.examId).questions.find((q)=>q.id===String(item.questionId));const score=Number(item.score);if(!question||!Number.isFinite(score)||score<0||score>question.weight)throw new HttpError(400,'invalid_batch_score','Confira os itens e as notas informadas.');return {session,question,score};});
    for(const {session,question,score} of validated){store.setGrade(session.id,question.id,score);store.addAudit('grade_changed',session.examId,`Correção em lote · aluno ${session.number}, questão ${question.id}, nota ${score}/${question.weight}: ${reason}`);}
    return {ok:true,updated:validated.length};
  });
  route('POST', '/api/sessions/:id/reopen', { admin: true }, async ({ req, params }) => {
    const session = needSession(params.id);
    const input = await readJson(req);
    const reason = String(input.reason || '').trim().slice(0, 500);
    if (reason.length < 5) throw new HttpError(400, 'reopen_reason_required', 'Informe o motivo (mínimo 5 caracteres).');
    store.reopen(params.id);
    store.addAudit('session_reopened', session.examId, `Aluno ${session.number}: ${reason}`);
    return { ok: true };
  });
  route('POST', '/api/sessions/:id/pause', {admin:true}, ({params}) => {
    const session=needSession(params.id);
    if (session.status!=='active') throw new HttpError(409,'session_not_active');
    store.pauseSession(session.id); store.addAudit('student_paused',session.examId,`Aluno nº ${session.number} pausado pelo professor.`);
    return {ok:true};
  });
  route('POST', '/api/sessions/:id/resume', {admin:true}, ({params}) => {
    const session=needSession(params.id);
    if (session.status!=='paused') throw new HttpError(409,'session_not_paused');
    store.resumeSession(session.id); store.addAudit('student_resumed',session.examId,`Aluno nº ${session.number} retomado pelo professor.`);
    return {ok:true};
  });

  route('GET', '/api/exams/:id/audit', { admin: true }, ({ params }) => {
    needExam(params.id);
    return { events: store.listAudit(params.id) };
  });
  route('POST', '/api/exams/:id/schedule', { admin: true }, async ({ req, params }) => {
    const exam = needExam(params.id);
    const input = await readJson(req);
    const start = Date.parse(input.startAt);
    const end = input.endAt ? Date.parse(input.endAt) : null;
    if (!Number.isFinite(start) || start <= Date.now() + 5000 || (input.endAt && (!Number.isFinite(end) || end <= start))) {
      throw new HttpError(400, 'invalid_schedule', 'Escolha um início futuro e um encerramento posterior ao início.');
    }
    if (exam.status === 'open' || store.listExams().some((e) => e.id !== exam.id && ['open', 'paused', 'scheduled'].includes(e.status))) {
      throw new HttpError(409, 'schedule_conflict', 'Encerre ou cancele a outra prova antes de agendar esta.');
    }
    store.scheduleExam(exam.id, new Date(start).toISOString(), end ? new Date(end).toISOString() : null);
    store.addAudit('exam_scheduled', exam.id, `Início: ${new Date(start).toISOString()}${end ? `; encerramento: ${new Date(end).toISOString()}` : ''}`);
    return { ok: true, exam: needExam(exam.id) };
  });
  route('POST', '/api/exams/:id/schedule/cancel', { admin: true }, ({ params }) => {
    const exam = needExam(params.id);
    if (exam.status !== 'scheduled') throw new HttpError(409, 'not_scheduled');
    store.cancelSchedule(exam.id);
    store.addAudit('schedule_cancelled', exam.id, 'Agendamento cancelado pelo professor.');
    return { ok: true };
  });

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
    let disk={available:false};
    try{const stat=fs.statfsSync(dataDir);disk={available:true,freeBytes:stat.bavail*stat.bsize,totalBytes:stat.blocks*stat.bsize};}catch{}
    return { port, desktop: !!process.versions.electron, windows: process.platform === 'win32', exportDir: exportDir || null, interfaces, urls, devices: seen, examOpen: !!store.getOpenExam(), students: store.getRoster().length + classStudents,disk };
  });
  route('GET','/api/diagnostics/report.txt',{admin:true},({req,res})=>{
    const port=req.socket.localPort;let disk='Indisponível';try{const stat=fs.statfsSync(dataDir);disk=`${(stat.bavail*stat.bsize/1024**3).toFixed(1)} GB livres de ${(stat.blocks*stat.bsize/1024**3).toFixed(1)} GB`;}catch{}
    const lines=['Atlas - diagnóstico sem dados de estudantes',`Versão: ${JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version}`,`Node: ${process.versions.node}`,`Electron: ${process.versions.electron||'servidor independente'}`,`Sistema: ${process.platform} ${process.arch}`,`Porta local: ${port}`,`Interface IPv4 disponível: ${Object.values(os.networkInterfaces()).flat().filter(n=>n?.family==='IPv4'&&!n.internal).length}`,`Espaço livre na unidade de dados: ${disk}`,`Servidor HTTP: ativo`];
    res.writeHead(200,{'content-type':'text/plain; charset=utf-8','content-disposition':'attachment; filename="atlas-diagnostico.txt"','cache-control':'no-store'});res.end(lines.join('\n'));return null;
  });

  // backup manual: um único arquivo .atlas com banco e anexos
  route('GET','/api/backups/settings',{admin:true},()=>store.getBackupSettings());
  route('POST','/api/backups/settings',{admin:true},async({req})=>{const input=await readJson(req);const settings=store.setBackupSettings(input);store.addAudit('backup_policy_changed','settings',`Intervalo ${settings.intervalMinutes} min; manter ${settings.keep} cópias.`);return {ok:true,settings};});
  route('GET','/api/audit',{admin:true},({url})=>({events:store.listAuditAll(Number(url.searchParams.get('limit'))||100)}));
  route('GET','/api/privacy/anonymization/preview',{admin:true},({url})=>{const before=String(url.searchParams.get('before')||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(before)||Date.parse(`${before}T00:00:00Z`)>=Date.now())throw new HttpError(400,'invalid_retention_date','Escolha uma data passada.');return store.previewAnonymization(`${before}T00:00:00.000Z`);});
  route('POST','/api/privacy/anonymization',{admin:true},async({req})=>{const input=await readJson(req);const before=String(input.before||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(before)||Date.parse(`${before}T00:00:00Z`)>=Date.now())throw new HttpError(400,'invalid_retention_date','Escolha uma data passada.');const result=store.anonymizeBefore(`${before}T00:00:00.000Z`);store.addAudit('student_data_anonymized','privacy',`${result.students} estudantes e ${result.sessions} sessões anteriores a ${before}.`);return {ok:true,...result};});
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
  route('POST','/api/restore/verify',{admin:true},async({req})=>{
    const raw=await readBody(req,400_000_000);let input;try{input=JSON.parse(raw.toString('utf8'));}catch{throw new HttpError(422,'invalid_backup','Este arquivo não é um backup válido do Atlas.');}
    try{return store.verifyBackup(input);}catch(error){if(error instanceof BackupError)throw new HttpError(422,'invalid_backup',error.message);throw error;}
  });
  route('POST','/api/restore/selective',{admin:true},async({req,url})=>{
    const raw=await readBody(req,400_000_000);let input;try{input=JSON.parse(raw.toString('utf8'));}catch{throw new HttpError(422,'invalid_backup','Este arquivo não é um backup válido do Atlas.');}
    try{return {ok:true,...store.restoreSelected(input,{classIds:url.searchParams.getAll('class'),examIds:url.searchParams.getAll('exam')})};}catch(error){if(error instanceof BackupError)throw new HttpError(422,'invalid_backup',error.message);throw error;}
  });

  // ---------- arquivos estáticos
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
  const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self' blob:; frame-src 'self'; object-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
  function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname).replace(/\/+$/, '') || '/';
    if (rel === '/') rel = '/index.html';
    else if (rel === '/professor') rel = '/professor.html';
    else if (rel === '/prova') rel = '/prova.html';
    else if (rel === '/teste') rel = '/teste.html';
    else if (rel === '/projetor') rel = '/projetor.html';
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
        const match = r.pattern.exec({ pathname: url.pathname });
        if (!match) continue;
        if (r.admin && !isAdmin(req)) throw new HttpError(401, 'teacher_auth_required', 'Entre com o PIN do professor.');
        let params;
        try { params = Object.fromEntries(Object.entries(match.pathname.groups).map(([name, value]) => [name, decodeURIComponent(value)])); }
        catch { throw new HttpError(400, 'bad_path', 'Endereço inválido.'); }
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
  const scheduleTimer = setInterval(() => {
    store.activateSchedules();
    // prova encerrada pelo horário: também guarda a cópia automática
    const open = store.getOpenExam();
    if (open) watchedExamId = open.id;
    else if (watchedExamId) {
      const ended = store.getExam(watchedExamId);
      if (ended?.status === 'closed') { watchedExamId = null; saveCopy(ended); } else if (!ended || ended.status !== 'paused') watchedExamId = null;
    }
  }, 1000);
  scheduleTimer.unref();
  const close = () => new Promise((resolve) => { clearInterval(backupTimer); clearInterval(scheduleTimer); server.close(() => { store.close(); resolve(); }); server.closeAllConnections?.(); });
  return { server, store, pin, close, [Symbol.asyncDispose]: close };
}

// ---------- execução direta: `npm start` ou os arquivos "Iniciar-Atlas"
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // atlas.env (opcional, ao lado do server.mjs): linhas PORT=8080, ATLAS_PIN=123456, ATLAS_EXPORT_DIR=D:\\Copias
  try { process.loadEnvFile(path.join(root, 'atlas.env')); } catch { /* sem arquivo: usa os padrões */ }
  const port = Number(process.env.PORT || 8080);
  const dataDir = process.env.ATLAS_DATA_DIR || path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  // PIN fixo: fica guardado em data/pin.txt para o professor não precisar decorar um novo a cada aula.
  const pinFile = path.join(dataDir, 'pin.txt');
  let pin = process.env.ATLAS_PIN || (fs.existsSync(pinFile) ? fs.readFileSync(pinFile, 'utf8').trim() : '');
  if (!pin) { pin = String(crypto.randomInt(100000, 1000000)); fs.writeFileSync(pinFile, pin + '\n'); }

  const app = createApp({ dataDir, pin, exportDir: process.env.ATLAS_EXPORT_DIR || path.join(os.homedir(), 'Documents', 'Atlas', 'Copias') });
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

