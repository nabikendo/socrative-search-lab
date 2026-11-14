import { app, BrowserWindow, dialog, shell, Menu } from 'electron';
import updater from 'electron-updater';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { createApp } from '../server.mjs';

const { autoUpdater } = updater;

let atlas;
let window;
let updateChannel='beta';
let updateChannelFile='';
const MAIN_PROFILE = 'principal';

function loadProfiles() {
  const file = path.join(app.getPath('userData'), 'profiles.json');
  try {
    const profiles = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(profiles)) throw new Error('Lista de perfis inválida.');
    return { file, profiles: profiles.filter(({ id, name }) => /^[a-f0-9]{24}$/.test(id) && typeof name === 'string') };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { file, profiles: [] };
  }
}

function useUpdateChannel(channel){
  updateChannel=channel==='stable'?'stable':'beta';
  autoUpdater.channel=updateChannel==='stable'?'latest':'beta';
  autoUpdater.allowPrerelease=updateChannel==='beta';
  if(updateChannelFile)fs.writeFileSync(updateChannelFile,updateChannel+'\n',{encoding:'utf8',mode:0o600});
}

async function checkUpdates() {
  if (!app.isPackaged) {
    await dialog.showMessageBox(window, { type: 'info', title: 'Atualizações', message: 'A busca de atualizações funciona na versão instalada do Atlas.' });
    return;
  }
  try { useUpdateChannel(updateChannel); await autoUpdater.checkForUpdates(); }
  catch (error) {
    await dialog.showMessageBox(window, { type: 'warning', title: 'Não foi possível buscar atualizações', message: 'Confira sua conexão com a Internet e tente novamente.', detail: error.message });
  }
}

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowPrerelease = true;
autoUpdater.channel = 'beta';
autoUpdater.allowDowngrade = false;
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
  const { file: profileFile, profiles } = loadProfiles();
  const requested = process.argv.find((arg) => arg.startsWith('--atlas-profile='))?.slice('--atlas-profile='.length);
  const profile = profiles.find(({ id }) => id === requested);
  const activeProfile = profile?.id ?? MAIN_PROFILE;
  const dataDir = profile
    ? path.join(app.getPath('userData'), 'profiles', profile.id)
    : path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  updateChannelFile=path.join(app.getPath('userData'),'update-channel.txt');
  try{updateChannel=fs.readFileSync(updateChannelFile,'utf8').trim()==='stable'?'stable':'beta';}catch{}
  useUpdateChannel(updateChannel);
  const pin = getPin(dataDir);
  function switchProfile(id) {
    if (id === activeProfile) return;
    if (atlas.store.getOpenExam()) {
      dialog.showMessageBox(window, { type: 'warning', message: 'Encerre a aplicação atual antes de trocar de perfil.' });
      return;
    }
    const args = process.argv.slice(1).filter((arg) => !arg.startsWith('--atlas-profile='));
    app.relaunch({ args: [...args, `--atlas-profile=${id}`] });
    app.quit();
  }
  atlas = createApp({ dataDir, pin, desktopProfiles: {
    list: () => ({ active: activeProfile, profiles: [{ id: MAIN_PROFILE, name: 'Principal' }, ...profiles] }),
    create(name, profilePin) {
      if (profiles.some((entry) => entry.name.toLowerCase() === name.toLowerCase()) || name.toLowerCase() === 'principal') return false;
      const id = crypto.randomBytes(12).toString('hex');
      const directory = path.join(app.getPath('userData'), 'profiles', id);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'pin.txt'), profilePin + '\n', { mode: 0o600 });
      const temporary = profileFile + '.tmp';
      fs.writeFileSync(temporary, JSON.stringify([...profiles, { id, name }]), { mode: 0o600 });
      fs.renameSync(temporary, profileFile);
      profiles.push({ id, name });
      return true;
    },
    switch(id) {
      if (id !== MAIN_PROFILE && !profiles.some((entry) => entry.id === id)) return false;
      setTimeout(() => switchProfile(id), 600);
      return true;
    },
  } });
  let listening = false;
  for (const candidate of [80, 8080, 0]) {
    try {
      await new Promise((resolve, reject) => {
        const fail = (error) => { atlas.server.removeListener('listening', resolve); reject(error); };
        atlas.server.once('error', fail);
        atlas.server.listen(candidate, '0.0.0.0', () => { atlas.server.removeListener('error', fail); resolve(); });
      });
      listening = true;
      break;
    } catch (error) {
      if (!['EADDRINUSE', 'EACCES'].includes(error.code)) throw error;
    }
  }
  if (!listening) throw new Error('Não foi possível escolher uma porta para o Atlas.');
  const port = atlas.server.address().port;
  const studentUrls = () => {
    return Object.values(os.networkInterfaces()).flat()
      .filter((net) => net?.family === 'IPv4' && !net.internal)
      .map((net) => net.address)
      .sort((a, b) => Number(b === '192.168.5.142') - Number(a === '192.168.5.142'))
      .map((ip) => `http://${ip}:${port}/prova`);
  };
  window = new BrowserWindow({
    width: 1200, height: 800, minWidth: 820, minHeight: 600,
    title: `Atlas — ${profile?.name ?? 'Principal'}`,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Atlas', submenu: [
      ...(!profile ? [{ label: 'Mostrar PIN do perfil principal', click: () => dialog.showMessageBox(window, { type: 'info', title: 'PIN do professor', message: 'Seu PIN: ' + pin }) }] : []),
      { label: 'Trocar perfil', submenu: [{ id: MAIN_PROFILE, name: 'Principal' }, ...profiles].map(({ id, name }) => ({
        label: name, enabled: id !== activeProfile, click: () => switchProfile(id),
      })) },
      { label: 'Endereço para os alunos', click: () => dialog.showMessageBox(window, { type: 'info', title: 'Acesso dos alunos', message: 'Endereços na rede local', detail: studentUrls().join('\\n') || 'Conecte o computador à rede Wi-Fi da sala.' }) },
      { label: 'Buscar atualizações', accelerator: 'Alt+U', click: () => checkUpdates() },
      { label: 'Canal de atualizações', submenu: [
        {label:'Pré-lançamentos beta',type:'radio',checked:updateChannel==='beta',click:()=>{useUpdateChannel('beta');dialog.showMessageBox(window,{type:'info',title:'Canal beta selecionado',message:'O Atlas poderá oferecer versões de teste. Você pode voltar ao canal estável neste menu.'});}},
        {label:'Somente versões estáveis',type:'radio',checked:updateChannel==='stable',click:()=>{useUpdateChannel('stable');dialog.showMessageBox(window,{type:'info',title:'Canal estável selecionado',message:'O Atlas só buscará versões marcadas como estáveis.'});}},
      ]},
      { role: 'quit', label: 'Sair' },
    ] },
  ]));
  window.setMenuBarVisibility(true);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://127.0.0.1:' + port + '/')) event.preventDefault();
  });
  await window.loadURL('http://127.0.0.1:' + port + '/professor');
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
