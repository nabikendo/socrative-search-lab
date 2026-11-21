import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';

// Sala de 40 alunos: entrada, entrega, reabertura e planilha.
let app, base, dir, admin, exam;
const call = async (url, { method = 'GET', body, cookie = '' } = {}) => {
  const res = await fetch(base + url, { method, headers: { connection: 'close', ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, cookie: res.headers.get('set-cookie')?.split(';')[0], data: type.includes('json') ? await res.json() : await res.text() };
};
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-sala40-'));
  app = createApp({ dataDir: dir, pin: '123456', securePort: 0 });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
  admin = (await call('/api/auth/login', { method: 'POST', body: { pin: '123456' } })).cookie;
  const turma = app.store.saveClass('2ª série B', Array.from({ length: 40 }, (_, i) => ({ number: String(i + 1), name: `Aluno ${i + 1}` })));
  exam = app.store.saveExam({ title: 'Sala 40', classId: turma.id, questions: [{ type: 'choice', text: '2+2?', options: ['3', '4'], correct: '4', weight: 1 }] });
  app.store.openExam(exam.id);
  exam = app.store.getExam(exam.id);
});
after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('40 alunos saindo pelo mesmo endereço (rede com NAT) entram e entregam sem "Muitas tentativas"', async () => {
  const sessions = await Promise.all(Array.from({ length: 40 }, async (_, i) => {
    const number = String(i + 1);
    assert.equal((await call('/api/identify', { method: 'POST', body: { code: exam.accessCode, number } })).status, 200, `identificação do aluno ${number}`);
    const started = await call('/api/session/start', { method: 'POST', body: { code: exam.accessCode, number, deviceId: `aparelho-${number}-abcdefgh` } });
    assert.equal(started.status, 200, `entrada do aluno ${number}: ${JSON.stringify(started.data)}`);
    return started.data.session;
  }));
  const qid = exam.questions[0].id;
  const saved = await Promise.all(sessions.map((s) => call('/api/answer', { method: 'POST', body: { sessionId: s.id, token: s.token, questionId: qid, answer: '4' } })));
  assert.deepEqual(saved.filter((r) => r.status !== 200).map((r) => r.data), []);
  const sent = await Promise.all(sessions.map((s) => call('/api/session/submit', { method: 'POST', body: { sessionId: s.id, token: s.token } })));
  assert.deepEqual(sent.filter((r) => r.status !== 200).map((r) => r.data), []);
  const results = (await call(`/api/exams/${exam.id}/results`, { cookie: admin })).data.results;
  assert.equal(results.filter((r) => r.status === 'submitted').length, 40);
});

test('quem tenta muitos números seguidos é barrado por número, sem travar a sala', async () => {
  let blocked = 0;
  for (let i = 0; i < 20; i++) if ((await call('/api/identify', { method: 'POST', body: { code: exam.accessCode, number: '999' } })).status === 429) blocked++;
  assert.ok(blocked > 0, 'o mesmo número repetido deve ser limitado');
  assert.equal((await call('/api/identify', { method: 'POST', body: { code: exam.accessCode, number: '7' } })).status, 200);
});

test('reabrir: a sessão volta a ficar ativa e o aparelho do aluno consegue retomar', async () => {
  const results = (await call(`/api/exams/${exam.id}/results`, { cookie: admin })).data.results;
  const r5 = results.find((r) => r.number === '5');
  assert.equal((await call(`/api/sessions/${r5.sessionId}/reopen`, { method: 'POST', cookie: admin, body: { reason: 'Revisar resposta' } })).status, 200);
  const again = await call('/api/session/start', { method: 'POST', body: { code: exam.accessCode, number: '5', deviceId: 'aparelho-5-abcdefgh' } });
  assert.equal(again.status, 200);
  assert.equal(again.data.answers[exam.questions[0].id], '4');
});

test('planilhas trazem data e hora do computador do professor e o número como número', async () => {
  const csv = (await call(`/api/exams/${exam.id}/export.csv`, { cookie: admin })).data;
  const line = csv.split('\r\n').find((l) => l.startsWith('1;'));
  assert.match(line, /;\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2};/);
  assert.doesNotMatch(csv, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
});
