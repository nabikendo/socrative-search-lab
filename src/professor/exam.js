import qrcode from 'qrcode-generator';
import { api } from '../lib/api.js';
import { h, clear, toast, plural } from '../lib/dom.js';
import { questionId, parseQuestionsText, parsePdfQuestionText } from '../../shared/exam.js';
import { SAEB_LEVELS, SAEB_SKILLS, skillLabel } from '../../shared/skills.js';

let root;
let timer;
const state = { exams: [], classes: [], model: null, dirty: false, urls: [], live: null, error: '', scheduleStart: '', scheduleEnd: '' };

export function mount(el) { root = el; }
export async function activate() {
  const network=await api('/api/network').catch(() => ({ urls: [] }));
  state.urls = network.urls;
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
  m.questions.push({ ...event.detail, id: questionId(), correctIndex: typeof event.detail.correct==='string'?event.detail.options.indexOf(event.detail.correct):null, correctIndexes:Array.isArray(event.detail.correct)?event.detail.correct.map((value)=>event.detail.options.indexOf(value)).filter((i)=>i>=0):[], numericAnswer:event.detail.type==='numeric'?event.detail.correct:'' });
  state.dirty = true;
  try { await save(); toast('Questão adicionada à prova'); }
  catch (error) { toast(error.message); }
});

const blank = () => ({ id: null, title: '', status: 'draft', accessCode: null, document: null, locked: false, shuffle: false,
  pdfOnly: true, classId: state.classes[0]?.id || null, feedback: false, questions: [newQuestion('choice')] });
function newQuestion(type) {
  return { id: questionId(), type, text: '', options: ['choice','multi'].includes(type) ? ['', ''] : [], correctIndex: null, correctIndexes:[], numericAnswer:'', tolerance:0, image:'', imageAlt:'', topic:'',difficulty:'',rubric:[],weight: 1 };
}
const fromServer = (exam, locked) => ({ ...exam, locked, pdfOnly: !exam.questions.length, questions: exam.questions.map((q) => ({ ...q, correctIndex: typeof q.correct==='string'&&q.options?q.options.indexOf(q.correct):null, correctIndexes:Array.isArray(q.correct)?q.correct.map((answer)=>q.options.indexOf(answer)).filter((i)=>i>=0):[], numericAnswer:q.type==='numeric'?q.correct:'', tolerance:q.tolerance ?? 0 })) });
function payload() {
  return { id: state.model.id, title: state.model.title, shuffle: !!state.model.shuffle, classId: state.model.classId || null, feedback: !!state.model.feedback, questions: state.model.pdfOnly ? [] : state.model.questions.map((q) => {
    const options = q.options.map((o) => o.trim());
    const correct = q.type === 'choice' && q.correctIndex !== null ? options[q.correctIndex] : q.type==='multi' ? (q.correctIndexes||[]).map((i)=>options[i]).filter(Boolean) : q.type==='numeric' && q.numericAnswer!=='' ? Number(String(q.numericAnswer).replace(',','.')) : undefined;
    return { id: q.id, type: q.type, text: q.text, options: options.filter(Boolean), ...(correct!==undefined&&correct!=='' ? { correct } : {}), ...(q.type==='numeric'?{tolerance:Number(q.tolerance)||0}:{}), image:q.image||'',imageAlt:q.imageAlt||'',topic:q.topic||'',difficulty:q.difficulty||'',rubric:q.rubric||[],weight: Number(q.weight) || 1, skill: q.skill || '', explanation: q.explanation || '' };
  }) };
}

