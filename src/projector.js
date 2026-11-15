import { api } from './lib/api.js';
import { h, clear } from './lib/dom.js';
import { applySavedTheme, getAppearance, setAppearance } from './lib/theme.js';

applySavedTheme();
const presentationButton = document.getElementById('presentation-toggle');
const updatePresentation = () => presentationButton.setAttribute('aria-pressed', String(getAppearance().presentation));
presentationButton.addEventListener('click', () => { setAppearance({ presentation: !getAppearance().presentation }); updatePresentation(); });
updatePresentation();
const examId = new URLSearchParams(location.search).get('exam');
const $ = (id) => document.getElementById(id);
const timer = setInterval(refresh, 3000);
window.addEventListener('pagehide', () => clearInterval(timer), { once: true });

async function refresh() {
  if (!examId) { $('error').textContent = 'Abra o modo projetor pelo painel do professor.'; return; }
  try {
    const data = await api(`/api/exams/${encodeURIComponent(examId)}/projector`);
    $('error').textContent = '';
    $('title').textContent = data.title;
    $('status').textContent = data.status === 'open' ? 'Prova em andamento' : data.status === 'scheduled' ? `Agendada para ${new Date(data.scheduledStart).toLocaleString('pt-BR')}` : 'Prova encerrada';
    $('code').textContent = data.code || '';
    $('started').textContent = `${data.started}/${data.total}`;
    $('online').textContent = String(data.online);
    $('submitted').textContent = `${data.submitted}/${data.total}`;
    $('waiting').textContent = String(Math.max(0, data.total - data.started));
    clear($('questions'), ...data.questions.map((q) => {
      const pct = q.total ? Math.round(q.answered / q.total * 100) : 0;
      return h('article', { class:'projector-question' },
        h('div', { class:'row between' }, h('strong', {}, `Questão ${q.index}`), h('span', {}, `${q.answered}/${q.total} responderam`)),
        h('div', { class:'progress', 'aria-label':`${pct}% responderam` }, h('div', { style:`width:${pct}%` })));
    }));
  } catch (error) { $('error').textContent = error.status === 401 ? 'Entre no painel do professor nesta janela para autorizar o modo projetor.' : error.message; }
}

refresh();
