import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { updateSafety } from '../desktop/update-safety.mjs';

test('atualizador falha fechado sem banco ou quando a consulta falha', () => {
  assert.deepEqual(updateSafety(null), { safe: false, reason: 'store_unavailable' });
  assert.deepEqual(updateSafety({ getOpenExam: () => { throw new Error('DB closed'); } }), { safe: false, reason: 'store_error' });
});
test('instalação é bloqueada com prova aberta ou pausada', () => {
  for (const status of ['open', 'paused']) {
    assert.deepEqual(updateSafety({ getOpenExam: () => ({ id: 'prova-1', status }) }),
      { safe: false, reason: 'exam_in_progress', examId: 'prova-1' });
  }
});
test('sem prova em andamento, a atualização pode prosseguir', () => {
  assert.deepEqual(updateSafety({ getOpenExam: () => null }), { safe: true, reason: null });
  assert.deepEqual(updateSafety({ getOpenExam: () => ({ status: 'closed' }) }), { safe: true, reason: null });
});
test('instalação não é automática ao sair e exige verificação antes do instalador', () => {
  const code = fs.readFileSync(new URL('../desktop/main.mjs', import.meta.url), 'utf8');
  assert.match(code, /autoUpdater\.autoInstallOnAppQuit = false/);
  assert.match(code, /downloadedUpdate = info/);
  assert.match(code, /updateSafety\(atlas\?\.store\)/);
  assert.match(code, /antes-atualizacao-/);
  assert.match(code, /await atlas\.close\(\)/);
  assert.match(code, /autoUpdater\.quitAndInstall\(false, true\)/);
});
