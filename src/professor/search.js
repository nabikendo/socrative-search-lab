import { api } from '../lib/api.js';
import { h, clear } from '../lib/dom.js';

// Busca global (atalho "/"): abas, provas e alunos. Escolher um resultado abre a aba certa.
const TABS = [['inicio', 'Início'], ['turma', 'Turma e alunos'], ['prova', 'Provas'], ['banco', 'Banco de questões'], ['descritores', 'Descritores'], ['resultados', 'Resultados'], ['ajuda', 'Ajuda'], ['configuracoes', 'Configurações']];
const norm = (text) => String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const goto = (tab, examId) => {
  if (examId) { try { sessionStorage.setItem(tab === 'resultados' ? 'atlas.resultsExam' : 'atlas.jumpExam', examId); } catch { /* sem armazenamento */ } }
  window.dispatchEvent(new CustomEvent('atlas:goto', { detail: tab }));
};

export function initSearch(trigger) {
  let data = null;
  const input = h('input', { type: 'search', placeholder: 'Buscar alunos, provas ou abas', 'aria-label': 'Buscar', autocomplete: 'off' });
  const list = h('div', { class: 'search-results', role: 'listbox' });
  const dialog = h('dialog', { class: 'search-dialog', 'aria-label': 'Busca' }, h('div', { class: 'search-box' }, input), list);
  document.body.append(dialog);
  let items = []; let index = 0;

  async function load() {
    const [{ exams }, { classes }] = await Promise.all([api('/api/exams'), api('/api/classes')]);
    const rosters = await Promise.all(classes.map((c) => api(`/api/classes/${encodeURIComponent(c.id)}/roster`).then((r) => r.roster.map((s) => ({ ...s, className: c.name }))).catch(() => [])));
    data = { exams, students: rosters.flat() };
  }
  function draw() {
    const q = norm(input.value.trim());
    const match = (text) => !q || norm(text).includes(q);
    items = [
      ...TABS.filter(([, label]) => match(label)).map(([tab, label]) => ({ kind: 'Aba', label, run: () => goto(tab) })),
      ...(data?.exams ?? []).filter((e) => q && match(e.title)).slice(0, 8).map((e) => ({ kind: 'Prova', label: e.title, run: () => goto(e.status === 'draft' ? 'prova' : 'resultados', e.id) })),
      ...(data?.students ?? []).filter((s) => q && (match(s.name) || s.number === q)).slice(0, 8).map((s) => ({ kind: s.className, label: `${s.number} · ${s.name}`, run: () => goto('turma') })),
    ];
    index = Math.min(index, Math.max(0, items.length - 1));
    clear(list, items.length ? items.map((item, i) => h('button', { type: 'button', role: 'option', class: 'search-item', 'aria-selected': String(i === index), onclick: () => choose(i) },
      h('span', { class: 'search-kind' }, item.kind), h('span', {}, item.label))) : h('p', { class: 'caption' }, 'Nada encontrado.'));
  }
  function choose(i) { const item = items[i]; if (!item) return; dialog.close(); item.run(); }
  async function open() {
    input.value = ''; index = 0; draw(); dialog.showModal(); input.focus();
    try { await load(); draw(); } catch { /* sem dados: busca só nas abas */ }
  }
  input.addEventListener('input', () => { index = 0; draw(); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { index = Math.min(items.length - 1, index + 1); draw(); event.preventDefault(); }
    else if (event.key === 'ArrowUp') { index = Math.max(0, index - 1); draw(); event.preventDefault(); }
    else if (event.key === 'Enter') { event.preventDefault(); choose(index); }
  });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  trigger.addEventListener('click', open);
  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || dialog.open || document.getElementById('app')?.hidden) return;
    const tag = document.activeElement?.tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || document.activeElement?.isContentEditable) return;
    event.preventDefault(); open();
  });
}
