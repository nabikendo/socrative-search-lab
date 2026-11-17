import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { openStore } from '../lib/store.mjs';

// Cada perfil de professor tem a própria pasta de dados (banco, documentos, PIN, preferências e IA).
// Por isso turmas, alunos, avaliações e resultados de um perfil nunca aparecem em outro.
export const MAIN_PROFILE = 'principal';
export class ProfileError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

const ID = /^[a-f0-9]{24}$/;
const PIN = /^\d{6}$/;

export function createProfileManager({ userDataDir, documentsDir, activeId = MAIN_PROFILE, onChange = () => {} }) {
  let active = activeId;
  const file = path.join(userDataDir, 'profiles.json');
  const profilesDir = path.join(userDataDir, 'profiles');

  const load = () => {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(parsed)) throw new Error('Lista de perfis inválida.');
      return parsed.filter(({ id, name }) => ID.test(id) && typeof name === 'string');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return [];
    }
  };
  let profiles = load();
  const save = () => {
    fs.mkdirSync(userDataDir, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(profiles), { mode: 0o600 });
    fs.renameSync(tmp, file);
    onChange();
  };
  const dataDirOf = (id) => (id === MAIN_PROFILE ? path.join(userDataDir, 'data') : path.join(profilesDir, id));
  const find = (id) => profiles.find((entry) => entry.id === id);
  const need = (id) => find(id) ?? (() => { throw new ProfileError('profile_not_found', 'Perfil não encontrado.', 404); })();

  const cleanName = (value, ownId = null) => {
    const name = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (!name || name.length > 70) throw new ProfileError('invalid_profile', 'Informe um nome de até 70 caracteres.');
    const lower = name.toLowerCase();
    if (lower === 'principal' || profiles.some((entry) => entry.id !== ownId && entry.name.toLowerCase() === lower)) {
      throw new ProfileError('profile_exists', 'Já existe um perfil com esse nome.', 409);
    }
    return name;
  };
  const cleanPin = (value) => {
    const pin = String(value ?? '');
    if (!PIN.test(pin)) throw new ProfileError('invalid_profile', 'O PIN deve ter seis dígitos.');
    return pin;
  };

  return {
    // O perfil em uso só é conhecido depois de validar o argumento de linha de comando contra a lista.
    setActive(id) { active = id; },
    get activeId() { return active; },
    dataDirOf,
    get: (id) => (id === MAIN_PROFILE ? { id, name: 'Principal', main: true } : find(id) ?? null),
    list: () => ({
      active,
      profiles: [{ id: MAIN_PROFILE, name: 'Principal', main: true }, ...profiles.map(({ id, name }) => ({ id, name }))],
    }),
    exists: (id) => id === MAIN_PROFILE || !!find(id),

    create(name, pin) {
      const clean = cleanName(name); const code = cleanPin(pin);
      const id = crypto.randomBytes(12).toString('hex');
      fs.mkdirSync(dataDirOf(id), { recursive: true });
      fs.writeFileSync(path.join(dataDirOf(id), 'pin.txt'), code + '\n', { mode: 0o600 });
      profiles.push({ id, name: clean });
      save();
      return { id, name: clean };
    },

    rename(id, name) {
      if (id === MAIN_PROFILE) throw new ProfileError('profile_main', 'O perfil Principal não pode ser renomeado.');
      const entry = need(id);
      entry.name = cleanName(name, id);
      save();
      return { id, name: entry.name };
    },

    // O PIN do perfil em uso fica na memória do servidor; para trocá-lo, abra outro perfil primeiro.
    changePin(id, pin) {
      if (id === MAIN_PROFILE) throw new ProfileError('profile_main', 'O PIN do perfil Principal é mostrado no menu Atlas.');
      need(id);
      if (id === active) throw new ProfileError('profile_active', 'Troque para outro perfil antes de alterar o PIN deste.', 409);
      fs.writeFileSync(path.join(dataDirOf(id), 'pin.txt'), cleanPin(pin) + '\n', { mode: 0o600 });
      return { id };
    },

    // Exclui o perfil. Com backup, antes grava um arquivo .atlas em Documentos/Atlas/PerfisExcluidos que pode ser
    // importado em qualquer perfil (Importar backup). O perfil em uso e o Principal não podem ser excluídos.
    remove(id, { backup = true } = {}) {
      if (id === MAIN_PROFILE) throw new ProfileError('profile_main', 'O perfil Principal não pode ser excluído.');
      const entry = need(id);
      if (id === active) throw new ProfileError('profile_active', 'Troque para outro perfil antes de excluir este.', 409);
      const dir = dataDirOf(id);
      let backupFile = null;
      if (backup && fs.existsSync(path.join(dir, 'atlas.sqlite'))) {
        const target = path.join(documentsDir, 'Atlas', 'PerfisExcluidos');
        fs.mkdirSync(target, { recursive: true });
        const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
        const slug = entry.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'perfil';
        backupFile = path.join(target, `${slug}-${stamp}.atlas`);
        const store = openStore(dir);
        try { fs.writeFileSync(backupFile, JSON.stringify(store.exportBackup()), { mode: 0o600 }); }
        catch { fs.rmSync(backupFile, { force: true }); throw new ProfileError('backup_failed', 'Não foi possível salvar a cópia de segurança; o perfil não foi excluído.', 500); }
        finally { store.close(); }
      }
      fs.rmSync(dir, { recursive: true, force: true });
      profiles = profiles.filter((item) => item.id !== id);
      save();
      return { id, backupFile };
    },
  };
}
