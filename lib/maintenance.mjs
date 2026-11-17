import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Limpeza e redefinição do perfil ativo. Cada ação tem um alcance (individual, turma ou perfil) e passa sempre
// por plan() (o que será afetado e o que impede) antes de run(). Nada é apagado sem confirmação digitada.
export class MaintenanceError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

export const ACTIONS = {
  drafts: { label: 'Limpar avaliações em elaboração', scopes: ['exam', 'class', 'profile'], destructive: true, backup: true },
  restart: { label: 'Reiniciar prova em andamento', scopes: ['exam', 'class', 'profile'], destructive: true, backup: true },
  disconnect: { label: 'Desconectar participantes', scopes: ['session', 'exam', 'profile'], destructive: false, backup: false },
  results: { label: 'Apagar resultados', scopes: ['session', 'exam', 'class', 'profile'], destructive: true, backup: true },
  classes: { label: 'Redefinir turmas e alunos', scopes: ['student', 'class', 'profile'], destructive: true, backup: true },
  cache: { label: 'Limpar cache', scopes: ['profile'], destructive: false, backup: false },
  settings: { label: 'Restaurar configurações', scopes: ['profile'], destructive: false, backup: false },
  ai: { label: 'Remover configurações e chaves de IA', scopes: ['profile'], destructive: true, backup: false },
  reset: { label: 'Restaurar o perfil de fábrica', scopes: ['profile'], destructive: true, backup: true },
};

const LIVE = ['open', 'paused'];
const HOLD = ['open', 'paused', 'scheduled']; // provas que ainda dependem da turma
const AWAY_EVENTS = ['student_away', 'student_admitted', 'student_paused', 'student_resumed', 'session_reopened'];
const BACKUP_NAME = /^atlas-antes-[a-z0-9-]{3,80}\.atlas$/;
const KEEP_BACKUPS = 10;
const fail = (code, message, status = 400) => { throw new MaintenanceError(code, message, status); };
const marks = (list) => list.map(() => '?').join(',');
const phraseOf = (action) => (ACTIONS[action].destructive ? 'APAGAR' : 'CONFIRMAR');

function normalize(request) {
  const action = String(request?.action ?? '');
  const def = ACTIONS[action];
  if (!def) fail('unknown_action', 'Ação de limpeza desconhecida.');
  const type = String(request?.scope?.type ?? 'profile');
  if (!def.scopes.includes(type)) fail('invalid_scope', 'Esta ação não pode ser aplicada a esse alcance.');
  const scope = { type, id: String(request?.scope?.id ?? ''), number: String(request?.scope?.number ?? '') };
  if (type !== 'profile' && !scope.id) fail('invalid_scope', 'Escolha o item que será limpo.');
  if (type === 'student' && !scope.number) fail('invalid_scope', 'Escolha o aluno.');
  return { action, def, scope };
}

const count = (raw, sql, ...args) => raw.get(sql, ...args)?.n ?? 0;

// Provas dentro do alcance. Lança 404 se o item escolhido não existe.
function examsIn(raw, scope) {
  if (scope.type === 'exam') {
    const rows = raw.all('SELECT id,title,status,class_id FROM exams WHERE id=?', scope.id);
    if (!rows.length) fail('not_found', 'Prova não encontrada.', 404);
    return rows;
  }
  if (scope.type === 'class') {
    if (!raw.get('SELECT id FROM classes WHERE id=?', scope.id)) fail('not_found', 'Turma não encontrada.', 404);
    return raw.all('SELECT id,title,status,class_id FROM exams WHERE class_id=?', scope.id);
  }
  return raw.all('SELECT id,title,status,class_id FROM exams');
}
const sessionsOf = (raw, examId) => count(raw, 'SELECT COUNT(*) AS n FROM sessions WHERE exam_id=?', examId);
const answersOf = (raw, examId) => count(raw, 'SELECT COUNT(*) AS n FROM answers WHERE session_id IN (SELECT id FROM sessions WHERE exam_id=?)', examId);
const gradesOf = (raw, examId) => count(raw, 'SELECT COUNT(*) AS n FROM grades WHERE session_id IN (SELECT id FROM sessions WHERE exam_id=?)', examId);

