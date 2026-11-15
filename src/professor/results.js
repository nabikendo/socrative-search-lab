import { api } from '../lib/api.js';
import { h, clear, toast, plural, formatScore } from '../lib/dom.js';
import { skillLabel } from '../../shared/skills.js';

let root;
let timer;
const state = { exams: [], examId: null, data: null, sig: '', open: new Set(), alertsEnabled:false, submittedCounts:new Map(), batchScores:new Map() };

export function mount(el) { root = el; }
export async function activate() {
  state.exams = (await api('/api/exams')).exams;
  state.examId = state.exams.some((e) => e.id === state.examId) ? state.examId : (state.exams.find((e) => e.status === 'open') || state.exams[0])?.id ?? null;
  await refresh(true);
  timer = setInterval(() => refresh(false), 4000);
}
export function deactivate() { clearInterval(timer); }

async function refresh(force) {
  if (!state.examId) { state.data = null; render(); return; }
  // não redesenha enquanto o professor digita uma nota
  if (!force && root.contains(document.activeElement) && document.activeElement.matches('input')) return;
  try {
    const next = await api(`/api/exams/${state.examId}/results`);
    const submitted=next.results.filter((r)=>r.status==='submitted');
    const previous=state.submittedCounts.get(state.examId);
    if(previous!==undefined && submitted.length>previous && state.alertsEnabled && 'Notification' in window && Notification.permission==='granted') {
      const latest=submitted[submitted.length-1];
      new Notification('Prova entregue',{body:`${latest.name} (nº ${latest.number}) enviou ${next.exam.title}.`});
    }
    state.submittedCounts.set(state.examId,submitted.length);
    const sig = JSON.stringify(next);
    if (!force && sig === state.sig) return;
    state.sig = sig; state.data = next; render();
  } catch { /* o aviso de login é tratado globalmente */ }
}

