// Sprint 4: salvamento, retomada, cronômetro sincronizado, revisão antes do envio e regras do cliente.
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';
import { timeWarning, secondsLeft, reviewSummary, newDeviceId, hasAnswer } from '../shared/student-ui.js';
import { answerFailure } from '../shared/answer-sync.js';

let app, base, admin, dir;
const call = async (url, { method = 'GET', body, cookie = '' } = {}) => {
  const res = await fetch(base + url, { method, headers: { connection: 'close', ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, data: type.includes('json') ? await res.json() : await res.text() };
};
const prof = (url, opts = {}) => call(url, { ...opts, cookie: admin });

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-student-'));
  app = createApp({ dataDir: dir, pin: '123456', securePort: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: '123456' }) });
  admin = login.headers.get('set-cookie').split(';')[0];
});
after(async () => { mock.timers.reset(); await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function openExam(title, questions) {
  const klass = (await prof('/api/classes', { method: 'POST', body: { name: `Turma ${title}`, roster: [{ number: '1', name: 'ANA' }, { number: '2', name: 'BRUNO' }] } })).data.class;
  const exam = (await prof('/api/exams', { method: 'POST', body: { title, classId: klass.id, questions } })).data.exam;
  const { code } = (await prof(`/api/exams/${exam.id}/open`, { method: 'POST' })).data;
  return { examId: exam.id, code, questions: app.store.getExam(exam.id).questions };
}
const qs = [
  { type: 'choice', text: 'Q1', options: ['A', 'B'], correct: 'A', weight: 1 },
  { type: 'text', text: 'Q2', weight: 1 },
  { type: 'multi', text: 'Q3', options: ['X', 'Y', 'Z'], correct: ['X', 'Y'], weight: 1 },
];

test('autosave: responder, fechar, reabrir e conferir (inclusive depois do acesso vencer)', async () => {
  const { code, questions } = await openExam('Autosave', qs);
  const device = newDeviceId();
  const first = (await call('/api/session/start', { method: 'POST', body: { code, number: '1', deviceId: device } })).data;
  const saved = { code, number: '1', sessionId: first.session.id, token: first.session.token }; // o que o navegador guarda
  const send = (questionId, answer) => call('/api/answer', { method: 'POST', body: { sessionId: saved.sessionId, token: saved.token, questionId, answer } });
  assert.equal((await send(questions[0].id, 'B')).status, 200);
  assert.equal((await send(questions[1].id, 'Ligação iônica: transferência de elétrons')).status, 200);
  assert.equal((await send(questions[2].id, ['X', 'Z'])).status, 200);
  assert.equal((await send(questions[0].id, 'A')).status, 200, 'trocar a resposta sobrescreve');
  // "fecha" o navegador (aviso de saída) e reabre logo depois: retoma pelo restore
  await call('/api/session/leave', { method: 'POST', body: { sessionId: saved.sessionId, token: saved.token } });
  const reopened = await call('/api/session/restore', { method: 'POST', body: saved });
  assert.equal(reopened.status, 200);
  assert.deepEqual(reopened.data.answers, { [questions[0].id]: 'A', [questions[1].id]: 'Ligação iônica: transferência de elétrons', [questions[2].id]: '["X","Z"]' });
  // reabre só no dia seguinte da aula? não: 30 min depois, com o acesso vencido. O mesmo aparelho volta com tudo.
  mock.timers.enable({ apis: ['Date'], now: Date.now() + 30 * 60_000 });
  try {
    const expired = await call('/api/session/restore', { method: 'POST', body: saved });
    assert.equal(expired.data.error, 'session_expired');
    assert.equal(answerFailure(expired.data.error ? { code: expired.data.error, status: expired.status } : {}).action, 'renew', 'o cliente renova em vez de travar');
    const renewed = await call('/api/session/start', { method: 'POST', body: { code, number: '1', token: saved.token, deviceId: device } });
    assert.equal(renewed.status, 200);
    assert.equal(renewed.data.answers[questions[1].id], 'Ligação iônica: transferência de elétrons');
  } finally { mock.timers.reset(); }
});

test('cliente: salvamento com espera de ~1 s, fila local, renovação automática e aviso de saída', () => {
  const code = fs.readFileSync(new URL('../src/prova.js', import.meta.url), 'utf8');
  assert.match(code, /saveTextAnswer\(q\.id, ?value\), ?1000\)/, 'debounce de 1 s no texto');
  assert.match(code, /writeJson\(queueKey\(state\.session\.id\), state\.pending\)/, 'fila local persistida a cada alteração');
  assert.match(code, /failure\.action === 'renew' && await renewSession\(\)/);
  assert.match(code, /error\.code === 'session_expired'/);
  assert.match(code, /sendBeacon\('\/api\/session\/leave'/);
  assert.match(code, /deviceId: deviceId\(\)/);
});

test('cronômetro: avisos aos 5 e a 1 minuto, uma vez cada, pelo relógio do servidor', () => {
  const warned = new Set();
  assert.equal(timeWarning(301, warned), null);
  assert.equal(timeWarning(300, warned).id, '5min');
  assert.equal(timeWarning(299, warned), null, 'não repete');
  assert.equal(timeWarning(61, warned), null);
  assert.equal(timeWarning(60, warned).id, '1min');
  assert.equal(timeWarning(30, warned), null);
  assert.equal(timeWarning(0, new Set()), null, 'tempo esgotado não é aviso');
  const reopened = new Set();
  assert.equal(timeWarning(40, reopened).id, '1min', 'reabrir com 40 s mostra só o aviso urgente');
  assert.equal(timeWarning(35, reopened), null);
  // celular com o relógio 10 min adiantado: o deslocamento medido no batimento corrige
  const serverNow = 1_700_000_000_000; const endsAt = serverNow + 5 * 60_000;
  const phoneNow = serverNow + 10 * 60_000;
  const offset = serverNow - phoneNow;
  assert.equal(secondsLeft(endsAt, offset, phoneNow), 300);
  assert.equal(secondsLeft(endsAt, 0, phoneNow), 0, 'sem o deslocamento o celular erraria');
});

test('cronômetro sincronizado: o batimento informa a hora do servidor e o fim da prova (5 min e 1 min restantes)', async () => {
  const { examId, code } = await openExam('Relógio', qs);
  const session = (await call('/api/session/start', { method: 'POST', body: { code, number: '2', deviceId: newDeviceId() } })).data.session;
  for (const minutes of [5, 1]) {
    const now = Date.now();
    app.store.raw.tx(() => app.store.raw.run('UPDATE exams SET scheduled_end=? WHERE id=?', new Date(now + minutes * 60_000).toISOString(), examId));
    const result = (await call('/api/session/heartbeat', { method: 'POST', body: { sessionId: session.id, token: session.token } })).data;
    const left = secondsLeft(result.endsAt, result.serverNow - Date.now());
    assert.ok(Math.abs(left - minutes * 60) <= 2, `${left} ≈ ${minutes * 60}`);
    assert.equal(timeWarning(left, new Set())?.id, minutes === 5 ? '5min' : '1min');
  }
});

test('revisão antes de enviar: lista questões em branco (texto vazio, só espaços, múltipla vazia) e marcadas', () => {
  const questions = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
  const answers = { a: 'B', b: '   ', c: [], d: ['X'] };
  const review = reviewSummary(questions, (id) => answers[id], new Set(['a', 'e']));
  assert.equal(review.total, 5);
  assert.equal(review.answered, 2);
  assert.deepEqual(review.blanks.map((item) => item.number), [2, 3, 5]);
  assert.deepEqual(review.flagged.map((item) => item.number), [1, 5]);
  assert.ok(!hasAnswer(undefined) && !hasAnswer(null) && hasAnswer('0') && hasAnswer(0));
});

test('identificador do aparelho é aleatório, funciona sem HTTPS e é aceito pelo servidor', () => {
  const ids = new Set(Array.from({ length: 50 }, () => newDeviceId()));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.match(id, /^d-[0-9a-f]{32}$/);
});
