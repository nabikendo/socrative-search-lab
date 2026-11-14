import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalizeQuestions } from '../shared/exam.js';
import { cleanHtml } from './documents.mjs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS roster (
  number TEXT PRIMARY KEY, name TEXT NOT NULL, class_name TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS class_roster (
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE, number TEXT NOT NULL, name TEXT NOT NULL,
  position INTEGER NOT NULL, PRIMARY KEY(class_id, number));
CREATE TABLE IF NOT EXISTS question_bank (
  id TEXT PRIMARY KEY, question TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS exams (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', access_code TEXT,
  questions TEXT NOT NULL, document TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  class_id TEXT, feedback INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, exam_id TEXT NOT NULL REFERENCES exams(id), number TEXT NOT NULL, token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', started_at TEXT NOT NULL, submitted_at TEXT, last_seen INTEGER NOT NULL DEFAULT 0,
  student_name TEXT NOT NULL DEFAULT '', class_name TEXT NOT NULL DEFAULT '',
  UNIQUE (exam_id, number));
CREATE TABLE IF NOT EXISTS answers (
  session_id TEXT NOT NULL, question_id TEXT NOT NULL, answer TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, question_id));
CREATE TABLE IF NOT EXISTS grades (
  session_id TEXT NOT NULL, question_id TEXT NOT NULL, score REAL NOT NULL, PRIMARY KEY (session_id, question_id));
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL,
  file TEXT NOT NULL, html TEXT);
