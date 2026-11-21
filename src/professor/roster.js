import { api } from '../lib/api.js';
import { h, clear, toast, plural } from '../lib/dom.js';
import { parseRosterTextDetailed } from '../../shared/roster.js';
import { askText, askYesNo } from '../lib/ask.js';

let root;
let requestTimer;
const state = { roster: [], classes: [], classId: '', className: '', preview: null, duplicates: [], error: '', search: '', matches: [], history: null, moving: null, targetClassId: '', includeArchived: false, requests:[] };

export function mount(el) { root = el; render(); }
export async function activate() {
  state.classes = (await api(`/api/classes${state.includeArchived ? '?all=1' : ''}`)).classes;
  if (!state.classId && state.classes.length) state.classId = state.classes[0].id;
  syncClassName();
  await loadClassRoster(); await loadRequests(); render();
  clearInterval(requestTimer);
  requestTimer=setInterval(async()=>{if(!root.hidden && await loadRequests()) render();},5000);
}
export function deactivate() { clearInterval(requestTimer); }
async function loadClassRoster() { state.roster = state.classId ? (await api(`/api/classes/${state.classId}/roster`)).roster : (await api('/api/roster')).roster; }
async function loadRequests() { const next=(await api('/api/join-requests')).requests; const changed=JSON.stringify(next)!==JSON.stringify(state.requests); state.requests=next; return changed; }

async function answerRequest(request, approve) {
  try {
    await api(`/api/join-requests/${encodeURIComponent(request.id)}/${approve?'approve':'reject'}`,{method:'POST'});
    await loadRequests();
    state.classes=(await api(`/api/classes${state.includeArchived?'?all=1':''}`)).classes;
    await loadClassRoster(); render();
    toast(approve?'Aluno autorizado. Peça para tentar entrar novamente.':'Solicitação recusada.');
  } catch(error) { toast(error.message); }
}

async function searchStudents(term) {
  state.search = term;
  if (!term.trim()) { state.matches = []; render(); return; }
  state.matches = (await api(`/api/students/search?q=${encodeURIComponent(term)}`)).students;
  render();
}

async function showHistory(student) {
  try {
    const { history, recovery } = await api(`/api/students/${encodeURIComponent(student.id)}/history`);
    state.history = { student, entries: history, recovery };
  }
  catch (error) { state.history = { student, entries:[], error:error.message }; }
  render();
}

async function renameStudent(student) {
  const name = await askText('Corrija o nome do aluno:', student.name);
  if (!name) return;
  const number=await askText('Corrija o número de chamada:',student.number);
  if (!number || (name.trim() === student.name && number.trim()===student.number)) return;
  try {
    await api(`/api/classes/${student.classId || state.classId}/students/${encodeURIComponent(student.number)}/update`, { method:'POST', body:{ name, number:number.trim() } });
    await loadClassRoster();
    toast('Nome atualizado. As provas anteriores mantêm o registro original.');
    render();
  } catch (error) { toast(error.message); }
}

async function moveStudent() {
  if (!state.moving || !state.targetClassId) return;
  try {
    await api(`/api/classes/${state.moving.classId || state.classId}/students/${encodeURIComponent(state.moving.number)}/move`, { method:'POST', body:{ targetClassId:state.targetClassId } });
    state.moving = null; state.targetClassId = '';
    await loadClassRoster();
    toast('Aluno transferido. O histórico foi mantido.'); render();
  } catch (error) { toast(error.message); }
}

async function readFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) { const { extractPdfText } = await import('./pdf-text.js'); return parseRosterTextDetailed(await extractPdfText(file)); }
  if (name.endsWith('.xlsx')) { const parsed = await api('/api/roster/parse-xlsx', { method: 'POST', raw: file }); return { rows: parsed.roster, duplicates: parsed.duplicates || [] }; }
  return parseRosterTextDetailed(await file.text());
}

function propose(result) {
  const { rows, duplicates = [] } = Array.isArray(result) ? { rows: result } : result;
  state.error = rows.length ? '' : 'Não encontrei alunos. Use linhas como "3;Nome do aluno" ou uma planilha com número, nome e turma.';
  state.preview = rows.length ? rows : null;
  state.duplicates = duplicates;
  if (rows.length) {
    const detected = [...new Set(rows.map((r) => r.className).filter(Boolean))][0];
    if (detected) setTargetClassName(detected);
  }
  render();
}

