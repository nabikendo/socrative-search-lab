import qrcode from 'qrcode-generator';
import { api } from '../lib/api.js';
import { h, clear, toast, plural } from '../lib/dom.js';
import { questionId, parseQuestionsText } from '../../shared/exam.js';

let root;
let timer;
const state = { exams: [], model: null, dirty: false, urls: [], live: null, error: '' };

export function mount(el) { root = el; }
export async function activate() {
  state.urls = (await api('/api/network').catch(() => ({ urls: [] }))).urls;
  await loadList();
  const open = state.exams.find((e) => e.status === 'open');
  await select(state.model?.id && state.exams.some((e) => e.id === state.model.id) ? state.model.id : (open || state.exams[0])?.id);
  timer = setInterval(pollLive, 5000);
}
export function deactivate() { clearInterval(timer); }

const blank = () => ({ id: null, title: '', status: 'draft', accessCode: null, document: null, locked: false, shuffle: false,
  questions: [newQuestion('choice')] });
function newQuestion(type) {
  return { id: questionId(), type, text: '', options: type === 'choice' ? ['', ''] : [], correctIndex: null, weight: 1 };
}
const fromServer = (exam, locked) => ({ ...exam, locked, questions: exam.questions.map((q) => ({ ...q, correctIndex: q.correct ? q.options.indexOf(q.correct) : null })) });
function payload() {
  return { id: state.model.id, title: state.model.title, shuffle: !!state.model.shuffle, questions: state.model.questions.map((q) => {
    const options = q.options.map((o) => o.trim());
    const correct = q.type === 'choice' && q.correctIndex !== null ? options[q.correctIndex] : undefined;
    return { id: q.id, type: q.type, text: q.text, options: options.filter(Boolean), ...(correct ? { correct } : {}), weight: Number(q.weight) || 1 };
  }) };
}

async function loadList() { state.exams = (await api('/api/exams')).exams; }
async function select(id) {
  state.error = '';
  state.dirty = false;
  state.live = null;
  if (id) {
    const { exam } = await api(`/api/exams/${id}`);
    state.model = fromServer(exam, state.exams.find((e) => e.id === id)?.sessions > 0);
  } else state.model = blank();
  render();
  pollLive();
}
async function pollLive() {
  const m = state.model;
  if (!m?.id || m.status !== 'open' || root.hidden) return;
  try {
    const { results } = await api(`/api/exams/${m.id}/results`);
    state.live = { online: results.filter((r) => r.online).length, submitted: results.filter((r) => r.status === 'submitted').length, total: results.length };
    const el = root.querySelector('#live'); if (el) el.textContent = liveText();
  } catch { /* ignora */ }
}
const liveText = () => state.live ? `${state.live.online} online · ${state.live.submitted} de ${state.live.total} enviadas` : 'Aguardando alunos…';

async function save() {
  const { exam } = await api('/api/exams', { method: 'POST', body: payload() });
  await loadList();
  state.model = fromServer(exam, state.exams.find((e) => e.id === exam.id)?.sessions > 0);
  state.dirty = false;
  return exam;
}
const guard = (fn) => async (ev) => { try { state.error = ''; await fn(ev); } catch (e) { state.error = e.message; } render(); };
const touch = () => { state.dirty = true; const b = root.querySelector('#save'); if (b) b.disabled = false; };

