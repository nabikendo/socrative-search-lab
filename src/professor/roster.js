import { api } from '../lib/api.js';
import { h, clear, toast, plural } from '../lib/dom.js';
import { parseRosterText } from '../../shared/roster.js';

let root;
const state = { roster: [], preview: null, error: '' };

export function mount(el) { root = el; render(); }
export async function activate() { state.roster = (await api('/api/roster')).roster; render(); }

async function readFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) { const { extractPdfText } = await import('./pdf-text.js'); return parseRosterText(await extractPdfText(file)); }
  if (name.endsWith('.xlsx')) return (await api('/api/roster/parse-xlsx', { method: 'POST', raw: file })).roster;
  return parseRosterText(await file.text());
}

function propose(rows) {
  state.error = rows.length ? '' : 'Não encontrei alunos. Use linhas como "3;Nome do aluno" ou uma planilha com número, nome e turma.';
  state.preview = rows.length ? rows : null;
  render();
}

async function commit() {
  const { count } = await api('/api/roster', { method: 'POST', body: { roster: state.preview } });
  state.roster = (await api('/api/roster')).roster;
  state.preview = null;
  render();
  toast(`${plural(count, 'aluno salvo', 'alunos salvos')}`);
}

function studentList(rows, limit) {
  const shown = limit ? rows.slice(0, limit) : rows;
  return h('div', { class: 'list' },
    shown.map((s) => h('div', { class: 'list-row' }, h('span', { class: 'num' }, s.number), h('span', { class: 'grow' }, s.name), s.className && h('span', { class: 'meta' }, s.className))),
    limit && rows.length > limit && h('div', { class: 'list-row meta' }, `e mais ${rows.length - limit}…`));
}

function render() {
  const textarea = h('textarea', { placeholder: '3;Nome do aluno\n5;Outro aluno', 'aria-label': 'Colar lista de alunos' });
  const picker = h('input', { type: 'file', accept: '.pdf,.csv,.txt,.xlsx', id: 'roster-file', onchange: async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try { propose(await readFile(file)); } catch (error) { state.error = error.message || 'Não consegui ler este arquivo.'; render(); }
  } });

  clear(root, h('div', { class: 'stack' },
    h('div', { class: 'stack-s' },
      h('h1', { class: 'title' }, 'Turma'),
      h('p', { class: 'lead' }, state.roster.length ? `${plural(state.roster.length, 'aluno cadastrado', 'alunos cadastrados')}.` : 'Importe a lista de frequência para começar.')),

    !state.roster.length && !state.preview && h('ol', { class: 'steps' },
      step('1', 'Importe a lista de alunos', 'PDF do diário, planilha ou texto. É só uma vez por turma.'),
      step('2', 'Crie a prova', 'Na aba Prova: escreva as questões e marque a resposta certa.'),
      step('3', 'Abra para os alunos', 'Mostre o código e o QR Code. Acompanhe tudo na aba Resultados.')),

    state.preview
      ? h('div', { class: 'stack-s' },
        h('h2', { class: 'headline' }, `${plural(state.preview.length, 'aluno encontrado', 'alunos encontrados')}`),
        studentList(state.preview, 8),
        h('p', { class: 'caption' }, state.roster.length ? 'Ao importar, a lista atual será substituída.' : 'Confira se os números e nomes estão corretos.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => commit().catch((e) => { state.error = e.message; render(); }) }, `Importar ${state.preview.length}`),
          h('button', { class: 'btn secondary', onclick: () => { state.preview = null; render(); } }, 'Cancelar')))
      : h('div', { class: 'card stack-s' },
        h('h2', { class: 'headline' }, 'Importar lista'),
        h('p', { class: 'sub' }, 'PDF do diário de classe, planilha XLSX, CSV ou texto. O arquivo é lido neste computador e nunca sai da rede local.'),
        h('div', { class: 'row' }, picker, h('label', { class: 'btn', for: 'roster-file' }, 'Escolher arquivo')),
        h('details', {}, h('summary', { class: 'caption', style: 'cursor:pointer' }, 'Ou cole a lista'),
          h('div', { class: 'stack-s', style: 'margin-top:12px' }, textarea, h('div', {}, h('button', { class: 'btn secondary', onclick: () => propose(parseRosterText(textarea.value)) }, 'Ler lista')))),
        state.error && h('p', { class: 'error', role: 'alert' }, state.error)),

    state.roster.length > 0 && !state.preview && h('div', { class: 'stack-s' }, h('h2', { class: 'headline' }, 'Lista atual'), studentList(state.roster))));
}

const step = (n, title, text) => h('li', { class: 'step' }, h('span', { class: 'step-n' }, n), h('div', {}, h('div', { class: 'headline', style: 'font-size:17px' }, title), h('div', { class: 'sub' }, text)));
