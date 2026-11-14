import { api } from '../lib/api.js';
import { h, clear, toast, plural, formatScore } from '../lib/dom.js';
import { skillLabel } from '../../shared/skills.js';

let root;
let timer;
const state = { exams: [], examId: null, data: null, sig: '', open: new Set() };

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
  try {
    const next = await api(`/api/exams/${state.examId}/results`);
    const sig = JSON.stringify(next);
    if (!force && sig === state.sig) return;
    state.sig = sig; state.data = next; render();
  } catch { /* o aviso de login é tratado globalmente */ }
}

const badge = (r) => r.status === 'submitted' ? h('span', { class: 'badge ok' }, 'Enviada')
  : r.online ? h('span', { class: 'badge' }, h('span', { class: 'dot', style: 'color:var(--ok)' }), 'Online')
  : h('span', { class: 'badge warn' }, 'Desconectado');

function render() {
  const d = state.data;
  clear(root, h('div', { class: 'stack' },
    h('div', { class: 'row between' },
      h('h1', { class: 'title' }, 'Resultados'),
      state.exams.length > 0 && h('select', { 'aria-label': 'Escolher prova', style: 'width:auto;max-width:280px', onchange: (e) => { state.examId = e.target.value; state.open.clear(); state.sig = ''; refresh(true); } },
        state.exams.map((e) => h('option', { value: e.id, selected: e.id === state.examId }, e.title)))),
    !d ? h('p', { class: 'lead' }, 'Crie e abra uma prova para acompanhar as respostas aqui.')
      : [summary(d), !d.exam.questions.length && h('div', { class: 'notice' }, 'Avaliação somente em PDF: o Atlas acompanha quem entregou, mas não calcula as notas desta prova.'), d.results.length ? stats(d) : null, d.results.length ? skillInsights(d) : null, d.results.length ? insights(d) : null, d.results.length ? h('div', { class: 'list' }, d.results.map((r) => row(r, d.exam))) : h('p', { class: 'sub' }, d.exam.status === 'open' ? 'Aguardando os alunos entrarem…' : 'Nenhum aluno respondeu esta prova.')]));
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
    h('span', { class: 'grow' }, h('div', {}, r.name), h('div', { class: 'caption' }, `${r.total ? `${r.answered}/${r.total} respondidas` : 'prova em PDF'}${r.className ? ' · ' + r.className : ''}`)),
    badge(r),
    h('span', { class: 'score', style: 'min-width:96px;text-align:right;white-space:nowrap' }, r.max ? `${formatScore(r.score)}/${formatScore(r.max)}` : 'PDF', r.pending ? h('div', { class: 'caption' }, `${r.pending} a corrigir`) : null));
  if (!open) return h('div', {}, head);
  return h('div', {}, head,
    h('a', { class: 'btn secondary', href: `/api/sessions/${r.sessionId}/report.pdf` }, 'Baixar relatório individual em PDF'),
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

function skillInsights(d) {
  const groups = new Map();
  for (const q of d.exam.questions) {
    if (!q.skill || q.type !== 'choice' || !q.correct) continue;
    const answers = d.results.map((r) => r.answers[q.id]).filter(Boolean);
    const item = groups.get(q.skill) || { total: 0, correct: 0 };
    item.total += answers.length;
    item.correct += answers.filter((a) => a === q.correct).length;
    groups.set(q.skill, item);
  }
  if (!groups.size) return null;
  return h('details', { class: 'card insights' }, h('summary', { class: 'headline' }, 'Relatório por habilidade SAEB'),
    h('div', { class: 'stack-s', style: 'margin-top:16px' }, [...groups].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', { numeric: true })).map(([skill, item]) => {
      const pct = item.total ? Math.round(item.correct / item.total * 100) : null;
      return h('div', { class: 'bar-row' }, h('div', { class: 'row between caption' }, h('strong', {}, skillLabel(skill) || skill), h('span', {}, pct === null ? 'Sem respostas' : `${pct}% · ${item.correct}/${item.total}`)), h('div', { class: 'progress' }, h('div', { style: `width:${pct || 0}%;background:${pct !== null && pct < 50 ? 'var(--warn)' : 'var(--ok)'}` })));
    })));
}

async function grade(sessionId, questionId, value) {
  try { await api('/api/grade', { method: 'POST', body: { sessionId, questionId, score: value === '' ? null : value } }); toast('Nota salva'); }
  catch (error) { toast(error.message); }
  refresh(true);
}

function stats(d) {
  const sent = d.results.filter((r) => r.status === 'submitted');
  const cell = (label, value, sub) => h('div', { class: 'stat' }, h('div', { class: 'caption' }, label), h('div', { class: 'stat-n' }, value), sub && h('div', { class: 'caption' }, sub));
  if (!d.exam.questions.length) return h('div', { class: 'stats' },
    cell('Enviadas', `${sent.length}/${d.results.length}`),
    cell('Online agora', String(d.results.filter((r) => r.online).length)),
    cell('Formato', 'PDF', 'correção fora do Atlas'));
  const ratio = (r) => (r.max ? r.score / r.max : 0);
  const avg = sent.length ? sent.reduce((t, r) => t + ratio(r), 0) / sent.length : null;
  const max = d.results[0]?.max ?? 0;
  return h('div', { class: 'stats' },
    cell('Enviadas', `${sent.length}/${d.results.length}`),
    cell('Online agora', String(d.results.filter((r) => r.online).length)),
    cell('Média', avg === null ? '—' : formatScore(Math.round(avg * max * 100) / 100), avg === null ? 'aguardando envios' : `de ${formatScore(max)} · ${Math.round(avg * 100)}%`));
}

// Acerto por questão (só para as que têm gabarito): mostra o que a turma não aprendeu.
function insights(d) {
  const rows = d.exam.questions.map((q, i) => ({ q, i })).filter(({ q }) => q.type === 'choice' && q.correct).map(({ q, i }) => {
    const given = d.results.map((r) => r.answers[q.id]).filter(Boolean);
    const right = given.filter((a) => a === q.correct).length;
    const wrong = {};
    for (const a of given) if (a !== q.correct) wrong[a] = (wrong[a] || 0) + 1;
    const top = Object.entries(wrong).sort((a, b) => b[1] - a[1])[0];
    return { i, q, total: given.length, pct: given.length ? Math.round((right / given.length) * 100) : null, top };
  });
  if (!rows.length || !rows.some((r) => r.total)) return null;
  return h('details', { class: 'card insights' },
    h('summary', { class: 'headline' }, 'Desempenho por questão'),
    h('div', { class: 'stack-s', style: 'margin-top:16px' }, rows.map(({ i, q, total, pct, top }) => h('div', { class: 'bar-row' },
      h('div', { class: 'row between caption' }, h('span', {}, `Q${i + 1} · ${q.text.length > 60 ? q.text.slice(0, 60) + '…' : q.text}`), h('span', { class: 'score' }, pct === null ? '—' : `${pct}%`)),
      h('div', { class: 'progress' }, h('div', { style: `width:${pct ?? 0}%;background:${pct !== null && pct < 50 ? 'var(--warn)' : 'var(--ok)'}` })),
      top && pct !== null && pct < 70 && h('div', { class: 'caption' }, `Erro mais comum: “${top[0]}” (${top[1]})`)))));
}

