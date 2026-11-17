import fs from 'node:fs';
import path from 'node:path';
import { openStore } from './store.mjs';
import { seedDemo, DEMO_PREFIX } from './demo.mjs';

export class TestModeError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; }
}

// Modo de teste: um segundo banco (pasta "modo-teste" dentro do perfil) que SUBSTITUI o real enquanto estiver ativo.
// Como é outro arquivo, nada do que é criado, editado ou apagado ali pode alcançar turmas, alunos ou resultados reais.
export function createTestMode({ realStore, dataDir, onSwitch = () => {} }) {
  const dir = path.join(dataDir, 'modo-teste');
  let sandbox = null;

  const liveReal = () => realStore.raw.all("SELECT title FROM exams WHERE status IN ('open','paused','scheduled')");
  const open = () => {
    const store = openStore(dir);
    if (!store.listClasses().some((item) => item.name.startsWith(DEMO_PREFIX))) seedDemo(store);
    return store;
  };
  const status = () => {
    const store = sandbox;
    return {
      active: !!sandbox, exists: fs.existsSync(path.join(dir, 'atlas.sqlite')),
      counts: store ? {
        classes: store.listClasses().length, exams: store.listExams().length,
        sessions: store.raw.get('SELECT COUNT(*) AS n FROM sessions').n, bank: store.listBankQuestions().length,
      } : null,
    };
  };
  const closeSandbox = () => { if (sandbox) { try { sandbox.close(); } catch { /* já fechado */ } sandbox = null; } };

  return {
    dir,
    current: () => sandbox ?? realStore,
    isActive: () => !!sandbox,
    status,
    enable() {
      if (sandbox) return status();
      const live = liveReal();
      if (live.length) throw new TestModeError('real_exam_live', `Encerre ou cancele a prova "${live[0].title}" antes de entrar no modo de teste.`);
      sandbox = open(); onSwitch();
      return status();
    },
    reseed() {
      if (!sandbox) throw new TestModeError('not_active', 'O modo de teste não está ativo.');
      closeSandbox(); fs.rmSync(dir, { recursive: true, force: true });
      sandbox = open(); onSwitch();
      return status();
    },
    exit() { if (sandbox) { closeSandbox(); onSwitch(); } return status(); },
    purge() {
      const wasActive = !!sandbox;
      closeSandbox(); fs.rmSync(dir, { recursive: true, force: true });
      if (wasActive) onSwitch();
      return status();
    },
    closeAll: closeSandbox,
  };
}
