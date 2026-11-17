import { api } from '../lib/api.js';
import { setAppearance } from '../lib/theme.js';
import { h, clear } from '../lib/dom.js';
import { notice } from './settings-kit.js';

let root;
let panel;
let preferences;
let current = 'general';
let navigation = 0; // descarta renderizações antigas quando o professor troca de seção rapidamente

const appearanceKeys = new Set(['theme', 'fontSize', 'highContrast', 'compact', 'presentation']);
const general = [
  ['Aparência', [
    ['theme', 'Tema', 'select', [['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']]],
    ['fontSize', 'Tamanho da fonte', 'select', [['small', 'Pequena'], ['medium', 'Média'], ['large', 'Grande']]],
    ['highContrast', 'Alto contraste', 'checkbox'],
    ['compact', 'Modo compacto', 'checkbox'],
    ['presentation', 'Modo apresentação', 'checkbox']]],
  ['Prova — padrões', [
    ['defaultMinutes', 'Tempo padrão (minutos)', 'number'],
    ['shuffle', 'Embaralhar questões', 'checkbox'],
    ['showAnswerKey', 'Mostrar gabarito após envio', 'checkbox'],
    ['submissionSound', 'Notificação sonora ao receber envio', 'checkbox']]],
];
const sections = [
  ['general', 'Geral'], ['profiles', 'Perfis'], ['ai', 'Inteligência artificial'],
  ['data', 'Dados e limpeza'], ['test', 'Modo de teste'], ['about', 'Rede e sobre'],
];

const status = (message) => { const el = root?.querySelector('#settings-status'); if (el) el.textContent = message; };

async function save(key, value) {
  const before = { ...preferences };
  preferences[key] = value;
  if (appearanceKeys.has(key)) setAppearance({ [key]: value });
  try { preferences = await api('/api/teacher-settings', { method: 'PUT', body: { [key]: value } }); status('Preferência salva.'); }
  catch (error) { preferences = before; if (appearanceKeys.has(key)) setAppearance({ [key]: before[key] }); status('Erro ao salvar: ' + error.message); showSection(current); }
}
function setting([key, label, type, options]) {
  const input = document.createElement(type === 'select' ? 'select' : 'input');
  input.id = 'setting-' + key;
  if (type === 'select') for (const [value, name] of options) input.append(h('option', { value }, name));
  else input.type = type;
  if (type === 'checkbox') input.checked = !!preferences[key]; else input.value = String(preferences[key]);
  if (type === 'number') { input.min = '1'; input.max = '480'; input.step = '1'; }
  input.addEventListener('change', () => {
    const value = type === 'checkbox' ? input.checked : type === 'number' ? Number(input.value) : input.value;
    save(key, value);
  });
  return h('label', { class: type === 'checkbox' ? 'setting-check' : '' }, ...(type === 'checkbox' ? [input, document.createTextNode(label)] : [h('span', {}, label), input]));
}
const group = (title, children) => h('section', { class: 'settings-group' }, h('h2', { class: 'headline' }, title), h('div', { class: 'list' }, ...children));

async function loadNetwork(node) {
  const { urls } = await api('/api/network');
  node.textContent = urls.join(' · ') || 'Nenhum endereço de rede detectado';
}
async function renderAbout(target) {
  const network = h('p', { id: 'settings-network', class: 'caption' }, 'Carregando endereço…');
  const version = h('p', { id: 'settings-version' }, 'Atlas …');
  clear(target,
    group('Rede', [network, h('button', { class: 'btn secondary', type: 'button', onclick: () => loadNetwork(network).then(() => status('Endereços atualizados. O QR da prova usa o endereço atual.')).catch((error) => status(error.message)) }, 'Atualizar endereço e QR')]),
    group('Sobre', [version,
      h('a', { href: 'https://github.com/nabikendo/socrative-search-lab/releases' }, 'Changelog / versões'),
      h('a', { href: 'https://github.com/nabikendo/socrative-search-lab' }, 'Repositório GitHub')]));
  api('/api/version').then((info) => { version.textContent = `Atlas ${info.version}${info.desktop ? ' · aplicativo para computador' : ''}`; }).catch(() => { version.textContent = 'Atlas'; });
  await loadNetwork(network).catch((error) => status(error.message));
}

// Seções pesadas são carregadas só quando abertas (o painel do professor continua leve).
const renderers = {
  general: async (target) => clear(target, ...general.map(([title, fields]) => group(title, fields.map(setting)))),
  about: renderAbout,
  profiles: async (target) => (await import('./settings-profiles.js')).render(target, { status }),
  ai: async (target) => (await import('./settings-ai.js')).render(target, { status }),
  data: async (target) => (await import('./settings-data.js')).render(target, { status }),
  test: async (target) => (await import('./settings-testmode.js')).render(target, { status }),
};

export function mount(el) { root = el; }
export function deactivate() {}
// Permite que outras telas (ex.: Ajuda) abram as Configurações direto numa seção.
export function selectSection(id) { if (renderers[id]) current = id; }

async function showSection(id) {
  current = renderers[id] ? id : 'general';
  const ticket = ++navigation;
  for (const button of root.querySelectorAll('.settings-nav button')) {
    const active = button.dataset.section === current;
    button.setAttribute('aria-current', active ? 'page' : 'false');
    button.classList.toggle('active', active);
    // No celular a navegação vira uma faixa rolável: mantém a seção escolhida à vista.
    if (active) button.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
  const target = h('div', { class: 'stack-s settings-section', dataset: { section: current } }, h('p', { class: 'caption' }, 'Carregando…'));
  clear(panel, target);
  try { await renderers[current](target); }
  catch (error) { if (ticket === navigation) clear(target, notice(error.message, 'danger')); }
}

function render() {
  const nav = h('nav', { class: 'settings-nav', 'aria-label': 'Seções das configurações' },
    sections.map(([id, label]) => h('button', { type: 'button', dataset: { section: id }, onclick: () => { status(''); showSection(id); } }, label)));
  panel = h('div', { class: 'settings-panel', id: 'settings-panel' });
  clear(root,
    h('h1', { class: 'title-m' }, 'Configurações'),
    h('p', { id: 'settings-status', role: 'status', class: 'caption' }, 'Alterações são salvas automaticamente.'),
    h('div', { class: 'settings-layout' }, nav, panel));
  return showSection(current);
}

export async function activate() {
  try {
    preferences = await api('/api/teacher-settings');
    // As preferências do servidor são a referência do perfil do professor.
    setAppearance(Object.fromEntries([...appearanceKeys].map((key) => [key, preferences[key]])));
    await render();
  } catch (error) { clear(root, h('p', { class: 'error', role: 'alert' }, error.message)); }
}