function purgeParticipation(raw, examId) {
  raw.run('DELETE FROM grades WHERE session_id IN (SELECT id FROM sessions WHERE exam_id=?)', examId);
  raw.run('DELETE FROM answers WHERE session_id IN (SELECT id FROM sessions WHERE exam_id=?)', examId);
  raw.run('DELETE FROM sessions WHERE exam_id=?', examId);
  raw.run('DELETE FROM join_requests WHERE exam_id=?', examId);
  raw.run(`DELETE FROM audit_log WHERE target=? AND event IN (${marks(AWAY_EVENTS)})`, examId, ...AWAY_EVENTS);
}
const sessionIdsOf = (raw, examId) => raw.all('SELECT id FROM sessions WHERE exam_id=?', examId).map((row) => row.id);
const dropExamMeta = (raw, examId) => { for (const key of ['annulled', 'original', 'release']) raw.run('DELETE FROM meta WHERE key=?', `${key}:${examId}`); };

function tempFiles(ctx) {
  const out = [];
  for (const dir of new Set([ctx.store.backupDir, ctx.store.documentDir, ctx.store.dataDir])) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { /* pasta ainda não existe */ }
    for (const entry of entries) {
      if (entry.isFile() && /\.(tmp|restore-tmp)$/i.test(entry.name)) {
        const file = path.join(dir, entry.name);
        try { out.push({ file, size: fs.statSync(file).size }); } catch { /* sumiu */ }
      }
    }
  }
  return out;
}

