import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../lib/store.mjs';
import { openAiSettings } from '../lib/ai-settings.mjs';
import { plan, publicPlan, execute, listSafetyBackups, safetyBackupPath, createSafetyBackup, MaintenanceError } from '../lib/maintenance.mjs';

const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

const choice = { type: 'choice', text: '2+2?', options: ['3', '4'], correct: '4', weight: 1 };

// Perfil realista: duas turmas, prova encerrada com resultados, dois rascunhos e uma prova em andamento.
function world({ live = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-maint-')); dirs.push(dir);
  const store = openStore(dir);
  const aiSettings = openAiSettings(dir);
  const preferencesFile = path.join(dir, 'teacher-settings.json');
  fs.writeFileSync(preferencesFile, '{"theme":"dark"}');
  aiSettings.updateProvider('groq', { apiKey: 'gsk-1234567890', model: 'm1' });
  const forgotten = [];
  let cacheCleared = 0;
  const ctx = { store, dataDir: dir, preferencesFile, aiSettings, hooks: { forgetPresence: (ids) => forgotten.push(...ids), clearAppCache: async () => { cacheCleared += 1; } } };

  const A = store.saveClass('33.01', [{ number: '1', name: 'Ana' }, { number: '2', name: 'Bia' }, { number: '3', name: 'Caio' }]);
  const B = store.saveClass('33.02', [{ number: '1', name: 'Dora' }, { number: '2', name: 'Edu' }]);
  const studentA1 = store.classRoster(A.id)[0];
  store.setAccommodation(studentA1.id, { extraTime: 10 });
  const closed = store.saveExam({ title: 'Prova encerrada', questions: [choice], classId: A.id });
  const draftA = store.saveExam({ title: 'Rascunho A', questions: [choice], classId: A.id });
  const draftB = store.saveExam({ title: 'Rascunho B', questions: [choice], classId: B.id });
  const draftWithResults = store.saveExam({ title: 'Rascunho com notas', questions: [choice], classId: A.id });
  const qid = (exam) => store.getExam(exam.id).questions[0].id;

  const fill = (exam, rows) => rows.map(([number, name, submit]) => {
    const session = store.createSession(exam.id, number, { name, className: store.getClass?.(exam.classId)?.name ?? '' });
    store.saveAnswer(session.id, qid(exam), '4');
    store.setGrade(session.id, qid(exam), 1);
    if (submit) store.submit(session.id);
    return session;
  });
  store.openExam(closed.id);
  const closedSessions = fill(closed, [['1', 'Ana', true], ['2', 'Bia', true]]);
  store.closeExam(closed.id);
  store.annulQuestion(store.getExam(closed.id), qid(closed), 'credit', 'teste');
  // rascunho que já recebeu participações (ex.: prova reaberta e depois devolvida a rascunho)
  store.openExam(draftWithResults.id);
  fill(draftWithResults, [['3', 'Caio', true]]);
  store.closeExam(draftWithResults.id);
  store.raw.tx(() => store.raw.run("UPDATE exams SET status='draft' WHERE id=?", draftWithResults.id));
  let liveExam = null; let liveSessions = [];
  if (live) {
    liveExam = store.saveExam({ title: 'Prova ao vivo', questions: [choice], classId: B.id });
    store.openExam(liveExam.id);
    liveSessions = fill(liveExam, [['1', 'Dora', false], ['2', 'Edu', true]]);
  }
  return { dir, store, ctx, aiSettings, preferencesFile, forgotten, cacheCleared: () => cacheCleared, A, B, closed, closedSessions, draftA, draftB, draftWithResults, liveExam, liveSessions };
}
const totals = (store) => ({
  exams: store.listExams().length, sessions: store.raw.get('SELECT COUNT(*) AS n FROM sessions').n,
  answers: store.raw.get('SELECT COUNT(*) AS n FROM answers').n, grades: store.raw.get('SELECT COUNT(*) AS n FROM grades').n,
  classes: store.listClasses().length, students: store.raw.get('SELECT COUNT(*) AS n FROM class_roster').n,
});
const run = (w, action, scope = { type: 'profile' }, extra = {}) => execute(w.ctx, { action, scope, confirm: action === 'cache' || action === 'disconnect' || action === 'settings' ? 'CONFIRMAR' : 'APAGAR', ...extra });
const code = (c) => (e) => e instanceof MaintenanceError && e.code === c;

test('pré-visualização não altera nada e mostra o que será afetado', () => {
  const w = world(); const before = totals(w.store);
  const p = plan(w.ctx, { action: 'results', scope: { type: 'exam', id: w.closed.id } });
  assert.deepEqual(totals(w.store), before);
  assert.equal(p.canRun, true); assert.equal(p.confirmPhrase, 'APAGAR');
  assert.deepEqual(p.summary.map((item) => [item.label, item.count]), [['Provas com resultados', 1], ['Participações', 2], ['Respostas', 2], ['Notas lançadas', 2]]);
  assert.ok(!('_detail' in publicPlan(p)));
});

test('sem a frase de confirmação nada é apagado; ações leves pedem CONFIRMAR', async () => {
  const w = world(); const before = totals(w.store);
  for (const confirm of [undefined, '', 'apagar', 'SIM', true]) {
    await assert.rejects(execute(w.ctx, { action: 'results', scope: { type: 'profile' }, confirm }), code('confirmation_required'));
  }
  await assert.rejects(execute(w.ctx, { action: 'cache', scope: { type: 'profile' }, confirm: 'APAGAR' }), code('confirmation_required'));
  assert.deepEqual(totals(w.store), before);
  assert.equal(listSafetyBackups(w.store).length, 0, 'não cria backup se a confirmação falhou');
});

test('ação ou alcance inválidos e itens inexistentes são recusados', async () => {
  const w = world();
  assert.throws(() => plan(w.ctx, { action: 'formatar' }), code('unknown_action'));
  assert.throws(() => plan(w.ctx, { action: 'cache', scope: { type: 'exam', id: 'x' } }), code('invalid_scope'));
  assert.throws(() => plan(w.ctx, { action: 'results', scope: { type: 'exam' } }), code('invalid_scope'));
  assert.throws(() => plan(w.ctx, { action: 'results', scope: { type: 'exam', id: 'nao-existe' } }), code('not_found'));
  assert.throws(() => plan(w.ctx, { action: 'classes', scope: { type: 'student', id: w.A.id, number: '99' } }), code('not_found'));
});

test('limpar avaliações em elaboração: individual, por turma e perfil; rascunho com participações é preservado', async () => {
  let w = world();
  await run(w, 'drafts', { type: 'exam', id: w.draftA.id });
  assert.ok(!w.store.listExams().some((exam) => exam.id === w.draftA.id));
  assert.ok(w.store.listExams().some((exam) => exam.id === w.draftB.id));

  w = world();
  await run(w, 'drafts', { type: 'class', id: w.A.id });
  const left = w.store.listExams().map((exam) => exam.title).sort();
  assert.deepEqual(left, ['Exemplo — ligações químicas', 'Prova ao vivo', 'Prova encerrada', 'Rascunho B', 'Rascunho com notas']);

  w = world();
  const p = plan(w.ctx, { action: 'drafts', scope: { type: 'profile' } });
  assert.match(p.notes.join(' '), /1 rascunho/);
  await run(w, 'drafts');
  assert.deepEqual(w.store.listExams().map((exam) => exam.title).sort(), ['Prova ao vivo', 'Prova encerrada', 'Rascunho com notas']);
});

test('limpar rascunhos sem nenhum rascunho é bloqueado com mensagem clara', async () => {
  const w = world();
  await run(w, 'drafts');
  const p = plan(w.ctx, { action: 'drafts', scope: { type: 'class', id: w.B.id } });
  assert.equal(p.canRun, false);
  await assert.rejects(run(w, 'drafts', { type: 'class', id: w.B.id }), code('blocked'));
});

test('apagar resultados: individual, prova e turma; provas permanecem; prova ao vivo é protegida', async () => {
  let w = world();
  const [first] = w.closedSessions;
  await run(w, 'results', { type: 'session', id: first.id });
  assert.equal(w.store.listSessions(w.closed.id).length, 1);
  assert.equal(w.store.raw.get('SELECT COUNT(*) AS n FROM answers WHERE session_id=?', first.id).n, 0);

  w = world();
  await run(w, 'results', { type: 'exam', id: w.closed.id });
  assert.equal(w.store.listSessions(w.closed.id).length, 0);
  assert.ok(w.store.getExam(w.closed.id), 'a prova continua existindo');
  assert.equal(w.store.listSessions(w.liveExam.id).length, 2, 'prova ao vivo intacta');

  w = world();
  await run(w, 'results', { type: 'class', id: w.A.id });
  assert.equal(w.store.listSessions(w.closed.id).length, 0);
  assert.equal(w.store.listSessions(w.draftWithResults.id).length, 0);
  assert.equal(w.store.listSessions(w.liveExam.id).length, 2);

  w = world();
  await assert.rejects(run(w, 'results', { type: 'exam', id: w.liveExam.id }), code('blocked'));
  await assert.rejects(run(w, 'results', { type: 'session', id: w.liveSessions[0].id }), code('blocked'));
  const all = plan(w.ctx, { action: 'results', scope: { type: 'profile' } });
  assert.match(all.notes.join(' '), /em andamento serão ignoradas/);
  await run(w, 'results');
  assert.equal(w.store.listSessions(w.liveExam.id).length, 2);
  assert.equal(w.store.raw.get('SELECT COUNT(*) AS n FROM sessions').n, 2);
});

test('reiniciar prova em andamento: zera participações, troca o código e mantém a prova aberta', async () => {
  const w = world();
  const before = w.store.getExam(w.liveExam.id).accessCode;
  const result = await run(w, 'restart', { type: 'exam', id: w.liveExam.id });
  assert.equal(result.ok, true);
  const exam = w.store.getExam(w.liveExam.id);
  assert.equal(exam.status, 'open');
  assert.notEqual(exam.accessCode, before);
  assert.equal(w.store.listSessions(w.liveExam.id).length, 0);
  assert.deepEqual(w.forgotten.sort(), w.liveSessions.map((s) => s.id).sort());
  assert.equal(w.store.listSessions(w.closed.id).length, 2, 'resultados de outras provas intactos');
  await assert.rejects(run(w, 'restart', { type: 'exam', id: w.closed.id }), code('blocked'));
});

test('desconectar participantes: invalida o aparelho, preserva respostas e não toca em quem já enviou', async () => {
  const w = world();
  const [active, submitted] = w.liveSessions;
  const oldToken = w.store.getSession(active.id).token; const oldSubmitted = w.store.getSession(submitted.id).token;
  await run(w, 'disconnect', { type: 'exam', id: w.liveExam.id });
  const after = w.store.getSession(active.id);
  assert.notEqual(after.token, oldToken);
  assert.equal(after.lastSeen, 0);
  assert.equal(w.store.getSession(submitted.id).token, oldSubmitted);
  assert.equal(w.store.raw.get('SELECT COUNT(*) AS n FROM answers WHERE session_id=?', active.id).n, 1, 'respostas preservadas');
  assert.deepEqual(w.forgotten, [active.id]);
  await assert.rejects(run(w, 'disconnect', { type: 'exam', id: w.liveExam.id }), code('blocked'));
  const individual = world();
  await run(individual, 'disconnect', { type: 'session', id: individual.liveSessions[0].id });
  assert.deepEqual(individual.forgotten, [individual.liveSessions[0].id]);
});

test('redefinir turmas: aluno, turma e perfil; provas ficam sem turma e resultados permanecem', async () => {
  let w = world();
  await run(w, 'classes', { type: 'student', id: w.A.id, number: '2' });
  assert.deepEqual(w.store.classRoster(w.A.id).map((s) => s.number), ['1', '3']);
  assert.equal(w.store.listSessions(w.closed.id).length, 2);

  w = world({ live: false });
  assert.equal(w.store.getExam(w.closed.id).classId, w.A.id);
  await run(w, 'classes', { type: 'class', id: w.A.id });
  assert.ok(!w.store.listClasses().some((c) => c.id === w.A.id));
  assert.equal(w.store.getExam(w.closed.id).classId, null);
  assert.equal(w.store.listSessions(w.closed.id).length, 2, 'resultados mantidos');
  assert.equal(w.store.raw.get("SELECT COUNT(*) AS n FROM meta WHERE key LIKE 'accommodation:%'").n, 0);

  w = world({ live: false });
  await run(w, 'classes');
  assert.deepEqual([w.store.listClasses().length, w.store.raw.get('SELECT COUNT(*) AS n FROM class_roster').n, w.store.raw.get('SELECT COUNT(*) AS n FROM roster').n], [0, 0, 0]);
  w.store.close();
  const reopened = openStore(w.dir);
  assert.equal(reopened.listClasses().length, 0, 'a lista antiga não recria as turmas ao reabrir');
  reopened.close();
});

test('redefinir turmas é bloqueado enquanto há prova aberta, pausada ou agendada para ela', async () => {
  const w = world();
  assert.equal(plan(w.ctx, { action: 'classes', scope: { type: 'class', id: w.B.id } }).canRun, false);
  await assert.rejects(run(w, 'classes', { type: 'class', id: w.B.id }), code('blocked'));
  await assert.rejects(run(w, 'classes'), code('blocked'));
  assert.equal(plan(w.ctx, { action: 'classes', scope: { type: 'class', id: w.A.id } }).canRun, true);
  assert.equal(w.store.listClasses().length, 2);
});

test('limpar cache remove só temporários e chama o limpador do aplicativo', async () => {
  const w = world();
  const tmp = [path.join(w.store.backupDir, 'export-aa.tmp'), path.join(w.store.documentDir, 'x.restore-tmp'), path.join(w.dir, 'y.tmp')];
  for (const file of tmp) fs.writeFileSync(file, 'lixo');
  const keep = path.join(w.store.backupDir, 'meu-backup.atlas'); fs.writeFileSync(keep, '{}');
  const before = totals(w.store);
  const result = await run(w, 'cache');
  assert.equal(result.backup, null);
  for (const file of tmp) assert.equal(fs.existsSync(file), false);
  assert.equal(fs.existsSync(keep), true);
  assert.equal(w.cacheCleared(), 1);
  assert.deepEqual(totals(w.store), before);
});

test('restaurar configurações e remover IA são independentes e não tocam nos dados', async () => {
  const w = world(); const before = totals(w.store);
  await run(w, 'settings');
  assert.equal(fs.existsSync(w.preferencesFile), false);
  assert.equal(w.aiSettings.exists(), true);
  await assert.rejects(run(w, 'settings'), code('blocked'));
  await run(w, 'ai');
  assert.equal(w.aiSettings.exists(), false);
  assert.deepEqual(totals(w.store), before);
});

test('restaurar o perfil de fábrica: exige prova encerrada, apaga tudo e não recria a prova de exemplo', async () => {
  let w = world();
  await assert.rejects(run(w, 'reset'), code('blocked'));
  w = world({ live: false });
  await run(w, 'reset');
  assert.deepEqual(totals(w.store), { exams: 0, sessions: 0, answers: 0, grades: 0, classes: 0, students: 0 });
  assert.equal(w.store.listBankQuestions().length, 0);
  assert.equal(fs.existsSync(w.preferencesFile), false);
  assert.equal(w.aiSettings.exists(), false);
  w.store.close();
  const reopened = openStore(w.dir);
  assert.equal(reopened.listExams().length, 0, 'não reaparece a prova de exemplo');
  reopened.close();
});

test('backup automático antes de apagar: é criado, restaurável e pode ser dispensado', async () => {
  let w = world();
  const before = totals(w.store);
  const result = await run(w, 'results', { type: 'exam', id: w.closed.id });
  assert.match(result.backup.name, /^atlas-antes-results-\d{14}-[0-9a-f]{4}\.atlas$/);
  assert.equal(listSafetyBackups(w.store).length, 1);
  const saved = JSON.parse(fs.readFileSync(safetyBackupPath(w.store, result.backup.name), 'utf8'));
  assert.equal(saved.format, 'atlas-backup');
  w.store.restoreBackup(saved);
  assert.equal(totals(w.store).sessions, before.sessions, 'restaurar devolve os resultados apagados');

  w = world();
  const none = await run(w, 'results', { type: 'exam', id: w.closed.id }, { backup: false });
  assert.equal(none.backup, null); assert.equal(listSafetyBackups(w.store).length, 0);
  const light = await run(w, 'disconnect', { type: 'exam', id: w.liveExam.id });
  assert.equal(light.backup, null);
});

test('backups de segurança: guarda só os 10 mais recentes e recusa nomes perigosos', () => {
  const w = world();
  for (let i = 0; i < 13; i += 1) {
    const { name } = createSafetyBackup(w.store, 'teste');
    const file = path.join(w.store.backupDir, name);
    fs.utimesSync(file, new Date(Date.now() + i * 1000), new Date(Date.now() + i * 1000));
  }
  assert.equal(listSafetyBackups(w.store).length, 10);
  for (const bad of ['../atlas.sqlite', 'atlas-antes-x.sqlite', 'qualquer.atlas', 'atlas-antes-../x.atlas', '']) {
    assert.throws(() => safetyBackupPath(w.store, bad), MaintenanceError, bad);
  }
});

test('perfis são isolados: limpar um não afeta o outro', async () => {
  const a = world(); const b = world();
  const untouched = totals(b.store);
  await run(a, 'results'); await run(a, 'classes').catch(() => {});
  assert.deepEqual(totals(b.store), untouched);
  assert.ok(b.aiSettings.exists() && fs.existsSync(b.preferencesFile));
});
