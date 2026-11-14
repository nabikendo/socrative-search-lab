import { api, ApiError } from './lib/api.js';
import { $, h, clear, plural } from './lib/dom.js';
import { orderForStudent } from '../shared/shuffle.js';
import { initializeThemeButton } from './lib/theme.js';

initializeThemeButton();

const SESSION_KEY = 'atlas.session';
const queueKey = (sessionId) => `atlas.queue.${sessionId}`;

const state = { session: null, student: null, exam: null, questions: [], index: 0, flags: new Set(), feedback: {}, scale: 1, answers: {}, pending: {}, closed: false, flushing: false, retryTimer: null, heartbeat: null };
const flagsKey = (sessionId) => `atlas.flags.${sessionId}`;
const scratchKey = (sessionId) => `atlas.scratch.${sessionId}`;
const scaleKey = 'atlas.fontscale';

const show = (id) => { for (const s of ['join', 'confirm', 'exam', 'done']) $('#' + s).hidden = s !== id; };
const readJson = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* armazenamento cheio ou bloqueado */ } };

// ---------- 1. entrada
let joinTimer;
async function refreshJoinStatus() {
  try {
    const { exam } = await api('/api/open-exam');
    $('#join-status').textContent = exam ? `${exam.title} está aberta. Digite o código mostrado pelo professor.` : 'Aguarde: o professor ainda não abriu a prova.';
    $('#join-button').disabled = !exam;
  } catch {
    $('#join-status').textContent = 'Sem conexão com o servidor. Verifique o Wi‑Fi da sala.';
    $('#join-button').disabled = true;
  }
}
function showJoin() {
  show('join');
  refreshJoinStatus();
  clearInterval(joinTimer);
  joinTimer = setInterval(refreshJoinStatus, 5000);
}

let candidate = null;
$('#join-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#join-error').textContent = '';
  const code = $('#code').value.trim();
  const number = $('#number').value.trim();
  try {
    const { student } = await api('/api/identify', { method: 'POST', body: { code, number } });
    candidate = { code, number, student };
    $('#confirm-name').textContent = student.name;
    $('#confirm-error').textContent = '';
    clearInterval(joinTimer);
    show('confirm');
  } catch (error) {
    $('#join-error').textContent = error.message;
  }
});
$('#confirm-no').addEventListener('click', showJoin);
$('#confirm-yes').addEventListener('click', async () => {
  try { await startSession(candidate.code, candidate.number); }
  catch (error) { $('#confirm-error').textContent = error.message; }
});

async function startSession(code, number, token) {
  const data = await api('/api/session/start', { method: 'POST', body: { code, number, token } });
  state.session = data.session;
  state.student = data.student;
  state.exam = data.exam;
  state.feedback = {};
  state.closed = false;
  state.answers = data.answers;
  state.pending = readJson(queueKey(data.session.id)) || {};
  writeJson(SESSION_KEY, { code, number, sessionId: data.session.id, token: data.session.token });
  renderExam();
  flush();
  clearInterval(state.heartbeat);
  state.heartbeat = setInterval(beat, 10000);
}

// ---------- 2. prova (uma questão por vez)
const currentAnswer = (qid) => (qid in state.pending ? state.pending[qid] : state.answers[qid] || '');
const letter = (i) => String.fromCharCode(65 + i);
const formatWeight = (w) => String(w).replace('.', ',');

