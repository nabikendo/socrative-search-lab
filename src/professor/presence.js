import { api } from '../lib/api.js';
import { h, clear, toast } from '../lib/dom.js';
import { confirmAction } from '../lib/confirm.js';

// Painel de presença em tempo real (Sprint 2). Recebe atualizações por Server-Sent Events: o servidor empurra
// um retrato da turma sempre que alguém entra, sai, envia, pede ajuda ou tenta entrar em outro aparelho.
// Decisão de UX: quem fecha a página continua em "Entraram", marcado como "Saiu" (amarelo), porque esteve presente;
// não volta para "Não entraram". Sai em até 30 s sem sinal, ou na hora quando o navegador avisa o fechamento.
const STATE = {
  online: { label: 'Em prova', cls: 'ok', icon: '●' },
  submitted: { label: 'Enviou', cls: 'ok', icon: '✓' },
  left: { label: 'Saiu', cls: 'warn', icon: '!' },
  absent: { label: 'Não entrou', cls: 'danger', icon: '○' },
};
const EVENTS = {
  entered: 'Entrou', returned: 'Voltou', left: 'Saiu', submitted: 'Enviou a prova', device_released: 'Dispositivo liberado',
  device_rebound: 'Entrou em outro aparelho (liberado)', device_conflict: 'Tentou entrar em outro aparelho', help: 'Pediu ajuda', help_answered: 'Ajuda atendida',
};
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—');
const norm = (text) => String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function createPresencePanel() {
  const state = { examId: null, data: null, query: '', filter: 'all', connected: false, source: null, poll: null, logOpen: false };
  const el = h('section', { class: 'card stack-s presence-panel', 'aria-label': 'Presença na prova' });
  const search = h('input', { type: 'search', placeholder: 'Buscar aluno pelo nome ou número', 'aria-label': 'Buscar aluno', autocomplete: 'off' });
  search.addEventListener('input', () => { state.query = search.value; draw(); });

  function connect() {
    disconnect();
    if (!state.examId) return;
    const url = `/api/exams/${encodeURIComponent(state.examId)}/presence`;
    if ('EventSource' in window) {
      const source = new EventSource(`${url}/stream`);
      source.addEventListener('presence', (event) => { state.connected = true; try { state.data = JSON.parse(event.data); } catch { return; } draw(); });
      source.addEventListener('open', () => { state.connected = true; draw(); });
      source.addEventListener('error', () => { state.connected = false; draw(); }); // o navegador reconecta sozinho
      state.source = source;
    } else {
      const load = () => api(url).then((data) => { state.data = data; state.connected = true; draw(); }).catch(() => { state.connected = false; draw(); });
      load(); state.poll = setInterval(load, 4000);
    }
  }
  function disconnect() { state.source?.close(); state.source = null; clearInterval(state.poll); state.poll = null; state.connected = false; }

  async function release(student) {
    const { confirmed } = await confirmAction({
      title: `Liberar o dispositivo de ${student.name}?`,
      lead: 'O aparelho atual perde o acesso. O próximo aparelho em que o aluno entrar com o número nº ' + student.number + ' fica vinculado. As respostas já salvas são mantidas.',
      confirmLabel: 'Liberar dispositivo',
    });
    if (!confirmed) return;
    try { await api(`/api/sessions/${student.sessionId}/release-device`, { method: 'POST' }); toast('Dispositivo liberado. Peça ao aluno para entrar de novo com o número.'); }
    catch (error) { toast(error.message); }
  }
  async function answerHelp(student) {
    try { await api(`/api/sessions/${student.sessionId}/help/answer`, { method: 'POST' }); } catch (error) { toast(error.message); }
  }

  function studentRow(student) {
    const info = STATE[student.state];
    const details = student.state === 'absent' ? [] : [
      `entrou ${time(student.enteredAt)}`,
      student.state === 'submitted' ? `enviou ${time(student.submittedAt)}` : student.state === 'left' ? `último sinal ${time(student.lastSeenAt)}` : null,
      student.device || null, student.ip || null,
    ].filter(Boolean);
    return h('div', { class: `list-row presence-row ${student.state}`, dataset: { number: student.number } },
      h('span', { class: 'num' }, student.number),
      h('div', { class: 'grow' },
        h('div', {}, h('strong', {}, student.name || 'Sem nome'), student.outsideRoster ? h('span', { class: 'badge' }, 'fora da lista') : null),
        details.length ? h('div', { class: 'meta' }, details.join(' · ')) : null),
      student.help ? h('span', { class: 'badge warn presence-help' }, '✋ ajuda') : null,
      student.conflicts ? h('span', { class: 'badge danger', title: 'Tentativas de entrar em outro aparelho' }, `2 aparelhos ×${student.conflicts}`) : null,
      student.away ? h('span', { class: 'badge warn' }, 'fora da página') : null,
      h('span', { class: `badge ${info.cls}` }, `${info.icon} ${info.label}`),
      student.sessionId && student.state !== 'submitted' ? h('button', { class: 'btn quiet sm', type: 'button', onclick: () => release(student) }, 'Liberar dispositivo') : null);
  }

  function alerts(data) {
    const help = data.students.filter((s) => s.help);
    const conflict = data.students.filter((s) => s.conflicts && s.state !== 'submitted');
    if (!help.length && !conflict.length) return null;
    return h('div', { class: 'stack-s presence-alerts', role: 'status', 'aria-live': 'polite' },
      ...help.map((s) => h('div', { class: 'notice warn row between' }, h('span', {}, `✋ ${s.name} (nº ${s.number}) pediu ajuda às ${time(s.help)}`),
        h('button', { class: 'btn sm', type: 'button', onclick: () => answerHelp(s) }, 'Atendido'))),
      ...conflict.map((s) => h('div', { class: 'notice danger row between' }, h('span', {}, `⚠ ${s.name} (nº ${s.number}): tentativa de entrar em outro aparelho. Se ele trocou de aparelho, libere o dispositivo.`),
        h('button', { class: 'btn sm secondary', type: 'button', onclick: () => release(s) }, 'Liberar dispositivo'))));
  }

  function auditLog(data) {
    const details = h('details', { class: 'presence-log', open: state.logOpen, ontoggle: (event) => { state.logOpen = event.target.open; } },
      h('summary', {}, `Registro de auditoria (${data.audit.length})`),
      data.audit.length ? h('div', { class: 'presence-log-table', role: 'table' },
        h('div', { class: 'presence-log-row head', role: 'row' }, ['Hora', 'Aluno', 'Evento', 'IP', 'Aparelho'].map((label) => h('span', { role: 'columnheader' }, label))),
        data.audit.map((entry) => h('div', { class: 'presence-log-row', role: 'row' },
          h('span', {}, new Date(entry.at).toLocaleTimeString('pt-BR')),
          h('span', {}, `${entry.number ?? ''} ${entry.name ?? ''}`.trim()),
          h('span', {}, (EVENTS[entry.event] ?? entry.event) + (entry.reason ? ` (${entry.reason})` : '')),
          h('span', {}, entry.ip ?? ''),
          h('span', {}, entry.device ?? '')))) : h('p', { class: 'caption' }, 'Nada registrado ainda.'));
    return details;
  }

  function draw() {
    const data = state.data;
    if (!data) { clear(el, h('h2', { class: 'headline' }, 'Presença'), h('p', { class: 'caption' }, state.examId ? 'Conectando…' : 'Escolha uma prova.')); return; }
    const query = norm(state.query);
    const visible = data.students.filter((s) => !query || norm(s.name).includes(query) || s.number === state.query.trim());
    const entered = visible.filter((s) => s.state !== 'absent');
    const absent = visible.filter((s) => s.state === 'absent');
    const { counts } = data;
    const pct = counts.total ? Math.round((counts.entered / counts.total) * 100) : 0;
    const filter = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Mostrar' }, [['all', 'Todos'], ['in', 'Entraram'], ['out', 'Não entraram']].map(([id, label]) =>
      h('button', { type: 'button', 'aria-pressed': String(state.filter === id), onclick: () => { state.filter = id; draw(); } }, label)));
    const column = (title, list, cls, empty) => h('div', { class: `presence-col ${cls}` },
      h('h3', { class: 'headline' }, `${title} (${list.length})`),
      list.length ? h('div', { class: 'list' }, list.map(studentRow)) : h('p', { class: 'caption' }, empty));
    clear(el,
      h('div', { class: 'row between' },
        h('div', {}, h('h2', { class: 'headline' }, 'Presença'),
          h('p', { class: 'presence-counter', 'aria-live': 'polite' }, h('strong', {}, `${counts.entered} de ${counts.total}`), ' alunos entraram')),
        h('div', { class: 'row' },
          h('span', { class: `badge ${state.connected ? 'ok' : 'warn'}` }, state.connected ? '● Ao vivo' : 'Reconectando…'),
          h('a', { class: 'btn secondary sm', href: `/api/exams/${encodeURIComponent(data.exam.id)}/presence.csv` }, 'Exportar chamada'))),
      h('div', { class: 'progress', 'aria-hidden': 'true' }, h('div', { style: `width:${pct}%` })),
      h('div', { class: 'row presence-chips' },
        h('span', { class: 'badge ok' }, `● Em prova ${counts.online}`), h('span', { class: 'badge ok' }, `✓ Enviaram ${counts.submitted}`),
        h('span', { class: 'badge warn' }, `! Saíram ${counts.left}`), h('span', { class: 'badge danger' }, `○ Não entraram ${counts.absent}`)),
      alerts(data),
      // o mesmo campo de busca é reaproveitado: não perde o que foi digitado a cada atualização
      h('div', { class: 'row presence-tools' }, search, filter),
      h('div', { class: `presence-cols filter-${state.filter}` },
        state.filter !== 'out' ? column('Entraram', entered, 'in', query ? 'Ninguém encontrado.' : 'Ninguém entrou ainda.') : null,
        state.filter !== 'in' ? column('Não entraram', absent, 'out', query ? 'Ninguém encontrado.' : 'Todos entraram.') : null),
      h('p', { class: 'caption' }, 'Quem fecha a página aparece como “Saiu” (em até 30 s) e continua contando como presente. “Liberar dispositivo” permite trocar de aparelho sem perder respostas.'),
      auditLog(data));
  }

  return {
    el,
    setExam(examId) { if (examId === state.examId) return; state.examId = examId; state.data = null; draw(); connect(); },
    stop: disconnect,
    resume() { if (state.examId && !state.source && !state.poll) connect(); },
  };
}
