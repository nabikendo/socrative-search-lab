// Sprint 2 (presença em tempo real) e mitigações da Sprint 5 (validade do acesso, vínculo por aparelho, 2 aparelhos).
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';

let app, base, admin, dir;
const choice = (text) => ({ type: 'choice', text, options: ['A', 'B', 'C'], correct: 'B', weight: 1 });
const call = async (url, { method = 'GET', body, cookie = '', headers = {} } = {}) => {
  const res = await fetch(base + url, { method, headers: { connection: 'close', ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, data: type.includes('json') ? await res.json() : await res.text() };
};
const prof = (url, opts = {}) => call(url, { ...opts, cookie: admin });

// Cliente SSE mínimo: lê o fluxo e entrega cada evento "presence" já interpretado.
async function openStream(examId) {
  const controller = new AbortController();
  const res = await fetch(`${base}/api/exams/${examId}/presence/stream`, { headers: { cookie: admin }, signal: controller.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events = [];
  const waiters = [];
  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, cut); buffer = buffer.slice(cut + 2);
          const name = block.match(/^event: (.+)$/m)?.[1];
          const data = block.match(/^data: (.+)$/m)?.[1];
          if (name === 'presence' && data) { const parsed = JSON.parse(data); events.push(parsed); for (const w of [...waiters]) if (w.match(parsed)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(parsed); } }
        }
      }
    } catch { /* fechado */ }
  })();
  return {
    events,
    next(match, timeout = 6000) {
      const found = events.find(match);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const waiter = { match, resolve };
        waiters.push(waiter);
        setTimeout(() => { waiters.splice(waiters.indexOf(waiter), 1); reject(new Error('evento SSE não chegou a tempo')); }, timeout).unref();
      });
    },
    // descarta o histórico: próximas esperas só valem para eventos novos
    reset() { events.length = 0; },
    close() { controller.abort(); },
  };
}