const ops = {
  drafts: {
    plan({ store }, scope) {
      const { raw } = store;
      const drafts = examsIn(raw, scope).filter((exam) => exam.status === 'draft');
      const deletable = drafts.filter((exam) => sessionsOf(raw, exam.id) === 0);
      const kept = drafts.length - deletable.length;
      return {
        summary: [{ label: 'Avaliações em elaboração', count: deletable.length }],
        notes: kept ? [`${kept} rascunho(s) com participações serão mantidos. Use "Apagar resultados" primeiro.`] : [],
        blocked: deletable.length ? [] : ['Não há avaliação em elaboração dentro deste alcance.'],
        ids: deletable.map((exam) => exam.id),
      };
    },
    async run({ store }, _scope, plan) {
      const { raw } = store;
      const files = [];
      raw.tx(() => {
        for (const id of plan.ids) {
          files.push(...raw.all('SELECT * FROM documents WHERE exam_id=?', id));
          raw.run('DELETE FROM documents WHERE exam_id=?', id);
          raw.run('DELETE FROM join_requests WHERE exam_id=?', id);
          raw.run('DELETE FROM audit_log WHERE target=?', id);
          dropExamMeta(raw, id);
          raw.run('DELETE FROM exams WHERE id=?', id);
        }
      });
      for (const row of files) store.unlinkDocument(row);
    },
  },

  restart: {
    plan({ store }, scope) {
      const { raw } = store;
      const live = examsIn(raw, scope).filter((exam) => LIVE.includes(exam.status));
      const sessions = live.reduce((sum, exam) => sum + sessionsOf(raw, exam.id), 0);
      return {
        summary: [{ label: 'Provas em andamento', count: live.length }, { label: 'Participações', count: sessions },
          { label: 'Respostas', count: live.reduce((sum, exam) => sum + answersOf(raw, exam.id), 0) }],
        notes: ['As provas continuam abertas, com um novo código de acesso. Os alunos precisarão entrar de novo.'],
        blocked: live.length ? [] : ['Não há prova em andamento dentro deste alcance.'],
        ids: live.map((exam) => exam.id),
      };
    },
    async run({ store, hooks }, _scope, plan) {
      const { raw } = store;
      const forgotten = [];
      raw.tx(() => {
        for (const id of plan.ids) {
          forgotten.push(...sessionIdsOf(raw, id));
          purgeParticipation(raw, id);
          raw.run('UPDATE exams SET access_code=?, updated_at=? WHERE id=?', String(crypto.randomInt(1000, 10000)), new Date().toISOString(), id);
        }
      });
      hooks?.forgetPresence?.(forgotten);
    },
  },

  disconnect: {
    plan({ store }, scope) {
      const { raw } = store;
      let rows;
      if (scope.type === 'session') {
        rows = raw.all('SELECT s.id,s.exam_id,s.status,s.last_seen FROM sessions s WHERE s.id=?', scope.id);
        if (!rows.length) fail('not_found', 'Participante não encontrado.', 404);
      } else if (scope.type === 'exam') {
        if (!raw.get('SELECT id FROM exams WHERE id=?', scope.id)) fail('not_found', 'Prova não encontrada.', 404);
        rows = raw.all('SELECT id,exam_id,status,last_seen FROM sessions WHERE exam_id=?', scope.id);
      } else {
        rows = raw.all(`SELECT s.id,s.exam_id,s.status,s.last_seen FROM sessions s JOIN exams e ON e.id=s.exam_id WHERE e.status IN (${marks(LIVE)})`, ...LIVE);
      }
      const connected = rows.filter((row) => row.status !== 'submitted' && row.last_seen > 0);
      return {
        summary: [{ label: 'Participantes a desconectar', count: connected.length }],
        notes: ['As respostas já enviadas ficam salvas. O aluno volta informando o número de chamada.'],
        blocked: connected.length ? [] : ['Não há participante conectado dentro deste alcance (quem já enviou a prova ou já foi desconectado não é afetado).'],
        ids: connected.map((row) => row.id), exams: [...new Set(connected.map((row) => row.exam_id))],
      };
    },
    async run({ store, hooks }, _scope, plan) {
      const { raw } = store;
      raw.tx(() => {
        // Igual a "Liberar dispositivo": o aparelho perde o acesso e o aluno entra de novo (em qualquer aparelho) sem perder respostas.
        for (const id of plan.ids) raw.run("UPDATE sessions SET token=?, last_seen=0, device_id=NULL, device_state='released' WHERE id=?", crypto.randomBytes(16).toString('hex'), id);
      });
      hooks?.forgetPresence?.(plan.ids);
    },
  },

  results: {
    plan({ store }, scope) {
      const { raw } = store;
      if (scope.type === 'session') {
        const row = raw.get('SELECT s.id,e.status,e.title FROM sessions s JOIN exams e ON e.id=s.exam_id WHERE s.id=?', scope.id);
        if (!row) fail('not_found', 'Participante não encontrado.', 404);
        const live = LIVE.includes(row.status);
        return {
          summary: [{ label: 'Participações', count: 1 }, { label: 'Respostas', count: count(raw, 'SELECT COUNT(*) AS n FROM answers WHERE session_id=?', scope.id) }],
          notes: [], blocked: live ? [`A prova "${row.title}" está em andamento. Use "Reiniciar prova em andamento" ou encerre-a antes.`] : [], sessionId: scope.id, ids: [],
        };
      }
      const exams = examsIn(raw, scope);
      const live = exams.filter((exam) => LIVE.includes(exam.status));
      const targets = exams.filter((exam) => !LIVE.includes(exam.status) && sessionsOf(raw, exam.id) > 0);
      const blocked = [];
      if (!targets.length) blocked.push(live.length ? 'Só há provas em andamento aqui. Use "Reiniciar prova em andamento".' : 'Não há resultados dentro deste alcance.');
      return {
        summary: [{ label: 'Provas com resultados', count: targets.length },
          { label: 'Participações', count: targets.reduce((sum, exam) => sum + sessionsOf(raw, exam.id), 0) },
          { label: 'Respostas', count: targets.reduce((sum, exam) => sum + answersOf(raw, exam.id), 0) },
          { label: 'Notas lançadas', count: targets.reduce((sum, exam) => sum + gradesOf(raw, exam.id), 0) }],
        notes: [...(live.length ? [`${live.length} prova(s) em andamento serão ignoradas.`] : []), 'As provas e suas questões são mantidas.'],
        blocked, ids: targets.map((exam) => exam.id),
      };
    },
    async run({ store }, _scope, plan) {
      const { raw } = store;
      raw.tx(() => {
        if (plan.sessionId) {
          raw.run('DELETE FROM grades WHERE session_id=?', plan.sessionId);
          raw.run('DELETE FROM answers WHERE session_id=?', plan.sessionId);
          raw.run('DELETE FROM sessions WHERE id=?', plan.sessionId);
        } else for (const id of plan.ids) purgeParticipation(raw, id);
      });
    },
  },

  classes: {
    plan({ store }, scope) {
      const { raw } = store;
      if (scope.type === 'student') {
        const row = raw.get('SELECT r.student_id,r.name,c.name AS class_name FROM class_roster r JOIN classes c ON c.id=r.class_id WHERE r.class_id=? AND r.number=?', scope.id, scope.number);
        if (!row) fail('not_found', 'Aluno não encontrado nesta turma.', 404);
        const kept = row.student_id ? count(raw, 'SELECT COUNT(*) AS n FROM sessions WHERE student_id=?', row.student_id) : 0;
        return {
          summary: [{ label: 'Aluno', count: 1 }],
          notes: kept ? [`${kept} participação(ões) já registradas permanecem nos resultados.`] : [],
          blocked: [], studentId: row.student_id, className: row.class_name,
        };
      }
      const classes = scope.type === 'class'
        ? raw.all('SELECT id,name FROM classes WHERE id=?', scope.id)
        : raw.all('SELECT id,name FROM classes');
      if (scope.type === 'class' && !classes.length) fail('not_found', 'Turma não encontrada.', 404);
      const ids = classes.map((item) => item.id);
      const linked = ids.length ? raw.all(`SELECT title,status FROM exams WHERE class_id IN (${marks(ids)})`, ...ids) : [];
      const holding = linked.filter((exam) => HOLD.includes(exam.status));
      const students = ids.length ? count(raw, `SELECT COUNT(*) AS n FROM class_roster WHERE class_id IN (${marks(ids)})`, ...ids) : 0;
      const legacy = scope.type === 'profile' ? count(raw, 'SELECT COUNT(*) AS n FROM roster') : 0;
      const nothing = !classes.length && !legacy;
      return {
        summary: [{ label: 'Turmas', count: classes.length }, { label: 'Alunos', count: students + legacy }],
        notes: linked.length ? [`${linked.length} prova(s) ficarão sem turma vinculada. Resultados já registrados são mantidos.`] : [],
        blocked: nothing ? ['Não há turma ou aluno dentro deste alcance.']
          : holding.length ? [`A prova "${holding[0].title}" está aberta, pausada ou agendada para esta turma. Encerre-a antes.`] : [],
        ids, classes,
      };
    },
    async run({ store }, scope, plan) {
      const { raw } = store;
      raw.tx(() => {
        if (scope.type === 'student') {
          if (plan.studentId) raw.run('DELETE FROM meta WHERE key=?', `accommodation:${plan.studentId}`);
          raw.run('DELETE FROM class_roster WHERE class_id=? AND number=?', scope.id, scope.number);
          raw.run('DELETE FROM roster WHERE number=? AND class_name=?', scope.number, plan.className);
          return;
        }
        for (const id of plan.ids) {
          for (const row of raw.all('SELECT student_id FROM class_roster WHERE class_id=?', id)) {
            if (row.student_id) raw.run('DELETE FROM meta WHERE key=?', `accommodation:${row.student_id}`);
          }
          raw.run('UPDATE exams SET class_id=NULL WHERE class_id=?', id);
          raw.run('DELETE FROM join_requests WHERE class_id=?', id);
        }
        for (const item of plan.classes) raw.run('DELETE FROM roster WHERE class_name=?', item.name);
        if (plan.ids.length) raw.run(`DELETE FROM classes WHERE id IN (${marks(plan.ids)})`, ...plan.ids);
        // Sem turmas, a lista antiga seria recriada na próxima abertura do app; por isso também é limpa.
        if (scope.type === 'profile' || count(raw, 'SELECT COUNT(*) AS n FROM classes') === 0) raw.run('DELETE FROM roster');
      });
    },
  },

  cache: {
    plan(ctx) {
      const files = tempFiles(ctx);
      return {
        summary: [{ label: 'Arquivos temporários', count: files.length }, { label: 'Espaço liberado (KB)', count: Math.ceil(files.reduce((sum, item) => sum + item.size, 0) / 1024) }],
        notes: [...(ctx.hooks?.clearAppCache ? ['Também limpa o cache de páginas do aplicativo. Nenhum dado seu é apagado.'] : ['Nenhum dado seu é apagado.'])],
        blocked: [],
      };
    },
    async run(ctx) {
      for (const item of tempFiles(ctx)) fs.rmSync(item.file, { force: true });
      await ctx.hooks?.clearAppCache?.();
    },
  },

  settings: {
    plan(ctx) {
      const exists = fs.existsSync(ctx.preferencesFile);
      return { summary: [{ label: 'Preferências personalizadas', count: exists ? 1 : 0 }], notes: ['Tema, tamanho do texto e padrões de prova voltam ao original. Turmas, provas e IA não mudam.'],
        blocked: exists ? [] : ['As configurações já estão no padrão.'] };
    },
    async run(ctx) { fs.rmSync(ctx.preferencesFile, { force: true }); },
  },

  ai: {
    plan(ctx) {
      const view = ctx.aiSettings.publicView();
      const configured = Object.values(view.providers).filter((item) => item.hasKey || item.model).length;
      return { summary: [{ label: 'Provedores configurados', count: configured }], notes: ['As chaves de API são apagadas deste computador. A IA local volta a ser a escolha padrão.'],
        blocked: ctx.aiSettings.exists() ? [] : ['Não há configuração de IA para remover.'] };
    },
    async run(ctx) { ctx.aiSettings.clear(); },
  },

  reset: {
    plan({ store }) {
      const { raw } = store;
      const live = raw.all(`SELECT title FROM exams WHERE status IN (${marks(LIVE)})`, ...LIVE);
      return {
        summary: [{ label: 'Provas', count: count(raw, 'SELECT COUNT(*) AS n FROM exams') },
          { label: 'Participações', count: count(raw, 'SELECT COUNT(*) AS n FROM sessions') },
          { label: 'Turmas', count: count(raw, 'SELECT COUNT(*) AS n FROM classes') },
          { label: 'Alunos', count: count(raw, 'SELECT COUNT(*) AS n FROM class_roster') + count(raw, 'SELECT COUNT(*) AS n FROM roster') },
          { label: 'Questões do banco', count: count(raw, 'SELECT COUNT(*) AS n FROM question_bank') }],
        notes: ['Apaga também as configurações e as chaves de IA deste perfil. Outros perfis não são afetados.'],
        blocked: live.length ? [`Encerre a prova "${live[0].title}" antes de restaurar o perfil.`] : [],
      };
    },
    async run(ctx) {
      const { store } = ctx; const { raw } = store;
      const files = raw.all('SELECT * FROM documents');
      raw.tx(() => {
        for (const table of ['grades', 'answers', 'sessions', 'join_requests', 'documents', 'exams', 'class_roster', 'classes', 'roster', 'question_bank', 'audit_log']) raw.run(`DELETE FROM ${table}`);
        raw.run("DELETE FROM meta WHERE key<>'initialized'");
      });
      for (const row of files) store.unlinkDocument(row);
      fs.rmSync(ctx.preferencesFile, { force: true });
      ctx.aiSettings.clear();
      await ops.cache.run(ctx);
    },
  },
};

