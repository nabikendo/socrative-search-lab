import { api, ApiError } from './lib/api.js';
import { answerFailure } from '../shared/answer-sync.js';
import { $, h, clear, plural, toast } from './lib/dom.js';
import { orderForStudent } from '../shared/shuffle.js';
import { initializeThemeButton, getAppearance, setAppearance } from './lib/theme.js';

initializeThemeButton();
const appearanceDialog = document.getElementById('student-settings-dialog');
document.getElementById('student-settings').addEventListener('click', () => {
  const appearance = getAppearance();
  document.getElementById('student-theme').value = appearance.theme;
  document.getElementById('student-font').value = appearance.fontSize;
  document.getElementById('student-contrast').checked = appearance.highContrast;
  document.getElementById('student-compact').checked = appearance.compact;
  appearanceDialog.showModal();
});
for (const [id, key, prop] of [['student-theme','theme','value'],['student-font','fontSize','value'],['student-contrast','highContrast','checked'],['student-compact','compact','checked']]) {
  document.getElementById(id).addEventListener('change', (event) => setAppearance({ [key]: event.target[prop] }));
}


const SESSION_KEY = 'atlas.session';
const rehearsalId = new URLSearchParams(location.search).get('ensaio');
const queueKey = (sessionId) => `atlas.queue.${sessionId}`;

const state = { session: null, student: null, exam: null, questions: [], index: 0, flags: new Set(), feedback: {}, scale: 1, answers: {}, pending: {}, endsAt: null, clockOffset: 0, closed: false, paused:false, flushing: false, retryTimer: null, heartbeat: null };
const flagsKey = (sessionId) => `atlas.flags.${sessionId}`;
const scratchKey = (sessionId) => `atlas.scratch.${sessionId}`;
const scaleKey = 'atlas.fontscale';
const contrastKey='atlas.highcontrast';

const show = (id) => { for (const s of ['join', 'confirm', 'exam', 'done']) $('#' + s).hidden = s !== id; };
const readJson = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };

// ---------- 1. entrada
let joinTimer;
let reviewCredentials;
$('#return-to-join').addEventListener('click', showJoin);
$('#review-button').addEventListener('click', async () => {
  try {
    const review = await api('/api/session/review', { method: 'POST', body: reviewCredentials });
    clear($('#review-results'), h('strong', {}, `Nota: ${review.score} / ${review.max}${review.pending ? ' · correção pendente' : ''}`),
      review.questions.map((question) => h('article', { class: 'card' },
        h('strong', {}, question.text),
        h('p', {}, `Sua resposta: ${question.answer || 'Sem resposta'}`),
        h('p', {}, question.annulled ? 'Questão anulada' : `Gabarito: ${question.correct ?? 'Correção manual'}`),
        question.explanation && h('p', {}, question.explanation))));
  } catch (error) { clear($('#review-results'), error.message); }
});
async function refreshJoinStatus() {
  try {
    const { exam } = await api('/api/open-exam');
    $('#join-status').textContent = exam ? (exam.paused ? `${exam.title} está pausada. Aguarde o professor retomar.` : `${exam.title} está aberta. Digite o código mostrado pelo professor.`) : 'Aguarde: o professor ainda não abriu a prova.';
    $('#join-button').disabled = !exam || exam.paused;
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
    $('#join-error').textContent = error.code === 'student_not_found'
      ? 'Seu número não aparece na lista. Você pode enviar um pedido de autorização ao professor.'
      : error.message;
    const unlisted = error.code === 'student_not_found';
    $('#join-name-wrap').hidden = !unlisted;
    $('#join-request').hidden = !unlisted;
    $('#join-request-status').hidden = true;
  }
});
$('#join-request').addEventListener('click', async () => {
  $('#join-error').textContent = '';
  try {
    const result = await api('/api/join-requests', { method:'POST', body:{ code:$('#code').value.trim(), number:$('#number').value.trim(), name:$('#join-name').value.trim() } });
    $('#join-request-status').textContent = result.message;
    $('#join-request-status').hidden = false;
    $('#join-name-wrap').hidden = true;
    $('#join-request').hidden = true;
  } catch (error) { $('#join-error').textContent = error.message; }
});
$('#confirm-no').addEventListener('click', showJoin);
$('#confirm-yes').addEventListener('click', async () => {
  try { await startSession(candidate.code, candidate.number); }
  catch (error) { $('#confirm-error').textContent = error.message; }
});