async function loadList() { state.exams = (await api('/api/exams')).exams; }
async function select(id) {
  state.error = '';
  state.dirty = false;
  state.live = null;
  state.scheduleStart = '';
  state.scheduleEnd = '';
  if (id) {
    const { exam } = await api(`/api/exams/${id}`);
    state.model = fromServer(exam, state.exams.find((e) => e.id === id)?.sessions > 0);
  } else state.model = blank();
  render();
  pollLive();
}
async function pollLive() {
  const m = state.model;
  if (!m?.id || !['open','paused'].includes(m.status) || root.hidden) return;
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
async function createVersion(exam, kind) {
  if (state.dirty && !confirm('Criar a versão a partir da última prova salva?')) return;
  const { exam: copy } = await api(`/api/exams/${exam.id}/version`, { method: 'POST', body: { kind } });
  await loadList();
  await select(copy.id);
}
const guard = (fn) => async (ev) => { try { state.error = ''; await fn(ev); } catch (e) { state.error = e.message; } render(); };
const touch = () => { state.dirty = true; const b = root.querySelector('#save'); if (b) b.disabled = false; };

function render() {
  const m = state.model;
  const isOpen = m.status === 'open';
  const isPaused = m.status === 'paused';
  const isScheduled = m.status === 'scheduled';
  clear(root, h('div', { class: 'stack' },
    h('div', { class: 'row between' },
      h('h1', { class: 'title' }, 'Prova'),
      h('div', { class: 'row' },
        h('select', { 'aria-label': 'Escolher prova', style: 'width:auto;max-width:260px', onchange: guard(async (ev) => { await select(ev.target.value || null); }) },
          state.exams.map((e) => h('option', { value: e.id, selected: e.id === m.id }, e.title + (e.status === 'open' ? ' ●' : ''))),
          !m.id && h('option', { value: '', selected: true }, 'Nova prova')),
        h('button', { class: 'btn secondary', onclick: () => { state.model = blank(); state.dirty = false; render(); } }, 'Nova'))),

    isOpen && openBanner(m),
    m.original && h('p', { class: 'notice' }, `${m.original.kind === 'second-call' ? 'Segunda chamada' : 'Versão de'} · ${m.original.title}`),
    isPaused && h('div',{class:'card stack-s'},h('div',{class:'row between'},h('strong',{},'Prova pausada'),h('span',{class:'hero-code'},m.accessCode)),h('p',{class:'sub'},'Os alunos conectados estão impedidos de responder. Retome quando estiver pronto.'),h('button',{class:'btn secondary',onclick:()=>window.open(`/projetor?exam=${encodeURIComponent(m.id)}`,'_blank','noopener')},'Abrir acompanhamento no projetor')),
    isScheduled && h('div', { class:'notice' }, `Esta prova abrirá automaticamente em ${new Date(m.scheduledStart).toLocaleString('pt-BR')}${m.scheduledEnd ? ` e encerrará em ${new Date(m.scheduledEnd).toLocaleString('pt-BR')}` : ''}.`),
    m.id && !isOpen && !isPaused && scheduleCard(m),
    m.locked && h('div', { class: 'notice' }, 'Esta prova já tem respostas, então as questões estão travadas. Para mudar algo, duplique a prova.'),

    h('div', { class: 'card stack-s' },
      h('label', { class: 'field' }, h('span', {}, 'Título'), h('input', { value: m.title, placeholder: 'Ex.: Ligações químicas — 1º bimestre', oninput: (e) => { m.title = e.target.value; touch(); } })),
      h('label', { class: 'field' }, h('span', {}, 'Turma'), h('select', { value: m.classId || '', disabled: m.locked, onchange: (e) => { m.classId = e.target.value || null; touch(); } }, h('option', { value: '' }, 'Lista geral'), state.classes.map((c) => h('option', { value: c.id }, c.name)))),
      h('label', { class: 'option', style: 'border-radius:14px' },
        h('input', { type: 'checkbox', checked: !!m.shuffle, disabled: m.locked, onchange: (e) => { m.shuffle = e.target.checked; touch(); } }),
        h('span', {}, h('strong', {}, 'Embaralhar para cada aluno'), h('span', { class: 'caption', style: 'display:block' }, 'Cada aluno vê as questões e as alternativas em ordem diferente. Evite alternativas como “todas as anteriores”.'))),
      h('label', { class: 'option', style: 'border-radius:14px' }, h('input', { type: 'checkbox', checked: !!m.feedback, disabled: m.locked, onchange: (e) => { m.feedback = e.target.checked; touch(); } }), h('span', {}, h('strong', {}, 'Mostrar feedback após cada questão'), h('span', { class: 'caption', style: 'display:block' }, 'Mostra gabarito e explicação depois que o aluno responder.')))),

    !m.pdfOnly && h('div', { class: `question-layout${m.document?.kind === 'pdf' ? ' with-original' : ''}` },
      h('div', { class: 'stack' }, m.questions.map((q, i) => questionCard(q, i))),
      m.document?.kind === 'pdf' && h('details', { class: 'card', ontoggle: async (event) => {
        const details = event.currentTarget;
        const viewer = details.querySelector('.original-pdf');
        if (!details.open || viewer.dataset.loaded) return;
        viewer.dataset.loaded = 'true';
        try {
          const { mountPdf } = await import('../lib/pdf-viewer.js');
          await mountPdf(viewer, `/api/document/${m.document.id}`);
        } catch {
          delete viewer.dataset.loaded;
          viewer.textContent = 'Não consegui abrir o PDF original.';
        }
      } },
        h('summary', {}, 'Conferir com o PDF original'),
        h('div', { class: 'original-pdf', 'aria-label': 'PDF original da prova' }))),

    !m.locked && h('div', { class: 'row' },
      h('button', { class: 'btn secondary', onclick: () => { m.questions.push(newQuestion('choice')); touch(); render(); } }, 'Adicionar questão'),
      h('button', { class: 'btn quiet', onclick: () => { m.questions.push(newQuestion('text')); touch(); render(); } }, 'Questão aberta')),
    !m.locked && pdfOnlyOption(m),
    !m.locked && !m.pdfOnly && quickText(m),
    documentCard(m),

    state.error && h('p', { class: 'error', role: 'alert' }, state.error),
    h('div', { class: 'row' },
      h('button', { id: 'save', class: 'btn', disabled: !state.dirty && !!m.id, onclick: guard(async () => { await save(); toast('Prova salva'); }) }, 'Salvar'),
      m.id && h('a', { class: 'btn quiet', href: `/prova?ensaio=${encodeURIComponent(m.id)}` }, 'Ensaiar prova salva'),
      m.id && h('button', { class: 'btn quiet', onclick: guard(() => createVersion(m, 'version')) }, 'Criar versão'),
      m.id && h('button', { class: 'btn quiet', onclick: guard(() => createVersion(m, 'second-call')) }, 'Criar segunda chamada'),
      isPaused
        ? h('div',{class:'row'},h('button',{class:'btn secondary',onclick:guard(async()=>{await api(`/api/exams/${m.id}/resume`,{method:'POST'});await loadList();await select(m.id);toast('Prova retomada para toda a turma');})},'Retomar prova'),h('button',{class:'btn danger',onclick:guard(async()=>{await api(`/api/exams/${m.id}/close`,{method:'POST'});await loadList();await select(m.id);toast('Prova encerrada');})},'Encerrar prova'))
        : isOpen
        ? h('div',{class:'row'},h('button',{class:'btn quiet',onclick:guard(async()=>{await api(`/api/exams/${m.id}/pause`,{method:'POST'});await loadList();await select(m.id);toast('Prova pausada para toda a turma');})},'Pausar turma'),h('button',{class:'btn secondary',onclick:guard(async()=>{await api(`/api/exams/${m.id}/close`,{method:'POST'});await loadList();await select(m.id);})},'Encerrar prova'))
        : isScheduled
        ? h('button', { class:'btn secondary', onclick:guard(async () => { await api(`/api/exams/${m.id}/schedule/cancel`, { method:'POST' }); await loadList(); await select(m.id); toast('Agendamento cancelado'); }) }, 'Cancelar agendamento')
        : h('button', { class: 'btn secondary', onclick: guard(async () => {
          const questions = payload().questions;
          const review = await Promise.all(questions.map(async (question, index) => {
            const issues = [];
            if ((question.type === 'choice' && !question.correct) || (question.type === 'multi' && !question.correct?.length)) issues.push('sem gabarito');
            const options = question.options.map((option) => option.trim().toLocaleLowerCase('pt-BR')).filter(Boolean);
            if (new Set(options).size < options.length) issues.push('alternativas repetidas');
            const weight = Number(m.questions[index].weight);
            if (!Number.isFinite(weight) || weight <= 0 || weight > 100) issues.push('peso inválido');
            if (question.image) {
              const image = new Image();
              image.src = question.image;
              try { await image.decode(); } catch { issues.push('imagem não abriu'); }
            }
            return issues.length ? `Questão ${index + 1}: ${issues.join(', ')}` : null;
          }));
          const total = questions.reduce((sum, question) => sum + question.weight, 0);
          if (!confirm(`Revisar e abrir a prova?\n\n${questions.length} questões · ${total.toFixed(2)} pontos\n${review.filter(Boolean).join('\n')}`)) return;
          const { id } = state.dirty || !m.id ? await save() : m;
          const { code } = await api(`/api/exams/${id}/open`, { method: 'POST' });
          await loadList();
          await select(id);
          toast(`Prova aberta · código ${code}`);
        }) }, 'Abrir para os alunos'),
      m.id && h('button', { class: 'btn quiet', onclick: guard(async () => { state.model = { ...blank(), title: `${m.title} (cópia)`, questions: payloadQuestions(m).map((q) => ({ ...q, correctIndex: typeof q.correct==='string'?q.options.indexOf(q.correct):null, correctIndexes:Array.isArray(q.correct)?q.correct.map((value)=>q.options.indexOf(value)).filter((i)=>i>=0):[],numericAnswer:q.type==='numeric'?q.correct:'' })) }; state.dirty = true; }) }, 'Duplicar'),
      m.id && !isOpen && !isPaused && h('button', { class: 'btn danger', onclick: guard(async () => { if (!confirm('Excluir esta prova?')) return; await api(`/api/exams/${m.id}`, { method: 'DELETE' }); await loadList(); await select(state.exams[0]?.id); }) }, 'Excluir'))));
}
const payloadQuestions = (m) => payload().questions.map((q) => ({ ...q, id: questionId() }));

function openBanner(m) {
  const url = state.urls.length ? `${state.urls[0]}/prova` : '';
  if (!url) return h('div', { class: 'notice warn' }, `Código: ${m.accessCode}. Conecte este computador à rede dos alunos para gerar o endereço de acesso.`);
  const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
  return h('div', { class: 'card row', style: 'gap:28px' },
    h('div', { class: 'qr', 'aria-label': `QR Code de ${url}`, innerHTML: qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true }) }),
    h('div', { class: 'stack-s grow' },
      h('span', { class: 'eyebrow' }, 'Prova aberta · código'),
      h('div', { class: 'hero-code' }, m.accessCode),
      h('p', {}, 'Endereço para os alunos: ', h('strong', {}, url)),
      state.urls.length > 1 && h('p', { class: 'caption' }, 'Outros endereços deste computador: ', state.urls.slice(1).map((u) => `${u}/prova`).join(' · ')),
      h('button', { class:'btn secondary', type:'button', onclick:() => window.open(`/projetor?exam=${encodeURIComponent(m.id)}`, '_blank', 'noopener') }, 'Abrir acompanhamento no projetor'),
      h('span', { id: 'live', class: 'badge ok' }, liveText())));
}

function localDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.valueOf() - offset).toISOString().slice(0, 16);
}

function scheduleCard(m) {
  return h('div', { class:'card stack-s' },
    h('h2', { class:'headline' }, 'Agendar aplicação'),
    h('p', { class:'sub' }, 'O Atlas abrirá a prova neste computador no horário escolhido. Mantenha o Atlas ligado e conectado à rede.'),
    h('div', { class:'row' },
      h('label', { class:'field' }, h('span', {}, 'Início'), h('input', { type:'datetime-local', required:true, value:state.scheduleStart || localDateTime(m.scheduledStart), oninput:(e) => { state.scheduleStart=e.target.value; } })),
      h('label', { class:'field' }, h('span', {}, 'Encerramento (opcional)'), h('input', { type:'datetime-local', value:state.scheduleEnd || localDateTime(m.scheduledEnd), oninput:(e) => { state.scheduleEnd=e.target.value; } }))),
    !m.scheduledStart && h('button', { class:'btn secondary', onclick:guard(async () => {
      if (!state.scheduleStart) throw new Error('Escolha o horário de início.');
      const startAt = new Date(state.scheduleStart);
      const endAt = state.scheduleEnd ? new Date(state.scheduleEnd) : null;
      if (Number.isNaN(startAt.valueOf()) || (state.scheduleEnd && Number.isNaN(endAt.valueOf()))) throw new Error('Confira os horários informados.');
      await api(`/api/exams/${m.id}/schedule`, { method:'POST', body:{ startAt:startAt.toISOString(), endAt:endAt?.toISOString() || null } });
      await loadList(); await select(m.id); toast('Prova agendada');
    }) }, 'Salvar agendamento'));
}