function render() {
  const m = state.model;
  const isOpen = m.status === 'open';
  clear(root, h('div', { class: 'stack' },
    h('div', { class: 'row between' },
      h('h1', { class: 'title' }, 'Prova'),
      h('div', { class: 'row' },
        h('select', { 'aria-label': 'Escolher prova', style: 'width:auto;max-width:260px', onchange: guard(async (ev) => { await select(ev.target.value || null); }) },
          state.exams.map((e) => h('option', { value: e.id, selected: e.id === m.id }, e.title + (e.status === 'open' ? ' ●' : ''))),
          !m.id && h('option', { value: '', selected: true }, 'Nova prova')),
        h('button', { class: 'btn secondary', onclick: () => { state.model = blank(); state.dirty = false; render(); } }, 'Nova'))),

    isOpen && openBanner(m),
    m.locked && h('div', { class: 'notice' }, 'Esta prova já tem respostas, então as questões estão travadas. Para mudar algo, duplique a prova.'),

    h('div', { class: 'card stack-s' },
      h('label', { class: 'field' }, h('span', {}, 'Título'), h('input', { value: m.title, placeholder: 'Ex.: Ligações químicas — 1º bimestre', oninput: (e) => { m.title = e.target.value; touch(); } })),
      h('label', { class: 'option', style: 'border-radius:14px' },
        h('input', { type: 'checkbox', checked: !!m.shuffle, disabled: m.locked, onchange: (e) => { m.shuffle = e.target.checked; touch(); } }),
        h('span', {}, h('strong', {}, 'Embaralhar para cada aluno'), h('span', { class: 'caption', style: 'display:block' }, 'Cada aluno vê as questões e as alternativas em ordem diferente. Evite alternativas como “todas as anteriores”.')))),

    ...m.questions.map((q, i) => questionCard(q, i)),

    !m.locked && h('div', { class: 'row' },
      h('button', { class: 'btn secondary', onclick: () => { m.questions.push(newQuestion('choice')); touch(); render(); } }, 'Adicionar questão'),
      h('button', { class: 'btn quiet', onclick: () => { m.questions.push(newQuestion('text')); touch(); render(); } }, 'Questão aberta')),
    !m.locked && quickText(m),
    documentCard(m),

    state.error && h('p', { class: 'error', role: 'alert' }, state.error),
    h('div', { class: 'row' },
      h('button', { id: 'save', class: 'btn', disabled: !state.dirty && !!m.id, onclick: guard(async () => { await save(); toast('Prova salva'); }) }, 'Salvar'),
      isOpen
        ? h('button', { class: 'btn secondary', onclick: guard(async () => { await api(`/api/exams/${m.id}/close`, { method: 'POST' }); await loadList(); await select(m.id); }) }, 'Encerrar prova')
        : h('button', { class: 'btn secondary', onclick: guard(async () => { const { id } = state.dirty || !m.id ? await save() : m; const { code } = await api(`/api/exams/${id}/open`, { method: 'POST' }); await loadList(); await select(id); toast(`Prova aberta · código ${code}`); }) }, 'Abrir para os alunos'),
      m.id && h('button', { class: 'btn quiet', onclick: guard(async () => { state.model = { ...blank(), title: `${m.title} (cópia)`, questions: payloadQuestions(m).map((q) => ({ ...q, correctIndex: q.correct ? q.options.indexOf(q.correct) : null })) }; state.dirty = true; }) }, 'Duplicar'),
      m.id && !isOpen && h('button', { class: 'btn danger', onclick: guard(async () => { if (!confirm('Excluir esta prova?')) return; await api(`/api/exams/${m.id}`, { method: 'DELETE' }); await loadList(); await select(state.exams[0]?.id); }) }, 'Excluir'))));
}
const payloadQuestions = (m) => payload().questions.map((q) => ({ ...q, id: questionId() }));

function openBanner(m) {
  const url = `${state.urls[0] || location.origin}/prova`;
  const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
  return h('div', { class: 'card row', style: 'gap:28px' },
    h('div', { class: 'qr', 'aria-label': `QR Code de ${url}`, innerHTML: qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true }) }),
    h('div', { class: 'stack-s grow' },
      h('span', { class: 'eyebrow' }, 'Prova aberta · código'),
      h('div', { class: 'hero-code' }, m.accessCode),
      h('p', {}, 'Alunos abrem ', h('strong', {}, url)),
      state.urls.length > 1 && h('p', { class: 'caption' }, 'Outros endereços: ', state.urls.slice(1).map((u) => `${u}/prova`).join(' · ')),
      h('span', { id: 'live', class: 'badge ok' }, liveText())));
}