function renderExam() {
  show('exam');
  const q = state.exam;
  // cada aluno pode ter sua própria ordem de questões e alternativas (definido pelo professor)
  state.questions = q.shuffle ? orderForStudent(q.questions, state.session.id) : q.questions;
  state.index = Math.min(state.index, state.questions.length - 1);
  state.flags = new Set(readJson(flagsKey(state.session.id)) || []);
  state.scale = Number(readJson(scaleKey)) || 1;
  document.documentElement.style.setProperty('--fs', String(state.scale));

  const className = state.student.className;
  $('#exam-title').textContent = className ? `${className} · ${q.title}` : q.title;
  $('#student-name').textContent = state.student.name;
  $('#student-meta').textContent = `nº ${state.student.number}`;
  $('#hud-seat').textContent = `nº ${state.student.number}`;
  $('#host').textContent = `Rede local · ${location.host}`;
  $('#n-total').textContent = plural(state.questions.length, 'item', 'itens');
  $('#scratch').value = readJson(scratchKey(state.session.id)) || '';

  const doc = q.document;
  $('#doc-open').hidden = !doc;
  if (doc) $('#doc-open').textContent = doc.kind === 'pdf' ? 'Ver documento (PDF)' : 'Ver documento';

  clear($('#grid'), ...state.questions.map((question, i) => h('button', { type: 'button', 'data-i': i, 'aria-label': `Questão ${i + 1}`, onclick: () => go(i) }, String(i + 1).padStart(2, '0'))));
  renderQuestion();
}

function renderQuestion() {
  const total = state.questions.length;
  if (!total) {
    $('#hud-label').textContent = 'Prova em PDF';
    $('#pct').textContent = 'PDF';
    clear($('#q-card'),
      h('div', { class: 'stack-s' },
        h('div', { class: 'eyebrow' }, 'Questões no documento'),
        h('h1', { class: 'headline' }, state.exam.document?.name || 'Prova em PDF'),
        h('p', { class: 'sub' }, 'Abra o PDF para consultar as questões. Depois, responda no papel conforme a orientação do professor e entregue a prova pelo botão acima.')),
      h('button', { class: 'btn secondary', type: 'button', disabled: !state.exam.document, onclick: () => $('#doc-open').click() }, 'Abrir PDF da prova'));
    return;
  }
  const q = state.questions[state.index];
  const last = state.index === total - 1;
  let control;
  if (q.type === 'choice') {
    control = h('fieldset', { class: 'opts', style: 'border:0;padding:0;margin:0', 'aria-labelledby': 'q-text' },
      q.options.map((option, i) => h('label', { class: 'opt' },
        h('input', { type: 'radio', name: q.id, value: option, checked: currentAnswer(q.id) === option, disabled: state.closed || !!state.feedback[q.id], onchange: () => saveChoice(q.id, option) }),
        h('span', { class: 'letter' }, letter(i)), h('span', {}, option))));
  } else {
    let timer;
    control = h('textarea', {
      name: q.id, rows: 6, placeholder: 'Digite sua resposta', value: currentAnswer(q.id), disabled: state.closed, 'aria-labelledby': 'q-text',
      oninput: (event) => { clearTimeout(timer); const value = event.target.value; markSaving(); timer = setTimeout(() => saveTextAnswer(q.id, value), 500); },
      onblur: (event) => { clearTimeout(timer); if (event.target.value !== currentAnswer(q.id)) saveTextAnswer(q.id, event.target.value); },
    });
  }
  const flagged = state.flags.has(q.id);
  clear($('#q-card'),
    h('div', { class: 'q-meta' },
      h('div', {}, h('div', { class: 'eyebrow' }, q.type === 'choice' ? `Peso ${formatWeight(q.weight)}` : `Questão aberta · peso ${formatWeight(q.weight)}`),
        h('h1', { class: 'q-num' }, `Questão ${state.index + 1} `, h('small', {}, `de ${total}`))),
      h('div', { class: 'q-tools', role: 'toolbar', 'aria-label': 'Ferramentas' },
        h('button', { type: 'button', title: 'Diminuir a letra', 'aria-label': 'Diminuir a letra', onclick: () => setScale(-0.1) }, 'A−'),
        h('button', { type: 'button', title: 'Aumentar a letra', 'aria-label': 'Aumentar a letra', onclick: () => setScale(0.1) }, 'A+'),
        h('button', { type: 'button', 'aria-pressed': String(flagged), title: 'Marcar para revisar depois (R)', onclick: toggleFlag }, flagged ? '⚑ Revisar' : '⚐ Revisar'))),
    h('div', { class: 'q-text', id: 'q-text' }, q.text),
    control,
    state.exam.feedback && state.feedback[q.id] && state.feedback[q.id].answer === currentAnswer(q.id) && h('div', { class: `notice ${state.feedback[q.id].correct && state.feedback[q.id].answer !== state.feedback[q.id].correct ? 'warn' : ''}` },
      h('strong', {}, state.feedback[q.id].correct ? (state.feedback[q.id].answer === state.feedback[q.id].correct ? 'Resposta correta!' : `Resposta correta: ${state.feedback[q.id].correct}`) : 'Orientação do professor'),
      state.feedback[q.id].explanation && h('p', {}, state.feedback[q.id].explanation)),
    h('div', { class: 'q-nav' },
      h('button', { class: 'btn secondary', type: 'button', disabled: state.index === 0, onclick: () => go(state.index - 1) }, '← Anterior'),
      h('button', { class: 'btn quiet', type: 'button', disabled: state.closed || !currentAnswer(q.id), onclick: clearAnswer }, q.type === 'choice' ? 'Limpar seleção' : 'Limpar resposta'),
      last ? h('button', { class: 'btn', type: 'button', onclick: openSubmit }, 'Revisar e entregar')
        : h('button', { class: 'btn', type: 'button', onclick: () => go(state.index + 1) }, 'Próxima →')));
  refreshSide();
}