async function newExam(title, names) {
  const klass = (await prof('/api/classes', { method: 'POST', body: { name: `Turma ${title}`, roster: names.map((name, i) => ({ number: String(i + 1), name })) } })).data.class;
  const exam = (await prof('/api/exams', { method: 'POST', body: { title, classId: klass.id, questions: [choice('Q1?'), choice('Q2?')] } })).data.exam;
  const { code } = (await prof(`/api/exams/${exam.id}/open`, { method: 'POST' })).data;
  return { examId: exam.id, code, questions: app.store.getExam(exam.id).questions };
}
const start = (code, number, deviceId, token) => call('/api/session/start', { method: 'POST', body: { code, number, deviceId, token }, headers: { 'user-agent': 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) Chrome/120' } });
const beat = (s) => call('/api/session/heartbeat', { method: 'POST', body: { sessionId: s.id, token: s.token } });

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-presence-'));
  app = createApp({ dataDir: dir, pin: '123456', securePort: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: '123456' }) });
  admin = login.headers.get('set-cookie').split(';')[0];
});
after(async () => { mock.timers.reset(); await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('rotas de presença exigem o PIN do professor', async () => {
  const { examId } = await newExam('Auth', ['ANA']);
  for (const url of [`/api/exams/${examId}/presence`, `/api/exams/${examId}/presence/stream`, `/api/exams/${examId}/presence.csv`]) assert.equal((await call(url)).status, 401, url);
  assert.equal((await call('/api/sessions/x/release-device', { method: 'POST' })).status, 401);
});

test('SSE: 3 alunos entrando em sequência aparecem em segundos, com contador e horário', async () => {
  const { examId, code } = await newExam('SSE', ['ANA', 'BRUNO', 'CAIO', 'DORA']);
  const stream = await openStream(examId);
  try {
    const first = await stream.next((e) => e.counts.total === 4);
    assert.deepEqual([first.counts.entered, first.counts.absent], [0, 4]);
    for (const [i, number] of ['1', '2', '3'].entries()) {
      const t0 = Date.now();
      assert.equal((await start(code, number, `device-${number}-aaaaaaaa`)).status, 200);
      const event = await stream.next((e) => e.counts.entered === i + 1);
      assert.ok(Date.now() - t0 < 3000, 'atualiza em segundos');
      const student = event.students.find((s) => s.number === number);
      assert.equal(student.state, 'online');
      assert.ok(student.enteredAt);
      assert.equal(student.device, 'Chromebook');
      assert.equal(student.ip, '127.0.0.1');
    }
    const last = stream.events.at(-1);
    assert.deepEqual([last.counts.entered, last.counts.total, last.counts.online, last.counts.absent], [3, 4, 3, 1]);
    assert.deepEqual(last.students.filter((s) => s.state === 'absent').map((s) => s.name), ['DORA']);
    assert.deepEqual(last.audit.filter((a) => a.event === 'entered').map((a) => a.number).sort(), ['1', '2', '3']);
  } finally { stream.close(); }
});

test('expiração: aluno fecha o navegador (sai como "Saiu"), volta no mesmo aparelho e continua', async () => {
  const { examId, code, questions } = await newExam('Fecha', ['ANA', 'BRUNO']);
  const stream = await openStream(examId);
  try {
    const session = (await start(code, '1', 'device-ana-11111111')).data.session;
    assert.equal((await call('/api/answer', { method: 'POST', body: { sessionId: session.id, token: session.token, questionId: questions[0].id, answer: 'B' } })).status, 200);
    await stream.next((e) => e.counts.online === 1);
    // navegador fecha: o aviso de saída faz o painel mostrar "Saiu" na hora
    assert.equal((await call('/api/session/leave', { method: 'POST', body: { sessionId: session.id, token: session.token } })).status, 200);
    const gone = await stream.next((e) => e.students.find((s) => s.number === '1').state === 'left');
    assert.equal(gone.counts.entered, 1, 'quem saiu continua contando como presente (decisão de UX)');
    assert.ok(gone.audit.some((a) => a.event === 'left' && a.reason === 'fechou a página'));
    // volta no mesmo aparelho, mesmo depois do acesso vencer (sem perder a resposta)
    mock.timers.enable({ apis: ['Date'], now: Date.now() + 11 * 60_000 });
    try {
      assert.equal((await beat(session)).data.error, 'session_expired');
      const back = await start(code, '1', 'device-ana-11111111');
      assert.equal(back.status, 200);
      assert.equal(back.data.session.id, session.id);
      assert.notEqual(back.data.session.token, session.token, 'token novo ao voltar');
      assert.equal(back.data.answers[questions[0].id], 'B', 'resposta salva continua lá');
    } finally { mock.timers.reset(); }
    const returned = await stream.next((e) => e.students.find((s) => s.number === '1').state === 'online' && e.audit.some((a) => a.event === 'returned'));
    assert.equal(returned.counts.online, 1);
  } finally { stream.close(); }
});

test('sem aviso do navegador, o aluno passa a "Saiu" depois de 30 s sem sinal', async () => {
  const { examId, code } = await newExam('Sem sinal', ['ANA']);
  const stream = await openStream(examId);
  try {
    await start(code, '1', 'device-silencio-1');
    await stream.next((e) => e.counts.online === 1);
    mock.timers.enable({ apis: ['Date'], now: Date.now() + 31_000 });
    try {
      const event = await stream.next((e) => e.counts.left === 1, 8000);
      assert.ok(event.audit.some((a) => a.event === 'left' && a.reason === 'sem sinal'));
    } finally { mock.timers.reset(); }
  } finally { stream.close(); }
});

test('validade do acesso: token vence após 10 min sem sinal e a renovação exige o mesmo aparelho', async () => {
  const { code } = await newExam('TTL', ['ANA']);
  const session = (await start(code, '1', 'device-ttl-1234567')).data.session;
  mock.timers.enable({ apis: ['Date'], now: Date.now() + 9 * 60_000 });
  try { assert.equal((await beat(session)).status, 200, 'ainda dentro dos 10 min'); } finally { mock.timers.reset(); }
  mock.timers.enable({ apis: ['Date'], now: Date.now() + 9 * 60_000 + 10 * 60_000 + 5_000 });
  try {
    const expired = await beat(session);
    assert.equal(expired.status, 401); assert.equal(expired.data.error, 'session_expired');
    assert.equal((await call('/api/answer', { method: 'POST', body: { sessionId: session.id, token: session.token, questionId: 'x', answer: 'A' } })).data.error, 'session_expired');
    // quem tem o token velho mas está em outro aparelho não renova
    assert.equal((await start(code, '1', 'device-ladrao-999', session.token)).status, 409);
    assert.equal((await start(code, '1', 'device-ttl-1234567')).status, 200);
  } finally { mock.timers.reset(); }
  // validade configurável
  assert.equal((await prof('/api/security', { method: 'PUT', body: { tokenTtlMinutes: 1 } })).status, 400);
  assert.equal((await prof('/api/security', { method: 'PUT', body: { tokenTtlMinutes: 15 } })).data.tokenTtlMinutes, 15);
  await prof('/api/security', { method: 'PUT', body: { tokenTtlMinutes: 10 } });
});

test('troca de dispositivo: 2º aparelho é barrado e alertado; liberar e reconectar sem perder respostas', async () => {
  const { examId, code, questions } = await newExam('Troca', ['ANA', 'BRUNO']);
  const stream = await openStream(examId);
  try {
    const first = (await start(code, '2', 'device-velho-0001')).data.session;
    await call('/api/answer', { method: 'POST', body: { sessionId: first.id, token: first.token, questionId: questions[0].id, answer: 'C' } });
    await call('/api/answer', { method: 'POST', body: { sessionId: first.id, token: first.token, questionId: questions[1].id, answer: 'A' } });
    // mesmo aluno em outro aparelho, com o primeiro ainda conectado
    const intruder = await call('/api/session/start', { method: 'POST', body: { code, number: '2', deviceId: 'device-novo-0002' }, headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 13; Mobile)' } });
    assert.equal(intruder.status, 409); assert.equal(intruder.data.error, 'session_in_use');
    assert.match(intruder.data.message, /liberar/);
    const alert = await stream.next((e) => e.counts.conflicts === 1);
    const bruno = alert.students.find((s) => s.number === '2');
    assert.equal(bruno.conflicts, 1);
    const conflictLog = alert.audit.find((a) => a.event === 'device_conflict');
    assert.equal(conflictLog.device, 'Celular Android'); assert.equal(conflictLog.boundDevice, 'Chromebook'); assert.equal(conflictLog.ip, '127.0.0.1');

    // professor libera
    assert.equal((await prof(`/api/sessions/${first.id}/release-device`, { method: 'POST' })).status, 200);
    const old = await beat(first);
    assert.equal(old.status, 401); assert.equal(old.data.error, 'invalid_session', 'aparelho antigo perde o acesso (não renova sozinho)');
    const swapped = await call('/api/session/start', { method: 'POST', body: { code, number: '2', deviceId: 'device-novo-0002' }, headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 13; Mobile)' } });
    assert.equal(swapped.status, 200);
    assert.equal(swapped.data.session.id, first.id, 'mesma participação');
    assert.deepEqual(swapped.data.answers, { [questions[0].id]: 'C', [questions[1].id]: 'A' }, 'nenhuma resposta perdida');
    // agora o vínculo é do aparelho novo: o antigo é que fica barrado
    assert.equal((await start(code, '2', 'device-velho-0001')).status, 409);
    const after = await stream.next((e) => e.audit.some((a) => a.event === 'device_rebound'));
    assert.equal(after.students.find((s) => s.number === '2').device, 'Celular Android');
    assert.ok(after.audit.some((a) => a.event === 'device_released'));
    // não dá para liberar quem já enviou
    await call('/api/session/submit', { method: 'POST', body: { sessionId: swapped.data.session.id, token: swapped.data.session.token } });
    assert.equal((await prof(`/api/sessions/${first.id}/release-device`, { method: 'POST' })).status, 409);
  } finally { stream.close(); }
});

test('pedir ajuda chega ao painel por SSE em segundos e o professor marca como atendido', async () => {
  const { examId, code } = await newExam('Ajuda', ['ANA']);
  const stream = await openStream(examId);
  try {
    const session = (await start(code, '1', 'device-ajuda-0001')).data.session;
    const t0 = Date.now();
    assert.equal((await call('/api/session/help', { method: 'POST', body: { sessionId: session.id, token: session.token, on: true } })).data.help, true);
    const asked = await stream.next((e) => e.counts.help === 1);
    assert.ok(Date.now() - t0 < 3000);
    assert.ok(asked.students[0].help);
    assert.equal((await beat(session)).data.help, true);
    assert.equal((await prof(`/api/sessions/${session.id}/help/answer`, { method: 'POST' })).status, 200);
    const answered = await stream.next((e) => e.counts.help === 0 && e.audit.some((a) => a.event === 'help_answered'));
    assert.equal(answered.students[0].help, null);
    assert.equal((await beat(session)).data.help, false, 'o aluno vê que foi atendido');
    assert.equal((await call('/api/session/help', { method: 'POST', body: { sessionId: session.id, token: 'errado', on: true } })).status, 401);
  } finally { stream.close(); }
});

test('exportar chamada em CSV: legível no Excel, com acentos, aspas, ponto e vírgula e sem fórmulas', async () => {
  const names = ['JOÃO D\'ÁVILA', 'MARÍA "LUPITA"; SOUZA', '=CMD()+1', 'ÇÃO ÊNIO ÜBER'];
  const { examId, code } = await newExam('Química — 1º ano', names);
  await start(code, '1', 'device-csv-000001');
  const s3 = (await start(code, '3', 'device-csv-000003')).data.session;
  await call('/api/session/submit', { method: 'POST', body: { sessionId: s3.id, token: s3.token } });
  const res = await fetch(`${base}/api/exams/${examId}/presence.csv`, { headers: { cookie: admin } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv; charset=utf-8/);
  assert.match(res.headers.get('content-disposition'), /chamada-quimica-1-ano\.csv/);
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF], 'BOM UTF-8 para o Excel reconhecer os acentos');
  const text = new TextDecoder().decode(bytes).replace(/^﻿/, '');
  assert.match(text, /2 de 4 alunos entraram/);
  const lines = text.trim().split('\r\n');
  assert.equal(lines[2], 'Nº;Aluno;Turma;Situação;Entrada;Última atividade;Envio;Aparelho;IP;Pedidos de ajuda;Tentativas em outro aparelho');
  const rows = lines.slice(3);
  assert.equal(rows.length, 4);
  assert.match(rows[0], /^1;JOÃO D'ÁVILA;Turma Química — 1º ano;Em prova;/);
  assert.match(rows[1], /^2;"MARÍA ""LUPITA""; SOUZA";Turma Química — 1º ano;Não entrou;/);
  assert.match(rows[2], /^3;'=CMD\(\)\+1;Turma Química — 1º ano;Enviou;/, 'fórmula neutralizada');
  assert.match(rows[3], /^4;ÇÃO ÊNIO ÜBER;.*;Não entrou;/);
  assert.match(rows[0], /;Chromebook;127\.0\.0\.1;0;0$/);
});

test('auditoria de presença não polui a auditoria geral da prova', async () => {
  const { examId, code } = await newExam('Auditoria', ['ANA']);
  await start(code, '1', 'device-audit-00001');
  const general = (await prof(`/api/exams/${examId}/audit`)).data.events;
  assert.ok(general.every((e) => !e.event.startsWith('presence_')));
  assert.ok((await prof(`/api/exams/${examId}/presence`)).data.audit.length >= 1);
});
