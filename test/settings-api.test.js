import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';
import { openStore } from '../lib/store.mjs';
import { DEMO_PREFIX, seedDemo } from '../lib/demo.mjs';

let app, base, admin, dir, exportDir, cacheCleared = 0;
const call = async (url, { method = 'GET', body, cookie = admin } = {}) => {
  // connection: close evita reaproveitar um socket que o servidor encerrou (falha intermitente no Windows).
  const res = await fetch(base + url, { method, headers: { connection: 'close', ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, data: type.includes('json') ? await res.json() : await res.text() };
};
const real = () => {
  const store = app.store; const n = (table) => store.raw.get(`SELECT COUNT(*) AS n FROM ${table}`).n;
  return { classes: n('classes'), students: n('class_roster'), exams: n('exams'), sessions: n('sessions'), answers: n('answers'), bank: n('question_bank'), titles: store.listExams().map((e) => e.title).sort().join('|') };
};
const choice = { type: 'choice', text: 'Capital do Brasil?', options: ['Brasília', 'Rio'], correct: 'Brasília', weight: 1 };

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-settings-'));
  exportDir = path.join(dir, 'copias-externas');
  app = createApp({ dataDir: dir, pin: '123456', exportDir, clearAppCache: async () => { cacheCleared += 1; } });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: '123456' }) });
  admin = login.headers.get('set-cookie').split(';')[0];
  // dados REAIS que nenhuma ação de teste pode tocar
  const klass = app.store.saveClass('Turma Real 1A', [{ number: '1', name: 'ALUNO REAL UM' }, { number: '2', name: 'ALUNA REAL DOIS' }]);
  const exam = app.store.saveExam({ title: 'Prova Real de História', questions: [choice], classId: klass.id });
  app.store.openExam(exam.id);
  const student = app.store.classRoster(klass.id)[0];
  const session = app.store.createSession(exam.id, '1', { id: student.id, name: student.name, className: klass.name });
  app.store.saveAnswer(session.id, app.store.getExam(exam.id).questions[0].id, 'Brasília');
  app.store.submit(session.id);
  app.store.closeExam(exam.id);
  app.store.saveBankQuestion(choice);
});
after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('rotas de limpeza, modo de teste e versão exigem o PIN do professor', async () => {
  for (const [method, url] of [['GET', '/api/version'], ['GET', '/api/maintenance/targets'], ['POST', '/api/maintenance/preview'], ['POST', '/api/maintenance/run'],
    ['GET', '/api/maintenance/backups'], ['GET', '/api/test-mode'], ['POST', '/api/test-mode']]) {
    assert.equal((await call(url, { method, cookie: '', body: method === 'POST' ? {} : undefined })).status, 401, url);
  }
});

test('versão exibida vem do package.json (não fica fixa no código da tela)', async () => {
  const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal((await call('/api/version')).data.version, version);
});

