import { selectSection } from './settings.js';
import { api } from '../lib/api.js';
import { h, clear, toast } from '../lib/dom.js';
import { SAEB_LEVELS, SAEB_SKILLS, ENEM_LEVELS, ENEM_SKILLS, MATRIX_LEVELS, MATRIX_SKILLS, findSkill, enemArea, MATRIZ_SOURCES } from '../../shared/skills.js';
import { ENEM_AXES, ENEM_ESSAY, ENEM_SOURCE, essayCriteria, ESSAY_PROMPT } from '../../shared/enem.js';
import { generateDescriptorQuestion, SUPPORTED_GENERATORS } from '../../shared/descriptor-generator.js';

let root, bank = [], exams = [];
const ESSAY = 'ENEMRED'; // "etapa" especial: competências da redação do ENEM
const savedLevel = (() => { try { return localStorage.getItem('atlas.descritores.nivel'); } catch { return null; } })();
const startLevel = MATRIX_LEVELS.some((l) => l.id === savedLevel) || savedLevel === ESSAY ? savedLevel : 'ENEMCN';
const state = { level: startLevel, skill: MATRIX_SKILLS.find((s) => s.level === startLevel)?.id || '', search: '', draft: null, report: null, working: false, error: '', objeto: '' };
export function mount(el) { root = el; }
export async function activate() {
  try {
    const [questions, saved] = await Promise.all([api('/api/question-bank'), api('/api/exams')]);
    bank = questions.questions || []; exams = saved.exams || []; state.error = '';
  } catch (error) { state.error = error.message; }
  render();
}
const field = (title, input) => h('label', { class: 'field' }, h('span', {}, title), input);
const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const skillRows = () => MATRIX_SKILLS.filter(s => s.level === state.level && normalize(s.code + ' ' + s.topic + ' ' + (s.competenciaText || '') + ' ' + s.description).includes(normalize(state.search)));
function chooseLevel(id) { state.level=id; state.skill=MATRIX_SKILLS.find(s=>s.level===id)?.id||'';state.draft=null;state.report=null;state.objeto='';try{localStorage.setItem('atlas.descritores.nivel',id);}catch{/* sem armazenamento */}render(); }
function chooseSkill(id) { state.skill=id;state.draft=null;state.report=null;state.error='';render(); }
function chooseObjeto(text) { state.objeto = state.objeto === text ? '' : text; render(); }
function goToExam(question) {
  sessionStorage.setItem('atlas.bank.pending', JSON.stringify(question));
  window.dispatchEvent(new CustomEvent('atlas:goto', { detail:'prova' }));
}
async function save(question) {
  const result = await api('/api/question-bank', { method:'POST',body:question });
  bank.unshift(result.question);state.draft=null;render();toast('Questão salva com o descritor selecionado.');
}
function generate() {
  state.draftByAi = false;
  state.draft = generateDescriptorQuestion(state.skill, Math.floor(Math.random()*1e9)+1);
  state.error=state.draft?'':'Este descritor não tem gerador automático validado; use a criação orientada.';
  render();
}
// Descobre qual IA foi escolhida para a tarefa em Configurações › Inteligência artificial.
// Sem IA configurada, abre um aviso com atalho direto para a configuração (em vez de falhar em silêncio).
async function aiTarget(task) {
  const choice = (await api('/api/ai/status'))[task];
  if (!choice.ready) { needSetup(choice); return null; }
  return choice;
}
function needSetup(choice) {
  const dialog = h('dialog', { class: 'atlas-descriptor-editor', 'aria-label': 'Configurar IA' },
    h('h2', { class: 'headline' }, 'Configure uma IA para continuar'),
    h('p', {}, 'Para criar e analisar questões com IA, cadastre a chave de API de um provedor (Gemini, ChatGPT, Claude, DeepSeek, Groq…), escolha o modelo e salve.'),
    h('p', { class: 'caption' }, choice?.name ? `IA escolhida agora: ${choice.name} — ainda sem chave ou modelo.` : ''),
    h('div', { class: 'row' },
      h('button', { class: 'btn secondary', type: 'button', onclick: () => dialog.close() }, 'Agora não'),
      h('button', { class: 'btn', type: 'button', onclick: () => { dialog.close(); selectSection('ai'); window.dispatchEvent(new CustomEvent('atlas:goto', { detail: 'configuracoes' })); } }, 'Abrir configuração de IA')));
  document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove(), { once: true }); dialog.showModal();
}
const aiNote = (target) => 'Usando '+target.name+' · '+target.model+'. O descritor, o texto-base e a questão são enviados ao provedor; dados de alunos nunca são enviados.';
async function aiEditor() {
  let target;
  try { target = await aiTarget('generate'); }
  catch (error) { toast(error.message); return; }
  if (!target) return;
  const skill = findSkill(state.skill);
  // Erros aparecem dentro da janela (o aviso flutuante ficava escondido atrás dela).
  const problem=h('p',{class:'notice danger',role:'alert',hidden:true});
  const form=h('form',{class:'stack-s',onsubmit:async(event)=>{
    event.preventDefault();
    const values=new FormData(form);
    const button=form.querySelector('[type=submit]');
    button.disabled=true;problem.hidden=true;
    const started=Date.now();const tick=()=>{button.textContent=`Gerando… ${Math.round((Date.now()-started)/1000)} s`;};tick();const timer=setInterval(tick,1000);
    try{
      const result=await api('/api/ai/descriptor-question',{method:'POST',body:{
        skillId:skill.id,
        context:String(values.get('context')||''),
        objeto:String(values.get('objeto')||'')}});
      if(state.skill!==skill.id){toast('Você mudou de descritor; a questão gerada não foi inserida.');return;}
      state.draft=result.question;state.draftByAi=true;state.error='';dialog.close();render();
      toast('Rascunho gerado. Confira todas as alternativas e o gabarito antes de salvar.');
    }catch(error){problem.textContent=error.message;problem.hidden=false;}
    finally{clearInterval(timer);button.disabled=false;button.textContent='Gerar rascunho com IA';}
  }},
    h('p',{class:'notice'},(skill.matrix==='ENEM'?'ENEM · '+skill.subject+' · C'+skill.competencia+' · ':'Descritor ')+skill.code+': '+skill.description),
    skill.matrix==='ENEM'&&field('Objeto de conhecimento (opcional)',objetoSelect(skill)),
    skill.matrix==='ENEM'&&h('p',{class:'caption'},'A IA gera uma questão no estilo do ENEM, com situação-problema e 5 alternativas (A–E).'),
    field(skill.matrix==='ENEM'?'Texto-base e orientações adicionais (recomendado em Linguagens e Humanas)':'Texto-base e orientações adicionais (obrigatório para Língua Portuguesa)',h('textarea',{
      name:'context',rows:5,maxLength:8000,
      placeholder:skill.subject==='Língua Portuguesa'?'Cole aqui o texto que o aluno deverá interpretar.':'Opcional: contexto escolar, situações-problema ou conteúdos específicos.'})),
    h('p',{class:'caption'},aiNote(target)+' A validação estrutural não garante resposta correta; revise antes de aplicar.'),
    problem,
    h('div',{class:'row'},
      h('button',{class:'btn secondary',type:'button',onclick:()=>dialog.close()},'Cancelar'),
      h('button',{class:'btn',type:'submit'},'Gerar rascunho com IA')));
  const dialog=h('dialog',{class:'atlas-descriptor-editor','aria-label':'Gerar com IA'},
    h('h2',{class:'headline'},'Criação assistida por IA'),form);
  document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
}
function objetoSelect(skill) {
  const area = enemArea(skill.level);
  return h('select', { name: 'objeto', value: state.objeto },
    h('option', { value: '' }, 'Qualquer objeto da área'),
    area.objetos.map((topic) => h('optgroup', { label: (topic.disciplina ? topic.disciplina + ' · ' : '') + topic.tema },
      topic.itens.map((item) => h('option', { value: item }, item)))));
}
function manualEditor() {
  const skill=findSkill(state.skill);
  const form=h('form',{class:'stack-s',onsubmit:async(event)=>{
    event.preventDefault();
    const data=new FormData(form);
    const type=String(data.get('type'));
    const options=String(data.get('options')||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    const answer=String(data.get('answer')||'').trim();
    const question={type,text:String(data.get('text')||'').trim(),
      options:['choice','multi'].includes(type)?options:[],skill:skill.id,
      topic:skill.topic,weight:1,difficulty:'medium',
      explanation:String(data.get('explanation')||'').trim()};
    if(type==='choice'&&answer)question.correct=answer;
    if(type==='multi'&&answer)question.correct=answer.split(/\s*[;,]\s*/).filter(Boolean);
    if(type==='numeric')question.correct=Number(answer);
    if(['choice','multi'].includes(type)&&(options.length<2||options.length>10)){toast('Informe de 2 a 10 alternativas.');return;}
    if(type==='choice'&&(!answer||!options.includes(answer))){toast('Gabarito deve coincidir com uma alternativa.');return;}
    if(type==='multi'&&(!Array.isArray(question.correct)||!question.correct.length||question.correct.some(a=>!options.includes(a)))){toast('Respostas devem constar entre as alternativas.');return;}
    if(type==='numeric'&&(!answer||!Number.isFinite(Number(answer)))){toast('Resposta numérica inválida.');return;}
    try{await save(question);dialog.close();}catch(error){toast(error.message);}
  }},
    h('p',{class:'notice'},skill.code+' · '+skill.description),
    field('Enunciado',h('textarea',{name:'text',required:true,maxLength:2000,rows:4,placeholder:'Para leitura, insira ou identifique o texto-base.'})),
    field('Formato',h('select',{name:'type'},h('option',{value:'choice'},'Múltipla escolha'),h('option',{value:'text'},'Discursiva'),h('option',{value:'numeric'},'Numérica'),h('option',{value:'multi'},'Múltiplas respostas'))),
    field('Alternativas (uma por linha)',h('textarea',{name:'options',rows:4})),
    field('Gabarito (em múltiplas respostas, separe por ponto e vírgula)',h('input',{name:'answer'})),
    field('Explicação ou resolução',h('textarea',{name:'explanation',maxLength:1200,rows:2})),
    h('p',{class:'caption'},'Revise se a questão realmente avalia o descritor; a associação não é uma validação por IA.'),
    h('div',{class:'row'},h('button',{type:'button',class:'btn secondary',onclick:()=>dialog.close()},'Cancelar'),h('button',{class:'btn',type:'submit'},'Salvar questão')));
  const dialog=h('dialog',{class:'atlas-descriptor-editor','aria-label':'Questão por descritor'},h('h2',{class:'headline'},'Criar questão por descritor'),form);
  document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
}
function correct(q,value) {
  if(q.type==='choice')return value===q.correct;
  if(q.type==='numeric')return value!==''&&value!=null&&Number.isFinite(Number(String(value).replace(',','.')))&&Math.abs(Number(String(value).replace(',','.'))-Number(q.correct))<=Number(q.tolerance||0);
  if(q.type==='multi'){
    let selected=value;
    if(typeof selected==='string'){try{selected=JSON.parse(selected);}catch{return false;}}
    const expected=q.correct;
    return Array.isArray(selected)&&Array.isArray(expected)&&selected.length===expected.length&&selected.slice().sort().every((s,i)=>s===expected.slice().sort()[i]);
  }
  return null;
}
async function analyze() {
  const selected=state.skill;state.working=true;state.error='';render();
  try {
    let items=0,applied=0,answers=0,hits=0,manual=0,manualPoints=0,manualMax=0,processed=0;
    for(const exam of exams.slice(0,60)){
      processed++;
      if(!exam.questionCount)continue;
      const result=await api('/api/exams/'+encodeURIComponent(exam.id)+'/results');
      const found=(result.exam?.questions||[]).filter(q=>q.skill===selected);
      if(!found.length)continue;applied++;items+=found.length;
      for(const student of result.results||[]){
        if(student.status!=='submitted')continue;
        for(const q of found) {
          const value=student.answers?.[q.id];
          if(value===undefined||value===null||value==='')continue;
          if(['choice','multi','numeric'].includes(q.type)&&q.correct!==undefined){
            answers++;if(correct(q,value))hits++;
          } else if(student.grades?.[q.id]!==undefined){
            manual++;manualPoints+=Number(student.grades[q.id]);manualMax+=Number(q.weight||1);
          }
        }
      }
    }
    if(state.skill===selected)state.report={items,applied,answers,hits,manual,manualPoints,manualMax,processed,total:exams.length};
  } catch(error){if(state.skill===selected)state.error=error.message;}
  finally{if(state.skill===selected){state.working=false;render();}}
}
async function reviewQuestion(q) {
  const target = await aiTarget('review');
  if (!target) return;
  const outcome=h('div',{class:'stack-s'},h('p',{class:'caption'},'Parecer provisório: a revisão do professor continua necessária. '+aiNote(target)));
  const submit=h('button',{class:'btn',onclick:async()=>{
    submit.disabled=true;submit.textContent='Analisando…';
    try{
      const result=await api('/api/ai/descriptor-review',{method:'POST',body:{skillId:state.skill,question:q}});
      clear(outcome,h('p',{class:result.aligned?'notice':'notice warn'},result.aligned?'Possível alinhamento':'Possível divergência'),
        h('p',{},result.justification),
        ...result.improvements.map(text=>h('p',{class:'caption'},'Sugestão: '+text)));
    }catch(error){clear(outcome,h('p',{class:'notice warn'},error.message));}
    finally{submit.disabled=false;submit.textContent='Analisar novamente';}
  }},'Analisar questão');
  const dialog=h('dialog',{class:'atlas-descriptor-editor'},
    h('h2',{class:'headline'},'Análise de questão por IA'),
    h('p',{class:'caption'},q.text),
    outcome,
    h('div',{class:'row'},submit,h('button',{class:'btn secondary',onclick:()=>dialog.close()},'Fechar')));
  document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
}
function questionCard(q,draft=false){
  const keys=Array.isArray(q.correct)?q.correct:[q.correct];
  return h('article',{class:'card stack-s atlas-descriptor-question'},
    h('div',{class:'row between'},h('span',{class:'badge'},q.type==='text'?'Discursiva':'Questão objetiva'),h('span',{class:'caption'},q.skill)),
    h('strong',{},q.text),
    q.options?.length?h('div',{class:'atlas-descriptor-options'},q.options.map((option,index)=>h('div',
      {class:'atlas-descriptor-option'+(keys.includes(option)?' is-correct':'')},
      String.fromCharCode(65+index)+') '+option))):null,
    q.explanation&&h('div',{class:'notice'},'Resolução: '+q.explanation),
    h('div',{class:'row'},
      draft&&h('button',{class:'btn secondary',onclick:()=>save(q).catch(e=>toast(e.message))},'Salvar no banco'),
      h('button',{class:'btn secondary',onclick:()=>reviewQuestion(q).catch(e=>toast(e.message))},'Analisar com IA'),
      h('button',{class:'btn',onclick:()=>goToExam(q)},'Adicionar à prova')));
}
function render() {
  if(!root)return;
  const skill=findSkill(state.skill);
  const stage=MATRIX_LEVELS.find(s=>s.id===state.level);
  const enem=state.level===ESSAY||stage?.matrix==='ENEM';
  const matches=bank.filter(q=>q.skill===state.skill);
  const list=skillRows();
  const report=state.report;
  clear(root,h('div',{class:'stack atlas-descriptor-page'},
    h('div',{class:'row between'},
      h('div',{},h('h1',{class:'title'},'Descritores e habilidades'),h('p',{class:'sub'},'Pesquisar, criar e analisar questões pela Matriz de Referência do ENEM e pelas matrizes do SAEB.')),
      h('span',{class:'badge'},ENEM_SKILLS.length+' habilidades ENEM · '+SAEB_SKILLS.length+' descritores SAEB')),
    h('div',{class:'notice'},enem?'Matriz de Referência do ENEM ('+ENEM_SOURCE.publisher+', '+ENEM_SOURCE.year+'): 4 áreas, 30 competências de área e 120 habilidades (H1–H30 em cada área). O mesmo código Hn tem significados diferentes em cada área.':'Matrizes tradicionais Inep. Um mesmo código Dn pode ter significados diferentes por disciplina e etapa. As matrizes BNCC são outro referencial.'),
    h('div',{class:'atlas-descriptor-layout'},
      h('aside',{class:'card stack-s atlas-descriptor-sidebar'},
        field('Matriz, área ou etapa',h('select',{value:state.level,onchange:e=>chooseLevel(e.target.value)},
          h('optgroup',{label:'ENEM'},ENEM_LEVELS.map(s=>h('option',{value:s.id},s.subject)),h('option',{value:ESSAY},'Redação (competências I a V)')),
          h('optgroup',{label:'SAEB'},SAEB_LEVELS.map(s=>h('option',{value:s.id},s.label))))),
        state.level!==ESSAY&&
        field(enem?'Pesquisar habilidade':'Pesquisar descritor',h('input',{type:'search',value:state.search,placeholder:enem?'H17, gráfico, energia…':'D16, porcentagem, leitura…',
          oninput:e=>{state.search=e.target.value;render();let el=root.querySelector('.atlas-descriptor-sidebar input');el?.focus();}})),
        state.level!==ESSAY&&h('p',{class:'caption'},list.length+(enem?' habilidades encontradas':' descritores encontrados')),
        state.level!==ESSAY&&h('div',{class:'atlas-descriptor-list'},list.map((s,i)=>[
          s.matrix==='ENEM'&&s.competencia!==list[i-1]?.competencia&&h('p',{class:'eyebrow',style:'margin:10px 4px 2px'},'Competência de área '+s.competencia),
          h('button',{type:'button',class:'atlas-descriptor-select','aria-pressed':String(s.id===state.skill),onclick:()=>chooseSkill(s.id)},
            h('strong',{},s.code),h('span',{},s.description))])),
        h('a',{href:enem?ENEM_SOURCE.pdf:MATRIZ_SOURCES[stage?.source||'MAT'],target:'_blank',rel:'noopener noreferrer',class:'btn secondary'},enem?'Abrir a Matriz do ENEM (PDF)':'Ver PDF oficial')),
      h('div',{class:'atlas-descriptor-main stack'},
        state.level===ESSAY&&essayPanel(),
        state.level!==ESSAY&&skill&&h('div',{class:'card stack-s'},
          h('p',{class:'eyebrow'},skill.matrix==='ENEM'?'ENEM · '+skill.subject+' · Competência de área '+skill.competencia:skill.subject+' · '+skill.stage+' · '+skill.topic),
          h('h2',{class:'title-m'},skill.code+' — '+skill.description),
          skill.matrix==='ENEM'&&h('p',{class:'sub'},'Competência de área '+skill.competencia+': '+skill.competenciaText),
          skill.matrix==='ENEM'&&state.objeto&&h('p',{class:'notice'},'Objeto de conhecimento escolhido: ',h('strong',{},state.objeto),' (usado em Criar com IA).'),
          h('div',{class:'row'},
            h('button',{class:'btn',disabled:!SUPPORTED_GENERATORS.includes(skill.id),onclick:generate},'Gerar questão offline'),
            h('button',{class:'btn secondary',onclick:manualEditor},'Criar questão orientada'),
            h('button',{class:'btn secondary',onclick:()=>aiEditor().catch(error=>toast(error.message))},'Criar com IA'),
            h('button',{class:'btn secondary',disabled:state.working,onclick:analyze},state.working?'Analisando…':'Analisar resultados')),
          !SUPPORTED_GENERATORS.includes(skill.id)&&h('p',{class:'caption'},skill.matrix==='ENEM'?'Para o ENEM, use Criar com IA (estilo ENEM, 5 alternativas) ou Criar questão orientada.':'Não há gerador automático verificado para este descritor. A criação orientada permanece disponível.'),
          skill.matrix==='ENEM'&&enemReference(skill)),
        state.level!==ESSAY&&state.error&&h('p',{class:'notice warn',role:'alert'},state.error),
        state.draft&&h('div',{class:'stack-s'},h('h3',{class:'headline'},state.draftByAi?'Rascunho criado pela IA — revise antes de usar':'Questão inédita gerada por regras — revise'),questionCard(state.draft,true)),
        report&&h('div',{class:'card stack-s atlas-descriptor-analysis'},
          h('h3',{class:'headline'},'Análise das avaliações salvas'),
          h('div',{class:'atlas-descriptor-metrics'},
            metric('Provas com o descritor',report.applied),
            metric('Itens encontrados',report.items),
            metric('Respostas objetivas',report.answers),
            metric('Acertos',report.answers?(100*report.hits/report.answers).toFixed(1)+'%':'—')),
          report.manual>0&&h('p',{class:'caption'},'Questões discursivas corrigidas: '+report.manual+' · Pontos: '+report.manualPoints+'/'+report.manualMax),
          h('p',{class:'caption'},'Taxa de acerto descritiva; não é TRI nem prova de domínio individual. Base: respostas entregues.'),
          report.processed<report.total&&h('p',{class:'notice warn'},'Análise limitada às 60 provas mais recentes: '+report.processed+' de '+report.total+'.')),
        h('div',{class:'row between'},h('h3',{class:'headline'},'Buscar no banco local'),h('span',{class:'badge'},matches.length+' questões')),
        matches.length?h('div',{class:'atlas-descriptor-cards'},matches.map(q=>questionCard(q))):
          h('p',{class:'notice'},'Nenhuma questão com esta disciplina, etapa e descritor. Os códigos antigos como D16 não são associados automaticamente para evitar classificações erradas.'),
        h('p',{class:'caption'},'Banco: '+bank.length+' itens · Avaliações: '+exams.length+'. Busca local e offline, sem acesso a banco público de questões do Inep.')))));
}
function metric(title,value){return h('div',{class:'stat'},h('div',{class:'caption'},title),h('div',{class:'stat-n'},String(value)));}
// Referência da habilidade do ENEM: eixos cognitivos e objetos de conhecimento da área (tocar escolhe o objeto).
function enemReference(skill) {
  const area = enemArea(skill.level);
  const groups = [...new Set(area.objetos.map((topic) => topic.disciplina || ''))];
  return h('div', { class: 'stack-s' },
    h('details', {}, h('summary', { class: 'caption', style: 'cursor:pointer' }, 'Eixos cognitivos (comuns a todas as áreas)'),
      h('ul', { class: 'caption', style: 'margin:8px 0 0;padding-left:18px' }, ENEM_AXES.map((axis) => h('li', {}, h('strong', {}, `${axis.name} (${axis.id}): `), axis.text)))),
    h('details', { open: !!state.objeto }, h('summary', { class: 'caption', style: 'cursor:pointer' }, `Objetos de conhecimento da área (${area.objetos.reduce((n, t) => n + t.itens.length, 0)}) — toque para usar na criação com IA`),
      ...groups.map((group) => h('div', { class: 'stack-s', style: 'margin-top:8px' },
        group && h('p', { class: 'eyebrow' }, group),
        ...area.objetos.filter((topic) => (topic.disciplina || '') === group).map((topic) => h('div', {},
          h('strong', { class: 'caption', style: 'display:block;margin:6px 0 4px' }, topic.tema),
          h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' }, topic.itens.map((item) => h('button', {
            type: 'button', class: 'chip', 'aria-pressed': String(state.objeto === item), onclick: () => chooseObjeto(item),
          }, item)))))))));
}
// Redação do ENEM: as cinco competências com os níveis de 0 a 200 e atalho para incluir na prova.
function essayPanel() {
  return h('div', { class: 'card stack-s' },
    h('p', { class: 'eyebrow' }, 'ENEM · Prova de redação'),
    h('h2', { class: 'title-m' }, 'Competências da redação (0 a 200 cada, total 1000)'),
    h('p', { class: 'sub' }, 'Inclua uma redação na prova e corrija em Resultados escolhendo um nível por competência. O Atlas soma os pontos e converte para o peso da questão.'),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => goToExam({ type: 'text', text: ESSAY_PROMPT, options: [], weight: 10, topic: 'Redação ENEM', criteria: essayCriteria() }) }, 'Adicionar redação modelo ENEM à prova')),
    ...ENEM_ESSAY.map((c) => h('details', {}, h('summary', { style: 'cursor:pointer' }, h('strong', {}, `Competência ${c.id}`), ' — ', c.text),
      h('ul', { class: 'caption', style: 'margin:8px 0 0;padding-left:18px' }, c.levels.map((level) => h('li', {}, h('strong', {}, `${level.score} pontos: `), level.description))))));
}
