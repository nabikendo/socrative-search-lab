import { api } from '../lib/api.js';
import { h, clear, toast, plural } from '../lib/dom.js';
import { parseRosterTextDetailed } from '../../shared/roster.js';

let root;
const state = { roster: [], classes: [], classId: '', className: '', preview: null, duplicates: [], error: '' };

export function mount(el) { root = el; render(); }
export async function activate() {
  state.classes = (await api('/api/classes')).classes;
  if (!state.classId && state.classes.length) state.classId = state.classes[0].id;
  await loadClassRoster(); render();
}
async function loadClassRoster() { state.roster = state.classId ? (await api(`/api/classes/${state.classId}/roster`)).roster : (await api('/api/roster')).roster; }

async function readFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) { const { extractPdfText } = await import('./pdf-text.js'); return parseRosterTextDetailed(await extractPdfText(file)); }
  if (name.endsWith('.xlsx')) { const parsed = await api('/api/roster/parse-xlsx', { method: 'POST', raw: file }); return { rows: parsed.roster, duplicates: parsed.duplicates || [] }; }
  return parseRosterTextDetailed(await file.text());
}

function propose(result) {
  const { rows, duplicates = [] } = Array.isArray(result) ? { rows: result } : result;
  state.error = rows.length ? '' : 'Não encontrei alunos. Use linhas como "3;Nome do aluno" ou uma planilha com número, nome e turma.';
  state.preview = rows.length ? rows : null;
  state.duplicates = duplicates;
  if (rows.length) {
    const detected = [...new Set(rows.map((r) => r.className).filter(Boolean))][0];
    if (detected) setTargetClassName(detected);
  }
  render();
}

function setTargetClassName(name) {
  state.className = name;
  state.classId = state.classes.find((c) => c.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase())?.id || '';
}

function previewClass(rows) {
  const classes = [...new Set(rows.map((row) => row.className).filter(Boolean))];
  return classes.length ? h('p', { class: 'notice' }, `Turma identificada: ${classes.join(', ')}`) : null;
}

async function commit() {
  const name = state.className.trim();
  if (!name) throw new Error('Informe ou confirme o nome da turma antes de importar.');
  const saved = await api('/api/classes', { method: 'POST', body: { id: state.classId || undefined, name, roster: state.preview } });
  state.classId = saved.class.id;
  state.className = saved.class.name;
  state.classes = (await api('/api/classes')).classes;
  await loadClassRoster();
  state.preview = null;
  render();
  toast(`${plural(state.roster.length, 'aluno salvo', 'alunos salvos')} na turma ${name}`);
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
      state.classes.length > 0 && h('label', { class: 'field' }, h('span', {}, 'Turmas salvas'), h('select', { value: state.classId, onchange: async (e) => { state.classId = e.target.value; state.className = state.classes.find((c) => c.id === state.classId)?.name || ''; await loadClassRoster(); render(); } }, state.classes.map((c) => h('option', { value: c.id }, `${c.name} · ${c.students} alunos`)))),
      h('p', { class: 'lead' }, state.roster.length ? `${plural(state.roster.length, 'aluno cadastrado', 'alunos cadastrados')}${state.className ? ` em ${state.className}` : ''}.` : 'Importe a lista de frequência para começar.')),

    !state.roster.length && !state.preview && h('ol', { class: 'steps' },
      step('1', 'Importe a lista de alunos', 'PDF do diário, planilha ou texto. É só uma vez por turma.'),
      step('2', 'Crie a prova', 'Na aba Prova: escreva as questões e marque a resposta certa.'),
      step('3', 'Abra para os alunos', 'Mostre o código e o QR Code. Acompanhe tudo na aba Resultados.')),

    state.preview
      ? h('div', { class: 'stack-s' },
        h('h2', { class: 'headline' }, `${plural(state.preview.length, 'aluno encontrado', 'alunos encontrados')}`),
        previewClass(state.preview),
        state.duplicates.length > 0 && h('div', { class: 'notice warn' }, `${state.duplicates.length} números de chamada repetidos foram consolidados na prévia: ${state.duplicates.map((d) => `${d.number} (${d.count} ocorrências)`).join(', ')}. Confira os nomes antes de importar.`),
        h('label', { class: 'field' }, h('span', {}, 'Nome da turma'), h('input', { value: state.className, placeholder: 'Ex.: 13.01 / 1ª série', oninput: (e) => setTargetClassName(e.target.value) })),
        studentList(state.preview, 8),
        h('p', { class: 'caption' }, 'A lista será salva separadamente; as outras turmas e o histórico das provas serão preservados.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => commit().catch((e) => { state.error = e.message; render(); }) }, `Importar ${state.preview.length}`),
          h('button', { class: 'btn secondary', onclick: () => { state.preview = null; state.duplicates = []; render(); } }, 'Cancelar')))
      : h('div', { class: 'card stack-s' },
        h('h2', { class: 'headline' }, 'Importar lista'),
        h('p', { class: 'sub' }, 'PDF do diário de classe, planilha XLSX, CSV ou texto. O arquivo é lido neste computador e nunca sai da rede local.'),
        h('label', { class: 'field' }, h('span', {}, 'Nome da turma'), h('input', { value: state.className, placeholder: 'Será identificado no Diário de Classe quando possível', oninput: (e) => setTargetClassName(e.target.value) })),
        h('div', { class: 'row' }, picker, h('label', { class: 'btn', for: 'roster-file' }, 'Escolher arquivo')),
        h('details', {}, h('summary', { class: 'caption', style: 'cursor:pointer' }, 'Ou cole a lista'),
          h('div', { class: 'stack-s', style: 'margin-top:12px' }, textarea, h('div', {}, h('button', { class: 'btn secondary', onclick: () => propose(parseRosterTextDetailed(textarea.value)) }, 'Ler lista')))),
        state.error && h('p', { class: 'error', role: 'alert' }, state.error)),

    state.roster.length > 0 && !state.preview && h('div', { class: 'stack-s' }, h('h2', { class: 'headline' }, 'Lista atual'), studentList(state.roster))));
}

const step = (n, title, text) => h('li', { class: 'step' }, h('span', { class: 'step-n' }, n), h('div', {}, h('div', { class: 'headline', style: 'font-size:17px' }, title), h('div', { class: 'sub' }, text)));