function questionText(question, index, locked) {
  const input = h('textarea', { value: question.text, disabled: locked, placeholder: 'Enunciado',
    'aria-label': `Enunciado da questão ${index + 1}`, oninput: (event) => { question.text = event.target.value; touch(); } });
  const insert = (value) => {
    input.setRangeText(value, input.selectionStart, input.selectionEnd, 'end');
    question.text = input.value;
    touch();
    input.focus();
  };
  return h('div', { class: 'stack-s' }, input, !locked && h('div', { class: 'row' },
    h('button', { class: 'btn quiet', onclick: () => {
      const top = prompt('Numerador');
      if (!top) return;
      const bottom = prompt('Denominador');
      if (bottom) insert(`(${top})⁄(${bottom})`);
    } }, 'Fração'),
    h('button', { class: 'btn quiet', onclick: () => {
      const value = prompt('Expressão dentro da raiz');
      if (value) insert(`√(${value})`);
    } }, 'Raiz'),
    h('button', { class: 'btn quiet', onclick: () => {
      const value = prompt('Expoente inteiro');
      if (value && /^-?\d+$/.test(value)) insert([...value].map((character) => character === '-' ? '⁻' : '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(character)]).join(''));
    } }, 'Potência'),
    h('button', { class: 'btn quiet', onclick: () => {
      const values = prompt('Valores do gráfico de barras, separados por ponto e vírgula', '2;5;3');
      if (!values) return;
      const points = values.split(';').map((value) => value.trim().replace(',', '.'));
      const numbers = points.map(Number);
      if (numbers.length > 12 || points.some((value, i) => !value || !Number.isFinite(numbers[i]))) { toast('Informe até 12 valores numéricos.'); return; }
      if (question.image && !confirm('Substituir a imagem atual por este gráfico?')) return;
      const canvas = document.createElement('canvas');
      canvas.width = 720;
      canvas.height = 320;
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, 720, 320);
      context.font = '16px sans-serif';
      const min = Math.min(0, ...numbers);
      const max = Math.max(0, ...numbers);
      const range = max - min || 1;
      const y = (number) => 254 - 205 * (number - min) / range;
      context.fillStyle = '#111';
      context.fillRect(24, y(0), 672, 1);
      const width = 672 / numbers.length;
      numbers.forEach((number, i) => {
        const left = 24 + i * width;
        context.fillStyle = '#51439f';
        context.fillRect(left + 10, Math.min(y(0), y(number)), width - 20, Math.abs(y(number) - y(0)));
        context.fillStyle = '#111';
        context.fillText(`${String.fromCharCode(65 + i)}: ${points[i]}`, left + 4, 289, width - 8);
      });
      question.image = canvas.toDataURL('image/png');
      question.imageAlt = `Gráfico de barras. ${points.map((value, i) => `${String.fromCharCode(65 + i)}: ${value}`).join('; ')}.`;
      touch();
      render();
    } }, 'Gráfico de barras')));
}

function questionCard(q, index) {
  const m = state.model;
  const lock = m.locked;
  return h('div', { class: 'card q-card' },
    h('div', { class: 'q-head' },
      h('span', { class: 'eyebrow' }, `Questão ${index + 1}`),
      h('div', { class: 'row' },
        !lock && h('select',{ 'aria-label':`Tipo da questão ${index+1}`, value:q.type, onchange:(e)=>{q.type=e.target.value;if(['choice','multi'].includes(q.type)&&q.options.length<2)q.options=['',''];touch();render();}},
          h('option',{value:'choice'},'Uma alternativa correta'),h('option',{value:'multi'},'Várias alternativas corretas'),h('option',{value:'numeric'},'Resposta numérica'),h('option',{value:'text'},'Resposta aberta')),
        !lock && m.questions.length > 1 && h('button', { class: 'pill-btn', 'aria-label': 'Remover questão', onclick: () => { m.questions.splice(index, 1); touch(); render(); } }, '×'))),
    questionText(q, index, lock),
    ['choice','multi'].includes(q.type) && h('div', { class: 'stack-s' },
      q.options.map((option, i) => h('div', { class: 'opt-row' },
        h('input', { type: q.type==='choice'?'radio':'checkbox', name: `c-${q.id}`, checked: q.type==='choice'?q.correctIndex===i:q.correctIndexes.includes(i), disabled: lock, title: 'Resposta correta', 'aria-label': `Alternativa ${i + 1} é correta`, onchange: () => { if(q.type==='choice')q.correctIndex=i;else if(q.correctIndexes.includes(i))q.correctIndexes=q.correctIndexes.filter((x)=>x!==i);else q.correctIndexes.push(i);touch(); } }),
        h('input', { type: 'text', value: option, disabled: lock, placeholder: `Alternativa ${i + 1}`, oninput: (e) => { q.options[i] = e.target.value; touch(); } }),
        !lock && q.options.length > 2 && h('button', { class: 'pill-btn', 'aria-label': 'Remover alternativa', onclick: () => { q.options.splice(i, 1); q.correctIndex = q.correctIndex === i ? null : q.correctIndex > i ? q.correctIndex - 1 : q.correctIndex; q.correctIndexes=q.correctIndexes.filter((x)=>x!==i).map((x)=>x>i?x-1:x); touch(); render(); } }, '×'))),
      !lock && q.options.length < 10 && h('div', {}, h('button', { class: 'btn quiet', onclick: () => { q.options.push(''); touch(); render(); } }, 'Adicionar alternativa')),
      h('p', { class: 'caption' }, q.type==='choice' ? (q.correctIndex === null ? 'Marque a correta para correção automática; sem marcação, a nota é manual.' : 'Correção automática ativada.') : `${q.correctIndexes.length} alternativa(s) correta(s) marcada(s).`)),
    q.type==='numeric' && h('div',{class:'row'},
      h('label',{class:'field'},h('span',{},'Resposta correta'),h('input',{type:'number',step:'any',value:q.numericAnswer,disabled:lock,oninput:(e)=>{q.numericAnswer=e.target.value;touch();}})),
      h('label',{class:'field'},h('span',{},'Margem de tolerância'),h('input',{type:'number',min:'0',step:'any',value:q.tolerance,disabled:lock,oninput:(e)=>{q.tolerance=e.target.value;touch();}}))),
    h('div',{class:'stack-s'},
      h('label',{class:'field'},h('span',{},'Imagem da questão (opcional)'),h('input',{type:'file',accept:'image/png,image/jpeg,image/webp',disabled:lock,onchange:async(e)=>{
        const file=e.target.files[0];e.target.value='';if(!file)return;
        if(file.size>200000){toast('Use uma imagem de até 200 KB.');return;}
        q.image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(file);});touch();render();
      }})),
      q.image&&h('img',{src:q.image,alt:q.imageAlt||'Imagem da questão',style:'max-width:100%;max-height:280px;object-fit:contain;border-radius:12px'}),
      q.image&&h('div',{class:'row'},h('label',{class:'field grow'},h('span',{},'Descrição acessível da imagem'),h('input',{value:q.imageAlt||'',disabled:lock,oninput:(e)=>{q.imageAlt=e.target.value;touch();}})),!lock&&h('button',{class:'btn quiet',onclick:()=>{q.image='';q.imageAlt='';touch();render();}},'Remover imagem'))),
    h('div', { class: 'row' },
      h('label', { class: 'field grow' }, h('span', {}, 'Habilidade SAEB de Matemática'), h('select', { value: q.skill || '', disabled: lock, onchange: (e) => { q.skill = e.target.value; touch(); } },
        h('option', { value: '' }, 'Sem habilidade vinculada'),
        q.skill && /^D\d{1,2}$/.test(q.skill) && h('option', { value: q.skill }, skillLabel(q.skill)),
        ...SAEB_LEVELS.map((level) => h('optgroup', { label: level.label }, SAEB_SKILLS.filter((item) => item.id.startsWith(`${level.id}-`)).map((item) => h('option', { value: item.id }, item.label)))))),
      h('label', { class: 'field' }, h('span', {}, 'Peso'), h('input', { type: 'number', min: '0.25', max: '100', step: '0.25', value: q.weight, disabled: lock, style: 'width:90px', oninput: (e) => { q.weight = e.target.value; touch(); } }))),
    h('div',{class:'row'},
      h('label',{class:'field grow'},h('span',{},'Conteúdo'),h('input',{value:q.topic||'',maxLength:80,disabled:lock,placeholder:'Ex.: frações, geometria',oninput:(e)=>{q.topic=e.target.value;touch();}})),
      h('label',{class:'field'},h('span',{},'Dificuldade'),h('select',{value:q.difficulty||'',disabled:lock,onchange:(e)=>{q.difficulty=e.target.value;touch();}},h('option',{value:''},'Não definida'),h('option',{value:'easy'},'Fácil'),h('option',{value:'medium'},'Média'),h('option',{value:'hard'},'Difícil')))),
    h('label', { class: 'field' }, h('span', {}, 'Explicação da resposta correta'), h('textarea', { value: q.explanation || '', disabled: lock, placeholder: 'Opcional: será exibida ao estudante se o feedback estiver ativado.', oninput: (e) => { q.explanation = e.target.value; touch(); } })),
    h('details',{class:'rubric-editor'},h('summary',{class:'caption'},`Rubrica de correção${q.rubric?.length?` · ${q.rubric.length} níveis`:''}`),h('div',{class:'stack-s',style:'margin-top:12px'},
      (q.rubric||[]).map((level,index)=>h('div',{class:'row'},h('input',{value:level.label,disabled:lock,maxLength:80,placeholder:`Nível ${index+1}`,oninput:(e)=>{level.label=e.target.value;touch();}}),h('input',{type:'number',value:level.score,disabled:lock,min:0,max:q.weight,step:'0.25','aria-label':'Nota deste nível',oninput:(e)=>{level.score=Number(e.target.value);touch();}}),h('input',{value:level.description||'',disabled:lock,maxLength:240,placeholder:'Critério observado (opcional)',oninput:(e)=>{level.description=e.target.value;touch();}}),!lock&&h('button',{class:'btn quiet',type:'button','aria-label':'Remover nível da rubrica',onclick:()=>{q.rubric.splice(index,1);touch();render();}},'Remover'))),
       !lock&&(q.rubric||[]).length<8&&h('button',{class:'btn quiet',type:'button',onclick:()=>{q.rubric=q.rubric||[];q.rubric.push({label:`Nível ${q.rubric.length+1}`,score:0,description:''});touch();render();}},'Adicionar nível de desempenho'))),
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
      m.document?.kind === 'pdf' && !m.locked && h('button', { class: 'btn secondary', onclick: guard(async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        const label = button.textContent;
        try {
        const response = await fetch(`/api/document/${m.document.id}`);
        if (!response.ok) throw new Error('Não consegui abrir o PDF para extrair as questões.');
        const { extractPdfText } = await import('./pdf-text.js');
        const extracted = parsePdfQuestionText(await extractPdfText(await response.blob(), {
          recognizePage: async (image, page, total) => {
            button.textContent = `Reconhecendo página ${page} de ${total}…`;
            return (await api('/api/documents/ocr-page', { method: 'POST', raw: image })).text;
          },
        }));
        if (!extracted.length) throw new Error('Não encontrei questões numeradas neste PDF.');
        if (state.model !== m) return;
        if (!m.pdfOnly && m.questions.some((question) => question.text.trim()) &&
            !confirm(`Substituir as questões do editor por ${extracted.length} questões extraídas?`)) return;
        m.pdfOnly = false;
        m.questions = extracted.map((q) => ({ ...q, correctIndex: null }));
        touch(); render();
        toast(`${extracted.length} questões extraídas. Revise os enunciados e gabaritos antes de abrir a prova.`);
        } finally {
          button.disabled = false;
          button.textContent = label;
        }
      }) }, 'Extrair questões para revisar'),
      m.document && h('button', { class: 'btn danger', onclick: guard(async () => { await api(`/api/exams/${m.id}/document`, { method: 'DELETE' }); m.document = null; }) }, 'Remover')));
}

