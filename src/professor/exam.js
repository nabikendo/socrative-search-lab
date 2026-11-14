import qrcode from 'qrcode-generator';
import { api } from '../lib/api.js';
import { h, clear, toast, plural } from '../lib/dom.js';
import { questionId, parseQuestionsText, parsePdfQuestionText } from '../../shared/exam.js';
import { SAEB_LEVELS, SAEB_SKILLS, skillLabel } from '../../shared/skills.js';

let root;
let timer;
const state = { exams: [], classes: [], model: null, dirty: false, urls: [], live: null, error: '' };

export function mount(el) { root = el; }
export async function activate() {
  state.urls = (await api('/api/network').catch(() => ({ urls: [] }))).urls;
  state.classes = (await api('/api/classes')).classes;
  await loadList();
  const open = state.exams.find((e) => e.status === 'open');
  await select(state.model?.id && state.exams.some((e) => e.id === state.model.id) ? state.model.id : (open || state.exams[0])?.id);
  timer = setInterval(pollLive, 5000);
}
export function deactivate() { clearInterval(timer); }
window.addEventListener('atlas:add-bank-question', async (event) => {
  const m = state.model;
  if (!m?.id) { toast('Salve a prova primeiro para adicionar questões do banco.'); return; }
  if (m.locked || m.status === 'open') { toast('Encerre ou duplique a prova antes de alterar as questões.'); return; }
  m.pdfOnly = false;
  m.questions.push({ ...event.detail, id: questionId(), correctIndex: event.detail.correct ? event.detail.options.indexOf(event.detail.correct) : null });
  state.dirty = true;
  try { await save(); toast('Questão adicionada à prova'); }
  catch (error) { toast(error.message); }
});

const blank = () => ({ id: null, title: '', status: 'draft', accessCode: null, document: null, locked: false, shuffle: false,
  pdfOnly: true, classId: state.classes[0]?.id || null, feedback: false, questions: [newQuestion('choice')] });
