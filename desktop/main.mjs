import { app, BrowserWindow, dialog, shell, Menu, nativeTheme, powerSaveBlocker, safeStorage, session } from 'electron';
import { execFile } from 'node:child_process';
import updater from 'electron-updater';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { createApp } from '../server.mjs';
import { createProfileManager, MAIN_PROFILE } from './profiles.mjs';
import { updateSafety } from './update-safety.mjs';

const { autoUpdater } = updater;

let atlas;
let window;
let manualUpdateCheck=false;
let downloadedUpdate=null;
let updateChannel='beta';
let updateChannelFile='';

function useUpdateChannel(channel){
  updateChannel=channel==='stable'?'stable':'beta';
  autoUpdater.channel=updateChannel==='stable'?'latest':'beta';
  autoUpdater.allowPrerelease=updateChannel==='beta';
  if(updateChannelFile)fs.writeFileSync(updateChannelFile,updateChannel+'\n',{encoding:'utf8',mode:0o600});
}

async function checkUpdates(manual = true) {
  manualUpdateCheck = manual;
  if (!app.isPackaged) {
    if (!manual) return;
    await dialog.showMessageBox(window, { type: 'info', title: 'Atualizações', message: 'A busca de atualizações funciona na versão instalada do Atlas.' });
    return;
  }
  try { useUpdateChannel(updateChannel); await autoUpdater.checkForUpdates(); }
  catch (error) {
    if (!manual) return; // sala sem Internet: a busca automática falha em silêncio
    await dialog.showMessageBox(window, { type: 'warning', title: 'Não foi possível buscar atualizações', message: 'Confira sua conexão com a Internet e tente novamente.', detail: error.message });
  }
}

// Never install on ordinary exit: the professor might be supervising an exam.
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.allowPrerelease = true;
autoUpdater.channel = 'beta';
autoUpdater.allowDowngrade = false;
async function installDownloadedUpdate() {
  if (!downloadedUpdate) {
    await dialog.showMessageBox(window, { type: 'info', title: 'Atualização', message: 'Nenhuma atualização baixada nesta sessão.' });
    return;
  }
  const safety = updateSafety(atlas?.store);
  if (!safety.safe) {
    await dialog.showMessageBox(window, {
      type: 'warning', title: 'Instalação adiada',
      message: safety.reason === 'exam_in_progress' ? 'Existe uma prova aberta ou pausada.' :
        safety.reason === 'unconfirmed_deliveries' ? `Existem ${safety.count} sessão(ões) com entrega não confirmada nos últimos 3 dias.` :
        safety.reason === 'scheduled_soon' ? 'Uma prova está agendada para começar em breve.' :
        'Não foi possível confirmar que os dados estão seguros.',
      detail: 'Confira os envios pendentes no painel de resultados e as provas agendadas antes de instalar. A atualização permanece baixada.',
    });
    return;
  }
  // A snapshot is required before the updater can replace installed files.
  // It remains in userData, separate from the Windows installation.
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const directory = atlas.store.backupDir;
    fs.mkdirSync(directory, { recursive: true });
    const tmp = path.join(directory, `antes-atualizacao-${stamp}.atlas.tmp`);
    const target = path.join(directory, `antes-atualizacao-${stamp}.atlas`);
    fs.writeFileSync(tmp, JSON.stringify(atlas.store.exportBackup()), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, target);
  } catch (error) {
    await dialog.showMessageBox(window, {
      type: 'error', title: 'Atualização cancelada', message: 'Não foi possível salvar o backup preventivo.',
      detail: error.message,
    });
    return;
  }
  // Recheck: an exam may have started while the backup was being created.
  if (!updateSafety(atlas?.store).safe) {
    await dialog.showMessageBox(window, { type: 'warning', title: 'Instalação adiada', message: 'Uma prova foi iniciada durante a preparação da atualização.' });
    return;
  }
  try {
    await atlas.close();
    atlas = null;
    app.isClosingAtlas = true;
    autoUpdater.quitAndInstall(false, true);
  } catch (error) {
    dialog.showErrorBox('Falha ao instalar atualização', error.message);
    // The database connection may already be closed; relaunch the same profile.
    app.relaunch();
    app.isClosingAtlas = true;
    app.quit();
  }
}