`;

export class BackupError extends Error {}

const now = () => new Date().toISOString();
const rid = (bytes = 8) => crypto.randomBytes(bytes).toString('hex');

export function openStore(dataDir) {
  const documentDir = path.join(dataDir, 'documents');
  const backupDir = path.join(dataDir, 'backups');
  fs.mkdirSync(documentDir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });

  const dbPath = path.join(dataDir, 'atlas.sqlite');
  const openDb = () => {
    const handle = new DatabaseSync(dbPath);
    handle.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;');
    handle.exec(SCHEMA);
    // migração: embaralhar questões/alternativas por aluno (bancos antigos não têm a coluna)
    if (!handle.prepare('PRAGMA table_info(exams)').all().some((c) => c.name === 'shuffle')) handle.exec('ALTER TABLE exams ADD COLUMN shuffle INTEGER NOT NULL DEFAULT 0');
    const examColumns = new Set(handle.prepare('PRAGMA table_info(exams)').all().map((c) => c.name));
    if (!examColumns.has('class_id')) handle.exec('ALTER TABLE exams ADD COLUMN class_id TEXT');
    if (!examColumns.has('feedback')) handle.exec('ALTER TABLE exams ADD COLUMN feedback INTEGER NOT NULL DEFAULT 0');
    const sessionColumns = new Set(handle.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name));
    if (!sessionColumns.has('student_name')) handle.exec("ALTER TABLE sessions ADD COLUMN student_name TEXT NOT NULL DEFAULT ''");
    if (!sessionColumns.has('class_name')) handle.exec("ALTER TABLE sessions ADD COLUMN class_name TEXT NOT NULL DEFAULT ''");
    return handle;
  };
  let db = openDb();

  let dirty = false;
  const q = (sql) => db.prepare(sql);
  const tx = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); dirty = true; return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const meta = (key) => q('SELECT value FROM meta WHERE key=?').get(key)?.value;
  const setMeta = (key, value) => q('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);

  const examOf = (r) => r && ({
    id: r.id, title: r.title, status: r.status, accessCode: r.access_code || null, shuffle: !!r.shuffle,
    classId: r.class_id || null, feedback: !!r.feedback,
    questions: JSON.parse(r.questions), document: r.document ? JSON.parse(r.document) : null,
    createdAt: r.created_at, updatedAt: r.updated_at,
    ...(r.n_sessions !== undefined ? { sessions: r.n_sessions, submitted: r.n_submitted } : {}),
  });
  const sessionOf = (r) => r && ({
    id: r.id, examId: r.exam_id, number: r.number, token: r.token, status: r.status,
    startedAt: r.started_at, submittedAt: r.submitted_at, lastSeen: r.last_seen,
    name: r.student_name || '', className: r.class_name || '',
  });

  const store = {
    dataDir, documentDir, backupDir,

    // ---- turma
    getRoster: () => q('SELECT number,name,class_name AS className FROM roster ORDER BY position').all(),
    findStudent: (number) => q('SELECT number,name,class_name AS className FROM roster WHERE number=?').get(String(number)),
    replaceRoster(rows) {
      tx(() => {
        q('DELETE FROM roster').run();
        const insert = q('INSERT INTO roster(number,name,class_name,position) VALUES(?,?,?,?)');
        rows.forEach((r, i) => insert.run(String(r.number), String(r.name), String(r.className || ''), i));
      });
      return rows.length;
    },
    listClasses: () => q('SELECT c.id,c.name,(SELECT COUNT(*) FROM class_roster r WHERE r.class_id=c.id) AS students FROM classes c ORDER BY c.name COLLATE NOCASE').all(),
    getClass: (id) => q('SELECT id,name FROM classes WHERE id=?').get(id),
    classRoster: (id) => q('SELECT number,name,? AS className FROM class_roster WHERE class_id=? ORDER BY position').all(store.getClass(id)?.name || '', id),
    saveClass(name, rows, id = null) {
      const className = String(name || '').trim().slice(0, 120);
      if (!className) throw new Error('Informe o nome da turma.');
      const classId = id && store.getClass(id) ? id : `c-${rid(6)}`;
      tx(() => {
        q('INSERT INTO classes(id,name,created_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name').run(classId, className, now());
        q('DELETE FROM class_roster WHERE class_id=?').run(classId);
        const insert = q('INSERT INTO class_roster(class_id,number,name,position) VALUES(?,?,?,?)');
        rows.forEach((r, i) => insert.run(classId, String(r.number), String(r.name), i));
      });
      return { id: classId, name: className, students: rows.length };
    },
    saveBankQuestion(question) {
      const clean = normalizeQuestions([question])[0];
      const id = `b-${rid(6)}`;
      tx(() => q('INSERT INTO question_bank(id,question,created_at) VALUES(?,?,?)').run(id, JSON.stringify(clean), now()));
      return { bankId: id, ...clean, createdAt: now() };
    },
    listBankQuestions: () => q('SELECT id,question,created_at FROM question_bank ORDER BY created_at DESC').all().map((r) => ({ ...JSON.parse(r.question), bankId: r.id, createdAt: r.created_at })),
    deleteBankQuestion(id) { tx(() => q('DELETE FROM question_bank WHERE id=?').run(id)); },

    // ---- provas
    listExams: () => q(`SELECT e.*, (SELECT COUNT(*) FROM sessions s WHERE s.exam_id=e.id) AS n_sessions,
        (SELECT COUNT(*) FROM sessions s WHERE s.exam_id=e.id AND s.status='submitted') AS n_submitted
        FROM exams e ORDER BY e.created_at DESC`).all().map(examOf),
    getExam: (id) => examOf(q('SELECT * FROM exams WHERE id=?').get(id)),
    getOpenExam: () => examOf(q("SELECT * FROM exams WHERE status='open'").get()),
    saveExam({ id, title, questions, shuffle, classId, feedback }) {
      const cleanQuestions = normalizeQuestions(questions);
      const current = id ? store.getExam(id) : null;
      const examId = current ? current.id : `p-${rid(4)}`;
      tx(() => {
        if (current) {
          q('UPDATE exams SET title=?, questions=?, shuffle=?, class_id=?, feedback=?, updated_at=? WHERE id=?').run(title, JSON.stringify(cleanQuestions), shuffle === undefined ? Number(current.shuffle) : Number(!!shuffle), classId === undefined ? current.classId : classId || null, feedback === undefined ? Number(current.feedback) : Number(!!feedback), now(), examId);
        } else {
          q('INSERT INTO exams(id,title,status,questions,shuffle,class_id,feedback,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
            .run(examId, title, 'draft', JSON.stringify(cleanQuestions), Number(!!shuffle), classId || null, Number(!!feedback), now(), now());
        }
      });
      return store.getExam(examId);
    },
    hasSessions: (examId) => q('SELECT 1 FROM sessions WHERE exam_id=? LIMIT 1').get(examId) !== undefined,
    deleteExam(id) {
      const doc = store.getExam(id)?.document;
      tx(() => { q('DELETE FROM documents WHERE exam_id=?').run(id); q('DELETE FROM exams WHERE id=?').run(id); });
      if (doc) store.unlinkDocument(doc.id);
    },
    openExam(id) {
      return tx(() => {
        q("UPDATE exams SET status='closed' WHERE status='open' AND id<>?").run(id);
        const exam = store.getExam(id);
        const code = exam.status === 'open' && exam.accessCode ? exam.accessCode : String(crypto.randomInt(1000, 10000));
        q("UPDATE exams SET status='open', access_code=?, updated_at=? WHERE id=?").run(code, now(), id);
        return code;
      });
    },
    closeExam: (id) => tx(() => q("UPDATE exams SET status='closed', updated_at=? WHERE id=? AND status='open'").run(now(), id)),

    // ---- documentos
    setDocument(examId, { name, kind, size, file, html }) {
      const old = store.getExam(examId)?.document;
      const id = rid(16);
      tx(() => {
        if (old) q('DELETE FROM documents WHERE id=?').run(old.id);
        q('INSERT INTO documents(id,exam_id,name,kind,size,file,html) VALUES(?,?,?,?,?,?,?)').run(id, examId, name, kind, size, file, html ?? null);
        q('UPDATE exams SET document=?, updated_at=? WHERE id=?').run(JSON.stringify({ id, name, kind, size }), now(), examId);
      });
      if (old) store.unlinkDocument(old.id);
      return { id, name, kind, size };
    },
    removeDocument(examId) {
      const old = store.getExam(examId)?.document;
      if (!old) return;
      tx(() => { q('DELETE FROM documents WHERE id=?').run(old.id); q('UPDATE exams SET document=NULL, updated_at=? WHERE id=?').run(now(), examId); });
      store.unlinkDocument(old.id);
    },
    getDocument: (id) => q('SELECT * FROM documents WHERE id=?').get(id),
    unlinkDocument(id) {
      const row = store.getDocument(id);
      if (row) fs.rmSync(path.join(documentDir, row.file), { force: true });
    },

    // ---- sessões
    getSession: (id) => sessionOf(q('SELECT * FROM sessions WHERE id=?').get(id)),
    findSession: (examId, number) => sessionOf(q('SELECT * FROM sessions WHERE exam_id=? AND number=?').get(examId, number)),
    listSessions: (examId) => q('SELECT * FROM sessions WHERE exam_id=? ORDER BY CAST(number AS INTEGER)').all(examId).map(sessionOf),
    createSession(examId, number, student = {}) {
      const id = `s-${rid(8)}`;
      tx(() => q('INSERT INTO sessions(id,exam_id,number,token,started_at,last_seen,student_name,class_name) VALUES(?,?,?,?,?,?,?,?)').run(id, examId, number, rid(16), now(), Date.now(), String(student.name || ''), String(student.className || '')));
      return store.getSession(id);
    },
    rotateToken(id) { tx(() => q('UPDATE sessions SET token=?, last_seen=? WHERE id=?').run(rid(16), Date.now(), id)); return store.getSession(id); },
    touch: (id) => q('UPDATE sessions SET last_seen=? WHERE id=?').run(Date.now(), id),
    submit: (id) => tx(() => q("UPDATE sessions SET status='submitted', submitted_at=COALESCE(submitted_at,?), last_seen=? WHERE id=?").run(now(), Date.now(), id)),
    reopen: (id) => tx(() => q("UPDATE sessions SET status='active', submitted_at=NULL WHERE id=?").run(id)),

    // ---- respostas e notas
    getAnswers(sessionId) {
      return Object.fromEntries(q('SELECT question_id,answer FROM answers WHERE session_id=?').all(sessionId).map((r) => [r.question_id, r.answer]));
    },
    saveAnswer: (sessionId, questionId, answer) => tx(() => {
      q('INSERT INTO answers(session_id,question_id,answer,updated_at) VALUES(?,?,?,?) ON CONFLICT(session_id,question_id) DO UPDATE SET answer=excluded.answer, updated_at=excluded.updated_at')
        .run(sessionId, questionId, answer, now());
      q('UPDATE sessions SET last_seen=? WHERE id=?').run(Date.now(), sessionId);
    }),
    answersForExam(examId) {
      const map = {};
      for (const r of q('SELECT a.session_id,a.question_id,a.answer FROM answers a JOIN sessions s ON s.id=a.session_id WHERE s.exam_id=?').all(examId)) (map[r.session_id] ??= {})[r.question_id] = r.answer;
      return map;
    },
    gradesForExam(examId) {
      const map = {};
      for (const r of q('SELECT g.session_id,g.question_id,g.score FROM grades g JOIN sessions s ON s.id=g.session_id WHERE s.exam_id=?').all(examId)) (map[r.session_id] ??= {})[r.question_id] = r.score;
      return map;
    },
    setGrade: (sessionId, questionId, score) => tx(() => {
      if (score === null) q('DELETE FROM grades WHERE session_id=? AND question_id=?').run(sessionId, questionId);
      else q('INSERT INTO grades(session_id,question_id,score) VALUES(?,?,?) ON CONFLICT(session_id,question_id) DO UPDATE SET score=excluded.score').run(sessionId, questionId, score);
    }),

    // ---- backup manual (um único arquivo .atlas) e restauração
    exportBackup() {
      const tmp = path.join(backupDir, `export-${rid(4)}.tmp`);
      db.exec(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`);
      const bytes = fs.readFileSync(tmp);
      fs.rmSync(tmp, { force: true });
      const documents = {};
      for (const r of q('SELECT file FROM documents').all()) {
        const file = path.join(documentDir, path.basename(r.file));
        if (fs.existsSync(file)) documents[path.basename(r.file)] = fs.readFileSync(file).toString('base64');
      }
      return { format: 'atlas-backup', version: 1, createdAt: now(), db: bytes.toString('base64'), documents };
    },
    restoreBackup(input) {
      const invalid = () => new BackupError('Este arquivo não é um backup válido do Atlas.');
      if (input?.format !== 'atlas-backup' || input.version !== 1 || typeof input.db !== 'string') throw invalid();
      const bytes = Buffer.from(input.db, 'base64');
      if (bytes.length < 512 || bytes.subarray(0, 15).toString('latin1') !== 'SQLite format 3') throw invalid();
      const tmp = path.join(backupDir, `restore-${rid(4)}.tmp`);
      fs.writeFileSync(tmp, bytes);
      try {
        const probe = new DatabaseSync(tmp);
        try {
          const check = probe.prepare('PRAGMA integrity_check').get();
          const tables = new Set(probe.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
          if (Object.values(check)[0] !== 'ok' || !['roster', 'exams', 'sessions', 'answers', 'grades', 'documents'].every((t) => tables.has(t))) throw invalid();
        } finally { probe.close(); }
      } catch (error) { fs.rmSync(tmp, { force: true }); throw error instanceof BackupError ? error : invalid(); }

      // Validate attachment payloads before changing the live database.
      if (input.documents !== undefined && (input.documents === null || typeof input.documents !== 'object' || Array.isArray(input.documents))) {
        fs.rmSync(tmp, { force: true });
        throw invalid();
      }
      const restoredDocuments = new Map();
      try {
        for (const [name, data] of Object.entries(input.documents || {})) {
          if (!/^[a-f0-9]{32}\.(pdf|docx)$/.test(name) || typeof data !== 'string' ||
              !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw invalid();
          restoredDocuments.set(name, Buffer.from(data, 'base64'));
        }
      } catch (error) {
        fs.rmSync(tmp, { force: true });
        throw error instanceof BackupError ? error : invalid();
      }

      // guarda o estado atual antes de substituir tudo
      const stamp = now().replace(/[-:T]/g, '').slice(0, 14);
      db.exec(`VACUUM INTO '${path.join(backupDir, `atlas-antes-restauracao-${stamp}.sqlite`).replaceAll("'", "''")}'`);
      db.close();
      for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
      fs.copyFileSync(tmp, dbPath);
      fs.rmSync(tmp, { force: true });
      db = openDb();

      for (const f of fs.readdirSync(documentDir)) fs.rmSync(path.join(documentDir, f), { force: true });
      for (const [name, bytes] of restoredDocuments) fs.writeFileSync(path.join(documentDir, name), bytes);
      dirty = true;
      return { exams: q('SELECT COUNT(*) AS n FROM exams').get().n, students: q('SELECT COUNT(*) AS n FROM roster').get().n };
    },

    // ---- backup automático
    snapshot({ keep = 20 } = {}) {
      if (!dirty) return null;
      const stamp = now().replace(/[-:T]/g, '').slice(0, 14);
      const target = path.join(backupDir, `atlas-${stamp}.sqlite`);
      if (fs.existsSync(target)) return target;
      db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
      dirty = false;
      const old = fs.readdirSync(backupDir).filter((f) => f.endsWith('.sqlite')).sort().slice(0, -keep);
      for (const f of old) fs.rmSync(path.join(backupDir, f), { force: true });
      return target;
    },
    close() { store.snapshot(); db.close(); },
  };

  // ---- primeira execução: migra o formato antigo (um JSON dentro do SQLite) e cria uma prova de exemplo
  if (!meta('initialized')) {
    tx(() => migrateLegacy(db, store, dataDir, documentDir));
    if (!q('SELECT 1 FROM exams LIMIT 1').get()) {
      store.saveExam({ title: 'Exemplo — ligações químicas', questions: [
        { type: 'choice', text: 'Qual ligação ocorre pelo compartilhamento de elétrons?', options: ['Iônica', 'Covalente', 'Metálica'], correct: 'Covalente' },
        { type: 'choice', text: 'Qual partícula possui carga negativa?', options: ['Próton', 'Nêutron', 'Elétron'], correct: 'Elétron' },
        { type: 'text', text: 'Explique com suas palavras o que é uma ligação iônica.', weight: 2 },
      ] });
    }
    setMeta('initialized', now());
  }
  // Migra as listas globais antigas para turmas sem apagar nem alterar o fluxo legado.
  if (!q('SELECT 1 FROM classes LIMIT 1').get()) {
    const groups = new Map();
    for (const row of store.getRoster()) {
      const name = row.className || 'Turma importada anteriormente';
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(row);
    }
    for (const [name, rows] of groups) store.saveClass(name, rows);
  }
  return store;
}