async function startSession(code, number, token) {
  const data = await api('/api/session/start', { method: 'POST', body: { code, number, token } });
  beginSession(data, code, number);
}

function beginSession(data, code, number) {
  state.session = data.session;
  state.student = data.student;
  state.exam = data.exam;
  state.feedback = {};
  state.closed = false;
  state.paused = !!data.paused;
  state.answers = data.answers;
  state.pending = readJson(queueKey(data.session.id)) || {};
  state.blockedSync = false;
  state.queuePersisted = true;
  const sessionPersisted = writeJson(SESSION_KEY, { code, number, sessionId: data.session.id, token: data.session.token });
  if (!sessionPersisted) toast('Este navegador bloqueou o armazenamento da sessão. Mantenha a prova aberta até entregar.');
  renderExam();
  if (data.timeEnded) lockExam('Seu tempo de prova terminou. Entregue as respostas já recebidas pelo Atlas.');
  else if (!state.paused) flush();
  clearInterval(state.heartbeat);
  state.heartbeat = setInterval(beat, 10000);
  setTimeout(beat, 400);
}

// ---------- 2. prova (uma questão por vez)
const currentAnswer = (qid) => {
  const q=state.questions.find((item)=>item.id===qid);
  const value=qid in state.pending?state.pending[qid]:state.answers[qid]||'';
  if(q?.type==='multi') { if(Array.isArray(value))return value; try{return JSON.parse(value||'[]');}catch{return [];} }
  return value;
};
const hasAnswer=(value)=>Array.isArray(value)?value.length>0:String(value??'').trim().length>0;
const sameAnswer=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const letter = (i) => String.fromCharCode(65 + i);
const formatWeight = (w) => String(w).replace('.', ',');