function setTargetClassName(name) {
  state.className = name;
  state.classId = state.classes.find((c) => c.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase())?.id || '';
}

function previewClass(rows) {
  const classes = [...new Set(rows.map((row) => row.className).filter(Boolean))];
  return classes.length ? h('p', { class: 'notice' }, `Turma identificada: ${classes.join(', ')}`) : null;
}

// O nome acompanha a turma escolhida (antes ficava vazio na primeira carga e a importação parava).
function syncClassName() {
  if (state.classId) state.className = state.classes.find((c) => c.id === state.classId)?.name || state.className;
}

async function commit() {
  syncClassName();
  const name = state.className.trim();
  if (!name) throw new Error('Informe ou confirme o nome da turma antes de importar.');
  const saved = await api('/api/classes', { method: 'POST', body: { id: state.classId || undefined, name, roster: state.preview } });
  state.classId = saved.class.id;
  state.className = saved.class.name;
  state.classes = (await api('/api/classes')).classes;
  await loadClassRoster();
  state.preview = null;
  render();
  toast(`${plural(state.roster.length, 'aluno salvo', 'alunos salvos')} na turma ${name}`);
}

async function confirmImport() {
  syncClassName();
  if (state.classId) {
    const { roster } = await api(`/api/classes/${state.classId}/roster`);
    const current = new Map(roster.map((student) => [student.number, student.name]));
    const incoming = new Map(state.preview.map((student) => [student.number, student.name]));
    const added = [...incoming].filter(([number]) => !current.has(number));
    const removed = [...current].filter(([number]) => !incoming.has(number));
    const changed = [...incoming].filter(([number, name]) => current.has(number) && current.get(number) !== name);
    const sections = [
      ['Entradas', added],
      ['Saídas da lista atual', removed],
      ['Alterações de nome no mesmo número', changed.map(([number, name]) => [number, `${current.get(number)} → ${name}`])],
    ];
    const details = sections.map(([title, rows]) => `${title} (${rows.length})\n${rows.map(([number, name]) => `${number} · ${name}`).join('\n')}`).join('\n\n');
    if (!await askYesNo(`Atualizar a lista de ${state.className}?\n\n${details}\n\nSe for a mesma pessoa com nome ou número corrigido, cancele e use Editar nome na lista atual antes de importar.`)) return;
  }
  await commit();
}

async function deleteSelectedClass() {
  const current = state.classes.find((item) => item.id === state.classId);
  if (!current || !await askYesNo(`Excluir definitivamente a turma ${current.name} e sua lista? Turmas vinculadas a provas devem ser arquivadas.`)) return;
  await api(`/api/classes/${current.id}`, { method: 'DELETE' });
  state.classes = (await api(`/api/classes${state.includeArchived ? '?all=1' : ''}`)).classes;
  state.classId = state.classes[0]?.id || '';
  state.className = state.classes[0]?.name || '';
  await loadClassRoster();
  render();
}

async function createEmptyClass() {
  const name = (await askText('Nome da nova turma', '', { title: 'Nova turma' }))?.trim();
  if (!name) return;
  const { class: item } = await api('/api/classes', { method: 'POST', body: { name, createEmpty: true } });
  state.classes = (await api(`/api/classes${state.includeArchived ? '?all=1' : ''}`)).classes;
  state.classId = item.id;
  state.className = item.name;
  await loadClassRoster();
  render();
}

function studentList(rows, limit, actions = false) {
  const shown = limit ? rows.slice(0, limit) : rows;
  return h('div', { class: 'list' },
    shown.map((s) => h('div', { class: 'list-row' }, h('span', { class: 'num' }, s.number), h('span', { class: 'grow' }, s.name), s.className && h('span', { class: 'meta' }, s.className), actions && h('div', { class:'row' },
      h('button', { class:'btn quiet', onclick:() => renameStudent({ ...s, classId:s.classId || state.classId }) }, 'Editar nome'),
      s.id && h('button', { class:'btn quiet', onclick:() => showHistory(s) }, 'Histórico'),
      s.id && h('button', { class:'btn quiet', onclick: () => editAccommodation(s) }, 'Adaptações'),
      s.id && h('button', { class:'btn quiet', onclick:() => { state.moving=s; state.targetClassId=''; render(); } }, 'Transferir')))),
    limit && rows.length > limit && h('div', { class: 'list-row meta' }, `e mais ${rows.length - limit}…`));
}

