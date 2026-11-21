import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';

let app, base, dir;
const choice = { type: 'choice', text: '2+2?', options: ['3', '4'], correct: '4', weight: 1 };
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-entrada-'));
  app = createApp({ dataDir: dir, pin: '123456', securePort: 0 });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const call = async (url, { method = 'GET', body, cookie = '', headers = {} } = {}) => {
  const res = await fetch(base + url, { method, headers: { connection: 'close', ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, cookie: res.headers.get('set-cookie')?.split(';')[0], data: type.includes('json') ? await res.json() : await res.text() };
};

test('neste computador o Atlas entra sem PIN; o PIN continua valendo para login normal', async () => {
  const before = await call('/api/auth/status');
  assert.deepEqual(before.data, { authenticated: false, pinRequired: false });
  const local = await call('/api/auth/local', { method: 'POST' });
  assert.equal(local.status, 200);
  assert.equal((await call('/api/exams', { cookie: local.cookie })).status, 200);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { pin: '000000' } })).status, 403);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { pin: '123456' } })).status, 200);
});

test('entrada sem PIN recusa pedidos de outro site e respeita a opção de exigir PIN', async () => {
  assert.equal((await call('/api/auth/local', { method: 'POST', headers: { origin: 'https://site-malicioso.example' } })).status, 403);
  assert.equal((await call('/api/auth/local', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  const admin = (await call('/api/auth/login', { method: 'POST', body: { pin: '123456' } })).cookie;
  assert.equal((await call('/api/teacher-settings', { method: 'PUT', cookie: admin, body: { requirePinLocal: true } })).status, 200);
  try {
    assert.equal((await call('/api/auth/status')).data.pinRequired, true);
    assert.equal((await call('/api/auth/local', { method: 'POST' })).status, 403);
  } finally { await call('/api/teacher-settings', { method: 'PUT', cookie: admin, body: { requirePinLocal: false } }); }
  assert.equal((await call('/api/auth/local', { method: 'POST' })).status, 200);
});

test('boas-vindas: aparece até ser marcada como vista', async () => {
  const admin = (await call('/api/auth/local', { method: 'POST' })).cookie;
  assert.equal((await call('/api/teacher-settings', { cookie: admin })).data.welcomeSeen, false);
  await call('/api/teacher-settings', { method: 'PUT', cookie: admin, body: { welcomeSeen: true } });
  assert.equal((await call('/api/teacher-settings', { cookie: admin })).data.welcomeSeen, true);
});

test('prova com respostas pode ser excluída, com confirmação e backup', async () => {
  const admin = (await call('/api/auth/local', { method: 'POST' })).cookie;
  const make = async (title) => (await call('/api/exams', { method: 'POST', cookie: admin, body: { title, questions: [choice] } })).data.exam;
  const withAnswers = async (title) => {
    const exam = await make(title);
    app.store.openExam(exam.id);
    const session = app.store.createSession(exam.id, '1', { name: 'Ana', className: '' });
    app.store.saveAnswer(session.id, app.store.getExam(exam.id).questions[0].id, '4');
    app.store.submit(session.id);
    app.store.closeExam(exam.id);
    return exam;
  };
  const exam = await withAnswers('Prova com respostas');
  const asked = await call(`/api/exams/${exam.id}`, { method: 'DELETE', cookie: admin });
  assert.equal(asked.status, 409); assert.equal(asked.data.error ?? asked.data.code, 'exam_has_sessions');
  assert.ok(app.store.getExam(exam.id), 'sem confirmação nada é apagado');

  const done = await call(`/api/exams/${exam.id}?confirm=1&backup=1`, { method: 'DELETE', cookie: admin });
  assert.equal(done.status, 200);
  assert.deepEqual([done.data.removed.sessions, done.data.removed.answers], [1, 1]);
  assert.match(done.data.backup.name, /^atlas-antes-excluirprova-/);
  assert.equal(app.store.getExam(exam.id), undefined);
  assert.equal(app.store.raw.get('SELECT COUNT(*) AS n FROM sessions WHERE exam_id=?', exam.id).n, 0);
  assert.equal(app.store.raw.get('SELECT COUNT(*) AS n FROM answers').n, 0);
  assert.ok((await call('/api/maintenance/backups', { cookie: admin })).data.backups.length >= 1);

  const open = await make('Em andamento'); app.store.openExam(open.id);
  assert.equal((await call(`/api/exams/${open.id}?confirm=1`, { method: 'DELETE', cookie: admin })).status, 409, 'prova aberta continua protegida');
  const plain = await make('Sem respostas');
  assert.equal((await call(`/api/exams/${plain.id}`, { method: 'DELETE', cookie: admin })).status, 200);
});

test('histórico de estudante sem provas responde lista vazia (a Turma mostra "Ainda não há provas")', async () => {
  const admin = (await call('/api/auth/login', { method: 'POST', body: { pin: '123456' } })).cookie;
  const res = await call('/api/students/st-sem-provas/history', { cookie: admin });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, { history: [], recovery: [] });
});