function go(index) {
  if (index < 0 || index >= state.questions.length) return;
  state.index = index;
  renderQuestion();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function setScale(delta) {
  state.scale = Math.min(1.6, Math.max(0.8, Math.round((state.scale + delta) * 10) / 10));
  document.documentElement.style.setProperty('--fs', String(state.scale));
  writeJson(scaleKey, state.scale);
}
function toggleFlag() {
  const id = state.questions[state.index].id;
  state.flags.has(id) ? state.flags.delete(id) : state.flags.add(id);
  writeJson(flagsKey(state.session.id), [...state.flags]);
  renderQuestion();
}
function clearAnswer() { if (!state.closed) { setAnswer(state.questions[state.index].id, ''); renderQuestion(); } }

// painel lateral: contagens, barra e grade de questões
function refreshSide() {
  if (!state.questions.length) return;
  const total = state.questions.length;
  const done = state.questions.filter((q) => currentAnswer(q.id)).length;
  const flagged = state.questions.filter((q) => state.flags.has(q.id)).length;
  $('#n-done').textContent = done; $('#n-flag').textContent = flagged; $('#n-open').textContent = total - done;
  $('#pct').textContent = `${Math.round((done / total) * 100)}%`;
  $('#seg-done').style.width = `${(done / total) * 100}%`;
  $('#seg-flag').style.width = `${(flagged / total) * 100}%`;
  $('#progress-bar').style.width = `${(done / total) * 100}%`;
  $('#hud-label').textContent = `${done} de ${total} respondidas`;
  for (const button of $('#grid').children) {
    const i = Number(button.dataset.i); const q = state.questions[i];
    button.className = [currentAnswer(q.id) ? 'done' : '', i === state.index ? 'current' : ''].join(' ').trim();
    button.querySelector('.flag')?.remove();
    if (state.flags.has(q.id)) button.append(h('span', { class: 'flag' }, '⚑'));
    button.setAttribute('aria-current', i === state.index ? 'true' : 'false');
  }
}
const updateProgress = () => { refreshSide(); const total = state.questions.length; return { total, answered: state.questions.filter((q) => currentAnswer(q.id)).length }; };

// rascunho (só neste aparelho)
let scratchTimer;
$('#scratch').addEventListener('input', (event) => {
  clearTimeout(scratchTimer);
  $('#scratch-status').textContent = 'Salvando…';
  scratchTimer = setTimeout(() => { if (state.session) writeJson(scratchKey(state.session.id), event.target.value); $('#scratch-status').textContent = 'Fica só neste aparelho'; }, 400);
});

// atalhos de teclado
document.addEventListener('keydown', (event) => {
  if ($('#exam').hidden || document.querySelector('dialog[open]') || event.ctrlKey || event.metaKey || event.altKey) return;
  const typing = ['TEXTAREA', 'INPUT'].includes(event.target.tagName) && event.target.type !== 'radio';
  if (typing) return;
  const q = state.questions[state.index];
  if (!q) return;
  if (event.key === 'ArrowRight') go(state.index + 1);
  else if (event.key === 'ArrowLeft') go(state.index - 1);
  else if (/^[1-9]$/.test(event.key) && q.type === 'choice' && !state.closed && q.options[Number(event.key) - 1]) saveChoice(q.id, q.options[Number(event.key) - 1]);
  else if (event.key.toLowerCase() === 'r') toggleFlag();
  else if (event.key === 'Escape' && !state.closed) clearAnswer();
});

// documento de apoio (leitor próprio para PDF)
let pdf = null;
$('#doc-open').addEventListener('click', async () => {
  const doc = state.exam.document;
  $('#doc-name').textContent = doc.name;
  $('#doc-zoom').hidden = doc.kind !== 'pdf';
  $('#doc-dialog').showModal();
  const body = $('#doc-body');
  if (body.dataset.loaded === doc.id) return;
  if (doc.kind === 'pdf') {
    try {
      const { mountPdf } = await import('./lib/pdf-viewer.js');
      pdf = await mountPdf(body, `/api/document/${doc.id}`);
      pdf.setZoom(1);
    } catch {
      clear(body, h('div', { class: 'notice warn' }, 'Não consegui mostrar o documento aqui. ', h('a', { href: `/api/document/${doc.id}`, target: '_blank', rel: 'noopener' }, 'Abrir em outra aba')));
      return;
    }
  } else {
    clear(body, Object.assign(h('div', { class: 'doc-html' }), { innerHTML: doc.html || '<p>Documento sem prévia.</p>' })); // HTML já sanitizado no servidor
  }
  body.dataset.loaded = doc.id;
});
let zoom = 1;
$('#zoom-in').addEventListener('click', () => { zoom = pdf?.setZoom(zoom + 0.5) ?? zoom; });
$('#zoom-out').addEventListener('click', () => { zoom = pdf?.setZoom(zoom - 0.5) ?? zoom; });
$('#doc-close').addEventListener('click', () => $('#doc-dialog').close());

// ---------- 3. salvamento com fila local
function setAnswer(qid, value) {
  state.pending[qid] = value;
  writeJson(queueKey(state.session.id), state.pending);
  updateProgress();
  return flush();
}

async function saveChoice(qid, value) {
  delete state.feedback[qid];
  setAnswer(qid, value);
  if (!state.exam.feedback) { renderQuestion(); return; }
  for (let i = 0; i < 40 && qid in state.pending; i++) await new Promise((resolve) => setTimeout(resolve, 100));
  if (qid in state.pending) return;
  await requestFeedback(qid, value);
}
async function saveTextAnswer(qid, value) {
  delete state.feedback[qid];
  setAnswer(qid, value);
  if (!state.exam.feedback || !value.trim()) return;
  for (let i = 0; i < 40 && qid in state.pending; i++) await new Promise((resolve) => setTimeout(resolve, 100));
  if (!(qid in state.pending)) await requestFeedback(qid, value);
}
async function requestFeedback(qid, value) {
  try {
    state.feedback[qid] = { answer: value, ...(await api('/api/session/feedback', { method: 'POST', body: { sessionId: state.session.id, token: state.session.token, questionId: qid } })) };
    if (state.questions[state.index]?.id === qid) renderQuestion();
  } catch { /* se a conexão cair, a resposta fica salva e o feedback não é presumido */ }
}

function setStatus(kind, label) {
  const el = $('#save-state');
  el.className = `save-state ${kind}`;
  $('#save-label').textContent = label;
}
const markSaving = () => setStatus('', 'Salvando…');

async function flush() {
  if (state.flushing || !state.session) return;
  state.flushing = true;
  clearTimeout(state.retryTimer);
  try {
    while (Object.keys(state.pending).length) {
      const [qid, value] = Object.entries(state.pending)[0];
      setStatus('', 'Salvando…');
      try {
        await api('/api/answer', { method: 'POST', body: { sessionId: state.session.id, token: state.session.token, questionId: qid, answer: value } });
        state.answers[qid] = value;
        if (state.pending[qid] === value) delete state.pending[qid];
        writeJson(queueKey(state.session.id), state.pending);
      } catch (error) {
        if (error.code === 'exam_closed') { lockExam('O professor encerrou a prova. Suas respostas já salvas foram mantidas.'); return; }
        if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 429) {
          delete state.pending[qid]; // resposta recusada pelo servidor: não adianta repetir
          writeJson(queueKey(state.session.id), state.pending);
          setStatus('pending', 'Uma resposta não foi aceita');
          continue;
        }
        const count = Object.keys(state.pending).length;
        setStatus('pending', `Sem conexão — ${plural(count, 'resposta guardada', 'respostas guardadas')} neste aparelho`);
        state.retryTimer = setTimeout(flush, 3000);
        return;
      }
    }
    setStatus('ok', 'Tudo salvo');
  } finally {
    state.flushing = false;
    updateProgress();
  }
}