function migrateLegacy(db, store, dataDir, documentDir) {
  let legacy = null;
  const hasTable = db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name='atlas_state'").get();
  if (hasTable) { const row = db.prepare('SELECT payload FROM atlas_state WHERE id=1').get(); if (row) legacy = JSON.parse(row.payload); }
  const jsonFile = path.join(dataDir, 'atlas-data.json');
  if (!legacy && fs.existsSync(jsonFile)) { try { legacy = JSON.parse(fs.readFileSync(jsonFile, 'utf8')); } catch { /* arquivo corrompido: ignora */ } }
  if (!legacy) return;

  const run = (sql, ...args) => db.prepare(sql).run(...args);
  (legacy.roster || []).forEach((r, i) => run('INSERT OR IGNORE INTO roster(number,name,class_name,position) VALUES(?,?,?,?)', String(r.number), String(r.name), String(r.className || ''), i));

  let opened = false;
  for (const exam of legacy.exams || []) {
    let questions;
    try {
      questions = normalizeQuestions((exam.questions || []).map((x) => ({ ...x, type: x.type === 'choice' ? 'choice' : 'text' })));
    } catch { continue; }
    const isOpen = exam.status === 'open' && !opened;
    opened ||= isOpen;
    const legacyDoc = exam.document && legacy.documents?.[exam.document.id];
    let documentJson = null;
    if (legacyDoc) {
      const file = path.basename(legacyDoc.filePath || '');
      if (file && fs.existsSync(path.join(documentDir, file))) {
        const id = rid(16);
        run('INSERT INTO documents(id,exam_id,name,kind,size,file,html) VALUES(?,?,?,?,?,?,?)', id, exam.id, legacyDoc.name, legacyDoc.kind, legacyDoc.size || 0, file, legacyDoc.html ? cleanHtml(legacyDoc.html) : null);
        documentJson = JSON.stringify({ id, name: legacyDoc.name, kind: legacyDoc.kind, size: legacyDoc.size || 0 });
      }
    }
    run('INSERT OR IGNORE INTO exams(id,title,status,access_code,questions,document,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
      String(exam.id), String(exam.title || 'Avaliação'), isOpen ? 'open' : (exam.status === 'open' ? 'closed' : 'draft'), isOpen ? String(crypto.randomInt(1000, 10000)) : null,
      JSON.stringify(questions), documentJson, now(), now());
  }
  for (const s of legacy.sessions || []) {
    if (!db.prepare('SELECT 1 AS x FROM exams WHERE id=?').get(s.examId)) continue;
    run('INSERT OR IGNORE INTO sessions(id,exam_id,number,token,status,started_at,submitted_at,last_seen) VALUES(?,?,?,?,?,?,?,?)',
      String(s.id), String(s.examId), String(s.number), String(s.token || rid(16)), s.status === 'submitted' ? 'submitted' : 'active', s.startedAt || now(), s.submittedAt || null, Number(s.lastSeen || 0));
    for (const [qid, answer] of Object.entries(legacy.answers?.[s.id] || {})) run('INSERT OR IGNORE INTO answers(session_id,question_id,answer,updated_at) VALUES(?,?,?,?)', String(s.id), qid, String(answer), now());
    for (const [qid, score] of Object.entries(legacy.grades?.[s.id] || {})) run('INSERT OR IGNORE INTO grades(session_id,question_id,score) VALUES(?,?,?)', String(s.id), qid, Number(score) || 0);
  }
}