async function editAccommodation(student) {
  const extraMinutes = await askText(`Minutos adicionais para ${student.name} em provas agendadas com horário de encerramento (0 a 180)`, '0');
  if (extraMinutes === null || !extraMinutes.trim()) return;
  const largeText = await askYesNo('Usar fonte maior ao abrir a prova?');
  const highContrast = await askYesNo('Usar contraste alto ao abrir a prova?');
  try {
    await api(`/api/classes/${student.classId || state.classId}/students/${encodeURIComponent(student.number)}/accommodation`, {
      method: 'POST', body: { extraMinutes: Number(extraMinutes), largeText, highContrast },
    });
    toast('Adaptações salvas');
  } catch (error) { toast(error.message); }
}

async function handleRosterFile(file) {
  if (!file) return;
  try { propose(await readFile(file)); } catch (error) { state.error = error.message || 'Não consegui ler este arquivo.'; render(); }
}
function render() {
  const currentClass = state.classes.find((item) => item.id === state.classId);
  const textarea = h('textarea', { placeholder: '3;Nome do aluno\n5;Outro aluno', 'aria-label': 'Colar lista de alunos' });
  const picker = h('input', { type: 'file', accept: '.pdf,.csv,.txt,.xlsx', id: 'roster-file', onchange: async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    await handleRosterFile(file);
  } });

  clear(root, h('div', { class: 'stack' },
    h('div', { class: 'stack-s' },
      h('div', { class: 'atlas-roster-heading' }, h('div', {}, h('h1', { class: 'title' }, 'Turma'), h('p', { class: 'sub' }, 'Importe sua lista de frequência e organize avaliações por turma.')),
        h('button', { class: 'btn secondary', onclick: () => createEmptyClass().catch((error) => toast(error.message)) }, 'Criar turma')),
      state.classes.length > 0 && h('div', { class: 'class-grid', 'aria-label': 'Turmas salvas' },
        state.classes.map((item) => h('button', {
          type: 'button', class: 'btn secondary class-tile', 'aria-pressed': String(item.id === state.classId),
          onclick: async () => {
            state.classId = item.id;
            state.className = item.name;
            await loadClassRoster();
            render();
          },
        }, h('strong', {}, item.name), h('span', {}, `${item.students} alunos${item.archived ? ' · Arquivada' : ''}`)))),
      h('label', { class:'row caption' }, h('input', { type:'checkbox', checked:state.includeArchived, onchange:async (e) => { state.includeArchived=e.target.checked; state.classes=(await api(`/api/classes${state.includeArchived ? '?all=1' : ''}`)).classes; if (!state.classes.some((c)=>c.id===state.classId)) state.classId=state.classes[0]?.id || ''; await loadClassRoster(); render(); } }), 'Mostrar turmas arquivadas'),
      h('p', { class: 'lead' }, state.roster.length ? `${plural(state.roster.length, 'aluno cadastrado', 'alunos cadastrados')}${state.className ? ` em ${state.className}` : ''}.` : 'Importe a lista de frequência para começar.')),

    !state.classes.length && !state.preview && h('ol', { class: 'steps' },
      step('1', 'Importe a lista de alunos', 'PDF do Diário de Classe, planilha XLSX ou texto.'),
      step('2', 'Crie a prova', 'Na aba Prova, monte ou importe questões e selecione a turma.'),
      step('3', 'Abra para os alunos', 'Compartilhe o código e QR Code e acompanhe os envios em tempo real.')),
    h('div', { class:'card stack-s' }, h('h2', { class:'headline' }, 'Buscar aluno'),
      h('input', { type:'search', value:state.search, placeholder:'Nome ou número de chamada', oninput:(e) => { clearTimeout(state.searchTimer); const term=e.target.value; state.searchTimer=setTimeout(() => searchStudents(term).catch((error)=>toast(error.message)), 250); } }),
      state.matches.length ? studentList(state.matches, 30, true) : state.search.trim() && h('p', { class:'caption' }, 'Nenhum aluno encontrado.')),

    state.requests.length>0 && h('div',{class:'card stack-s'},h('h2',{class:'headline'},`Pedidos para entrar (${state.requests.length})`),
      h('p',{class:'sub'},'Confira a identidade do estudante antes de autorizar. Depois da liberação, ele deve tentar entrar novamente.'),
      h('div',{class:'list'},state.requests.map((request)=>h('div',{class:'list-row'},h('span',{class:'num'},request.number),h('span',{class:'grow'},`${request.name} · ${request.className||request.examTitle}`),
        h('button',{class:'btn secondary',onclick:()=>answerRequest(request,true)},'Autorizar'),h('button',{class:'btn quiet',onclick:()=>answerRequest(request,false)},'Recusar'))))),

    state.moving && h('div', { class:'card row' }, h('span', { class:'grow' }, `Transferir ${state.moving.name} — nº ${state.moving.number}`),
      h('select', { value:state.targetClassId, onchange:(e)=>{state.targetClassId=e.target.value;} }, h('option',{value:''},'Turma de destino'), state.classes.filter((c)=>!c.archived && c.id!== (state.moving.classId || state.classId)).map((c)=>h('option',{value:c.id},c.name))),
      h('button',{class:'btn secondary',disabled:!state.targetClassId,onclick:()=>moveStudent()},'Confirmar'),
      h('button',{class:'btn quiet',onclick:()=>{state.moving=null;render();}},'Cancelar')),

    state.history && h('div', { class:'card stack-s' }, h('div',{class:'row between'},h('h2',{class:'headline'},`Histórico de ${state.history.student.name}`),h('button',{class:'btn quiet',onclick:()=>{state.history=null;render();}},'Fechar')),
      skillTimeline(state.history.entries),
      recoveryPlan(state.history.recovery),
      state.history.error ? h('p',{class:'caption'},state.history.error) : state.history.entries.length ? h('div',{class:'list'},state.history.entries.map((entry)=>h('div',{class:'list-row'},h('span',{class:'grow'},`${entry.title} · ${entry.className || 'Turma não informada'}`),h('span',{class:'badge'},entry.status==='submitted'?'Entregue':'Em andamento'),h('span',{class:'caption'},new Date(entry.startedAt).toLocaleDateString('pt-BR'))))) : h('p',{class:'caption'},'Ainda não há provas registradas para este estudante.')),



    state.preview
      ? h('div', { class: 'stack-s' },
        h('h2', { class: 'headline' }, `${plural(state.preview.length, 'aluno encontrado', 'alunos encontrados')}`),
        previewClass(state.preview),
        state.duplicates.length > 0 && h('div', { class: 'notice warn' }, `${state.duplicates.length} números de chamada repetidos foram consolidados na prévia: ${state.duplicates.map((d) => `${d.number} (${d.count} ocorrências)`).join(', ')}. Confira os nomes antes de importar.`),
        h('label', { class: 'field' }, h('span', {}, 'Nome da turma'), h('input', { value: state.className, placeholder: 'Ex.: 13.01 / 1ª série', oninput: (e) => setTargetClassName(e.target.value) })),
        studentList(state.preview, 8),
        h('p', { class: 'caption' }, 'A lista será salva separadamente; as outras turmas e o histórico das provas serão preservados.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => confirmImport().catch((e) => toast(e.message)) }, state.classId ? 'Conferir mudanças' : `Importar ${state.preview.length}`),
          h('button', { class: 'btn secondary', onclick: () => { state.preview = null; state.duplicates = []; render(); } }, 'Cancelar')))
      : h('div', { class: 'card stack-s atlas-import-card' },
        h('div', { class: 'row between' }, h('div', {}, h('h2', { class: 'headline' }, 'Importar lista'),
          h('p', { class: 'sub' }, 'Carregue ou digite a lista de estudantes cadastrados.')),
          h('span', { class: 'badge ok' }, 'Processamento local')),
        h('p', { class: 'notice' }, 'Formatos com detecção automática: Diário de Classe SEDUC-TO (PDF), Excel (.xlsx), CSV ou texto. Revise os números e nomes antes de salvar.'),
        h('label', { class: 'field' }, h('span', {}, 'Nome da turma (identificado automaticamente quando disponível)'), h('input', { value: state.className, placeholder: 'Ex.: 13.01/EM.MAT-ANL', oninput: (e) => setTargetClassName(e.target.value) })),
        h('div', { class: 'atlas-upload-panel',
          ondragover: (e) => { e.preventDefault(); e.currentTarget.classList.add('dragging'); },
          ondragleave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('dragging'); },
          ondrop: (e) => { e.preventDefault(); e.currentTarget.classList.remove('dragging'); handleRosterFile(e.dataTransfer?.files?.[0]); }
        },
          h('div', { class: 'eyebrow' }, 'Arquivo da lista de alunos'),
          picker,
          h('label', { class: 'btn', for: 'roster-file' }, 'Escolher arquivo'),
          h('p', { class: 'caption' }, 'Ou arraste e solte aqui · PDF, XLSX, CSV ou TXT')),
        h('details', {}, h('summary', { class: 'caption', style: 'cursor:pointer' }, 'Ou cole a lista manualmente'),
          h('div', { class: 'stack-s', style: 'margin-top:12px' }, textarea, h('div', {}, h('button', { class: 'btn secondary', onclick: () => propose(parseRosterTextDetailed(textarea.value)) }, 'Ler lista')))),
        state.error && h('p', { class: 'error', role: 'alert' }, state.error)),

    state.classId && !state.preview && h('div', { class: 'stack-s' },
      h('button', { class: 'btn danger', onclick: () => deleteSelectedClass().catch((error) => toast(error.message)) }, 'Excluir turma'),
      h('div',{class:'row between'},h('h2', { class: 'headline' }, 'Lista atual'), state.classId && h('button',{class:'btn quiet',onclick:async()=>{
        const current=state.classes.find((c)=>c.id===state.classId);
        const archived=!!current?.archived;
        if (!await askYesNo(`${archived?'Restaurar':'Arquivar'} a turma ${current?.name}? ${archived?'Ela voltará à lista ativa.':'Ela não aparecerá para novas provas até ser restaurada.'}`)) return;
        await api(`/api/classes/${state.classId}/archive`,{method:'POST',body:{archived:!archived}});
        state.classes=(await api(`/api/classes${state.includeArchived?'?all=1':''}`)).classes;
        if (!state.classes.some((c)=>c.id===state.classId)) {state.classId=state.classes[0]?.id||''; syncClassName(); await loadClassRoster();}
        render();
      }}, currentClass?.archived?'Restaurar turma':'Arquivar turma')), studentList(state.roster.map((s)=>({...s,classId:state.classId})), undefined, true))));
}

