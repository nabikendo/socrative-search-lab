import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';
import { openStore } from '../lib/store.mjs';
import { createProfileManager, MAIN_PROFILE, ProfileError } from '../desktop/profiles.mjs';

const temp = [];
const tmp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-prof-')); temp.push(dir); return dir; };
afterEach(() => { for (const dir of temp.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const setup = (activeId) => {
  const userDataDir = tmp(); const documentsDir = tmp();
  let changes = 0;
  const make = (active = activeId) => createProfileManager({ userDataDir, documentsDir, activeId: active, onChange: () => { changes += 1; } });
  return { userDataDir, documentsDir, make, changes: () => changes };
};
const code = (c) => (e) => e instanceof ProfileError && e.code === c;

test('criar e listar: o Principal sempre existe e novos perfis persistem entre execuções', () => {
  const env = setup(); const m = env.make();
  assert.deepEqual(m.list().profiles.map((p) => p.id), [MAIN_PROFILE]);
  const created = m.create('  Prof.  Marina ', '123456');
  assert.equal(created.name, 'Prof. Marina');
  assert.equal(fs.readFileSync(path.join(m.dataDirOf(created.id), 'pin.txt'), 'utf8').trim(), '123456');
  assert.ok(env.changes() > 0);
  const again = env.make();
  assert.deepEqual(again.list().profiles.map((p) => p.name), ['Principal', 'Prof. Marina']);
  assert.equal(again.exists(created.id), true);
  assert.equal(again.exists('desconhecido'), false);
});

test('validação de nome e PIN; nomes são únicos sem diferenciar maiúsculas e "Principal" é reservado', () => {
  const m = setup().make();
  m.create('Ana', '111111');
  for (const bad of ['', '   ', 'x'.repeat(71)]) assert.throws(() => m.create(bad, '111111'), code('invalid_profile'));
  assert.throws(() => m.create('ANA', '222222'), code('profile_exists'));
  assert.throws(() => m.create('principal', '222222'), code('profile_exists'));
  for (const pin of ['12345', '1234567', 'abcdef', '', undefined]) assert.throws(() => m.create('Outro', pin), code('invalid_profile'));
  assert.equal(m.list().profiles.length, 2);
});

test('renomear: valida duplicidade, aceita o mesmo nome do próprio perfil e protege o Principal', () => {
  const env = setup(); const m = env.make();
  const a = m.create('Ana', '111111'); const b = m.create('Bruno', '222222');
  assert.equal(m.rename(a.id, 'Ana Souza').name, 'Ana Souza');
  assert.equal(m.rename(a.id, 'ana souza').name, 'ana souza', 'mudar só a caixa do próprio nome é permitido');
  assert.throws(() => m.rename(b.id, 'Ana Souza'), code('profile_exists'));
  assert.throws(() => m.rename(MAIN_PROFILE, 'Outro'), code('profile_main'));
  assert.throws(() => m.rename('f'.repeat(24), 'X'), code('profile_not_found'));
  assert.deepEqual(env.make().list().profiles.map((p) => p.name), ['Principal', 'ana souza', 'Bruno']);
});

test('trocar PIN: só de outro perfil; o perfil em uso e o Principal ficam de fora', () => {
  const env = setup(); const base = env.make();
  const a = base.create('Ana', '111111'); const b = base.create('Bruno', '222222');
  const m = env.make(a.id);
  assert.throws(() => m.changePin(a.id, '999999'), code('profile_active'));
  assert.throws(() => m.changePin(MAIN_PROFILE, '999999'), code('profile_main'));
  assert.throws(() => m.changePin(b.id, '12'), code('invalid_profile'));
  m.changePin(b.id, '654321');
  assert.equal(fs.readFileSync(path.join(m.dataDirOf(b.id), 'pin.txt'), 'utf8').trim(), '654321');
  assert.equal(fs.readFileSync(path.join(m.dataDirOf(a.id), 'pin.txt'), 'utf8').trim(), '111111');
});

test('perfis são isolados: turmas, alunos, provas e resultados de um não aparecem em outro', () => {
  const env = setup(); const m = env.make();
  const a = m.create('Ana', '111111'); const b = m.create('Bruno', '222222');
  const storeA = openStore(m.dataDirOf(a.id));
  const klass = storeA.saveClass('Turma da Ana', [{ number: '1', name: 'ALUNO A' }]);
  const exam = storeA.saveExam({ title: 'Prova da Ana', questions: [{ type: 'choice', text: 'x?', options: ['a', 'b'], correct: 'a' }], classId: klass.id });
  storeA.openExam(exam.id);
  const session = storeA.createSession(exam.id, '1', { name: 'ALUNO A', className: klass.name });
  storeA.submit(session.id); storeA.close();
  const storeB = openStore(m.dataDirOf(b.id));
  assert.deepEqual(storeB.listClasses(), []);
  assert.ok(!storeB.listExams().some((e) => e.title === 'Prova da Ana'));
  assert.equal(storeB.raw.get('SELECT COUNT(*) AS n FROM sessions').n, 0);
  storeB.close();
  assert.notEqual(m.dataDirOf(a.id), m.dataDirOf(b.id));
});

test('excluir com backup: salva .atlas importável, remove a pasta e não toca nos outros perfis', () => {
  const env = setup(); const base = env.make();
  const a = base.create('Ana', '111111'); const b = base.create('Bruno', '222222');
  const storeA = openStore(base.dataDirOf(a.id));
  storeA.saveClass('Turma da Ana', [{ number: '1', name: 'ALUNO A' }]); storeA.close();
  fs.writeFileSync(path.join(base.dataDirOf(b.id), 'marcador.txt'), 'bruno');

  const m = env.make(b.id);
  const result = m.remove(a.id, { backup: true });
  assert.equal(fs.existsSync(base.dataDirOf(a.id)), false);
  assert.ok(result.backupFile.startsWith(path.join(env.documentsDir, 'Atlas', 'PerfisExcluidos')));
  assert.match(path.basename(result.backupFile), /^ana-\d{14}\.atlas$/);
  assert.deepEqual(env.make().list().profiles.map((p) => p.name), ['Principal', 'Bruno']);
  assert.equal(fs.readFileSync(path.join(base.dataDirOf(b.id), 'marcador.txt'), 'utf8'), 'bruno');

  const target = openStore(tmp());
  target.restoreBackup(JSON.parse(fs.readFileSync(result.backupFile, 'utf8')));
  assert.ok(target.listClasses().some((c) => c.name === 'Turma da Ana'));
  target.close();
});

test('excluir sem backup apaga tudo; regras: Principal e perfil em uso não podem ser excluídos', () => {
  const env = setup(); const base = env.make();
  const a = base.create('Ana', '111111');
  const storeA = openStore(base.dataDirOf(a.id)); storeA.saveClass('Turma', [{ number: '1', name: 'X' }]); storeA.close();
  const m = env.make(MAIN_PROFILE);
  assert.throws(() => m.remove(MAIN_PROFILE), code('profile_main'));
  assert.throws(() => env.make(a.id).remove(a.id), code('profile_active'));
  assert.throws(() => m.remove('f'.repeat(24)), code('profile_not_found'));
  assert.equal(fs.existsSync(base.dataDirOf(a.id)), true, 'nada foi apagado pelas tentativas recusadas');
  const result = m.remove(a.id, { backup: false });
  assert.equal(result.backupFile, null);
  assert.equal(fs.existsSync(base.dataDirOf(a.id)), false);
  assert.equal(fs.existsSync(path.join(env.documentsDir, 'Atlas', 'PerfisExcluidos')), false);
});

test('lista corrompida ou com ids inválidos não expõe pastas fora de profiles/', () => {
  const env = setup();
  fs.writeFileSync(path.join(env.userDataDir, 'profiles.json'), JSON.stringify([{ id: '../../etc', name: 'Mau' }, { id: 'a'.repeat(24), name: 'Bom' }, { id: 'b'.repeat(24) }]));
  assert.deepEqual(env.make().list().profiles.map((p) => p.name), ['Principal', 'Bom']);
  fs.writeFileSync(path.join(env.userDataDir, 'profiles.json'), '{"nao":"lista"}');
  assert.throws(() => env.make(), /inválida/);
});

test('rotas de perfil: criar, editar, trocar PIN e excluir exigem PIN do professor, uso local e confirmação', async () => {
  const env = setup(); const base = env.make(MAIN_PROFILE);
  const dataDir = tmp();
  const app = createApp({ dataDir, pin: '123456', desktopProfiles: {
    list: () => base.list(), create: (n, p) => base.create(n, p), rename: (i, n) => base.rename(i, n),
    changePin: (i, p) => base.changePin(i, p), remove: (i, o) => base.remove(i, o), switch: () => true,
  } });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(url + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: '123456' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const call = async (path_, method = 'GET', body, headers = { cookie }) => {
    const res = await fetch(url + path_, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json() };
  };
  try {
    assert.equal((await call('/api/desktop/profiles', 'GET', undefined, {})).status, 401);
    const created = await call('/api/desktop/profiles', 'POST', { name: 'Ana', pin: '111111' });
    assert.equal(created.status, 200);
    const ana = created.data.profiles.find((p) => p.name === 'Ana');
    assert.equal((await call('/api/desktop/profiles', 'POST', { name: 'ana', pin: '111111' })).status, 409);
    assert.equal((await call('/api/desktop/profiles', 'POST', { name: 'Zé', pin: '12' })).status, 400);

    assert.equal((await call(`/api/desktop/profiles/${ana.id}`, 'PUT', { name: 'Ana Lima', pin: '333333' })).status, 200);
    assert.equal(base.list().profiles.find((p) => p.id === ana.id).name, 'Ana Lima');
    assert.equal(fs.readFileSync(path.join(base.dataDirOf(ana.id), 'pin.txt'), 'utf8').trim(), '333333');
    assert.equal((await call(`/api/desktop/profiles/${MAIN_PROFILE}`, 'PUT', { name: 'X' })).status, 400);
    assert.equal((await call(`/api/desktop/profiles/${'f'.repeat(24)}`, 'PUT', { name: 'X' })).status, 404);

    assert.equal((await call(`/api/desktop/profiles/${ana.id}`, 'DELETE', { confirm: 'ana' })).data.error, 'confirmation_required');
    assert.equal(base.exists(ana.id), true);
    const removed = await call(`/api/desktop/profiles/${ana.id}`, 'DELETE', { confirm: 'Ana Lima', backup: false });
    assert.equal(removed.status, 200); assert.equal(removed.data.backupFile, null);
    assert.deepEqual(removed.data.profiles.map((p) => p.name), ['Principal']);
    assert.equal((await call(`/api/desktop/profiles/${MAIN_PROFILE}`, 'DELETE', { confirm: 'Principal' })).status, 400);
  } finally { await app.close(); }
});