autoUpdater.on('update-available', async (info) => {
  const { response } = await dialog.showMessageBox(window, {
    type: 'info', title: 'Atualização do Atlas disponível',
    message: `A versão ${info.version} está disponível. Deseja baixar agora?`,
    buttons: ['Baixar atualização', 'Depois'], defaultId: 0, cancelId: 1,
  });
  if (response === 0) autoUpdater.downloadUpdate().catch((error) => dialog.showErrorBox('Falha na atualização', error.message));
});
autoUpdater.on('update-not-available', () => manualUpdateCheck && dialog.showMessageBox(window, { type: 'info', title: 'Atlas atualizado', message: 'Você já está usando a versão mais recente.' }));
autoUpdater.on('update-downloaded', async (info) => {
  downloadedUpdate = info;
  const safety = updateSafety(atlas?.store);
  if (!safety.safe) {
    await dialog.showMessageBox(window, {
      type: 'info', title: 'Atualização baixada — instalação adiada',
      message: `A versão ${info.version} está pronta, mas existem provas ou entregas pendentes.`,
      detail: 'O Atlas adia a instalação se existe prova aberta, sessões recentes sem entrega ou prova agendada para começar. Confira os resultados antes de instalar.',
    });
    return;
  }
  const { response } = await dialog.showMessageBox(window, {
    type: 'info', title: 'Atualização pronta',
    message: `A versão ${info.version} foi baixada.`,
    detail: 'Antes de instalar, o Atlas verifica novamente se não há provas abertas e salva um backup preventivo.',
    buttons: ['Instalar agora', 'Depois'], defaultId: 1, cancelId: 1,
  });
  if (response === 0) await installDownloadedUpdate();
});