test('modo de teste: cria dados fictícios isolados e os dados reais ficam intactos', async () => {
  const before = real();
  assert.equal((await call('/api/test-mode')).data.active, false);
  const on = await call('/api/test-mode', { method: 'POST', body: { action: 'enable' } });
  assert.equal(on.status, 200); assert.equal(on.data.active, true);
  assert.ok(on.data.counts.classes >= 1 && on.data.counts.sessions >= 20 && on.data.counts.bank >= 5);

  const classes = (await call('/api/classes')).data.classes;
  assert.ok(classes.length >= 1 && classes.every((c) => c.name.startsWith(DEMO_PREFIX)), JSON.stringify(classes.map((c) => c.name)));
  const exams = (await call('/api/exams')).data.exams;
  assert.ok(exams.some((e) => e.title.startsWith(DEMO_PREFIX)));
  assert.ok(!JSON.stringify(exams).includes('Prova Real'));
  assert.deepEqual(real(), before, 'banco real não muda ao entrar no modo de teste');

  const demoExam = exams.find((e) => e.title.includes('Rascunho'));
  assert.equal((await call(`/api/exams/${demoExam.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await call('/api/classes', { method: 'POST', body: { name: 'Turma criada durante o teste', roster: [{ number: '1', name: 'TESTE' }] } })).status, 200);
  assert.deepEqual(real(), before, 'edições feitas no teste não chegam ao banco real');

  for (const [method, url] of [['GET', '/api/backup'], ['POST', '/api/restore'], ['POST', '/api/restore/verify'], ['POST', '/api/restore/selective']]) {
    const res = await call(url, { method, body: method === 'POST' ? {} : undefined });
    assert.equal(res.status, 409, url); assert.equal(res.data.error, 'test_mode_active');
  }
  const open = (await call('/api/exams')).data.exams.find((e) => e.title.includes('Ligações'));
  await call(`/api/exams/${open.id}/open`, { method: 'POST', body: {} });
  await call(`/api/exams/${open.id}/close`, { method: 'POST', body: {} });
  assert.equal(fs.existsSync(exportDir) ? fs.readdirSync(exportDir).length : 0, 0, 'sem cópia automática de dados de teste');

  const off = await call('/api/test-mode', { method: 'POST', body: { action: 'exit' } });
  assert.equal(off.data.active, false); assert.equal(off.data.exists, true);
  assert.deepEqual(real(), before);
  assert.ok((await call('/api/classes')).data.classes.some((c) => c.name === 'Turma Real 1A'));
  assert.ok((await call('/api/exams')).data.exams.some((e) => e.title === 'Prova Real de História'));
  assert.equal((await call('/api/backup')).status, 200);
});

test('modo de teste: recriar devolve os dados fictícios originais e apagar remove a pasta de teste', async () => {
  const before = real();
  await call('/api/test-mode', { method: 'POST', body: { action: 'enable' } });
  const target = (await call('/api/exams')).data.exams.find((e) => e.title.includes('Ligações'));
  await call('/api/maintenance/run', { method: 'POST', body: { action: 'reset', scope: { type: 'profile' }, confirm: 'APAGAR', backup: false } });
  assert.equal((await call('/api/exams')).data.exams.length, 0, 'limpeza no modo de teste só afeta o banco de teste');
  assert.deepEqual(real(), before);
  const reseeded = await call('/api/test-mode', { method: 'POST', body: { action: 'reseed' } });
  assert.ok(reseeded.data.counts.sessions >= 20);
  assert.ok((await call('/api/exams')).data.exams.some((e) => e.id !== target.id && e.title.includes('Ligações')));
  const purged = await call('/api/test-mode', { method: 'POST', body: { action: 'purge' } });
  assert.deepEqual([purged.data.active, purged.data.exists], [false, false]);
  assert.equal(fs.existsSync(path.join(dir, 'modo-teste')), false);
  assert.deepEqual(real(), before);
  assert.equal((await call('/api/test-mode', { method: 'POST', body: { action: 'reseed' } })).status, 409);
  assert.equal((await call('/api/test-mode', { method: 'POST', body: { action: 'x' } })).status, 400);
});

test('modo de teste é recusado enquanto há prova real aberta (alunos perderiam o acesso)', async () => {
  const exam = app.store.saveExam({ title: 'Prova real aberta', questions: [choice] });
  app.store.openExam(exam.id);
  try {
    const res = await call('/api/test-mode', { method: 'POST', body: { action: 'enable' } });
    assert.equal(res.status, 409); assert.equal(res.data.error, 'real_exam_live'); assert.match(res.data.message, /Prova real aberta/);
    assert.equal((await call('/api/test-mode')).data.active, false);
  } finally { app.store.closeExam(exam.id); app.store.deleteExam(exam.id); }
});

test('dados fictícios são determinísticos, identificados como teste e sem nomes repetidos', () => {
  const make = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-demo-')); const s = openStore(d); const info = seedDemo(s); const names = s.classRoster(info.classId).map((r) => r.name); s.close(); fs.rmSync(d, { recursive: true, force: true }); return { info, names }; };
  const a = make(); const b = make();
  assert.deepEqual(a.names, b.names);
  assert.equal(new Set(a.names).size, a.names.length);
  assert.equal(a.info.students, 28); assert.equal(a.info.sessions, 24);
});

test('limpeza via HTTP: prévia, confirmação, backup de segurança e download', async () => {
  const before = real();
  const preview = await call('/api/maintenance/preview', { method: 'POST', body: { action: 'results', scope: { type: 'profile' } } });
  assert.equal(preview.status, 200); assert.equal(preview.data.canRun, true); assert.equal(preview.data.confirmPhrase, 'APAGAR');
  assert.ok(!('_detail' in preview.data));
  assert.deepEqual(real(), before);

  const refused = await call('/api/maintenance/run', { method: 'POST', body: { action: 'results', scope: { type: 'profile' }, confirm: 'sim' } });
  assert.equal(refused.status, 400); assert.equal(refused.data.error, 'confirmation_required');
  assert.deepEqual(real(), before);

  const run = await call('/api/maintenance/run', { method: 'POST', body: { action: 'results', scope: { type: 'profile' }, confirm: 'APAGAR' } });
  assert.equal(run.status, 200); assert.match(run.data.backup.name, /^atlas-antes-results-/);
  assert.equal(real().sessions, 0); assert.equal(real().exams, before.exams);

  const list = (await call('/api/maintenance/backups')).data.backups;
  assert.equal(list[0].name, run.data.backup.name);
  const download = await call(`/api/maintenance/backups/${run.data.backup.name}`);
  assert.equal(download.status, 200); assert.equal(download.data.format, 'atlas-backup');
  assert.equal((await call('/api/maintenance/backups/..%2Fatlas.sqlite')).status, 400);

  const restore = await fetch(base + '/api/restore', { method: 'POST', headers: { cookie: admin, connection: 'close' }, body: JSON.stringify(download.data) });
  assert.equal(restore.status, 200);
  assert.equal(real().sessions, before.sessions);
});

test('alvos para limpeza individual e por turma são listados', async () => {
  const targets = (await call('/api/maintenance/targets')).data;
  assert.ok(targets.actions.some((a) => a.id === 'results' && a.scopes.includes('session')));
  assert.ok(targets.classes.some((c) => c.name === 'Turma Real 1A' && c.students === 2));
  const exam = targets.exams.find((e) => e.title === 'Prova Real de História');
  assert.equal(exam.sessions, 1);
  const people = (await call(`/api/maintenance/exams/${exam.id}/participants`)).data.participants;
  assert.deepEqual(people.map((p) => [p.number, p.name, p.status]), [['1', 'ALUNO REAL UM', 'submitted']]);
});

test('limpar cache chama o limpador do aplicativo e não pede backup', async () => {
  const before = real(); const calls = cacheCleared;
  const result = await call('/api/maintenance/run', { method: 'POST', body: { action: 'cache', scope: { type: 'profile' }, confirm: 'CONFIRMAR' } });
  assert.equal(result.status, 200); assert.equal(result.data.backup, null);
  assert.equal(cacheCleared, calls + 1);
  assert.deepEqual(real(), before);
});

test('desconectar participante: o aparelho é invalidado, as respostas ficam e o aluno volta com o número', async () => {
  const klass = app.store.saveClass('Turma Desconexão', [{ number: '1', name: 'ALUNO UM' }, { number: '2', name: 'ALUNO DOIS' }]);
  const exam = app.store.saveExam({ title: 'Prova de Desconexão', questions: [choice], classId: klass.id });
  const code = app.store.openExam(exam.id);
  const qid = app.store.getExam(exam.id).questions[0].id;
  const student = (number) => call('/api/session/start', { method: 'POST', cookie: '', body: { code, number } });
  try {
    const first = (await student('1')).data;
    const same = { sessionId: first.session.id, token: first.session.token };
    assert.equal((await call('/api/answer', { method: 'POST', cookie: '', body: { ...same, questionId: qid, answer: 'Brasília' } })).status, 200);
    assert.equal((await call('/api/session/heartbeat', { method: 'POST', cookie: '', body: same })).status, 200);
    assert.equal((await student('1')).status, 409, 'sem desconectar, outro aparelho é barrado');

    const run = await call('/api/maintenance/run', { method: 'POST', body: { action: 'disconnect', scope: { type: 'exam', id: exam.id }, confirm: 'CONFIRMAR' } });
    assert.equal(run.status, 200); assert.equal(run.data.summary[0].count, 1);
    assert.equal((await call('/api/session/heartbeat', { method: 'POST', cookie: '', body: same })).status, 401, 'aparelho antigo perde o acesso');

    const back = await student('1');
    assert.equal(back.status, 200, 'o aluno entra de novo sem esperar o tempo de inatividade');
    assert.equal(back.data.session.id, first.session.id, 'continua na mesma participação');
    assert.notEqual(back.data.session.token, first.session.token);
    assert.equal(app.store.raw.get('SELECT COUNT(*) AS n FROM answers WHERE session_id=?', first.session.id).n, 1, 'respostas preservadas');

    const restart = await call('/api/maintenance/run', { method: 'POST', body: { action: 'restart', scope: { type: 'exam', id: exam.id }, confirm: 'APAGAR', backup: false } });
    assert.equal(restart.status, 200);
    assert.equal(app.store.listSessions(exam.id).length, 0);
    assert.equal((await student('1')).status, 403, 'código antigo recusado');
    const newCode = app.store.getExam(exam.id).accessCode;
    assert.notEqual(newCode, code);
    assert.equal((await call('/api/session/start', { method: 'POST', cookie: '', body: { code: newCode, number: '1' } })).status, 200);
  } finally { app.store.closeExam(exam.id); }
});
