import { api } from '../lib/api.js';
import { h, clear } from '../lib/dom.js';

// Aba Início: "seu dia, já preparado". Mostra a prova em andamento, números da turma e atalhos.
let root;
let timer;
const goto = (tab, examId) => {
  if (examId) { try { sessionStorage.setItem(tab === 'resultados' ? 'atlas.resultsExam' : 'atlas.jumpExam', examId); } catch { /* sem armazenamento */ } }
  window.dispatchEvent(new CustomEvent('atlas:goto', { detail: tab }));
};
const STATUS = { open: 'Aberta', paused: 'Pausada', closed: 'Encerrada', draft: 'Em elaboração', scheduled: 'Agendada' };
const greeting = () => { const hour = new Date().getHours(); return hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite'; };

export function mount(el) { root = el; }
export function deactivate() { clearInterval(timer); }
export async function activate() {
  await render();
  timer = setInterval(() => render().catch(() => {}), 8000);
}

function ring(value, total) {
  const pct = total ? Math.min(1, value / total) : 0;
  const r = 34; const c = 2 * Math.PI * r;
  const el = h('div', { class: 'ring', role: 'img', 'aria-label': `${value} de ${total} alunos entraram` });
  // SVG precisa do namespace próprio: montado por marcação com números calculados aqui (sem dados do usuário).
  el.innerHTML = `<svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="${r}" class="ring-track"/><circle cx="40" cy="40" r="${r}" class="ring-value" stroke-dasharray="${(c * pct).toFixed(1)} ${c.toFixed(1)}"/></svg>`;
  el.append(h('span', { class: 'ring-label' }, h('strong', {}, String(value)), h('small', {}, `de ${total}`)));
  return el;
}

function tile(label, value, sub, tone, onclick) {
  return h(onclick ? 'button' : 'div', { class: `mini-tile tone-${tone}`, type: onclick ? 'button' : undefined, onclick },
    h('span', { class: 'mini-label' }, label), h('strong', { class: 'mini-value' }, String(value)), sub ? h('span', { class: 'mini-sub' }, sub) : null);
}

async function render() {
  const [{ exams }, { classes }] = await Promise.all([api('/api/exams'), api('/api/classes')]);
  const live = exams.find((e) => e.status === 'open') || exams.find((e) => e.status === 'paused');
  const presence = live ? await api(`/api/exams/${encodeURIComponent(live.id)}/presence`).catch(() => null) : null;
  const students = classes.reduce((sum, item) => sum + (item.students || 0), 0);
  const drafts = exams.filter((e) => e.status === 'draft').length;
  const closed = exams.filter((e) => e.status === 'closed');
  const scheduled = exams.filter((e) => e.status === 'scheduled');

  const hero = live
    ? h('section', { class: 'hero-card live' },
      h('div', { class: 'hero-text' },
        h('span', { class: 'chip' }, live.status === 'paused' ? '⏸ Pausada' : '● Acontecendo agora'),
        h('h2', {}, live.title),
        h('p', { class: 'hero-sub' }, `Código ${live.accessCode ?? '—'} · ${live.questionCount} questões`),
        presence ? h('p', { class: 'hero-sub' }, h('strong', {}, `${presence.counts.entered} de ${presence.counts.total}`), ' alunos entraram',
          presence.counts.help ? ` · ✋ ${presence.counts.help} pedindo ajuda` : '') : null,
        h('div', { class: 'row hero-actions' },
          h('button', { class: 'btn pill', type: 'button', onclick: () => goto('resultados', live.id) }, 'Acompanhar ao vivo'),
          h('button', { class: 'btn pill ghost', type: 'button', onclick: () => goto('prova', live.id) }, 'Ver prova'))),
      presence ? ring(presence.counts.entered, presence.counts.total) : null)
    : h('section', { class: 'hero-card' },
      h('div', { class: 'hero-text' },
        h('span', { class: 'chip' }, scheduled.length ? `◷ ${scheduled.length} agendada(s)` : 'Nenhuma prova aberta'),
        h('h2', {}, drafts ? 'Continue de onde parou' : 'Crie a próxima avaliação'),
        h('p', { class: 'hero-sub' }, drafts ? `Você tem ${drafts} prova(s) em elaboração.` : 'Monte uma prova, abra para a turma e acompanhe ao vivo.'),
        h('div', { class: 'row hero-actions' },
          h('button', { class: 'btn pill', type: 'button', onclick: () => goto('prova') }, drafts ? 'Abrir provas' : 'Nova prova'),
          h('button', { class: 'btn pill ghost', type: 'button', onclick: () => goto('banco') }, 'Banco de questões'))),
      h('div', { class: 'hero-art', 'aria-hidden': 'true' }, '◇'));

  const recent = [...exams].sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))).slice(0, 6);
  clear(root, h('div', { class: 'home stack' },
    h('div', { class: 'home-hello' },
      h('p', { class: 'eyebrow' }, `${greeting()}, professor`),
      h('h2', { class: 'display' }, 'Seu dia, ', h('span', { class: 'accent-word' }, 'já'), ' preparado.')),
    h('div', { class: 'home-grid' },
      hero,
      h('section', { class: 'card stack-s' },
        h('div', { class: 'row between' }, h('h2', { class: 'headline' }, 'Resumo'), h('span', { class: 'caption' }, new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }))),
        h('div', { class: 'mini-grid' },
          tile('Turmas', classes.length, `${students} alunos`, 'blue', () => goto('turma')),
          tile('Provas', exams.length, `${closed.length} encerradas`, 'violet', () => goto('prova')),
          tile('Em elaboração', drafts, drafts ? 'rascunhos' : 'nenhum', 'yellow', () => goto('prova')),
          tile('Resultados', closed.length, 'para revisar', 'green', () => goto('resultados'))))),
    h('section', { class: 'card stack-s' },
      h('div', { class: 'row between' }, h('h2', { class: 'headline' }, 'Voltar para'), h('button', { class: 'btn quiet sm', type: 'button', onclick: () => goto('prova') }, 'Ver todas')),
      recent.length ? h('div', { class: 'jump-grid' }, recent.map((exam) => h('button', { class: `jump-card status-${exam.status}`, type: 'button', onclick: () => goto(exam.status === 'draft' ? 'prova' : 'resultados', exam.id) },
        h('span', { class: 'jump-status' }, STATUS[exam.status] ?? exam.status),
        h('strong', {}, exam.title),
        h('span', { class: 'caption' }, `${exam.questionCount} questões`))))
        : h('p', { class: 'caption' }, 'Suas provas aparecem aqui.'))));
}
