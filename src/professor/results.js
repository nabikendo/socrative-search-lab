import { api } from '../lib/api.js';
import { h, clear, toast, plural, formatScore } from '../lib/dom.js';

let root;
let timer;
const state = { exams: [], examId: null, data: null, open: new Set() };

export function mount(el) { root = el; }
export async function activate() {
  state.exams = (await api('/api/exams')).exams;
  state.examId = state.exams.some((e) => e.id === state.examId) ? state.examId : (state.exams.find((e) => e.status === 'open') || state.exams[0])?.id ?? null;
  await refresh(true);
  timer = setInterval(() => refresh(false), 4000);
}
export function deactivate() { clearInterval(timer); }

async function refresh(force) {
  if (!state.examId) { state.data = null; render(); return; }
  // não redesenha enquanto o professor digita uma nota
  if (!force && root.contains(document.activeElement) && document.activeElement.matches('input')) return;
  try { state.data = await api(`/api/exams/${state.examId}/results`); render(); } catch { /* o aviso de login é tratado globalmente */ }
}

const badge = (r) => r.status === 'submitted' ? h('span', { class: 'badge ok' }, 'Enviada')
  : r.online ? h('span', { class: 'badge' }, h('span', { class: 'dot', style: 'color:var(--ok)' }), 'Online')
  : h('span', { class: 'badge warn' }, 'Desconectado');

function render() {
  const d = state.data;
  clear(root, h('div', { class: 'stack' },
    h('div', { class: 'row between' },
      h('h1', { class: 'title' }, 'Resultados'),
      state.exams.length > 0 && h('select', { 'aria-label': 'Escolher prova', style: 'width:auto;max-width:280px', onchange: (e) => { state.examId = e.target.value; state.open.clear(); refresh(true); } },
        state.exams.map((e) => h('option', { value: e.id, selected: e.id === state.examId }, e.title)))),
    !d ? h('p', { class: 'lead' }, 'Crie e abra uma prova para acompanhar as respostas aqui.')
      : [summary(d), d.results.length ? h('div', { class: 'list' }, d.results.map((r) => row(r, d.exam))) : h('p', { class: 'sub' }, d.exam.status === 'open' ? 'Aguardando os alunos entrarem…' : 'Nenhum aluno respondeu esta prova.')]));
}

function summary(d) {
  const sent = d.results.filter((r) => r.status === 'submitted').length;
  return h('div', { class: 'row between' },
    h('p', { class: 'lead' }, `${sent} de ${d.results.length} enviadas`),
    h('a', { class: 'btn secondary', href: `/api/exams/${d.exam.id}/export.csv` }, 'Baixar planilha'));
}

function row(r, exam) {
  const open = state.open.has(r.sessionId);
  const head = h('button', { class: 'list-row clickable', 'aria-expanded': String(open), onclick: () => { open ? state.open.delete(r.sessionId) : state.open.add(r.sessionId); render(); } },
    h('span', { class: 'num' }, r.number),
    h('span', { class: 'grow' }, h('div', {}, r.name), h('div', { class: 'caption' }, `${r.answered}/${r.total} respondidas${r.className ? ' · ' + r.className : ''}`)),
    badge(r),
    h('span', { class: 'score', style: 'min-width:72px;text-align:right' }, `${formatScore(r.score)}/${formatScore(r.max)}`, r.pending ? h('div', { class: 'caption' }, `${r.pending} a corrigir`) : null));
  if (!open) return h('div', {}, head);
  return h('div', {}, head,
    exam.questions.map((q, i) => {
      const answer = r.answers[q.id];
      const auto = q.type === 'choice' && q.correct;
      return h('div', { class: 'answer-block' },
        h('div', { class: 'q' }, `${i + 1}. ${q.text}`),
        h('div', { class: answer ? 'a' : 'a empty' }, answer || 'Sem resposta'),
        auto ? h('div', { class: 'caption' }, answer === q.correct ? '✓ Correta' : `✗ Correta: ${q.correct}`)
          : h('label', { class: 'row caption' }, 'Nota (0 a ' + formatScore(q.weight) + ')',
            h('input', { class: 'grade-input', type: 'number', min: '0', max: String(q.weight), step: '0.25', value: r.grades[q.id] ?? '', onchange: (e) => grade(r.sessionId, q.id, e.target.value) })));
    }),
    r.status === 'submitted' && h('div', { class: 'answer-block' }, h('div', {}, h('button', { class: 'btn quiet', onclick: async () => { await api(`/api/sessions/${r.sessionId}/reopen`, { method: 'POST' }); toast('Envio reaberto'); refresh(true); } }, 'Reabrir para o aluno'))));
}

async function grade(sessionId, questionId, value) {
  try { await api('/api/grade', { method: 'POST', body: { sessionId, questionId, score: value === '' ? null : value } }); toast('Nota salva'); }
  catch (error) { toast(error.message); }
  refresh(true);
}
