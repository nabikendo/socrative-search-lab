import { app, BrowserWindow, dialog, shell, Menu } from 'electron';
import { autoUpdater } from 'electron-updater';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { createApp } from '../server.mjs';

let atlas;
let window;

async function checkUpdates() {
  if (!app.isPackaged) {
    await dialog.showMessageBox(window, { type: 'info', title: 'Atualizações', message: 'A busca de atualizações funciona na versão instalada do Atlas.' });
    return;
  }
  try { await autoUpdater.checkForUpdates(); }
  catch (error) {
    await dialog.showMessageBox(window, { type: 'warning', title: 'Não foi possível buscar atualizações', message: 'Confira sua conexão com a Internet e tente novamente.', detail: error.message });
  }
}

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowPrerelease = true;
autoUpdater.channel = 'beta';
autoUpdater.on('update-available', async (info) => {
  const { response } = await dialog.showMessageBox(window, {
    type: 'info', title: 'Atualização do Atlas disponível',
    message: `A versão ${info.version} está disponível. Deseja baixar agora?`,
    buttons: ['Baixar atualização', 'Depois'], defaultId: 0, cancelId: 1,
  });
  if (response === 0) autoUpdater.downloadUpdate().catch((error) => dialog.showErrorBox('Falha na atualização', error.message));
});
autoUpdater.on('update-not-available', () => dialog.showMessageBox(window, { type: 'info', title: 'Atlas atualizado', message: 'Você já está usando a versão mais recente.' }));
autoUpdater.on('update-downloaded', async (info) => {
  const { response } = await dialog.showMessageBox(window, {
    type: 'info', title: 'Atualização pronta',
    message: `A versão ${info.version} foi baixada.`, detail: 'Reinicie o Atlas para concluir a instalação.',
    buttons: ['Reiniciar agora', 'Depois'], defaultId: 0, cancelId: 1,
  });
  if (response === 0) autoUpdater.quitAndInstall();
});

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
  const pin = getPin(dataDir);
  atlas = createApp({ dataDir, pin });
  await new Promise((resolve, reject) => {
    atlas.server.once('error', reject);
    atlas.server.listen(0, '0.0.0.0', () => {
      atlas.server.removeListener('error', reject);
      resolve();
    });
  });
  const port = atlas.server.address().port;
  const studentUrls = () => Object.values(os.networkInterfaces()).flat()
    .filter((net) => net?.family === 'IPv4' && !net.internal)
    .map((net) => 'http://' + net.address + ':' + port + '/prova');
  window = new BrowserWindow({
    width: 1200, height: 800, minWidth: 820, minHeight: 600,
    title: 'Atlas — Provas',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Atlas', submenu: [
      { label: 'Mostrar PIN do professor', click: () => dialog.showMessageBox(window, { type: 'info', title: 'PIN do professor', message: 'Seu PIN: ' + pin }) },
      { label: 'Endereço para os alunos', click: () => dialog.showMessageBox(window, { type: 'info', title: 'Acesso dos alunos', message: 'Endereços na rede local', detail: studentUrls().join('\\n') || 'Conecte o computador à rede Wi-Fi da sala.' }) },
      { label: 'Buscar atualizações', accelerator: 'Alt+U', click: () => checkUpdates() },
      { role: 'quit', label: 'Sair' },
    ] },
  ]));
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://127.0.0.1:' + port + '/')) event.preventDefault();
  });
  await window.loadURL('http://127.0.0.1:' + port + '/professor');
  dialog.showMessageBox(window, { type: 'info', title: 'Acesso do professor', message: 'PIN do professor: ' + pin, detail: 'Para consultar novamente, abra Atlas → Mostrar PIN do professor. Para buscar atualizações, pressione Alt+U.' });
  if (app.isPackaged) setTimeout(() => checkUpdates(), 15_000).unref?.();
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
