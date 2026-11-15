import { api } from '../lib/api.js';
import { h, clear, toast } from '../lib/dom.js';
import { SAEB_LEVELS, SAEB_SKILLS, findSkill, MATRIZ_SOURCES } from '../../shared/skills.js';
import { generateDescriptorQuestion, SUPPORTED_GENERATORS } from '../../shared/descriptor-generator.js';

let root, bank = [], exams = [];
const state = { level: 'SAEB3', skill: 'SAEB3-D16', search: '', draft: null, report: null, working: false, error: '' };
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
const skillRows = () => SAEB_SKILLS.filter(s => s.level === state.level && normalize(s.code + ' ' + s.topic + ' ' + s.description).includes(normalize(state.search)));
function chooseLevel(id) { state.level=id; state.skill=SAEB_SKILLS.find(s=>s.level===id)?.id||'';state.draft=null;state.report=null;render(); }
function chooseSkill(id) { state.skill=id;state.draft=null;state.report=null;state.error='';render(); }
function goToExam(question) {
  sessionStorage.setItem('atlas.bank.pending', JSON.stringify(question));
  window.dispatchEvent(new CustomEvent('atlas:goto', { detail:'prova' }));
}
async function save(question) {
  const result = await api('/api/question-bank', { method:'POST',body:question });
  bank.unshift(result.question);state.draft=null;render();toast('Questão salva com o descritor selecionado.');
}
function generate() {
  state.draft = generateDescriptorQuestion(state.skill, Math.floor(Math.random()*1e9)+1);
  state.error=state.draft?'':'Este descritor não tem gerador automático validado; use a criação orientada.';
  render();
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
      h('button',{class:'btn',onclick:()=>goToExam(q)},'Adicionar à prova')));
}
function render() {
  if(!root)return;
  const skill=findSkill(state.skill);
  const stage=SAEB_LEVELS.find(s=>s.id===state.level);
  const matches=bank.filter(q=>q.skill===state.skill);
  const list=skillRows();
  const report=state.report;
  clear(root,h('div',{class:'stack atlas-descriptor-page'},
    h('div',{class:'row between'},
      h('div',{},h('h1',{class:'title'},'Descritores e habilidades'),h('p',{class:'sub'},'Pesquisar, criar e analisar questões por matriz e etapa do SAEB.')),
      h('span',{class:'badge'},SAEB_SKILLS.length+' descritores catalogados')),
    h('div',{class:'notice'},'Matrizes tradicionais Inep. Um mesmo código Dn pode ter significados diferentes por disciplina e etapa. As matrizes BNCC são outro referencial.'),
    h('div',{class:'atlas-descriptor-layout'},
      h('aside',{class:'card stack-s atlas-descriptor-sidebar'},
        field('Disciplina e etapa',h('select',{value:state.level,onchange:e=>chooseLevel(e.target.value)},
          SAEB_LEVELS.map(s=>h('option',{value:s.id,selected:stage?.id===s.id},s.label)))),
        field('Pesquisar descritor',h('input',{type:'search',value:state.search,placeholder:'D16, porcentagem, leitura…',
          oninput:e=>{state.search=e.target.value;render();let el=root.querySelector('.atlas-descriptor-sidebar input');el?.focus();}})),
        h('p',{class:'caption'},list.length+' descritores encontrados'),
        h('div',{class:'atlas-descriptor-list'},list.map(s=>h('button',{type:'button',class:'atlas-descriptor-select',
          'aria-pressed':String(s.id===state.skill),onclick:()=>chooseSkill(s.id)},
          h('strong',{},s.code),h('span',{},s.description)))),
        h('a',{href:MATRIZ_SOURCES[stage?.source||'MAT'],target:'_blank',rel:'noopener noreferrer',class:'btn secondary'},'Ver PDF oficial')),
      h('main',{class:'atlas-descriptor-main stack'},
        skill&&h('div',{class:'card stack-s'},
          h('p',{class:'eyebrow'},skill.subject+' · '+skill.stage+' · '+skill.topic),
          h('h2',{class:'title-m'},skill.code+' — '+skill.description),
          h('div',{class:'row'},
            h('button',{class:'btn',disabled:!SUPPORTED_GENERATORS.includes(skill.id),onclick:generate},'Gerar questão offline'),
            h('button',{class:'btn secondary',onclick:manualEditor},'Criar questão orientada'),
            h('button',{class:'btn secondary',disabled:state.working,onclick:analyze},state.working?'Analisando…':'Analisar resultados')),
          !SUPPORTED_GENERATORS.includes(skill.id)&&h('p',{class:'caption'},'Não há gerador automático verificado para este descritor. A criação orientada permanece disponível.')),
        state.error&&h('p',{class:'notice warn',role:'alert'},state.error),
        state.draft&&h('div',{class:'stack-s'},h('h3',{class:'headline'},'Questão inédita gerada por regras — revise'),questionCard(state.draft,true)),
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
