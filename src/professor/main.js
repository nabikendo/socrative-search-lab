import { api } from '../lib/api.js';
import { $, $$ } from '../lib/dom.js';
import * as roster from './roster.js';
import * as exam from './exam.js';
import * as results from './results.js';

const tabs = { turma: roster, prova: exam, resultados: results };
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

async function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  if (!mounted) {
    for (const [name, module] of Object.entries(tabs)) module.mount($(`#tab-${name}`));
    mounted = true;
  }
  const { roster: students } = await api('/api/roster');
  openTab(location.hash.slice(1) in tabs ? location.hash.slice(1) : students.length ? 'prova' : 'turma');
}

function openTab(name) {
  active?.deactivate?.();
  for (const button of $$('[data-tab]')) button.setAttribute('aria-selected', String(button.dataset.tab === name));
  for (const key of Object.keys(tabs)) $(`#tab-${key}`).hidden = key !== name;
  active = tabs[name];
  history.replaceState(null, '', `#${name}`);
  active.activate?.();
}

for (const button of $$('[data-tab]')) button.addEventListener('click', () => openTab(button.dataset.tab));

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#login-error').textContent = '';
  try { await api('/api/auth/login', { method: 'POST', body: { pin: $('#pin').value.trim() } }); await showApp(); }
  catch (error) { $('#login-error').textContent = error.message; }
});
$('#logout').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); showLogin(); });
window.addEventListener('atlas:auth-required', showLogin);

(async () => {
  try { (await api('/api/auth/status')).authenticated ? await showApp() : showLogin(); }
  catch { showLogin(); }
})();