export function plan(ctx, request) {
  const { action, def, scope } = normalize(request);
  const detail = ops[action].plan(ctx, scope);
  return {
    action, label: def.label, scope, destructive: def.destructive, backupAvailable: def.backup,
    confirmPhrase: phraseOf(action), summary: detail.summary, notes: detail.notes ?? [], blocked: detail.blocked ?? [],
    canRun: !(detail.blocked ?? []).length, _detail: detail,
  };
}
export function publicPlan(planned) { const copy = { ...planned }; delete copy._detail; return copy; }

export async function execute(ctx, request) {
  const { action, def, scope } = normalize(request);
  const planned = plan(ctx, request);
  if (planned.blocked.length) fail('blocked', planned.blocked[0], 409);
  if (request?.confirm !== planned.confirmPhrase) fail('confirmation_required', `Digite ${planned.confirmPhrase} para confirmar.`);
  const wantsBackup = def.backup && request?.backup !== false;
  const backup = wantsBackup ? createSafetyBackup(ctx.store, action) : null;
  await ops[action].run(ctx, scope, planned._detail);
  try { ctx.store.addAudit('maintenance', action, JSON.stringify({ scope: scope.type, backup: backup?.name ?? null })); } catch { /* auditoria é melhor esforço */ }
  return { ok: true, action, label: def.label, summary: planned.summary, backup };
}

