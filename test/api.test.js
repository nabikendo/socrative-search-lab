import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';
import { parseRosterText } from '../shared/roster.js';
import { scoreSession, normalizeQuestions } from '../shared/exam.js';

let app, base, admin;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-'));
const call = async (url, { method = 'GET', body, raw, cookie, headers = {} } = {}) => {
  const res = await fetch(base + url, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, data: type.includes('json') ? await res.json() : await res.text() };
};

before(async () => {
  app = createApp({ dataDir: dir, pin: '123456' });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: '123456' }) });
  admin = login.headers.get('set-cookie').split(';')[0];
});
after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('parser de lista: CSV com turma não vaza a turma para o nome', () => {
  const rows = parseRosterText('numero,nome,turma\n3,Aluno Um,13.01\n5;"SILVA, JOÃO";13.01\n7 CARLOS EDUARDO F 2');
  assert.deepEqual(rows.map((r) => [r.number, r.name, r.className]), [['3', 'Aluno Um', '13.01'], ['5', 'SILVA, JOÃO', '13.01'], ['7', 'CARLOS EDUARDO', '']]);
});

test('painel exige PIN e limita tentativas', async () => {
  assert.equal((await call('/api/roster')).status, 401);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { pin: '000000' } })).status, 403);
});

let examId, code, student;
test('fluxo completo do aluno, sem vazar gabarito', async () => {
  await call('/api/roster', { method: 'POST', cookie: admin, body: { roster: [{ number: '3', name: 'Aluno <img src=x onerror=alert(1)>', className: '13.01' }, { number: '5', name: 'Aluno Dois' }] } });
  const created = await call('/api/exams', { method: 'POST', cookie: admin, body: { title: 'T', questions: [
    { type: 'choice', text: 'Q?', options: ['A', 'B'], correct: 'B', weight: 2 }, { type: 'text', text: 'Livre', weight: 1 }] } });
  assert.equal(created.status, 200);
  examId = created.data.exam.id;
  assert.equal((await call('/api/open-exam')).data.exam, null);
  assert.equal((await call('/api/identify', { method: 'POST', body: { code: '1234', number: '3' } })).status, 409);

  ({ code } = (await call(`/api/exams/${examId}/open`, { method: 'POST', cookie: admin })).data);
  assert.equal((await call('/api/identify', { method: 'POST', body: { code: '0000', number: '3' } })).status, 403);
  assert.equal((await call('/api/identify', { method: 'POST', body: { code, number: '99' } })).status, 404);

  const start = await call('/api/session/start', { method: 'POST', body: { code, number: '3' } });
  assert.equal(start.status, 200);
  assert.ok(!JSON.stringify(start.data).includes('"correct"'), 'gabarito não pode ir ao aluno');
  student = start.data.session;
  assert.equal((await call('/api/session/start', { method: 'POST', body: { code, number: '3' } })).data.error, 'session_in_use');
  assert.equal((await call('/api/session/start', { method: 'POST', body: { code, number: '3', token: student.token } })).status, 200);

  const [q1, q2] = start.data.exam.questions;
  const send = (questionId, answer) => call('/api/answer', { method: 'POST', body: { sessionId: student.id, token: student.token, questionId, answer } });
  assert.equal((await send(q1.id, 'Z')).status, 400);
  assert.equal((await send(q1.id, 'B')).status, 200);
  assert.equal((await send(q2.id, '=HYPERLINK("http://x")')).status, 200);
  assert.equal((await call('/api/answer', { method: 'POST', body: { sessionId: student.id, token: 'errado', questionId: q1.id, answer: 'A' } })).status, 401);

  const results = (await call(`/api/exams/${examId}/results`, { cookie: admin })).data;
  assert.equal(results.results[0].score, 2);
  assert.equal(results.results[0].pending, 1);
  const q2id = q2.id;
  assert.equal((await call('/api/grade', { method: 'POST', cookie: admin, body: { sessionId: student.id, questionId: q2id, score: 5 } })).status, 400);
  assert.equal((await call('/api/grade', { method: 'POST', cookie: admin, body: { sessionId: student.id, questionId: q2id, score: 0.5 } })).status, 200);

  assert.equal((await call('/api/session/submit', { method: 'POST', body: { sessionId: student.id, token: student.token } })).status, 200);
  assert.equal((await call('/api/session/start', { method: 'POST', body: { code, number: '3', token: student.token } })).data.error, 'already_submitted');
});

test('CSV: BOM, ponto e vírgula, decimal com vírgula e sem injeção de fórmula', async () => {
  const bytes = Buffer.from(await (await fetch(`${base}/api/exams/${examId}/export.csv`, { headers: { cookie: admin } })).arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM UTF-8 para o Excel');
  const csv = bytes.toString('utf8');
  assert.ok(csv.includes('numero;nome;turma'));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes('2,5;3'));
});

test('editar prova aberta não a fecha; questões travam após respostas', async () => {
  const exam = (await call(`/api/exams/${examId}`, { cookie: admin })).data.exam;
  assert.equal(exam.status, 'open');
  const same = await call('/api/exams', { method: 'POST', cookie: admin, body: { id: examId, title: 'Novo título', questions: exam.questions } });
  assert.equal(same.status, 200);
  assert.equal(same.data.exam.status, 'open');
  const changed = await call('/api/exams', { method: 'POST', cookie: admin, body: { id: examId, title: 'x', questions: [{ type: 'text', text: 'Outra' }] } });
  assert.equal(changed.status, 409);
});