async function beat() {
  if (!state.session) return;
  try {
    const result = await api('/api/session/heartbeat', { method: 'POST', body: { sessionId: state.session.id, token: state.session.token } });
    if (result.submitted) finish();
    else if (!result.examOpen) lockExam('O professor encerrou a prova.');
    if (Object.keys(state.pending).length) flush();
  } catch { /* o indicador de salvamento já avisa sobre a conexão */ }
}

function lockExam(message) {
  state.closed = true;
  const banner = $('#banner');
  banner.textContent = message;
  banner.hidden = false;
  renderQuestion();
}

// ---------- 4. envio
const dialog = $('#submit-dialog');
function openSubmit() {
  const { total, answered } = updateProgress();
  const blanks = state.questions.map((q, i) => (currentAnswer(q.id) ? null : i + 1)).filter(Boolean);
  const marked = state.questions.map((q, i) => (state.flags.has(q.id) ? i + 1 : null)).filter(Boolean);
  const parts = [];
  if (blanks.length) parts.push(`Você respondeu ${answered} de ${total}. Em branco: ${blanks.join(', ')}.`);
  if (marked.length) parts.push(`Marcadas para revisar: ${marked.join(', ')}.`);
  parts.push('Depois do envio, não será possível alterar as respostas.');
  $('#submit-summary').textContent = parts.join(' ');
  $('#submit-error').textContent = '';
  dialog.showModal();
}
$('#submit').addEventListener('click', openSubmit);
$('#submit-cancel').addEventListener('click', () => {
  dialog.close();
  const first = state.questions.findIndex((q) => !currentAnswer(q.id));
  if (first >= 0) go(first);
});
$('#submit-confirm').addEventListener('click', async () => {
  const button = $('#submit-confirm');
  button.disabled = true;
  $('#submit-error').textContent = '';
  try {
    await flush();
    if (Object.keys(state.pending).length) throw new Error('Algumas respostas ainda não foram salvas no servidor. Verifique o Wi‑Fi e tente de novo.');
    await api('/api/session/submit', { method: 'POST', body: { sessionId: state.session.id, token: state.session.token } });
    dialog.close();
    finish();
  } catch (error) {
    $('#submit-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

function finish() {
  clearInterval(state.heartbeat);
  clearTimeout(state.retryTimer);
  if (state.session) { for (const key of [queueKey(state.session.id), flagsKey(state.session.id), scratchKey(state.session.id)]) { try { localStorage.removeItem(key); } catch { /* ignore */ } } }
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  state.session = null;
  show('done');
}

// ---------- início: tenta retomar uma prova em andamento neste aparelho
(async function boot() {
  const saved = readJson(SESSION_KEY);
  if (saved) {
    try { await startSession(saved.code, saved.number, saved.token); return; }
    catch (error) {
      if (error.code === 'already_submitted') { finish(); return; }
      if (error.code === 'network') { show('join'); $('#join-status').textContent = 'Sem conexão com o servidor. Verifique o Wi‑Fi da sala.'; setTimeout(boot, 3000); return; }
      try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    }
  }
  showJoin();
})();