function questionCard(q, index) {
  const m = state.model;
  const lock = m.locked;
  return h('div', { class: 'card q-card' },
    h('div', { class: 'q-head' },
      h('span', { class: 'eyebrow' }, `Questão ${index + 1}`),
      h('div', { class: 'row' },
        !lock && h('div', { class: 'segmented' },
          h('button', { type: 'button', 'aria-pressed': String(q.type === 'choice'), onclick: () => { q.type = 'choice'; if (q.options.length < 2) q.options = ['', '']; touch(); render(); } }, 'Múltipla escolha'),
          h('button', { type: 'button', 'aria-pressed': String(q.type === 'text'), onclick: () => { q.type = 'text'; touch(); render(); } }, 'Aberta')),
        !lock && m.questions.length > 1 && h('button', { class: 'pill-btn', 'aria-label': 'Remover questão', onclick: () => { m.questions.splice(index, 1); touch(); render(); } }, '×'))),
    h('textarea', { value: q.text, disabled: lock, placeholder: 'Enunciado', 'aria-label': `Enunciado da questão ${index + 1}`, oninput: (e) => { q.text = e.target.value; touch(); } }),
    q.type === 'choice' && h('div', { class: 'stack-s' },
      q.options.map((option, i) => h('div', { class: 'opt-row' },
        h('input', { type: 'radio', name: `c-${q.id}`, checked: q.correctIndex === i, disabled: lock, title: 'Resposta correta', 'aria-label': `Alternativa ${i + 1} é a correta`, onchange: () => { q.correctIndex = i; touch(); } }),
        h('input', { type: 'text', value: option, disabled: lock, placeholder: `Alternativa ${i + 1}`, oninput: (e) => { q.options[i] = e.target.value; touch(); } }),
        !lock && q.options.length > 2 && h('button', { class: 'pill-btn', 'aria-label': 'Remover alternativa', onclick: () => { q.options.splice(i, 1); q.correctIndex = q.correctIndex === i ? null : q.correctIndex > i ? q.correctIndex - 1 : q.correctIndex; touch(); render(); } }, '×'))),
      !lock && q.options.length < 10 && h('div', {}, h('button', { class: 'btn quiet', onclick: () => { q.options.push(''); touch(); render(); } }, 'Adicionar alternativa')),
      h('p', { class: 'caption' }, q.correctIndex === null ? 'Marque a correta para correção automática; sem marcação, a nota é manual.' : 'Correção automática ativada.')),
    h('label', { class: 'row caption' }, 'Peso', h('input', { type: 'number', min: '0.25', max: '100', step: '0.25', value: q.weight, disabled: lock, style: 'width:90px;padding:8px 10px;font-size:15px', oninput: (e) => { q.weight = e.target.value; touch(); } })));
}

function quickText(m) {
  const area = h('textarea', { placeholder: 'Qual partícula tem carga negativa? | Próton | *Elétron | Nêutron\nExplique a ligação iônica. || peso=2' });
  return h('details', {}, h('summary', { class: 'caption', style: 'cursor:pointer' }, 'Colar várias questões em texto'),
    h('div', { class: 'stack-s', style: 'margin-top:12px' },
      h('code', { class: 'mono-tip' }, 'Enunciado | alternativa | *correta | alternativa || peso=2'), area,
      h('div', {}, h('button', { class: 'btn secondary', onclick: () => { const qs = parseQuestionsText(area.value).map((q) => ({ ...q, correctIndex: q.correct ? q.options.indexOf(q.correct) : null })); if (!qs.length) return; if (m.questions.length === 1 && !m.questions[0].text) m.questions = []; m.questions.push(...qs); touch(); render(); } }, 'Adicionar ao editor'))));
}

function documentCard(m) {
  const picker = h('input', { type: 'file', id: 'doc-file', accept: '.pdf,.docx', onchange: guard(async (ev) => {
    const file = ev.target.files[0]; ev.target.value = '';
    if (!file) return;
    if (!m.id) await save();
    const { document } = await api(`/api/exams/${state.model.id}/document?name=${encodeURIComponent(file.name)}`, { method: 'POST', raw: file });
    state.model.document = document; toast('Documento anexado');
  }) });
  return h('div', { class: 'card stack-s' },
    h('h2', { class: 'headline' }, 'Documento da prova'),
    h('p', { class: 'sub' }, m.document ? `${m.document.name} · ${(m.document.size / 1048576).toFixed(1)} MB` : 'Opcional: anexe um PDF ou DOCX com textos e figuras. O aluno vê o arquivo junto das questões.'),
    h('div', { class: 'row' }, picker, h('label', { class: 'btn secondary', for: 'doc-file' }, m.document ? 'Trocar arquivo' : 'Anexar PDF ou DOCX'),
      m.document && h('button', { class: 'btn danger', onclick: guard(async () => { await api(`/api/exams/${m.id}/document`, { method: 'DELETE' }); m.document = null; }) }, 'Remover')));
}