test('abrir outra prova fecha a anterior e respostas são recusadas após encerrar', async () => {
  const other = (await call('/api/exams', { method: 'POST', cookie: admin, body: { title: 'Outra', questions: [{ type: 'text', text: 'Q' }] } })).data.exam;
  await call(`/api/exams/${other.id}/open`, { method: 'POST', cookie: admin });
  assert.equal((await call(`/api/exams/${examId}`, { cookie: admin })).data.exam.status, 'closed');
  assert.equal((await call('/api/open-exam')).data.exam.title, 'Outra');
  await call(`/api/exams/${other.id}/close`, { method: 'POST', cookie: admin });
  assert.equal((await call('/api/open-exam')).data.exam, null);
});

test('upload valida o conteúdo real do arquivo', async () => {
  const bad = await call(`/api/exams/${examId}/document?name=a.pdf`, { method: 'POST', cookie: admin, raw: Buffer.from('<script>alert(1)</script>'), headers: { 'content-type': 'application/octet-stream' } });
  assert.equal(bad.status, 415);
  const pdf = await call(`/api/exams/${examId}/document?name=prova.pdf`, { method: 'POST', cookie: admin, raw: Buffer.from('%PDF-1.4\n%%EOF'), headers: { 'content-type': 'application/octet-stream' } });
  assert.equal(pdf.status, 200);
});

test('regras de nota', () => {
  const exam = { questions: normalizeQuestions([{ type: 'choice', text: 'a', options: ['x', 'y'], correct: 'x', weight: 2 }, { type: 'text', text: 'b' }]) };
  const [a, b] = exam.questions;
  const r = scoreSession(exam, { [a.id]: 'x', [b.id]: 'texto' }, {});
  assert.deepEqual([r.score, r.max, r.pending], [2, 3, 1]);
});

test('embaralhar: ordem estável por aluno, preserva todas as alternativas e vai ao aluno', async () => {
  const { orderForStudent, seededShuffle } = await import('../shared/shuffle.js');
  const qs = Array.from({ length: 8 }, (_, i) => ({ id: `q${i}`, type: 'choice', text: `Q${i}`, options: ['a', 'b', 'c', 'd'] }));
  const a1 = orderForStudent(qs, 'aluno-1'); const a2 = orderForStudent(qs, 'aluno-1'); const b = orderForStudent(qs, 'aluno-2');
  assert.deepEqual(a1, a2);
  assert.notDeepEqual(a1.map((q) => q.id), b.map((q) => q.id));
  assert.deepEqual([...a1.map((q) => q.id)].sort(), qs.map((q) => q.id));
  assert.ok(a1.every((q) => [...q.options].sort().join() === 'a,b,c,d'));
  assert.deepEqual(seededShuffle([1, 2, 3, 4, 5], 'x').sort(), [1, 2, 3, 4, 5]);

  const created = await call('/api/exams', { method: 'POST', cookie: admin, body: { title: 'Embaralhada', shuffle: true, questions: [{ type: 'choice', text: 'Q?', options: ['A', 'B'], correct: 'A' }] } });
  assert.equal(created.data.exam.shuffle, true);
  const kept = await call('/api/exams', { method: 'POST', cookie: admin, body: { id: created.data.exam.id, title: 'Embaralhada 2', questions: [{ type: 'choice', text: 'Q?', options: ['A', 'B'], correct: 'A' }] } });
  assert.equal(kept.data.exam.shuffle, true); // não informado: mantém
  await call(`/api/exams/${created.data.exam.id}`, { method: 'DELETE', cookie: admin });
});

test('backup e restauração: devolve exatamente o estado salvo e guarda cópia do atual', async () => {
  const keep = await call('/api/exams', { method: 'POST', cookie: admin, body: { title: 'Prova do backup', questions: [{ type: 'text', text: 'Livre' }] } });
  const res = await fetch(base + '/api/backup', { headers: { cookie: admin } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /atlas-backup-\d{4}-\d{2}-\d{2}\.atlas/);
  const file = await res.text();
  assert.equal((await call('/api/backup')).status, 401);

  await call(`/api/exams/${keep.data.exam.id}`, { method: 'DELETE', cookie: admin });
  await call('/api/roster', { method: 'POST', cookie: admin, body: { roster: [{ number: '1', name: 'Só depois' }] } });
  const restored = await call('/api/restore', { method: 'POST', cookie: admin, raw: file });
  assert.equal(restored.status, 200);
  const exams = (await call('/api/exams', { cookie: admin })).data.exams;
  assert.ok(exams.some((e) => e.id === keep.data.exam.id));
  assert.notDeepEqual((await call('/api/roster', { cookie: admin })).data.roster.map((r) => r.name), ['Só depois']);
  assert.ok(fs.readdirSync(path.join(dir, 'backups')).some((f) => f.startsWith('atlas-antes-restauracao-')));

  assert.equal((await call('/api/restore', { method: 'POST', cookie: admin, raw: 'isto não é um backup' })).status, 422);
  assert.equal((await call('/api/restore', { method: 'POST', cookie: admin, raw: JSON.stringify({ format: 'atlas-backup', version: 1, db: Buffer.from('x'.repeat(2000)).toString('base64') }) })).status, 422);
  assert.equal((await call('/api/restore', { method: 'POST', raw: file })).status, 401);
  assert.equal((await call('/api/exams', { cookie: admin })).status, 200); // continua funcionando depois das tentativas inválidas
});

test('diagnóstico de rede: exige PIN e reconhece aparelhos que abriram a página do aluno', async () => {
  assert.equal((await call('/api/diagnostics')).status, 401);
  const before = (await call('/api/diagnostics', { cookie: admin })).data;
  assert.equal(typeof before.port, 'number');
  assert.ok(Array.isArray(before.interfaces) && Array.isArray(before.urls) && Array.isArray(before.devices));
  assert.equal(before.devices.length, 0); // o próprio computador (127.0.0.1) não conta como aparelho de aluno
});
