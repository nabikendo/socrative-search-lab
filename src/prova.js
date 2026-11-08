import { api, ApiError } from './lib/api.js';
import { $, h, clear, plural } from './lib/dom.js';

const SESSION_KEY = 'atlas.session';
const queueKey = (sessionId) => `atlas.queue.${sessionId}`;

const state = { session: null, student: null, exam: null, answers: {}, pending: {}, closed: false, flushing: false, retryTimer: null, heartbeat: null };

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
  state.closed = false;
  state.answers = data.answers;
  state.pending = readJson(queueKey(data.session.id)) || {};
  writeJson(SESSION_KEY, { code, number, sessionId: data.session.id, token: data.session.token });
  renderExam();
  flush();
  clearInterval(state.heartbeat);
  state.heartbeat = setInterval(beat, 10000);
}

// ---------- 2. prova
const currentAnswer = (qid) => (qid in state.pending ? state.pending[qid] : state.answers[qid] || '');

function renderExam() {
  show('exam');
  $('#student').textContent = `${state.student.name} · nº ${state.student.number}`;
  $('#exam-title').textContent = state.exam.title;

  const doc = state.exam.document;
  const box = $('#document');
  box.hidden = !doc;
  if (doc) {
    clear(box, doc.kind === 'pdf'
      ? h('div', { class: 'stack-s' },
        h('iframe', { class: 'doc-frame', title: doc.name, src: `/api/document/${doc.id}` }),
        h('a', { class: 'caption', href: `/api/document/${doc.id}`, target: '_blank', rel: 'noopener' }, 'Abrir o documento em tela cheia'))
      : Object.assign(h('div', { class: 'doc-html' }), { innerHTML: doc.html || '<p>Documento sem prévia.</p>' })); // HTML já sanitizado no servidor
  }

  clear($('#questions'), ...state.exam.questions.map((q, i) => questionBlock(q, i)));
  updateProgress();
}

function questionBlock(q, index) {
  const title = h('div', { class: 'q-title', id: `t-${q.id}` }, q.text);
  let control;
  if (q.type === 'choice') {
    control = h('div', { class: 'list', role: 'radiogroup', 'aria-labelledby': `t-${q.id}` },
      q.options.map((option) => h('label', { class: 'option' },
        h('input', { type: 'radio', name: q.id, value: option, checked: currentAnswer(q.id) === option, disabled: state.closed, onchange: () => setAnswer(q.id, option) }),
        h('span', {}, option))));
  } else {
    let timer;
    control = h('textarea', {
      name: q.id, rows: 4, placeholder: 'Digite sua resposta', value: currentAnswer(q.id), disabled: state.closed, 'aria-labelledby': `t-${q.id}`,
      oninput: (event) => { clearTimeout(timer); const value = event.target.value; markSaving(); timer = setTimeout(() => setAnswer(q.id, value), 500); },
      onblur: (event) => { clearTimeout(timer); if (event.target.value !== currentAnswer(q.id)) setAnswer(q.id, event.target.value); },
    });
  }
  return h('section', { class: 'q-block' }, h('div', { class: 'q-index' }, `Questão ${index + 1}`), title, control);
}

function updateProgress() {
  const total = state.exam.questions.length;
  const answered = state.exam.questions.filter((q) => currentAnswer(q.id)).length;
  $('#progress-bar').style.width = `${(answered / total) * 100}%`;
  return { total, answered };
}

// ---------- 3. salvamento com fila local
function setAnswer(qid, value) {
  state.pending[qid] = value;
  writeJson(queueKey(state.session.id), state.pending);
  updateProgress();
  flush();
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
  for (const input of document.querySelectorAll('#questions input, #questions textarea')) input.disabled = true;
}

// ---------- 4. envio
const dialog = $('#submit-dialog');
$('#submit').addEventListener('click', () => {
  const { total, answered } = updateProgress();
  const missing = total - answered;
  $('#submit-summary').textContent = missing
    ? `Você respondeu ${answered} de ${total}. ${plural(missing, 'questão está', 'questões estão')} em branco. Depois do envio, não será possível alterar.`
    : 'Depois do envio, não será possível alterar as respostas.';
  $('#submit-error').textContent = '';
  dialog.showModal();
});
$('#submit-cancel').addEventListener('click', () => dialog.close());
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
  if (state.session) { try { localStorage.removeItem(queueKey(state.session.id)); } catch { /* ignore */ } }
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
