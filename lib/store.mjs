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
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS class_roster (
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE, student_id TEXT, number TEXT NOT NULL, name TEXT NOT NULL,
  position INTEGER NOT NULL, PRIMARY KEY(class_id, number));
CREATE TABLE IF NOT EXISTS question_bank (
  id TEXT PRIMARY KEY, question TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS exams (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', access_code TEXT,
  questions TEXT NOT NULL, document TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  class_id TEXT, feedback INTEGER NOT NULL DEFAULT 0, scheduled_start TEXT, scheduled_end TEXT);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, exam_id TEXT NOT NULL REFERENCES exams(id), student_id TEXT, number TEXT NOT NULL, token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', started_at TEXT NOT NULL, submitted_at TEXT, last_seen INTEGER NOT NULL DEFAULT 0, paused_at TEXT,
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
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL, target TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS join_requests (
  id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, class_id TEXT, number TEXT NOT NULL, name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, UNIQUE(exam_id,number));
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
    if (!examColumns.has('scheduled_start')) handle.exec('ALTER TABLE exams ADD COLUMN scheduled_start TEXT');
    if (!examColumns.has('scheduled_end')) handle.exec('ALTER TABLE exams ADD COLUMN scheduled_end TEXT');
    const classColumns = new Set(handle.prepare('PRAGMA table_info(classes)').all().map((c) => c.name));
    if (!classColumns.has('archived')) handle.exec('ALTER TABLE classes ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
    const sessionColumns = new Set(handle.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name));
    if (!sessionColumns.has('student_id')) handle.exec('ALTER TABLE sessions ADD COLUMN student_id TEXT');
    if (!sessionColumns.has('paused_at')) handle.exec('ALTER TABLE sessions ADD COLUMN paused_at TEXT');
    if (!sessionColumns.has('student_name')) handle.exec("ALTER TABLE sessions ADD COLUMN student_name TEXT NOT NULL DEFAULT ''");
    if (!sessionColumns.has('class_name')) handle.exec("ALTER TABLE sessions ADD COLUMN class_name TEXT NOT NULL DEFAULT ''");
    const rosterColumns = new Set(handle.prepare('PRAGMA table_info(class_roster)').all().map((c) => c.name));
    if (!rosterColumns.has('student_id')) handle.exec('ALTER TABLE class_roster ADD COLUMN student_id TEXT');
    handle.exec("UPDATE class_roster SET student_id='st-' || lower(hex(randomblob(8))) WHERE student_id IS NULL");
    handle.exec(`UPDATE sessions AS s SET student_id=(SELECT r.student_id FROM class_roster r JOIN classes c ON c.id=r.class_id
      WHERE r.number=s.number AND c.name=s.class_name LIMIT 1) WHERE s.student_id IS NULL AND s.class_name<>''`);
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
    scheduledStart: r.scheduled_start || null, scheduledEnd: r.scheduled_end || null,
    questions: JSON.parse(r.questions), document: r.document ? JSON.parse(r.document) : null,
    createdAt: r.created_at, updatedAt: r.updated_at,
    annulled: JSON.parse(q('SELECT value FROM meta WHERE key=?').get(`annulled:${r.id}`)?.value || '{}'),
    original: JSON.parse(q('SELECT value FROM meta WHERE key=?').get(`original:${r.id}`)?.value || 'null'),
    releaseAt: q('SELECT value FROM meta WHERE key=?').get(`release:${r.id}`)?.value || null,
    ...(r.n_sessions !== undefined ? { sessions: r.n_sessions, submitted: r.n_submitted } : {}),
  });
  const sessionOf = (r) => r && ({
    id: r.id, examId: r.exam_id, studentId: r.student_id || null, number: r.number, token: r.token, status: r.status,
    startedAt: r.started_at, submittedAt: r.submitted_at, lastSeen: r.last_seen,
    pausedAt: r.paused_at || null,
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
    listClasses: ({ includeArchived = false } = {}) => q(`SELECT c.id,c.name,c.archived,(SELECT COUNT(*) FROM class_roster r WHERE r.class_id=c.id) AS students FROM classes c ${includeArchived ? '' : 'WHERE c.archived=0'} ORDER BY c.name COLLATE NOCASE`).all(),
    getClass: (id) => q('SELECT id,name FROM classes WHERE id=?').get(id),
    classRoster: (id) => q('SELECT student_id AS id,number,name,? AS className FROM class_roster WHERE class_id=? ORDER BY position').all(store.getClass(id)?.name || '', id),
    getAccommodation: (id) => JSON.parse(meta(`accommodation:${id}`) || '{}'),
    setAccommodation: (id, options) => tx(() => setMeta(`accommodation:${id}`, JSON.stringify(options))),
    saveClass(name, rows, id = null) {
      const className = String(name || '').trim().slice(0, 120);
      if (!className) throw new Error('Informe o nome da turma.');
      const classId = id && store.getClass(id) ? id : `c-${rid(6)}`;
      tx(() => {
        const studentKey = (number, name) => JSON.stringify([
          String(number), String(name).normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR'),
        ]);
        const prior = new Map(q('SELECT number,name,student_id FROM class_roster WHERE class_id=?').all(classId)
          .filter((r) => r.student_id).map((r) => [studentKey(r.number, r.name), r.student_id]));
        q('INSERT INTO classes(id,name,created_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name').run(classId, className, now());
        q('DELETE FROM class_roster WHERE class_id=?').run(classId);
        const insert = q('INSERT INTO class_roster(class_id,student_id,number,name,position) VALUES(?,?,?,?,?)');
        rows.forEach((r, i) => insert.run(classId, prior.get(studentKey(r.number, r.name)) || `st-${rid(8)}`, String(r.number), String(r.name), i));
      });
      return { id: classId, name: className, students: rows.length };
    },
    updateStudent(classId, number, name, nextNumber = number) {
      tx(() => q('UPDATE class_roster SET name=?,number=? WHERE class_id=? AND number=?').run(String(name).trim().slice(0, 180), String(nextNumber), classId, String(number)));
      return store.classRoster(classId).find((r) => r.number === String(nextNumber));
    },
    createJoinRequest(examId, classId, number, name) {
      const id = `jr-${rid(8)}`;
      tx(() => q('INSERT INTO join_requests(id,exam_id,class_id,number,name,created_at) VALUES(?,?,?,?,?,?)').run(id, examId, classId || null, String(number), String(name).trim().slice(0,180), now()));
      return id;
    },
    pendingJoinRequests() {
      return q(`SELECT j.id,j.exam_id AS examId,j.class_id AS classId,j.number,j.name,j.created_at AS createdAt,
        e.title AS examTitle,c.name AS className FROM join_requests j JOIN exams e ON e.id=j.exam_id
        LEFT JOIN classes c ON c.id=j.class_id WHERE j.status='pending' ORDER BY j.created_at`).all();
    },
    getJoinRequest(id) { return q("SELECT * FROM join_requests WHERE id=? AND status='pending'").get(id); },
    approveJoinRequest(id) {
      const request = store.getJoinRequest(id);
      if (!request) throw new Error('A solicitação já foi atendida.');
      tx(() => {
        if (request.class_id) {
          if (q('SELECT 1 FROM class_roster WHERE class_id=? AND number=?').get(request.class_id, request.number)) throw new Error('Esse número já está cadastrado na turma.');
          const position = q('SELECT COALESCE(MAX(position),-1)+1 AS n FROM class_roster WHERE class_id=?').get(request.class_id).n;
          q('INSERT INTO class_roster(class_id,student_id,number,name,position) VALUES(?,?,?,?,?)').run(request.class_id, `st-${rid(8)}`, request.number, request.name, position);
        } else {
          if (q('SELECT 1 FROM roster WHERE number=?').get(request.number)) throw new Error('Esse número já está cadastrado na lista.');
          const position = q('SELECT COALESCE(MAX(position),-1)+1 AS n FROM roster').get().n;
          q('INSERT INTO roster(number,name,class_name,position) VALUES(?,?,?,?)').run(request.number, request.name, '', position);
        }
        q("UPDATE join_requests SET status='approved' WHERE id=?").run(id);
      });
      return request;
    },
    rejectJoinRequest(id) { tx(() => q("UPDATE join_requests SET status='rejected' WHERE id=? AND status='pending'").run(id)); },
    moveStudent(sourceId, targetId, number) {
      const source = store.getClass(sourceId); const target = store.getClass(targetId);
      if (!source || !target || sourceId === targetId) throw new Error('Escolha duas turmas diferentes.');
      const row = q('SELECT student_id,number,name FROM class_roster WHERE class_id=? AND number=?').get(sourceId, String(number));
      if (!row) throw new Error('Aluno não encontrado na turma de origem.');
      if (q('SELECT 1 FROM class_roster WHERE class_id=? AND number=?').get(targetId, String(number))) throw new Error('Já existe esse número na turma de destino.');
      tx(() => {
        q('DELETE FROM class_roster WHERE class_id=? AND number=?').run(sourceId, String(number));
        const position = q('SELECT COALESCE(MAX(position),-1)+1 AS n FROM class_roster WHERE class_id=?').get(targetId).n;
        q('INSERT INTO class_roster(class_id,student_id,number,name,position) VALUES(?,?,?,?,?)').run(targetId, row.student_id, row.number, row.name, position);
      });
      return { ...row, id: row.student_id, className: target.name };
    },
    searchStudents(term) {
      const like = `%${String(term || '').trim().slice(0, 80)}%`;
      return q(`SELECT r.student_id AS id,r.number,r.name,c.id AS classId,c.name AS className
        FROM class_roster r JOIN classes c ON c.id=r.class_id
        WHERE r.number LIKE ? OR r.name LIKE ? ORDER BY c.name COLLATE NOCASE,r.name COLLATE NOCASE LIMIT 100`).all(like, like);
    },
    studentHistory(studentId) {
      return q(`SELECT s.id AS sessionId,s.exam_id AS examId,e.title,e.status AS examStatus,s.number,s.student_name AS name,s.class_name AS className,
        s.status,s.started_at AS startedAt,s.submitted_at AS submittedAt
        FROM sessions s JOIN exams e ON e.id=s.exam_id WHERE s.student_id=? ORDER BY s.started_at DESC`).all(studentId);
    },
    archiveClass(id, archived = true) {
      tx(() => q('UPDATE classes SET archived=? WHERE id=?').run(Number(!!archived), id));
    },
    deleteUnusedClass(id) {
      return tx(() => {
        if (q('SELECT 1 FROM exams WHERE class_id=? LIMIT 1').get(id)) return false;
        q('DELETE FROM class_roster WHERE class_id=?').run(id);
        q('DELETE FROM classes WHERE id=?').run(id);
        return true;
      });
    },
    saveBankQuestion(question) {
      const clean = normalizeQuestions([question])[0];
      const id = `b-${rid(6)}`;
      const createdAt = now();
      tx(() => q('INSERT INTO question_bank(id,question,created_at) VALUES(?,?,?)').run(id, JSON.stringify(clean), createdAt));
      return { bankId: id, ...clean, createdAt };
    },
    updateBankQuestion(id, question) {
      return tx(() => {
        const current = q('SELECT question,created_at FROM question_bank WHERE id=?').get(id);
        if (!current) return null;
        // Keep both stable bank and question IDs across edits, including favorites.
        const previous = JSON.parse(current.question);
        const clean = normalizeQuestions([{ ...question, id: previous.id }])[0];
        q('UPDATE question_bank SET question=? WHERE id=?').run(JSON.stringify(clean), id);
        return { ...clean, bankId: id, createdAt: current.created_at };
      });
    },
    listBankQuestions: () => q('SELECT id,question,created_at FROM question_bank ORDER BY created_at DESC').all().map((r) => ({ ...JSON.parse(r.question), bankId: r.id, createdAt: r.created_at })),
    deleteBankQuestion(id) { tx(() => q('DELETE FROM question_bank WHERE id=?').run(id)); },

    // ---- provas
    listExams: () => q(`SELECT e.*, (SELECT COUNT(*) FROM sessions s WHERE s.exam_id=e.id) AS n_sessions,
        (SELECT COUNT(*) FROM sessions s WHERE s.exam_id=e.id AND s.status='submitted') AS n_submitted
        FROM exams e ORDER BY e.created_at DESC`).all().map(examOf),
    getExam: (id) => examOf(q('SELECT * FROM exams WHERE id=?').get(id)),
    getOpenExam: () => examOf(q("SELECT * FROM exams WHERE status IN ('open','paused') ORDER BY updated_at DESC LIMIT 1").get()),
    // Recently closed exams may still have answers stored only on a disconnected
    // student's device. Keep installation disabled while submissions are missing.
    unconfirmedRecentSessions(hours = 72) {
      const horizon = Math.min(168, Math.max(1, Number(hours) || 72));
      const cutoff = new Date(Date.now() - horizon * 3600_000).toISOString();
      return q(`SELECT COUNT(*) AS n FROM sessions s JOIN exams e ON e.id=s.exam_id
        WHERE s.status <> 'submitted'
          AND (e.status IN ('open','paused') OR (e.status='closed' AND e.updated_at >= ?))`).get(cutoff).n;
    },
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
    linkOriginal(id, original) {
      tx(() => setMeta(`original:${id}`, JSON.stringify(original)));
    },
    setReleaseAt(id, date) {
      tx(() => setMeta(`release:${id}`, date));
    },
    annulQuestion(exam, questionId, mode, reason) {
      const updated = { ...exam.annulled, [questionId]: { mode, reason } };
      tx(() => {
        q('INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
          .run(`annulled:${exam.id}`, JSON.stringify(updated));
        q('INSERT INTO audit_log (event,target,detail,created_at) VALUES (?,?,?,?)')
          .run('question_annulled', exam.id, `${questionId} · ${mode === 'credit' ? 'Ponto para todos' : 'Retirada do total'} · ${reason}`, now());
      });
    },
    deleteExam(id) {
      const doc = store.getExam(id)?.document;
      const fileRow = doc && store.getDocument(doc.id);
      tx(() => { q('DELETE FROM documents WHERE exam_id=?').run(id); q('DELETE FROM exams WHERE id=?').run(id); });
      if (fileRow) store.unlinkDocument(fileRow);
    },
    openExam(id) {
      return tx(() => {
        q("UPDATE exams SET status='closed' WHERE status IN ('open','paused') AND id<>?").run(id);
        const exam = store.getExam(id);
        const code = exam.status === 'open' && exam.accessCode ? exam.accessCode : String(crypto.randomInt(1000, 10000));
        q("UPDATE exams SET status='open', access_code=?, updated_at=? WHERE id=?").run(code, now(), id);
        return code;
      });
    },
    closeExam: (id) => tx(() => q("UPDATE exams SET status='closed', updated_at=? WHERE id=? AND status IN ('open','paused')").run(now(), id)),
    pauseExam: (id) => tx(() => q("UPDATE exams SET status='paused', updated_at=? WHERE id=? AND status='open'").run(now(), id)),
    resumeExam: (id) => tx(() => q("UPDATE exams SET status='open', updated_at=? WHERE id=? AND status='paused'").run(now(), id)),
    scheduleExam(id, start, end) {
      tx(() => q("UPDATE exams SET status='scheduled', access_code=?, scheduled_start=?, scheduled_end=?, updated_at=? WHERE id=?")
        .run(String(crypto.randomInt(1000, 10000)), start, end, now(), id));
      return store.getExam(id);
    },
    cancelSchedule(id) { tx(() => q("UPDATE exams SET status='draft', scheduled_start=NULL, scheduled_end=NULL, updated_at=? WHERE id=? AND status='scheduled'").run(now(), id)); },
    activateSchedules(at = new Date().toISOString()) {
      const due = q("SELECT id FROM exams WHERE status='scheduled' AND scheduled_start<=? AND (scheduled_end IS NULL OR scheduled_end>?) ORDER BY scheduled_start").all(at, at);
      const expired = q("SELECT id FROM exams WHERE status='scheduled' AND scheduled_end IS NOT NULL AND scheduled_end<=?").all(at);
      const ended = q("SELECT id,class_id,scheduled_end FROM exams WHERE status='open' AND scheduled_end IS NOT NULL AND scheduled_end<=?").all(at)
        .filter((exam) => {
          const extra = exam.class_id ? Math.max(0, ...store.classRoster(exam.class_id).map((student) => store.getAccommodation(student.id).extraMinutes || 0)) : 0;
          return Date.parse(at) >= Date.parse(exam.scheduled_end) + extra * 60_000;
        });
      if (!due.length && !expired.length && !ended.length) return;
      tx(() => {
        q("UPDATE exams SET status='closed', updated_at=? WHERE status='scheduled' AND scheduled_end IS NOT NULL AND scheduled_end<=?").run(now(), at);
        for (const exam of ended) q("UPDATE exams SET status='closed', updated_at=? WHERE id=? AND status='open'").run(now(), exam.id);
        if (due.length) {
          q("UPDATE exams SET status='closed', updated_at=? WHERE status IN ('open','paused')").run(now());
          const selected = due.at(-1).id;
          q("UPDATE exams SET status='open', updated_at=? WHERE id=?").run(now(), selected);
        }
      });
    },
    // Acesso de baixo nível usado só por lib/maintenance.mjs (limpeza e redefinição). Escritas devem ocorrer dentro de tx().
    raw: { all: (sql, ...args) => q(sql).all(...args), get: (sql, ...args) => q(sql).get(...args), run: (sql, ...args) => q(sql).run(...args), tx },
    addAudit(event, target, detail) {
      tx(() => q('INSERT INTO audit_log(event,target,detail,created_at) VALUES(?,?,?,?)').run(String(event), String(target), String(detail), now()));
    },
    listAudit(target, limit = 100) { return q('SELECT event,target,detail,created_at AS createdAt FROM audit_log WHERE target=? ORDER BY id DESC LIMIT ?').all(String(target), Math.min(Math.max(Number(limit) || 100, 1), 500)); },
    awaySummary(){const out={};for(const r of q("SELECT target, detail, created_at AS at FROM audit_log WHERE event='student_away' ORDER BY id").all()){const seconds=Number(r.detail)||0;const entry=out[r.target]||={count:0,seconds:0,events:[]};entry.count++;entry.seconds+=seconds;entry.events.push({at:r.at,seconds});if(entry.events.length>40)entry.events.shift();}return out;},
    listAuditAll(limit=100){return q("SELECT event,target,detail,created_at AS createdAt FROM audit_log WHERE event<>'student_away' ORDER BY id DESC LIMIT ?").all(Math.min(Math.max(Number(limit)||100,1),500));},
    previewAnonymization(before){const ids=q(`SELECT student_id FROM sessions GROUP BY student_id HAVING student_id IS NOT NULL AND SUM(CASE WHEN status<>'submitted' OR started_at>=? THEN 1 ELSE 0 END)=0`).all(String(before)).map(r=>r.student_id);const legacy=q("SELECT COUNT(*) AS n FROM sessions WHERE student_id IS NULL AND status='submitted' AND started_at<?").get(String(before)).n;const sessions=ids.length?q(`SELECT COUNT(*) AS n FROM sessions WHERE student_id IN (${ids.map(()=>'?').join(',')})`).get(...ids).n:0;return {students:ids.length,sessions:sessions+legacy,legacySessions:legacy};},
    anonymizeBefore(before){const preview=store.previewAnonymization(before);const ids=q(`SELECT student_id FROM sessions GROUP BY student_id HAVING student_id IS NOT NULL AND SUM(CASE WHEN status<>'submitted' OR started_at>=? THEN 1 ELSE 0 END)=0`).all(String(before)).map(r=>r.student_id);const legacyNumbers=q(`SELECT number FROM sessions GROUP BY number HAVING SUM(CASE WHEN status<>'submitted' OR started_at>=? THEN 1 ELSE 0 END)=0 AND SUM(CASE WHEN student_id IS NULL THEN 1 ELSE 0 END)>0`).all(String(before)).map(r=>r.number);const names=ids.length?q(`SELECT DISTINCT name FROM class_roster WHERE student_id IN (${ids.map(()=>'?').join(',')})`).all(...ids).map(r=>r.name).filter(Boolean):[];tx(()=>{for(const name of names)q("UPDATE audit_log SET detail=replace(detail,?,'Estudante anonimizado') WHERE instr(detail,?)>0").run(name,name);for(const id of ids){const alias=`AN-${String(id).slice(-8)}`;q('UPDATE sessions SET number=?,student_name=? WHERE student_id=?').run(alias,'Estudante anonimizado',id);q('UPDATE class_roster SET number=?,name=? WHERE student_id=?').run(alias,'Estudante anonimizado',id);q('UPDATE roster SET name=? WHERE number IN (SELECT number FROM sessions WHERE student_id=?)').run('Estudante anonimizado',id);}const legacy=q("SELECT id,number FROM sessions WHERE student_id IS NULL AND status='submitted' AND started_at<?").all(String(before));for(const session of legacy)q('UPDATE sessions SET number=?,student_name=? WHERE id=?').run(`AN-${session.id.slice(-8)}`,'Estudante anonimizado',session.id);for(const number of legacyNumbers){const alias=`AN-${crypto.createHash('sha256').update(number).digest('hex').slice(0,8)}`;q('UPDATE roster SET number=?,name=? WHERE number=?').run(alias,'Estudante anonimizado',number);}q("UPDATE join_requests SET name='Estudante anonimizado' WHERE created_at<?").run(String(before));});return preview;},
    getBackupSettings(){try{return JSON.parse(meta('backup_settings')||'{"intervalMinutes":5,"keep":20}');}catch{return {intervalMinutes:5,keep:20};}},
    setBackupSettings(settings){const value={intervalMinutes:[5,15,30,60].includes(Number(settings.intervalMinutes))?Number(settings.intervalMinutes):5,keep:[10,20,60].includes(Number(settings.keep))?Number(settings.keep):20};tx(()=>setMeta('backup_settings',JSON.stringify(value)));return value;},

    // ---- documentos
    setDocument(examId, { name, kind, size, file, html }) {
      const old = store.getExam(examId)?.document;
      const oldFile = old && store.getDocument(old.id);
      const id = rid(16);
      tx(() => {
        if (old) q('DELETE FROM documents WHERE id=?').run(old.id);
        q('INSERT INTO documents(id,exam_id,name,kind,size,file,html) VALUES(?,?,?,?,?,?,?)').run(id, examId, name, kind, size, file, html ?? null);
        q('UPDATE exams SET document=?, updated_at=? WHERE id=?').run(JSON.stringify({ id, name, kind, size }), now(), examId);
      });
      if (oldFile) store.unlinkDocument(oldFile);
      return { id, name, kind, size };
    },
    removeDocument(examId) {
      const old = store.getExam(examId)?.document;
      if (!old) return;
      const oldFile = store.getDocument(old.id);
      tx(() => { q('DELETE FROM documents WHERE id=?').run(old.id); q('UPDATE exams SET document=NULL, updated_at=? WHERE id=?').run(now(), examId); });
      if (oldFile) store.unlinkDocument(oldFile);
    },
    getDocument: (id) => q('SELECT * FROM documents WHERE id=?').get(id),
    unlinkDocument(rowOrId) {
      const row = typeof rowOrId === 'string' ? store.getDocument(rowOrId) : rowOrId;
      if (row?.file && path.basename(row.file) === row.file) {
        fs.rmSync(path.join(documentDir, row.file), { force: true });
      }
    },

    // ---- sessões
    getSession: (id) => sessionOf(q('SELECT * FROM sessions WHERE id=?').get(id)),
    findSession: (examId, number) => sessionOf(q('SELECT * FROM sessions WHERE exam_id=? AND number=?').get(examId, number)),
    listSessions: (examId) => q('SELECT * FROM sessions WHERE exam_id=? ORDER BY CAST(number AS INTEGER)').all(examId).map(sessionOf),
    createSession(examId, number, student = {}) {
      const id = `s-${rid(8)}`;
      tx(() => q('INSERT INTO sessions(id,exam_id,student_id,number,token,started_at,last_seen,student_name,class_name) VALUES(?,?,?,?,?,?,?,?,?)').run(id, examId, student.id || null, number, rid(16), now(), Date.now(), String(student.name || ''), String(student.className || '')));
      return store.getSession(id);
    },
    rotateToken(id) { tx(() => q('UPDATE sessions SET token=?, last_seen=? WHERE id=?').run(rid(16), Date.now(), id)); return store.getSession(id); },
    touch: (id) => q('UPDATE sessions SET last_seen=? WHERE id=?').run(Date.now(), id),
    submit: (id) => tx(() => q("UPDATE sessions SET status='submitted', submitted_at=COALESCE(submitted_at,?), last_seen=? WHERE id=?").run(now(), Date.now(), id)),
    reopen: (id) => tx(() => q("UPDATE sessions SET status='active', submitted_at=NULL WHERE id=?").run(id)),
    pauseSession: (id) => tx(() => q("UPDATE sessions SET status='paused', paused_at=? WHERE id=? AND status='active'").run(now(), id)),
    resumeSession: (id) => tx(() => q("UPDATE sessions SET status='active', paused_at=NULL WHERE id=? AND status='paused'").run(id)),

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
      const encoded=bytes.toString('base64');
      const checksum=crypto.hash('sha256',`${encoded}\n${JSON.stringify(documents)}`);
      return { format: 'atlas-backup', version: 1, createdAt: now(), db: encoded, documents, checksum };
    },
    verifyBackup(input) {
      const invalid=()=>new BackupError('Este arquivo não é um backup válido do Atlas.');
      if(input?.format!=='atlas-backup'||input.version!==1||typeof input.db!=='string')throw invalid();
      const docs=input.documents||{};
      if(!docs||typeof docs!=='object'||Array.isArray(docs))throw invalid();
      if(input.checksum){const actual=crypto.hash('sha256',`${input.db}\n${JSON.stringify(docs)}`);if(!/^[a-f0-9]{64}$/i.test(input.checksum)||!crypto.timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(input.checksum,'hex')))throw invalid();}
      const bytes=Buffer.from(input.db,'base64');if(bytes.length<512||bytes.subarray(0,15).toString('latin1')!=='SQLite format 3')throw invalid();
      for(const [name,data] of Object.entries(docs))if(!/^[a-f0-9]{32}\.(pdf|docx)$/.test(name)||typeof data!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))throw invalid();
      const tmp=path.join(backupDir,`verify-${rid(4)}.tmp`);fs.writeFileSync(tmp,bytes);
      try{const probe=new DatabaseSync(tmp);try{const check=probe.prepare('PRAGMA integrity_check').get();const tables=new Set(probe.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r)=>r.name));if(Object.values(check)[0]!=='ok'||!['roster','classes','exams','sessions','answers','grades','documents'].every((t)=>tables.has(t)))throw invalid();return {valid:true,exams:probe.prepare('SELECT COUNT(*) AS n FROM exams').get().n,students:probe.prepare('SELECT COUNT(*) AS n FROM class_roster').get().n+probe.prepare('SELECT COUNT(*) AS n FROM roster').get().n,classes:probe.prepare('SELECT id,name FROM classes ORDER BY name').all(),examList:probe.prepare('SELECT id,title,class_id AS classId,created_at AS createdAt FROM exams ORDER BY created_at DESC').all()};}finally{probe.close();}}catch(error){throw error instanceof BackupError?error:invalid();}finally{fs.rmSync(tmp,{force:true});}
    },
    restoreSelected(input,{classIds=[],examIds=[]}={}){
      store.verifyBackup(input);const selectedClasses=new Set(classIds.map(String));const selectedExams=new Set(examIds.map(String));if(!selectedClasses.size&&!selectedExams.size)throw new BackupError('Selecione ao menos uma turma ou prova para restaurar.');
      const tmp=path.join(backupDir,`selective-${rid(4)}.tmp`);fs.writeFileSync(tmp,Buffer.from(input.db,'base64'));const source=new DatabaseSync(tmp);const restoredFiles=[];
      try{
        const classRows=source.prepare('SELECT id,name,created_at,archived FROM classes').all();const examRows=source.prepare('SELECT * FROM exams').all().filter(row=>selectedExams.has(row.id));
        for(const exam of examRows)if(exam.class_id)selectedClasses.add(exam.class_id);
        const classes=classRows.filter(row=>selectedClasses.has(row.id));
        for(const [name,data] of Object.entries(input.documents||{})){const bytes=Buffer.from(data,'base64');const target=path.join(documentDir,name);const staged=target+'.restore-tmp';fs.writeFileSync(staged,bytes);restoredFiles.push({target,staged});}
        const before=path.join(backupDir,`atlas-antes-restauracion-seletiva-${now().replace(/[-:T]/g,'').slice(0,14)}-${rid(3)}.sqlite`);db.exec(`VACUUM INTO '${before.replaceAll("'","''")}'`);
        tx(()=>{
          for(const row of classes){q('INSERT INTO classes(id,name,created_at,archived) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,archived=excluded.archived').run(row.id,row.name,row.created_at,row.archived);for(const student of source.prepare('SELECT class_id,student_id,number,name,position FROM class_roster WHERE class_id=?').all(row.id))q('INSERT INTO class_roster(class_id,student_id,number,name,position) VALUES(?,?,?,?,?) ON CONFLICT(class_id,number) DO UPDATE SET student_id=COALESCE(class_roster.student_id,excluded.student_id),name=excluded.name,position=excluded.position').run(student.class_id,student.student_id,student.number,student.name,student.position);}
          for(const exam of examRows){q(`INSERT INTO exams(id,title,status,access_code,questions,document,created_at,updated_at,class_id,feedback,scheduled_start,scheduled_end,shuffle) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,status=excluded.status,access_code=excluded.access_code,questions=excluded.questions,document=excluded.document,updated_at=excluded.updated_at,class_id=excluded.class_id,feedback=excluded.feedback,scheduled_start=excluded.scheduled_start,scheduled_end=excluded.scheduled_end,shuffle=excluded.shuffle`).run(exam.id,exam.title,exam.status,exam.access_code,exam.questions,exam.document,exam.created_at,exam.updated_at,exam.class_id,exam.feedback,exam.scheduled_start,exam.scheduled_end,exam.shuffle||0);
            for(const session of source.prepare('SELECT * FROM sessions WHERE exam_id=?').all(exam.id))q(`INSERT INTO sessions(id,exam_id,student_id,number,token,status,started_at,submitted_at,last_seen,paused_at,student_name,class_name) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET student_id=excluded.student_id,number=excluded.number,token=excluded.token,status=excluded.status,started_at=excluded.started_at,submitted_at=excluded.submitted_at,last_seen=excluded.last_seen,paused_at=excluded.paused_at,student_name=excluded.student_name,class_name=excluded.class_name`).run(session.id,session.exam_id,session.student_id,session.number,session.token,session.status,session.started_at,session.submitted_at,session.last_seen,session.paused_at,session.student_name,session.class_name);
            for(const answer of source.prepare('SELECT a.* FROM answers a JOIN sessions s ON s.id=a.session_id WHERE s.exam_id=?').all(exam.id))q('INSERT INTO answers(session_id,question_id,answer,updated_at) VALUES(?,?,?,?) ON CONFLICT(session_id,question_id) DO UPDATE SET answer=excluded.answer,updated_at=excluded.updated_at').run(answer.session_id,answer.question_id,answer.answer,answer.updated_at);
            for(const grade of source.prepare('SELECT g.* FROM grades g JOIN sessions s ON s.id=g.session_id WHERE s.exam_id=?').all(exam.id))q('INSERT INTO grades(session_id,question_id,score) VALUES(?,?,?) ON CONFLICT(session_id,question_id) DO UPDATE SET score=excluded.score').run(grade.session_id,grade.question_id,grade.score);
            for(const document of source.prepare('SELECT * FROM documents WHERE exam_id=?').all(exam.id))q('INSERT INTO documents(id,exam_id,name,kind,size,file,html) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET exam_id=excluded.exam_id,name=excluded.name,kind=excluded.kind,size=excluded.size,file=excluded.file,html=excluded.html').run(document.id,document.exam_id,document.name,document.kind,document.size,document.file,document.html);
          }
        });
        for(const file of restoredFiles){fs.copyFileSync(file.staged,file.target);fs.rmSync(file.staged,{force:true});}store.addAudit('selective_restore','backup',`${classes.length} turma(s), ${examRows.length} prova(s) restaurada(s).`);dirty=true;return {classes:classes.length,exams:examRows.length};
      }catch(error){for(const file of restoredFiles)fs.rmSync(file.staged,{force:true});throw error;}finally{source.close();fs.rmSync(tmp,{force:true});}
    },
    restoreBackup(input) {
      const invalid = () => new BackupError('Este arquivo não é um backup válido do Atlas.');
      store.verifyBackup(input);
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
    snapshot({ keep = this.getBackupSettings().keep, intervalMinutes = this.getBackupSettings().intervalMinutes } = {}) {
      if (!dirty) return null;
      const stamp = now().replace(/[-:T]/g, '').slice(0, 14);
      const target = path.join(backupDir, `atlas-${stamp}.sqlite`);
      if (fs.existsSync(target)) return target;
      const backups=fs.readdirSync(backupDir).filter((f)=>/^atlas-\d{14}\.sqlite$/.test(f)).sort();
      if(backups.length){const previous=backups.at(-1).match(/atlas-(\d{14})\.sqlite/)[1];const timestamp=Date.UTC(+previous.slice(0,4),+previous.slice(4,6)-1,+previous.slice(6,8),+previous.slice(8,10),+previous.slice(10,12),+previous.slice(12,14));if(Date.now()-timestamp<Math.max(5,Number(intervalMinutes)||5)*60_000)return null;}
      db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
      dirty = false;
      const old = fs.readdirSync(backupDir).filter((f) => /^atlas-\d{14}\.sqlite$/.test(f)).sort().slice(0, -Math.max(1,Number(keep)||20));
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

