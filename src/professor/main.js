import { api } from '../lib/api.js';
import { $, $$, h, clear } from '../lib/dom.js';
import { initializeThemeButton } from '../lib/theme.js';
import * as roster from './roster.js';
import * as exam from './exam.js';
import * as results from './results.js';
import * as help from './help.js';
import * as bank from './bank.js';
import * as descriptors from './descriptor-lab.js';
import * as settings from './settings.js';
import * as home from './home.js';
import { initSearch } from './search.js';

// Chegou aqui = todos os módulos carregaram: tira o aviso "Carregando…" (se um módulo falhar, ele permanece visível).
document.getElementById('boot')?.remove();

const tabs = { inicio: home, turma: roster, prova: exam, banco: bank, descritores: descriptors, resultados: results, ajuda: help, configuracoes: settings };

// Cada aba precisa de sua seção no HTML. Se alguma faltar, cria-a em vez de quebrar todas as outras abas.
for (const name of Object.keys(tabs)) {
  if ($(`#tab-${name}`)) continue;
  const section = document.createElement('section');
  section.id = `tab-${name}`;
  section.hidden = true;
  $('#app main').append(section);
}

function showTabError(name, error) {
  console.error(`Aba ${name}:`, error);
  clear($(`#tab-${name}`), h('div', { class: 'notice danger', role: 'alert' }, `Não consegui carregar esta aba: ${error?.message || 'erro inesperado'}. Feche e abra o Atlas; se continuar, veja Ajuda › Testar a conexão.`));
}
initializeThemeButton();
let mounted = false;
let active = null;

function showLogin() {
  active?.deactivate?.();
  active = null;
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#pin').value = '';
  $('#pin').focus();
}

// Aviso fixo enquanto o modo de teste estiver ativo: os dados mostrados são fictícios.
async function syncTestBanner() {
  $('#test-banner')?.remove();
  try {
    if (!(await api('/api/test-mode')).active) return;
    const leave = h('button', { class: 'btn quiet', type: 'button', onclick: async () => { await api('/api/test-mode', { method: 'POST', body: { action: 'exit' } }); location.reload(); } }, 'Sair do modo de teste');
    $('#app').prepend(h('div', { id: 'test-banner', class: 'test-banner', role: 'status' }, 'MODO DE TESTE — os dados são fictícios e não afetam seus dados reais.', leave));
  } catch { /* sem o aviso, o painel continua funcionando */ }
}

async function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  if (!mounted) {
    for (const [name, module] of Object.entries(tabs)) module.mount($(`#tab-${name}`));
    mounted = true;
  }
  syncTestBanner();
  const { roster: students } = await api('/api/roster');
  openTab(location.hash.slice(1) in tabs ? location.hash.slice(1) : students.length ? 'inicio' : 'turma');
}

const TITLES = { inicio: 'Início', turma: 'Turma', prova: 'Prova', banco: 'Banco de questões', descritores: 'Descritores', resultados: 'Resultados', ajuda: 'Ajuda', configuracoes: 'Configurações' };
function openTab(name) {
  active?.deactivate?.();
  for (const button of $$('[data-tab]')) button.setAttribute('aria-selected', String(button.dataset.tab === name));
  for (const key of Object.keys(tabs)) $(`#tab-${key}`).hidden = key !== name;
  active = tabs[name];
  // cabeçalho da página no estilo dos painéis: nome da seção e data de hoje
  $('#page-title').textContent = TITLES[name] ?? 'Atlas';
  const today = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#page-date').textContent = today.charAt(0).toUpperCase() + today.slice(1);
  $('#settings-open').classList.toggle('active', name === 'configuracoes');
  document.querySelector('.shell')?.scrollTo?.(0, 0);
  window.scrollTo(0, 0);
  history.replaceState(null, '', `#${name}`);
  // um erro ao carregar uma aba aparece nela, em vez de deixá-la em branco
  Promise.resolve().then(() => active.activate?.()).catch((error) => showTabError(name, error));
}

$('#settings-open').addEventListener('click', () => openTab('configuracoes'));
initSearch($('#search-open'));
// querySelectorAll returns the iterable collection of tab buttons.
for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => openTab(button.dataset.tab));

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#login-error').textContent = '';
  try { await api('/api/auth/login', { method: 'POST', body: { pin: $('#pin').value.trim() } }); await showApp(); }
  catch (error) { $('#login-error').textContent = error.message; }
});
$('#logout').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); showLogin(); });
window.addEventListener('atlas:auth-required', showLogin);
window.addEventListener('atlas:goto', (event) => openTab(event.detail));

(async () => {
  try { (await api('/api/auth/status')).authenticated ? await showApp() : showLogin(); }
  catch { showLogin(); }
})();

