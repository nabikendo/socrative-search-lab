import { api } from './lib/api.js';
import { $, h, clear } from './lib/dom.js';
import { initializeThemeButton } from './lib/theme.js';

initializeThemeButton();

const row = (state, title, text) => h('div', { class: `check ${state}` },
  h('span', { class: 'check-dot', 'aria-hidden': 'true' }),
  h('div', {}, h('div', { class: 'check-title' }, title), text && h('div', { class: 'caption' }, text)));

async function ping() {
  const start = performance.now();
  try {
    const response = await fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;
    return performance.now() - start;
  } catch { return null; }
}

function storageWorks() {
  try { localStorage.setItem('atlas.teste', '1'); localStorage.removeItem('atlas.teste'); return true; } catch { return false; }
}

async function run() {
  const box = $('#result');
  $('#again').disabled = true;
  clear(box, h('p', { class: 'caption' }, 'Testando…'));
  const times = [];
  let failed = 0;
  for (let i = 0; i < 6; i++) {
    const time = await ping();
    if (time === null) failed++; else times.push(time);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const rows = [];
  if (!times.length) {
    rows.push(row('bad', 'Sem conexão com o professor', 'Confira se o Wi‑Fi é o da sala e se o endereço está certo. Avise o professor.'));
  } else if (failed >= 2 || [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)] > 800) {
    rows.push(row('warn', 'Conexão instável', 'Funciona, mas pode falhar. Chegue mais perto do roteador ou avise o professor. Suas respostas ficam salvas no aparelho enquanto a rede volta.'));
  } else {
    const average = Math.round(times.reduce((sum, value) => sum + value, 0) / times.length);
    rows.push(row('ok', 'Conectado ao professor', `Resposta média: ${average} ms.`));
  }
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    rows.push(row('warn', 'Você está no computador do professor', 'Os alunos devem usar o endereço com números (192.168…) mostrado na tela da sala.'));
  }
  rows.push(storageWorks()
    ? row('ok', 'Salvamento no aparelho disponível')
    : row('bad', 'Este navegador não consegue guardar respostas', 'Saia do modo anônimo ou use outro navegador.'));
  if (times.length) {
    try {
      const { exam } = await api('/api/open-exam');
      rows.push(exam
        ? row('ok', exam.paused ? 'Prova pausada pelo professor' : 'Há uma prova aberta', exam.title)
        : row('warn', 'Nenhuma prova aberta ainda', 'Aguarde o professor abrir. Esta página já avisou a ele que seu aparelho está conectado.'));
    } catch { /* a conexão já foi avaliada acima */ }
  }
  clear(box, ...rows);
  $('#again').disabled = false;
}

$('#again').addEventListener('click', run);
run();
