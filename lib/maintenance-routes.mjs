import fs from 'node:fs';
import path from 'node:path';
import { ACTIONS, plan, publicPlan, execute, listSafetyBackups, safetyBackupPath, MaintenanceError } from './maintenance.mjs';
import { TestModeError } from './test-mode.mjs';

export function registerMaintenanceRoutes({ route, readJson, HttpError, limit, store, aiSettings, dataDir, hooks, testMode, version }) {
  const asHttp = (error) => {
    if (error instanceof MaintenanceError || error instanceof TestModeError) return new HttpError(error.status, error.code, error.message);
    return error;
  };
  const context = () => ({ store, dataDir, preferencesFile: path.join(dataDir, 'teacher-settings.json'), aiSettings, hooks });

  route('GET', '/api/version', { admin: true }, () => ({ version, desktop: !!process.versions.electron }));

  // Listas para escolher o alvo de uma limpeza individual ou por turma.
  route('GET', '/api/maintenance/targets', { admin: true }, () => ({
    actions: Object.entries(ACTIONS).map(([id, { label, scopes, destructive, backup }]) => ({ id, label, scopes, destructive, backup })),
    exams: store.raw.all('SELECT e.id,e.title,e.status,e.class_id AS classId,(SELECT COUNT(*) FROM sessions s WHERE s.exam_id=e.id) AS sessions FROM exams e ORDER BY e.created_at DESC'),
    classes: store.raw.all('SELECT c.id,c.name,(SELECT COUNT(*) FROM class_roster r WHERE r.class_id=c.id) AS students FROM classes c ORDER BY c.name'),
  }));
  route('GET', '/api/maintenance/exams/:id/participants', { admin: true }, ({ params }) => ({
    participants: store.raw.all('SELECT id,number,student_name AS name,status,last_seen AS lastSeen FROM sessions WHERE exam_id=? ORDER BY CAST(number AS INTEGER)', params.id),
  }));

  route('POST', '/api/maintenance/preview', { admin: true }, async ({ req }) => {
    limit(req, 'maintenance-preview', 60);
    try { return publicPlan(plan(context(), await readJson(req))); } catch (error) { throw asHttp(error); }
  });
  route('POST', '/api/maintenance/run', { admin: true }, async ({ req }) => {
    limit(req, 'maintenance-run', 10);
    try { return await execute(context(), await readJson(req)); } catch (error) { throw asHttp(error); }
  });

  route('GET', '/api/maintenance/backups', { admin: true }, () => ({ backups: listSafetyBackups(store) }));
  route('GET', '/api/maintenance/backups/:name', { admin: true }, ({ params, res }) => {
    let file;
    try { file = safetyBackupPath(store, params.name); } catch (error) { throw asHttp(error); }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': fs.statSync(file).size, 'cache-control': 'no-store', 'content-disposition': `attachment; filename="${path.basename(file)}"` });
    fs.createReadStream(file).pipe(res);
    return null;
  });

  route('GET', '/api/test-mode', { admin: true }, () => testMode.status());
  route('POST', '/api/test-mode', { admin: true }, async ({ req }) => {
    limit(req, 'test-mode', 20);
    const input = await readJson(req);
    try {
      switch (input.action) {
        case 'enable': return testMode.enable();
        case 'reseed': return testMode.reseed();
        case 'exit': return testMode.exit();
        case 'purge': return testMode.purge();
        default: throw new HttpError(400, 'invalid_action', 'Ação inválida.');
      }
    } catch (error) { throw asHttp(error); }
  });
}