function newQuestion(type) {
  return { id: questionId(), type, text: '', options: type === 'choice' ? ['', ''] : [], correctIndex: null, weight: 1 };
}
const fromServer = (exam, locked) => ({ ...exam, locked, pdfOnly: !exam.questions.length, questions: exam.questions.map((q) => ({ ...q, correctIndex: q.correct ? q.options.indexOf(q.correct) : null })) });
function payload() {
  return { id: state.model.id, title: state.model.title, shuffle: !!state.model.shuffle, classId: state.model.classId || null, feedback: !!state.model.feedback, questions: state.model.pdfOnly ? [] : state.model.questions.map((q) => {
    const options = q.options.map((o) => o.trim());
    const correct = q.type === 'choice' && q.correctIndex !== null ? options[q.correctIndex] : undefined;
    return { id: q.id, type: q.type, text: q.text, options: options.filter(Boolean), ...(correct ? { correct } : {}), weight: Number(q.weight) || 1, skill: q.skill || '', explanation: q.explanation || '' };
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
      h('label', { class: 'field' }, h('span', {}, 'Turma'), h('select', { value: m.classId || '', disabled: m.locked, onchange: (e) => { m.classId = e.target.value || null; touch(); } }, h('option', { value: '' }, 'Lista geral'), state.classes.map((c) => h('option', { value: c.id }, c.name)))),
      h('label', { class: 'option', style: 'border-radius:14px' },
        h('input', { type: 'checkbox', checked: !!m.shuffle, disabled: m.locked, onchange: (e) => { m.shuffle = e.target.checked; touch(); } }),
        h('span', {}, h('strong', {}, 'Embaralhar para cada aluno'), h('span', { class: 'caption', style: 'display:block' }, 'Cada aluno vê as questões e as alternativas em ordem diferente. Evite alternativas como “todas as anteriores”.'))),
      h('label', { class: 'option', style: 'border-radius:14px' }, h('input', { type: 'checkbox', checked: !!m.feedback, disabled: m.locked, onchange: (e) => { m.feedback = e.target.checked; touch(); } }), h('span', {}, h('strong', {}, 'Mostrar feedback após cada questão'), h('span', { class: 'caption', style: 'display:block' }, 'Mostra gabarito e explicação depois que o aluno responder.')))),

    ...(m.pdfOnly ? [] : m.questions.map((q, i) => questionCard(q, i))),

    !m.locked && h('div', { class: 'row' },
      h('button', { class: 'btn secondary', onclick: () => { m.questions.push(newQuestion('choice')); touch(); render(); } }, 'Adicionar questão'),
      h('button', { class: 'btn quiet', onclick: () => { m.questions.push(newQuestion('text')); touch(); render(); } }, 'Questão aberta')),
    !m.locked && pdfOnlyOption(m),
    !m.locked && !m.pdfOnly && quickText(m),
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
    h('div', { class: 'row' },
      h('label', { class: 'field grow' }, h('span', {}, 'Habilidade SAEB de Matemática'), h('select', { value: q.skill || '', disabled: lock, onchange: (e) => { q.skill = e.target.value; touch(); } },
        h('option', { value: '' }, 'Sem habilidade vinculada'),
        q.skill && /^D\d{1,2}$/.test(q.skill) && h('option', { value: q.skill }, skillLabel(q.skill)),
        ...SAEB_LEVELS.map((level) => h('optgroup', { label: level.label }, SAEB_SKILLS.filter((item) => item.id.startsWith(`${level.id}-`)).map((item) => h('option', { value: item.id }, item.label)))))),
      h('label', { class: 'field' }, h('span', {}, 'Peso'), h('input', { type: 'number', min: '0.25', max: '100', step: '0.25', value: q.weight, disabled: lock, style: 'width:90px', oninput: (e) => { q.weight = e.target.value; touch(); } }))),
    h('label', { class: 'field' }, h('span', {}, 'Explicação da resposta correta'), h('textarea', { value: q.explanation || '', disabled: lock, placeholder: 'Opcional: será exibida ao estudante se o feedback estiver ativado.', oninput: (e) => { q.explanation = e.target.value; touch(); } })),
    !lock && h('button', { class: 'btn quiet', type: 'button', onclick: guard(async () => {
      const raw = payload().questions[index];
      if (!raw.text?.trim()) throw new Error('Escreva o enunciado antes de salvar no banco de questões.');
      await api('/api/question-bank', { method: 'POST', body: raw }); toast('Questão salva no banco');
    }) }, 'Salvar questão no banco'));
}

function quickText(m) {
  const area = h('textarea', { placeholder: 'Qual partícula tem carga negativa? | Próton | *Elétron | Nêutron\nExplique a ligação iônica. || peso=2' });
  return h('details', {}, h('summary', { class: 'caption', style: 'cursor:pointer' }, 'Colar várias questões em texto'),
    h('div', { class: 'stack-s', style: 'margin-top:12px' },
      h('code', { class: 'mono-tip' }, 'Enunciado | alternativa | *correta | alternativa || peso=2'), area,
      h('div', {}, h('button', { class: 'btn secondary', onclick: () => { const qs = parseQuestionsText(area.value).map((q) => ({ ...q, correctIndex: q.correct ? q.options.indexOf(q.correct) : null })); if (!qs.length) return; if (m.questions.length === 1 && !m.questions[0].text) m.questions = []; m.questions.push(...qs); touch(); render(); } }, 'Adicionar ao editor'))));
}

function pdfOnlyOption(m) {
  return h('label', { class: 'option card', style: 'border-radius:14px' },
    h('input', { type: 'checkbox', checked: !!m.pdfOnly, onchange: (event) => {
      m.pdfOnly = event.target.checked;
      if (m.pdfOnly) m.questions = [];
      else if (!m.questions.length) m.questions = [newQuestion('choice')];
      touch(); render();
    } }),
    h('span', {}, h('strong', {}, 'As questões estão em um PDF'),
      h('span', { class: 'caption', style: 'display:block' }, 'Os alunos abrem o arquivo e entregam a prova sem preencher questões nesta tela.')));
}

function documentCard(m) {
  const picker = h('input', { type: 'file', id: 'doc-file', accept: '.pdf,.docx', onchange: guard(async (ev) => {
    const file = ev.target.files[0]; ev.target.value = '';
    if (!file) return;
    const wantsPdfOnly = state.model.pdfOnly && file.name.toLowerCase().endsWith('.pdf');
    if (!wantsPdfOnly && state.model.pdfOnly) {
      state.model.pdfOnly = false;
      if (!state.model.questions.length) state.model.questions = [newQuestion('choice')];
    }
    if (!m.id) {
      if (wantsPdfOnly) {
        m.pdfOnly = false;
        m.questions = [{ ...newQuestion('text'), text: 'Responda usando o documento da prova.' }];
      }
      await save();
      state.model.pdfOnly = wantsPdfOnly;
    }
    const { document } = await api(`/api/exams/${state.model.id}/document?name=${encodeURIComponent(file.name)}`, { method: 'POST', raw: file });
    state.model.document = document;
    if (wantsPdfOnly) {
      state.model.questions = [];
      await save();
      toast('Prova em PDF importada');
    } else { render(); toast('Documento anexado'); }
  }) });
  return h('div', { class: 'card stack-s' },
    h('h2', { class: 'headline' }, 'Documento da prova'),
      h('p', { class: 'sub' }, m.document ? `${m.document.name} · ${(m.document.size / 1048576).toFixed(1)} MB` : m.pdfOnly ? 'Importe o PDF que contém as questões. A lista de alunos abrirá o arquivo e poderá entregar a prova sem digitar as questões no Atlas.' : 'Opcional: anexe um PDF ou DOCX com textos e figuras. O aluno vê o arquivo junto das questões.'),
    h('div', { class: 'row' }, picker, h('label', { class: 'btn secondary', for: 'doc-file' }, m.document ? 'Trocar arquivo' : 'Anexar PDF ou DOCX'),
      m.document?.kind === 'pdf' && !m.locked && h('button', { class: 'btn secondary', onclick: guard(async () => {
        const response = await fetch(`/api/document/${m.document.id}`);
        if (!response.ok) throw new Error('Não consegui abrir o PDF para extrair as questões.');
        const { extractPdfText } = await import('./pdf-text.js');
        const extracted = parsePdfQuestionText(await extractPdfText(await response.blob()));
        if (!extracted.length) throw new Error('Não encontrei questões numeradas no texto deste PDF. Se ele for digitalizado como imagem, use a opção “As questões estão em um PDF” ou digite as questões.');
        m.pdfOnly = false;
        m.questions = extracted.map((q) => ({ ...q, correctIndex: null }));
        touch(); await save();
        toast(`${extracted.length} questões extraídas. Revise os enunciados e gabaritos antes de abrir a prova.`);
      }) }, 'Extrair questões para revisar'),
      m.document && h('button', { class: 'btn danger', onclick: guard(async () => { await api(`/api/exams/${m.id}/document`, { method: 'DELETE' }); m.document = null; }) }, 'Remover')));
}