const awayTime = (seconds) => (seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`);
const badge = (r) => r.status === 'submitted' ? h('span', { class: 'badge ok' }, 'Enviada')
  : r.status === 'paused' ? h('span',{class:'badge warn'},'Pausada pelo professor')
  : r.away?.now ? h('span', { class: 'badge warn' }, 'Fora da prova')
  : r.online ? h('span', { class: 'badge' }, h('span', { class: 'dot', style: 'color:var(--ok)' }), 'Online')
  : h('span', { class: 'badge warn' }, 'Desconectado');

function render() {
  const d = state.data;
  const header = h('div', { class: 'atlas-results-heading' },
    h('div', { class: 'row' }, h('h1', { class: 'title' }, 'Resultados'), h('span', { class: 'badge ok' }, 'Ao vivo')),
    state.exams.length > 0 && h('select', { 'aria-label': 'Escolher prova', style: 'width:auto;max-width:320px', onchange: (event) => {
      state.examId = event.target.value; state.open.clear(); state.sig = ''; refresh(true);
    } }, state.exams.map((exam) => h('option', { value: exam.id, selected: exam.id === state.examId }, exam.title))));
  if (!d) {
    clear(root, h('div', { class: 'stack' }, header, h('p', { class: 'lead' }, 'Crie e abra uma prova para acompanhar as respostas aqui.')));
    return;
  }
  const left = h('div', { class: 'atlas-results-column' },
    d.results.length ? insights(d) : null,
    d.results.length ? skillInsights(d) : null,
    d.results.length ? missingKeys(d) : null,
    d.results.length ? batchCorrection(d) : null,
    d.results.length ? comparePanel() : null,
    !d.results.length && h('div', { class: 'card' }, d.exam.status === 'open' ? 'Aguardando os alunos entrarem…' : 'Nenhum aluno respondeu esta prova.'));
  const right = h('aside', { class: 'atlas-results-column' },
    h('div', { class: 'card stack-s' },
      h('div', { class: 'row between' }, h('h2', { class: 'headline' }, 'Alunos da turma'), h('span', { class: 'caption' }, `${d.results.length} participantes`)),
      d.results.length ? h('div', { class: 'list' }, d.results.map((result) => row(result, d.exam))) : h('p', { class: 'caption' }, 'Sem participantes registrados.')),
    pendingStudents(d),
    schoolExport(d.exam));
  clear(root, h('div', { class: 'stack' },
    header, summary(d), awayNotice(d),
    !d.exam.questions.length && h('div', { class: 'notice' }, 'Avaliação somente em PDF: o Atlas acompanha quem entregou, mas não calcula as notas desta prova.'),
    stats(d),
    h('div', { class: 'atlas-results-grid' }, left, right)));
}

function awayNotice(d) {
  const outside = d.results.filter((r) => r.away?.now);
  if (!outside.length) return null;
  return h('div', { class: 'notice warn', role: 'status' }, `Fora da página da prova agora: ${outside.map((r) => `${r.name} (nº ${r.number})`).join(', ')}.`);
}

function summary(d) {
  const sent = d.results.filter((r) => r.status === 'submitted').length;
  return h('div', { class: 'row between' },
    h('p', { class: 'lead' }, `${sent} de ${(d.participants||[]).length || d.results.length} enviadas`),
    h('div',{class:'row'},
      h('button',{class:'btn quiet',onclick:async()=>{
        if(!('Notification' in window)){toast('Este aplicativo não permite avisos do sistema.');return;}
        if(Notification.permission!=='granted') { const permission=await Notification.requestPermission(); if(permission!=='granted'){toast('Permissão para avisos não concedida.');return;} }
        state.alertsEnabled=!state.alertsEnabled; render(); toast(state.alertsEnabled?'Avisos de entrega ativados':'Avisos de entrega desativados');
      }},state.alertsEnabled?'Avisos ligados':'Avisar quando entregarem'),
      h('a', { class: 'btn secondary', href: `/api/exams/${d.exam.id}/export.csv` }, 'Baixar CSV'),
      h('a', { class: 'btn secondary', href: `/api/exams/${d.exam.id}/export.xlsx` }, 'Baixar XLSX'),
      h('a', { class: 'btn quiet', href: `/api/exams/${d.exam.id}/report.pdf` }, 'Relatório para impressão')),
    d.exam.status === 'closed' && d.exam.questions.length > 0 && [annulmentForm(d.exam), releaseForm(d.exam)]);
}

function schoolExport(exam) {
  let template = { scale: 10, columns: 'number,name,className,score' };
  try { template = JSON.parse(localStorage.getItem('atlas.schoolExport')) || template; } catch {}
  const scale = h('input', { type: 'number', min: 1, max: 1000, step: 'any', required: true, value: template.scale });
  const keys = { number: 'Número', name: 'Estudante', className: 'Turma', date: 'Entrega', score: 'Nota' };
  const selects = Array.from({ length: 5 }, (_, index) => {
    const select = h('select', { 'aria-label': `Coluna ${index + 1}` }, h('option', { value: '' }, 'Omitir'),
      Object.entries(keys).map(([value, label]) => h('option', { value }, label)));
    select.value = template.columns.split(',')[index] || '';
    return select;
  });
  return h('details', { class: 'card' }, h('summary', {}, 'Planilha no formato da escola'),
    h('form', { class: 'stack-s', onsubmit: (event) => {
      event.preventDefault();
      const chosen = selects.map((select) => select.value).filter(Boolean);
      if (!chosen.length || new Set(chosen).size !== chosen.length) { toast('Escolha colunas sem repetir.'); return; }
      const settings = { scale: scale.value, columns: chosen.join(',') };
      localStorage.setItem('atlas.schoolExport', JSON.stringify(settings));
      location.href = `/api/exams/${exam.id}/export.csv?${new URLSearchParams(settings)}`;
    } },
    h('label', { class: 'field' }, 'Nota máxima na planilha', scale),
    h('div', { class: 'class-grid' }, selects.map((select, index) => h('label', { class: 'field' }, `Coluna ${index + 1}`, select))),
    h('button', { type: 'submit', class: 'btn secondary' }, 'Salvar modelo e baixar CSV')));
}

function releaseForm(exam) {
  const date = h('input', { type: 'datetime-local', required: true });
  return h('details', { class: 'card' }, h('summary', {}, 'Programar devolutiva'),
    exam.releaseAt && h('p', {}, `Data atual: ${new Date(exam.releaseAt).toLocaleString('pt-BR')}`),
    h('form', { class: 'stack-s', onsubmit: async (event) => {
      event.preventDefault();
      try {
        await api(`/api/exams/${exam.id}/release`, { method: 'POST', body: { date: new Date(date.value).toISOString() } });
        await refresh(true);
        toast('Devolutiva programada');
      } catch (error) { toast(error.message); }
    } }, h('label', { class: 'field' }, 'Data e hora', date), h('button', { class: 'btn', type: 'submit' }, 'Salvar data')));
}

function annulmentForm(exam) {
  const question = h('select', {}, exam.questions.map((item, index) =>
    h('option', { value: item.id }, `Q${index + 1} · ${item.text.slice(0, 90)}${exam.annulled?.[item.id] ? ' (anulada)' : ''}`)));
  const mode = h('select', {}, h('option', { value: 'credit' }, 'Dar o ponto a todos'), h('option', { value: 'remove' }, 'Retirar a questão do total'));
  const reason = h('input', { required: true, maxLength: 500 });
  return h('details', { class: 'card' }, h('summary', {}, 'Anular questão'),
    h('form', { class: 'stack-s', onsubmit: async (event) => {
      event.preventDefault();
      if (!confirm('Recalcular as notas de toda a turma e registrar esta decisão?')) return;
      try {
        await api(`/api/exams/${exam.id}/annul-question`, { method: 'POST', body: {
          questionId: question.value, mode: mode.value, reason: reason.value,
        } });
        await refresh(true);
        toast('Notas recalculadas');
      } catch (error) { toast(error.message); }
    } },
    h('label', { class: 'field' }, 'Questão', question),
    h('label', { class: 'field' }, 'Recálculo', mode),
    h('label', { class: 'field' }, 'Motivo', reason),
    h('button', { class: 'btn', type: 'submit' }, 'Aplicar anulação')));
}

function pendingStudents(d) {
  const participants=d.participants||[];
  if(!participants.length)return null;
  const done=new Set(d.results.filter((r)=>r.status==='submitted').map((r)=>r.number));
  const pending=participants.filter((p)=>!done.has(p.number));
  if(!pending.length)return h('div',{class:'notice ok'},'Todos os estudantes da turma já entregaram.');
  return h('details',{class:'card'},h('summary',{class:'headline'},`${pending.length} ainda não entregaram`),
    h('div',{class:'list',style:'margin-top:12px'},pending.map((p)=>{
      const started=d.results.find((r)=>r.number===p.number);
      return h('div',{class:'list-row'},h('span',{class:'num'},p.number),h('span',{class:'grow'},p.name),h('span',{class:'badge'},started?(started.status==='paused'?'Pausado':started.online?'Online':'Desconectado'):'Não iniciou'));
    })));
}

function awayHistory(r) {
  const clock = (ms) => new Date(ms).toLocaleTimeString('pt-BR');
  return h('div', { class: 'answer-block' },
    h('div', { class: 'q' }, `Saídas da página da prova (${r.away.count}, ${awayTime(r.away.seconds)} fora no total)`),
    r.away.events.slice().reverse().map((event) => {
      const back = Date.parse(event.at);
      return h('div', { class: 'a' }, `${clock(back - event.seconds * 1000)} → ${clock(back)} · ${awayTime(event.seconds)}`);
    }),
    r.away.count > r.away.events.length ? h('div', { class: 'caption' }, `Mostrando as ${r.away.events.length} saídas mais recentes.`) : null);
}

function row(r, exam) {
  const open = state.open.has(r.sessionId);
  const head = h('button', { class: 'list-row clickable', 'aria-expanded': String(open), onclick: () => { open ? state.open.delete(r.sessionId) : state.open.add(r.sessionId); render(); } },
    h('span', { class: 'num' }, r.number),
    h('span', { class: 'grow' }, h('div', {}, r.name), h('div', { class: 'caption' }, `${r.total ? `${r.answered}/${r.total} respondidas` : 'prova em PDF'}${r.className ? ' · ' + r.className : ''}${r.away?.count ? ` · saiu da página ${r.away.count}× (${awayTime(r.away.seconds)})` : ''}`)),
    badge(r),
    h('span', { class: 'score', style: 'min-width:96px;text-align:right;white-space:nowrap' }, r.max ? `${formatScore(r.score)}/${formatScore(r.max)}` : 'PDF', r.pending ? h('div', { class: 'caption' }, `${r.pending} a corrigir`) : null));
  if (!open) return h('div', {}, head);
  return h('div', {}, head,
    h('a', { class: 'btn secondary', href: `/api/sessions/${r.sessionId}/report.pdf` }, 'Baixar relatório individual em PDF'),
    r.away?.count ? awayHistory(r) : null,
    exam.questions.map((q, i) => {
      const answer = r.answers[q.id];
      const auto = ['choice','multi','numeric'].includes(q.type) && q.correct !== undefined;
      return h('div', { class: 'answer-block' },
        h('div', { class: 'q' }, `${i + 1}. ${q.text}`),
        h('div', { class: answer ? 'a' : 'a empty' }, answer || 'Sem resposta'),
        auto ? h('div', { class: 'caption' }, feedbackText(q,answer))
          : h('label', { class: 'row caption' }, 'Nota (0 a ' + formatScore(q.weight) + ')',
            q.rubric?.length ? h('select',{class:'grade-input',value:r.grades[q.id]??'',onchange:(e)=>grade(r.sessionId,q.id,e.target.value)},h('option',{value:''},'Selecione critério'),q.rubric.map((level)=>h('option',{value:String(level.score)},`${level.label} · ${formatScore(level.score)}${level.description?` — ${level.description}`:''}`)))
            : h('input', { class: 'grade-input', type: 'number', min: '0', max: String(q.weight), step: '0.25', value: r.grades[q.id] ?? '', onchange: (e) => grade(r.sessionId, q.id, e.target.value) })));
    }),
    r.status === 'active' && h('div',{class:'answer-block'},h('button',{class:'btn quiet',onclick:()=>controlSession(r,'pause')},'Pausar este aluno')),
    r.status === 'paused' && h('div',{class:'answer-block'},h('button',{class:'btn secondary',onclick:()=>controlSession(r,'resume')},'Retomar este aluno')),
    r.status === 'submitted' && h('div', { class: 'answer-block' }, h('div', {}, h('button', { class: 'btn quiet', onclick: async () => {
      const reason = prompt('Por que esta prova será reaberta? O motivo ficará no histórico de auditoria.');
      if (!reason) return;
      try { await api(`/api/sessions/${r.sessionId}/reopen`, { method: 'POST', body: { reason } }); toast('Envio reaberto'); refresh(true); }
      catch (error) { toast(error.message); }
    } }, 'Reabrir para o aluno'))));
}

async function controlSession(result, action) {
  try {
    await api(`/api/sessions/${result.sessionId}/${action}`,{method:'POST'});
    toast(action==='pause'?'Aluno pausado':'Prova do aluno retomada');
    refresh(true);
  } catch(error) { toast(error.message); }
}

function skillInsights(d) {
  const groups = new Map();
  for (const q of d.exam.questions) {
    if (!q.skill || !(['choice','multi','numeric'].includes(q.type) && q.correct !== undefined)) continue;
    const answered = d.results.map((r) => r.answers[q.id]).filter((answer) => answer !== undefined && answer !== null && String(answer).trim() !== '');
    const item = groups.get(q.skill) || { total: 0, correct: 0 };
    item.total += answered.length;
    item.correct += answered.filter((answer) => {
      if (q.type === 'choice') return answer === q.correct;
      if (q.type === 'numeric') return Number.isFinite(Number(String(answer).replace(',','.'))) && Math.abs(Number(String(answer).replace(',','.')) - Number(q.correct)) <= (q.tolerance || 0);
      let selected = answer;
      if (typeof selected === 'string') { try { selected = JSON.parse(selected); } catch { selected = []; } }
      return Array.isArray(selected) && selected.length === q.correct.length && [...selected].sort().every((value,index)=>value===[...q.correct].sort()[index]);
    }).length;
    groups.set(q.skill, item);
  }
  if (!groups.size) return null;
  return h('details', { class: 'card insights', open: true }, h('summary', { class: 'headline' }, 'Relatório por habilidade SAEB'),
    h('div', { class: 'stack-s', style: 'margin-top:16px' }, [...groups].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', { numeric: true })).map(([skill, item]) => {
      const pct = item.total ? Math.round(item.correct / item.total * 100) : null;
      return h('div', { class: 'bar-row' }, h('div', { class: 'row between caption' }, h('strong', {}, skillLabel(skill) || skill), h('span', {}, pct === null ? 'Sem respostas' : `${pct}% · ${item.correct}/${item.total}`)), h('div', { class: 'progress' }, h('div', { style: `width:${pct || 0}%;background:${pct !== null && pct < 50 ? 'var(--warn)' : 'var(--ok)'}` })));
    })));
}

async function grade(sessionId, questionId, value) {
  const reason=prompt('Informe o motivo da alteração da nota (ficará no histórico).');
  if(!reason||reason.trim().length<4){toast('Informe um motivo com pelo menos 4 caracteres.');refresh(true);return;}
  try { await api('/api/grade', { method: 'POST', body: { sessionId, questionId, score: value === '' ? null : value,reason } }); toast('Nota salva e registrada'); }
  catch (error) { toast(error.message); }
  refresh(true);
}

function feedbackText(q,answer){
  const correct=q.type==='multi'?Array.isArray(answer)&&answer.length===q.correct.length&&[...answer].sort().every((x,i)=>x===[...q.correct].sort()[i]):q.type==='numeric'?Math.abs(Number(String(answer).replace(',','.'))-Number(q.correct))<=(q.tolerance||0):answer===q.correct;
  return correct?`✓ Correta · ${formatScore(q.weight)}`:`✗ Gabarito: ${Array.isArray(q.correct)?q.correct.join(', '):q.correct}`;
}

function missingKeys(d){
  const missing=d.exam.questions.map((q,index)=>({q,index})).filter(({q})=>!(['choice','multi','numeric'].includes(q.type)&&q.correct!==undefined));
  if(!missing.length)return null;
  return h('details',{class:'card'},h('summary',{class:'headline'},`${missing.length} questão(ões) para correção ou gabarito`),h('ul',{class:'sub'},missing.map(({q,index})=>h('li',{},`Q${index+1}: ${q.text} · ${d.results.filter(r=>r.answers[q.id]!==undefined&&String(r.answers[q.id]).trim()!=='').length} resposta(s)`))));
}

function batchCorrection(d){
  const pending=[];
  for(const question of d.exam.questions){
    if(['choice','multi','numeric'].includes(question.type)&&question.correct!==undefined)continue;
    for(const result of d.results){
      const answer=result.answers[question.id];
      if(answer===undefined||answer===null||String(answer).trim()===''||result.grades[question.id]!==undefined)continue;
      pending.push({question,result,answer});
    }
  }
  if(!pending.length)return null;
  return h('details',{class:'card stack-s'},h('summary',{class:'headline'},`Correção manual em lote · ${pending.length} pendente(s)`),
    h('p',{class:'caption'},'Preencha as notas de várias respostas e salve tudo com um único motivo de correção.'),
    h('div',{class:'list'},pending.map(({question,result,answer})=>{
      const key=`${result.sessionId}:${question.id}`;
      return h('div',{class:'list-row'},h('span',{class:'grow'},h('strong',{},`${result.name} · Q${d.exam.questions.indexOf(question)+1}`),h('div',{class:'caption'},Array.isArray(answer)?answer.join(', '):answer)),question.rubric?.length?h('select',{value:state.batchScores.get(key)??'',onchange:(e)=>state.batchScores.set(key,e.target.value)},h('option',{value:''},'Critério'),question.rubric.map(level=>h('option',{value:String(level.score)},`${level.label} · ${formatScore(level.score)}`))):h('input',{type:'number',min:0,max:question.weight,step:'0.25',value:state.batchScores.get(key)??'',placeholder:`0–${question.weight}`,style:'max-width:120px',oninput:(e)=>state.batchScores.set(key,e.target.value)}));
    })),h('button',{class:'btn',onclick:async()=>{
      const items=pending.filter(({question,result})=>state.batchScores.has(`${result.sessionId}:${question.id}`)&&state.batchScores.get(`${result.sessionId}:${question.id}`)!=='').map(({question,result})=>({sessionId:result.sessionId,questionId:question.id,score:state.batchScores.get(`${result.sessionId}:${question.id}`)}));
      if(!items.length){toast('Preencha ao menos uma nota.');return;}
      const reason=prompt('Motivo desta correção em lote (mínimo 4 caracteres).');if(!reason||reason.trim().length<4)return;
      try{await api('/api/grade/batch',{method:'POST',body:{items,reason}});for(const item of items)state.batchScores.delete(`${item.sessionId}:${item.questionId}`);toast(`${items.length} nota(s) registradas no histórico.`);refresh(true);}catch(error){toast(error.message);}
    }},'Salvar correções preenchidas'));
}

function comparePanel(){
  const other=state.exams.filter((exam)=>exam.id!==state.examId);
  if(!other.length)return null;
  return h('details',{class:'card stack-s'},h('summary',{class:'headline'},'Comparar avaliações'),h('div',{class:'row'},
    h('label',{class:'field'},h('span',{},'De'),h('input',{id:'compare-from',type:'date'})),
    h('label',{class:'field'},h('span',{},'Até'),h('input',{id:'compare-to',type:'date'})),
    h('label',{class:'field grow'},h('span',{},'Comparar esta prova com'),h('select',{id:'compare-exam'},h('option',{value:''},'Selecione uma avaliação'),other.map((exam)=>h('option',{value:exam.id},exam.title)))),
    h('button',{class:'btn secondary',onclick:async()=>{
      const selected=root.querySelector('#compare-exam').value;if(!selected){toast('Selecione a segunda avaliação.');return;}
      const params=new URLSearchParams({ids:[state.examId,selected].join(',')});const from=root.querySelector('#compare-from').value;const to=root.querySelector('#compare-to').value;if(from)params.set('from',from);if(to)params.set('to',to);
      try{const report=await api(`/api/reports/compare?${params}`);const target=root.querySelector('#compare-output');clear(target,...report.exams.map((item)=>h('div',{class:'notice'},`${item.title} · ${item.className||'Turma não informada'} · ${item.sent}/${item.students} enviados no período · média ${item.average===null?'—':`${item.average}%`}`)));}catch(error){toast(error.message);}
    }},'Comparar')),
    h('p',{class:'caption'},'Os filtros de data consideram a entrega das provas. O Atlas mostra as médias das duas avaliações selecionadas.'),h('div',{id:'compare-output',class:'stack-s','aria-live':'polite'}));
}

function stats(d) {
  const sent = d.results.filter((r) => r.status === 'submitted');
  const cell = (label, value, sub) => h('div', { class: 'stat' }, h('div', { class: 'caption' }, label), h('div', { class: 'stat-n' }, value), sub && h('div', { class: 'caption' }, sub));
  if (!d.exam.questions.length) return h('div', { class: 'stats' },
    cell('Enviadas', `${sent.length}/${(d.participants||[]).length || d.results.length}`),
    cell('Online agora', String(d.results.filter((r) => r.online).length)),
    cell('Formato', 'PDF', 'correção fora do Atlas'));
  const ratio = (r) => (r.max ? r.score / r.max : 0);
  const avg = sent.length ? sent.reduce((t, r) => t + ratio(r), 0) / sent.length : null;
  const max = d.results[0]?.max ?? 0;
  return h('div', { class: 'stats' },
    cell('Enviadas', `${sent.length}/${(d.participants||[]).length || d.results.length}`, 'Submissões recebidas'),
    cell('Online agora', String(d.results.filter((r) => r.online).length), 'Dispositivos conectados'),
    cell('Média da turma', avg === null ? '—' : formatScore(Math.round(avg * max * 100) / 100), avg === null ? 'Aguardando envios' : `de ${formatScore(max)} · ${Math.round(avg * 100)}%`),
    cell('Pendentes', String((d.participants||[]).filter((participant) => !sent.some((s) => s.number === participant.number)).length), 'Alunos sem entrega'));
}

// Acerto por questão (só para as que têm gabarito): mostra o que a turma não aprendeu.
function insights(d) {
  const isObjective=(q)=>['choice','multi','numeric'].includes(q.type)&&q.correct!==undefined;
  const rows = d.exam.questions.map((q, i) => ({ q, i })).filter(({ q }) => isObjective(q)).map(({ q, i }) => {
    const given = d.results.map((r) => r.answers[q.id]).filter((answer)=>answer!==undefined&&answer!==null&&String(answer).trim()!=='');
    const isCorrect=(a)=>q.type==='choice'?a===q.correct:q.type==='numeric'?Number.isFinite(Number(String(a).replace(',','.')))&&Math.abs(Number(String(a).replace(',','.'))-Number(q.correct))<=(q.tolerance||0):(()=>{let v=a;if(typeof v==='string'){try{v=JSON.parse(v)}catch{v=[]}}return Array.isArray(v)&&v.length===q.correct.length&&[...v].sort().every((x,j)=>x===[...q.correct].sort()[j]);})();
    const right = given.filter(isCorrect).length;
    const wrong = {};
    for (const a of given) if (!isCorrect(a)) {const values=Array.isArray(a)?a:[a];for(const value of values){const label=String(value);wrong[label]=(wrong[label]||0)+1;}}
    const top = Object.entries(wrong).sort((a, b) => b[1] - a[1])[0];
    return { i, q, total: given.length, pct: given.length ? Math.round((right / given.length) * 100) : null, top };
  });
  if (!rows.length || !rows.some((r) => r.total)) return null;
  return h('details', { class: 'card insights' },
    h('summary', { class: 'headline' }, 'Desempenho por questão'),
    h('div', { class: 'stack-s', style: 'margin-top:16px' }, rows.map(({ i, q, total, pct, top }) => h('div', { class: 'bar-row' },
      h('div', { class: 'row between caption' }, h('span', {}, `Q${i + 1} · ${q.text.length > 60 ? q.text.slice(0, 60) + '…' : q.text}`), h('span', { class: 'score' }, pct === null ? '—' : `${pct}%`)),
      h('div', { class: 'progress' }, h('div', { style: `width:${pct ?? 0}%;background:${pct !== null && pct < 50 ? 'var(--warn)' : 'var(--ok)'}` })),
      top && pct !== null && pct < 70 && h('div', { class: 'caption' }, `Resposta incorreta mais comum: “${top[0]}” (${top[1]})`)))));
}