function renderExam() {
  show('exam');
  const q = state.exam;
  // cada aluno pode ter sua própria ordem de questões e alternativas (definido pelo professor)
  state.questions = q.shuffle ? orderForStudent(q.questions, state.session.id) : q.questions;
  state.index = Math.max(0, Math.min(state.index, state.questions.length - 1));
  state.flags = new Set(readJson(flagsKey(state.session.id)) || []);
  state.scale = Math.max(state.student.accommodation?.largeText ? 1.25 : 1, Number(readJson(scaleKey)) || 1);
  document.documentElement.style.setProperty('--fs', String(state.scale));
  document.documentElement.dataset.contrast=state.student.accommodation?.highContrast || readJson(contrastKey)?'high':'normal';

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
  $('#submit').disabled=state.paused;
  $('#submit-side').disabled=state.paused || state.closed;
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
        h('input', { type: 'radio', name: q.id, value: option, checked: currentAnswer(q.id) === option, disabled: state.closed || state.paused || !!state.feedback[q.id], onchange: () => saveChoice(q.id, option) }),
        h('span', { class: 'letter' }, letter(i)), h('span', {}, option))));
  } else if(q.type==='multi') {
    const selected=currentAnswer(q.id);
    control=h('fieldset',{class:'opts',style:'border:0;padding:0;margin:0','aria-labelledby':'q-text'},
      q.options.map((option,i)=>h('label',{class:'opt'},
        h('input',{type:'checkbox',name:q.id,value:option,checked:selected.includes(option),disabled:state.closed||state.paused||!!state.feedback[q.id],onchange:()=>saveMultiAnswer(q.id,option)}),
        h('span',{class:'letter'},letter(i)),h('span',{},option))));
  } else {
    let timer;
    control = q.type==='numeric' ? h('input', { type:'number',step:'any',name:q.id,placeholder:'Digite o valor',value:currentAnswer(q.id),disabled:state.closed||state.paused,'aria-labelledby':'q-text',oninput:(event)=>{clearTimeout(timer);const value=event.target.value;setAnswer(q.id,value,true);markSaving();timer=setTimeout(()=>saveTextAnswer(q.id,value),500);},onblur:(event)=>{clearTimeout(timer);saveTextAnswer(q.id,event.target.value);} }) : h('textarea', {
      name: q.id, rows: 6, placeholder: 'Digite sua resposta', value: currentAnswer(q.id), disabled: state.closed || state.paused, 'aria-labelledby': 'q-text',
      oninput: (event) => { clearTimeout(timer); const value = event.target.value; setAnswer(q.id, value, true); markSaving(); timer = setTimeout(() => saveTextAnswer(q.id, value), 500); },
      onblur: (event) => { clearTimeout(timer); saveTextAnswer(q.id, event.target.value); },
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
        h('button',{type:'button',title:'Ouvir enunciado e alternativas','aria-label':'Ouvir questão',onclick:()=>speakQuestion(q)},'🔊'),
        h('button',{type:'button','aria-pressed':String(document.documentElement.dataset.contrast==='high'),title:'Alternar alto contraste',onclick:toggleHighContrast},'◐ Contraste'),
        h('button', { type: 'button', 'aria-pressed': String(flagged), title: 'Marcar para revisar depois (R)', onclick: toggleFlag }, flagged ? '⚑ Revisar' : '⚐ Revisar'))),
    h('div', { class: 'q-text', id: 'q-text' }, q.text),
    q.image&&h('img',{src:q.image,alt:q.imageAlt||'Imagem da questão',style:'display:block;max-width:100%;max-height:55vh;object-fit:contain;border-radius:10px'}),
    control,
    q.type==='multi'&&state.exam.feedback&&!state.feedback[q.id]&&hasAnswer(currentAnswer(q.id))&&h('button',{class:'btn secondary',disabled:state.closed||state.paused,onclick:()=>checkMultiAnswer(q)},'Confirmar resposta e ver feedback'),
    state.exam.feedback && state.feedback[q.id] && sameAnswer(state.feedback[q.id].answer,currentAnswer(q.id)) && h('div', { class: `notice ${state.feedback[q.id].correct && !feedbackIsCorrect(q,state.feedback[q.id]) ? 'warn' : ''}` },
      h('strong', {}, state.feedback[q.id].correct ? (feedbackIsCorrect(q,state.feedback[q.id]) ? 'Resposta correta!' : `Resposta correta: ${Array.isArray(state.feedback[q.id].correct)?state.feedback[q.id].correct.join(', '):state.feedback[q.id].correct}`) : 'Orientação do professor'),
      state.feedback[q.id].explanation && h('p', {}, state.feedback[q.id].explanation)),
    h('div', { class: 'q-nav' },
      h('button', { class: 'btn secondary', type: 'button', disabled: state.index === 0, onclick: () => go(state.index - 1) }, '← Anterior'),
      h('button', { class: 'btn quiet', type: 'button', disabled: state.closed || state.paused || !hasAnswer(currentAnswer(q.id)), onclick: clearAnswer }, q.type === 'choice' ? 'Limpar seleção' : 'Limpar resposta'),
      last ? h('button', { class: 'btn', type: 'button', disabled:state.closed || state.paused, onclick: openSubmit }, 'Revisar e entregar')
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
function speakQuestion(question) {
  if(!('speechSynthesis' in window)||!('SpeechSynthesisUtterance' in window)){toast('Leitura em voz alta não está disponível neste aparelho.');return;}
  speechSynthesis.cancel();
  const text=[question.text,...(question.options||[])].join('. ');
  const speech=new SpeechSynthesisUtterance(text);speech.lang='pt-BR';speechSynthesis.speak(speech);
}
function toggleHighContrast() {
  const enabled=document.documentElement.dataset.contrast!=='high';
  document.documentElement.dataset.contrast=enabled?'high':'normal';
  writeJson(contrastKey,enabled);
  renderQuestion();
}
function toggleFlag() {
  const id = state.questions[state.index].id;
  state.flags.has(id) ? state.flags.delete(id) : state.flags.add(id);
  writeJson(flagsKey(state.session.id), [...state.flags]);
  renderQuestion();
}
function clearAnswer() { if (!state.closed && !state.paused) { const q=state.questions[state.index]; setAnswer(q.id,q.type==='multi'?[]:''); renderQuestion(); } }

// painel lateral: contagens, barra e grade de questões
function refreshSide() {
  if (!state.questions.length) return;
  const total = state.questions.length;
  const done = state.questions.filter((q) => hasAnswer(currentAnswer(q.id))).length;
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
const updateProgress = () => { refreshSide(); const total = state.questions.length; return { total, answered: state.questions.filter((q) => hasAnswer(currentAnswer(q.id))).length }; };

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
function setAnswer(qid, value, deferRemote = false) {
  if (state.closed || state.paused) return;
  if (rehearsalId) {
    state.answers[qid] = value;
    updateProgress();
    return;
  }
  state.pending[qid] = value;
  state.blockedSync = false;
  state.queuePersisted = writeJson(queueKey(state.session.id), state.pending);
  if (!state.queuePersisted) {
    setStatus('pending', 'Armazenamento local indisponível: não feche a página até confirmar o envio.');
  }
  updateProgress();
  if (!deferRemote) return flush();
}

async function saveChoice(qid, value) {
  delete state.feedback[qid];
  setAnswer(qid, value);
  if (!state.exam.feedback) { renderQuestion(); return; }
  for (let i = 0; i < 40 && qid in state.pending; i++) await new Promise((resolve) => setTimeout(resolve, 100));
  if (qid in state.pending) return;
  await requestFeedback(qid, value);
}
function saveMultiAnswer(qid, option) {
  const selected=[...currentAnswer(qid)];
  const next=selected.includes(option)?selected.filter((value)=>value!==option):[...selected,option];
  delete state.feedback[qid];
  setAnswer(qid,next);
  if(state.questions[state.index]?.id===qid)renderQuestion();
}
async function checkMultiAnswer(question) {
  const answer=currentAnswer(question.id);
  await flush();
  if (!(question.id in state.pending)) await requestFeedback(question.id,answer);
}
function feedbackIsCorrect(question, feedback) {
  if(feedback.correct===null || feedback.correct===undefined)return true;
  if(question.type==='multi')return sameAnswer([...feedback.answer].sort(),[...feedback.correct].sort());
  if(question.type==='numeric')return Number.isFinite(Number(feedback.answer))&&Math.abs(Number(feedback.answer)-Number(feedback.correct))<=(question.tolerance||0);
  return feedback.answer===feedback.correct;
}
async function saveTextAnswer(qid, value) {
  delete state.feedback[qid];
  setAnswer(qid, value);
  if (!state.exam.feedback || !String(value).trim()) return;
  for (let i = 0; i < 40 && qid in state.pending; i++) await new Promise((resolve) => setTimeout(resolve, 100));
  if (!(qid in state.pending)) await requestFeedback(qid, value);
}
async function requestFeedback(qid, value) {
  if (rehearsalId) return;
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
const markSaving = () => state.queuePersisted === false ?
  setStatus('pending', 'Armazenamento local indisponível: não feche a prova até o envio confirmar.') :
  setStatus('', 'Salvando…');

async function flush() {
  if (state.flushing || state.blockedSync || !state.session) return;
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
        const failure = answerFailure(error);
        const count = Object.keys(state.pending).length;
        if (failure.action === 'locked') {
          lockExam(failure.message);
          setStatus('pending', `${count} resposta(s) não confirmada(s) — avise o professor`);
          return;
        }
        if (failure.action === 'review') {
          state.blockedSync = true;
          setStatus('pending', failure.message);
          return;
        }
        setStatus('pending', state.queuePersisted ? `${failure.message} (${count} pendente(s))` : `AVISO: armazenamento bloqueado; ${count} resposta(s) apenas em memória. Não feche a prova.`);
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
    setClock(result);
    if (result.submitted) finish(result.receipt);
    else if (result.examPaused || result.studentPaused) {
      state.paused=true;
      $('#banner').textContent=result.studentPaused?'O professor pausou sua prova individual. Aguarde a liberação.':'A prova foi pausada pelo professor. Suas respostas ficam salvas.';
      $('#banner').hidden=false;
      renderQuestion();
    }
    else if (!result.examOpen) lockExam('O professor encerrou a prova.');
    else if (state.paused) { state.paused=false; $('#banner').hidden=true; renderQuestion(); }
    if (Object.keys(state.pending).length && !state.blockedSync) flush();
    flushAway();
  } catch (error) {
    // 401 = o professor desconectou este aparelho (ou reiniciou a prova): orienta o aluno em vez de ficar em silêncio.
    if (error?.status === 401) {
      clearInterval(state.heartbeat);
      $('#banner').textContent = 'Você foi desconectado pelo professor. Recarregue a página e entre de novo com seu número; suas respostas já enviadas continuam salvas.';
      $('#banner').hidden = false;
    } /* nos demais erros, o indicador de salvamento já avisa sobre a conexão */
  }
}

// ---------- aviso ao professor quando o aluno sai da página da prova
const AWAY_KEY = 'atlas.away';
const away = { since: 0, hidden: false, sent: false, timer: 0, queue: readJson(AWAY_KEY) || [] };
const examActive = () => !!state.session && !state.closed && !state.paused && !rehearsalId && !$('#exam').hidden;
const credentials = () => ({ sessionId: state.session.id, token: state.session.token });

function leavePage(kind) {
  if (!examActive() || away.since) return;
  away.since = Date.now();
  away.hidden = kind === 'hidden';
  away.sent = false;
  const notify = () => { away.sent = true; api('/api/session/away', { method: 'POST', body: { ...credentials(), state: 'away' } }).catch(() => {}); };
  // clicar na barra de endereço também tira o foco: só avisa se a saída durar alguns segundos
  if (away.hidden) notify(); else away.timer = setTimeout(notify, 3000);
}

function returnToPage() {
  clearTimeout(away.timer);
  if (!away.since) return;
  const seconds = Math.round((Date.now() - away.since) / 1000);
  const counted = away.hidden ? seconds >= 1 : seconds >= 3;
  away.since = 0;
  if (!state.session || (!counted && !away.sent)) return;
  away.queue.push({ sid: state.session.id, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, seconds: counted ? seconds : 0 });
  writeJson(AWAY_KEY, away.queue);
  if (counted && !state.closed) toast(`Você saiu da página por ${seconds} s. O professor foi avisado.`);
  flushAway();
}

async function flushAway() {
  if (!state.session || away.flushing || !away.queue.length) return;
  away.flushing = true;
  try {
    for (const item of [...away.queue]) {
      if (item.sid !== state.session.id) { away.queue = away.queue.filter((entry) => entry !== item); continue; }
      await api('/api/session/away', { method: 'POST', body: { ...credentials(), state: 'back', id: item.id, seconds: item.seconds } });
      away.queue = away.queue.filter((entry) => entry !== item);
    }
  } catch { /* tenta de novo no próximo batimento */ }
  finally { away.flushing = false; writeJson(AWAY_KEY, away.queue); }
}

document.addEventListener('visibilitychange', () => (document.hidden ? leavePage('hidden') : returnToPage()));
window.addEventListener('blur', () => { if (!document.hidden) leavePage('blur'); });
window.addEventListener('focus', () => { if (!document.hidden) returnToPage(); });

// ---------- tempo restante (relógio do servidor, para não depender da hora do Chromebook)
function updateClock() {
  const badge = $('#hud-time');
  if (!state.endsAt || state.closed) { badge.hidden = true; return; }
  const left = Math.max(0, Math.floor((state.endsAt - (Date.now() + state.clockOffset)) / 1000));
  const hours = Math.floor(left / 3600);
  const text = `${hours ? hours + ':' : ''}${String(Math.floor((left % 3600) / 60)).padStart(hours ? 2 : 1, '0')}:${String(left % 60).padStart(2, '0')}`;
  badge.textContent = left ? `Tempo restante ${text}` : 'Tempo encerrado';
  badge.className = `badge${left && left <= 300 ? ' warn' : ''}`;
  badge.hidden = false;
}
function setClock(result) {
  if (typeof result.serverNow === 'number') state.clockOffset = result.serverNow - Date.now();
  state.endsAt = result.endsAt || null;
  clearInterval(state.clock);
  updateClock();
  if (state.endsAt) state.clock = setInterval(updateClock, 1000);
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
  const blanks = state.questions.map((q, i) => (hasAnswer(currentAnswer(q.id)) ? null : i + 1)).filter(Boolean);
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
$('#submit-side').addEventListener('click', openSubmit);
$('#submit-cancel').addEventListener('click', () => {
  dialog.close();
  const first = state.questions.findIndex((q) => !hasAnswer(currentAnswer(q.id)));
  if (first >= 0) go(first);
});
$('#submit-confirm').addEventListener('click', async () => {
  const button = $('#submit-confirm');
  button.disabled = true;
  $('#submit-error').textContent = '';
  try {
    if (rehearsalId) {
      dialog.close();
      clear($('#done .lead'), 'Ensaio concluído. Nenhum resultado foi registrado.');
      show('done');
      return;
    }
    await flush();
    if (Object.keys(state.pending).length) throw new Error('Algumas respostas ainda não foram salvas no servidor. Verifique o Wi‑Fi e tente de novo.');
    const { receipt } = await api('/api/session/submit', { method: 'POST', body: { sessionId: state.session.id, token: state.session.token } });
    dialog.close();
    finish(receipt);
  } catch (error) {
    $('#submit-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

function finish(receipt) {
  reviewCredentials = readJson(SESSION_KEY);
  if (receipt && reviewCredentials) writeJson('atlas.last-receipt', { receipt, credentials: reviewCredentials });
  clearInterval(state.heartbeat);
  clearInterval(state.clock);
  clearTimeout(state.retryTimer);
  clearTimeout(away.timer);
  away.since = 0;
  const hasUnconfirmedAnswers = state.session && Object.keys(readJson(queueKey(state.session.id)) || {}).length > 0;
  if (state.session) {
    for (const key of [flagsKey(state.session.id), scratchKey(state.session.id), ...(hasUnconfirmedAnswers ? [] : [queueKey(state.session.id)])]) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    }
  }
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  state.session = null;
  $('#delivery-receipt').textContent = receipt
    ? `Comprovante ${receipt.number} · recebido em ${new Date(receipt.submittedAt).toLocaleString('pt-BR')}`
    : '';
  $('#review-actions').hidden = !reviewCredentials;
  show('done');
  if (hasUnconfirmedAnswers) {
    $('#delivery-receipt').textContent += ' — ATENÇÃO: existem respostas guardadas neste aparelho que não foram confirmadas pelo servidor. Avise o professor.';
  }
}

// ---------- início: tenta retomar uma prova em andamento neste aparelho
(async function boot() {
  if (rehearsalId) {
    try {
      const { exam } = await api(`/api/exams/${encodeURIComponent(rehearsalId)}/rehearsal`);
      state.session = { id: 'rehearsal-' + rehearsalId };
      state.student = { number: '—', name: 'Ensaio do professor', className: '' };
      state.exam = exam;
      renderExam();
    } catch (error) {
      show('join');
      $('#join-button').disabled = true;
      $('#join-status').textContent = error.message;
    }
    return;
  }
  const saved = readJson(SESSION_KEY);
  if (saved) {
    try {
      const data = await api('/api/session/restore', { method: 'POST', body: saved });
      if (data.receipt) {
        state.session = { id: saved.sessionId };
        finish(data.receipt);
      } else {
        beginSession(data, saved.code, saved.number);
      }
      return;
    }
    catch (error) {
      if (error.code === 'already_submitted') { finish(); return; }
      if (error.code === 'network') { show('join'); $('#join-status').textContent = 'Sem conexão com o servidor. Verifique o Wi‑Fi da sala.'; setTimeout(boot, 3000); return; }
      const unsent = Object.keys(readJson(queueKey(saved.sessionId)) || {}).length;
      if (unsent) {
        show('join');
        $('#join-status').textContent = `Esta sessão tem ${unsent} resposta(s) local(is) não confirmada(s). Não limpe os dados do navegador nem saia da rede. Solicite ajuda ao professor. (${error.message})`;
        return;
      }
      try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    }
  }
  const last = readJson('atlas.last-receipt');
  if (!saved && last?.receipt && last.credentials) {
    reviewCredentials = last.credentials;
    $('#delivery-receipt').textContent = `Comprovante ${last.receipt.number} · recebido em ${new Date(last.receipt.submittedAt).toLocaleString('pt-BR')}`;
    $('#review-actions').hidden = false;
    show('done');
    return;
  }
  showJoin();
})();