// O Windows pergunta sobre o Firewall só na primeira vez; se o professor cancelou, os alunos não conectam.
function addFirewallRule() {
  return new Promise((resolve, reject) => {
    const exe = process.execPath.replace(/'/g, "''");
    const script = `$ErrorActionPreference='Stop'; $e='${exe}'; Remove-NetFirewallRule -DisplayName 'Atlas' -ErrorAction SilentlyContinue; New-NetFirewallRule -DisplayName 'Atlas' -Direction Inbound -Action Allow -Program $e -Profile Private | Out-Null`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const outer = `$p = Start-Process -FilePath powershell -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand','${encoded}'; exit $p.ExitCode`;
    execFile('powershell.exe', ['-NoProfile', '-Command', outer], { windowsHide: true }, (error) => (error ? reject(error) : resolve()));
  });
}

async function allowFirewall() {
  if (process.platform !== 'win32') return;
  try {
    await addFirewallRule();
    await dialog.showMessageBox(window, { type: 'info', title: 'Firewall liberado', message: 'O Atlas foi autorizado nas redes Privadas do Windows. Confirme o perfil da rede Wi-Fi da escola.' });
  } catch {
    await dialog.showMessageBox(window, { type: 'warning', title: 'Não foi possível liberar', message: 'A liberação precisa da autorização do administrador do Windows.', detail: 'Tente de novo e escolha “Sim” quando o Windows perguntar. Em computador da escola, peça ajuda à TI.' });
  }
}

// Limpa o cache de páginas do Chromium sem tocar em cookies, preferências do navegador ou dados do professor.
async function clearWebCache() {
  await session.defaultSession.clearCache();
  await session.defaultSession.clearStorageData({ storages: ['cachestorage', 'serviceworkers', 'shadercache'] });
}

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
  const requested = process.argv.find((arg) => arg.startsWith('--atlas-profile='))?.slice('--atlas-profile='.length);
  let buildMenu = () => {};
  const manager = createProfileManager({
    userDataDir: app.getPath('userData'), documentsDir: app.getPath('documents'),
    activeId: requested, onChange: () => { buildMenu(); },
  });
  const profile = requested && requested !== MAIN_PROFILE && manager.exists(requested) ? manager.get(requested) : null;
  const activeProfile = profile?.id ?? MAIN_PROFILE;
  manager.setActive(activeProfile);
  const dataDir = manager.dataDirOf(activeProfile);
  fs.mkdirSync(dataDir, { recursive: true });
  updateChannelFile=path.join(app.getPath('userData'),'update-channel.txt');
  updateChannel=app.getVersion().includes('-')?'beta':'stable'; // versão estável acompanha só estáveis, a menos que o professor escolha outro canal
  try{const saved=fs.readFileSync(updateChannelFile,'utf8').trim();if(saved==='stable'||saved==='beta')updateChannel=saved;}catch{}
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
  const exportDir = path.join(app.getPath('documents'), 'Atlas', 'Copias');
  // Chaves de API ficam criptografadas com o cofre do sistema (DPAPI no Windows) quando disponível.
  const secretBox = safeStorage.isEncryptionAvailable()
    ? { encrypt: (text) => safeStorage.encryptString(text).toString('base64'), decrypt: (data) => safeStorage.decryptString(Buffer.from(data, 'base64')) }
    : undefined;
  atlas = createApp({ dataDir, pin, exportDir, secretBox, clearAppCache: clearWebCache, desktopProfiles: {
    list: () => manager.list(),
    create: (name, profilePin) => manager.create(name, profilePin),
    rename: (id, name) => { const result = manager.rename(id, name); if (id === activeProfile && window) window.setTitle(`Atlas — ${result.name}`); return result; },
    changePin: (id, profilePin) => manager.changePin(id, profilePin),
    remove: (id, options) => manager.remove(id, options),
    switch(id) {
      if (!manager.exists(id)) return false;
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
  // Endereço do próprio Atlas. Na porta 80 o Chromium escreve "http://127.0.0.1/…" (sem ":80"), então a comparação
  // é feita pela URL já interpretada. Antes, com a porta 80, recarregar a tela e abrir o projetor eram bloqueados.
  const isAtlasUrl = (url, prefix = '/') => {
    try { const u = new URL(url); return u.protocol === 'http:' && u.hostname === '127.0.0.1' && Number(u.port || 80) === port && u.pathname.startsWith(prefix); }
    catch { return false; }
  };
  // Endereços para os alunos conforme o modo de segurança (Configurações › Segurança).
  const studentUrls = () => atlas.studentUrls(port).map((url) => `${url}/prova`);
  window = new BrowserWindow({
    width: 1200, height: 800, minWidth: 820, minHeight: 600,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#f5f5f7',
    title: `Atlas — ${profile?.name ?? 'Principal'}`,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  buildMenu = () => Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Atlas', submenu: [
      ...(!profile ? [{ label: 'Mostrar PIN do perfil principal', click: () => dialog.showMessageBox(window, { type: 'info', title: 'PIN do professor', message: 'Seu PIN: ' + pin }) }] : []),
      { label: 'Trocar perfil', submenu: manager.list().profiles.map(({ id, name }) => ({
        label: name, enabled: id !== activeProfile, click: () => switchProfile(id),
      })) },
      { label: 'Endereço para os alunos', click: () => dialog.showMessageBox(window, { type: 'info', title: 'Acesso dos alunos', message: 'Endereços na rede local', detail: studentUrls().join('\n') || 'Conecte o computador à rede Wi-Fi da sala.' }) },
      ...(process.platform === 'win32' ? [{ label: 'Liberar no Firewall do Windows', click: () => allowFirewall() }] : []),
      { label: 'Abrir pasta das cópias de provas', click: () => { fs.mkdirSync(exportDir, { recursive: true }); shell.openPath(exportDir); } },
      { label: 'Buscar atualizações', accelerator: 'Alt+U', click: () => checkUpdates() },
      { label: 'Instalar atualização baixada', click: () => installDownloadedUpdate() },
      { label: 'Canal de atualizações', submenu: [
        {label:'Pré-lançamentos beta',type:'radio',checked:updateChannel==='beta',click:()=>{useUpdateChannel('beta');dialog.showMessageBox(window,{type:'info',title:'Canal beta selecionado',message:'O Atlas poderá oferecer versões de teste. Você pode voltar ao canal estável neste menu.'});}},
        {label:'Somente versões estáveis',type:'radio',checked:updateChannel==='stable',click:()=>{useUpdateChannel('stable');dialog.showMessageBox(window,{type:'info',title:'Canal estável selecionado',message:'O Atlas só buscará versões marcadas como estáveis.'});}},
      ]},
      { role: 'quit', label: 'Sair' },
    ] },
  ]));
  buildMenu();
  window.setMenuBarVisibility(true);
  window.webContents.setWindowOpenHandler(({ url }) => {
    // Acompanhamento no projetor: abre numa janela do próprio Atlas (antes era recusado e o botão não fazia nada).
    if (isAtlasUrl(url, '/projetor')) {
      return { action: 'allow', overrideBrowserWindowOptions: {
        width: 1280, height: 760, autoHideMenuBar: true, title: 'Atlas — Projetor',
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#f5f5f7',
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
      } };
    }
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  // A janela do projetor também só navega dentro do Atlas.
  window.webContents.on('did-create-window', (child) => {
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    child.webContents.on('will-navigate', (event, url) => { if (!isAtlasUrl(url)) event.preventDefault(); });
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAtlasUrl(url)) event.preventDefault();
  });
  await window.loadURL('http://127.0.0.1:' + port + '/professor');
  // durante uma prova aberta o computador não pode entrar em suspensão (os alunos perderiam a conexão)
  let blocker = null;
  const keepAwake = setInterval(() => {
    try {
      const examOpen = !!atlas.store.getOpenExam();
      if (examOpen && blocker === null) blocker = powerSaveBlocker.start('prevent-app-suspension');
      else if (!examOpen && blocker !== null) { powerSaveBlocker.stop(blocker); blocker = null; }
    } catch { /* o servidor está encerrando */ }
  }, 10_000);
  keepAwake.unref?.();
  const firewallMarker = path.join(app.getPath('userData'), 'firewall-asked.txt');
  if (process.platform === 'win32' && app.isPackaged && !fs.existsSync(firewallMarker)) {
    fs.writeFileSync(firewallMarker, new Date().toISOString() + '\n');
    const { response } = await dialog.showMessageBox(window, {
      type: 'question', title: 'Conexão dos alunos', buttons: ['Liberar agora', 'Depois'], defaultId: 0, cancelId: 1,
      message: 'Permitir que os alunos conectem ao Atlas?',
      detail: 'A liberação pede autorização do administrador e vale apenas para redes Privadas do Windows. Você pode refazê-la no menu Atlas › Liberar no Firewall do Windows.',
    });
    if (response === 0) await allowFirewall();
  }
  if (app.isPackaged) setTimeout(() => checkUpdates(false), 15_000).unref?.();
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
