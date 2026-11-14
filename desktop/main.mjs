import { app, BrowserWindow, dialog, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createApp } from '../server.mjs';

let atlas;
let window;

function getPin(dataDir) {
  const pinFile = path.join(dataDir, 'pin.txt');
  const existing = fs.existsSync(pinFile) ? fs.readFileSync(pinFile, 'utf8').trim() : '';
  if (/^\d{6}$/.test(existing)) return existing;
  const pin = String(crypto.randomInt(100000, 1000000));
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(pinFile, pin + '\n', { mode: 0o600 });
  return pin;
}

async function start() {
  const dataDir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  atlas = createApp({ dataDir, pin: getPin(dataDir) });
  await new Promise((resolve, reject) => {
    atlas.server.once('error', reject);
    atlas.server.listen(0, '0.0.0.0', () => {
      atlas.server.removeListener('error', reject);
      resolve();
    });
  });
  const port = atlas.server.address().port;
  window = new BrowserWindow({
    width: 1200, height: 800, minWidth: 820, minHeight: 600,
    title: 'Atlas — Provas',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://127.0.0.1:' + port + '/')) event.preventDefault();
  });
  await window.loadURL('http://127.0.0.1:' + port + '/professor');
}

app.on('second-instance', () => {
  if (window) { if (window.isMinimized()) window.restore(); window.focus(); }
});
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.whenReady().then(start).catch(async (error) => {
    dialog.showErrorBox('Atlas não iniciou', 'Não foi possível abrir o Atlas.\n\n' + error.message);
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (!atlas || app.isClosingAtlas) return;
    event.preventDefault();
    app.isClosingAtlas = true;
    atlas.close().finally(() => app.quit());
  });
}