const step = (n, title, text) => h('li', { class: 'step' }, h('span', { class: 'step-n' }, n), h('div', {}, h('div', { class: 'headline', style: 'font-size:17px' }, title), h('div', { class: 'sub' }, text)));

function skillTimeline(entries) {
  const groups = new Map();
  for (const entry of [...entries].reverse()) {
    for (const point of entry.skills || []) {
      if (!groups.has(point.skill)) groups.set(point.skill, []);
      groups.get(point.skill).push({ ...point, title: entry.title, date: entry.submittedAt });
    }
  }
  if (!groups.size) return null;
  return h('details', { class: 'card' }, h('summary', {}, 'Evolução por habilidade'),
    [...groups.values()].map((points) => h('section', { class: 'stack-s' },
      h('h3', {}, points[0].label || points[0].skill),
      points.map((point) => h('div', { class: 'list-row' },
        h('span', { class: 'grow' }, `${new Date(point.date).toLocaleDateString('pt-BR')} · ${point.title}`),
        h('strong', {}, `${point.percent}%`))))));
}

function recoveryPlan(questions) {
  if (!questions?.length) return null;
  const selected = new Set();
  return h('details', { class: 'card' }, h('summary', {}, 'Sugestões de recuperação por habilidade'),
    h('p', { class: 'caption' }, 'Sugestões do banco para habilidades com desempenho abaixo de 60%. Revise e selecione as questões.'),
    questions.map((question) => h('label', { class: 'row' },
      h('input', { type: 'checkbox', onchange: (event) => event.target.checked ? selected.add(question.bankId) : selected.delete(question.bankId) }),
      h('span', {}, `${question.skill} · ${question.text}`))),
    h('button', { class: 'btn secondary', onclick: async () => {
      if (!selected.size) { toast('Selecione as questões de recuperação.'); return; }
      try {
        const student = state.history.student;
        await api('/api/exams', { method: 'POST', body: {
          title: `Recuperação — ${student.name}`,
          classId: student.classId || state.classId || null,
          questions: questions.filter((question) => selected.has(question.bankId)),
        } });
        toast('Rascunho de recuperação salvo na aba Prova.');
      } catch (error) { toast(error.message); }
    } }, 'Salvar rascunho de recuperação'));
}