// ---- backup de segurança (mesmo formato .atlas do backup manual: pode ser restaurado em Importar backup) ----
export function createSafetyBackup(store, label = 'limpeza') {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const name = `atlas-antes-${String(label).replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 20) || 'limpeza'}-${stamp}-${crypto.randomBytes(2).toString('hex')}.atlas`;
  const file = path.join(store.backupDir, name);
  fs.writeFileSync(file, JSON.stringify(store.exportBackup()), { mode: 0o600 });
  const old = listSafetyBackups(store).filter((item) => item.name !== name).slice(KEEP_BACKUPS - 1); // o novo nunca é removido
  for (const item of old) fs.rmSync(path.join(store.backupDir, item.name), { force: true });
  return { name, size: fs.statSync(file).size };
}
export function listSafetyBackups(store) {
  let names = [];
  try { names = fs.readdirSync(store.backupDir).filter((name) => BACKUP_NAME.test(name)); } catch { /* sem pasta */ }
  return names.map((name) => { const stat = fs.statSync(path.join(store.backupDir, name)); return { name, size: stat.size, createdAt: stat.mtime.toISOString() }; })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
}
export function safetyBackupPath(store, name) {
  if (!BACKUP_NAME.test(String(name))) fail('invalid_name', 'Nome de backup inválido.');
  const file = path.join(store.backupDir, name);
  if (!fs.existsSync(file)) fail('not_found', 'Backup não encontrado.', 404);
  return file;
}
