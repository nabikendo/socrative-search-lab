import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();

const seed = [
  {id:1,title:'Frações na vida real',subject:'Matemática',grade:'6º ano',keywords:['frações','cotidiano','prática'],questions:12,time:'8 min',author:'Camila N.',description:'Uma sequência curta para reconhecer, comparar e operar frações em situações do dia a dia.',content:'frações equivalentes numerador denominador pizza receita'},
  {id:2,title:'Ecossistemas em equilíbrio',subject:'Ciências',grade:'7º ano',keywords:['ecologia','sistemas','revisão'],questions:15,time:'12 min',author:'Rafael M.',description:'Investigue relações entre seres vivos, ambiente e os ciclos que sustentam a vida.',content:'cadeia alimentar bioma produtores consumidores energia'},
  {id:3,title:'Reading between the lines',subject:'Inglês',grade:'8º ano',keywords:['leitura','interpretação','idiomas'],questions:10,time:'10 min',author:'Joana P.',description:'Leitura guiada com foco em inferência, vocabulário e compreensão de contexto.',content:'reading comprehension vocabulary context inference'},
  {id:4,title:'Brasil: mapas e territórios',subject:'Geografia',grade:'7º ano',keywords:['mapas','território','Brasil'],questions:14,time:'9 min',author:'Diego A.',description:'Leia mapas temáticos e conecte território, população e paisagens brasileiras.',content:'cartografia regiões escala legenda território'},
  {id:5,title:'Revoluções que mudaram o mundo',subject:'História',grade:'9º ano',keywords:['história','revolução','causas'],questions:18,time:'15 min',author:'Lia S.',description:'Uma revisão comparativa sobre causas, atores e consequências de grandes revoluções.',content:'revolução industrial francesa iluminismo sociedade'},
  {id:6,title:'Pontuação sem mistério',subject:'Língua Portuguesa',grade:'5º ano',keywords:['gramática','escrita','prática'],questions:11,time:'7 min',author:'Nina C.',description:'Pratique o uso de vírgula, ponto e dois-pontos em frases que fazem sentido.',content:'vírgula período frase escrita gramática'},
  {id:7,title:'Energia e suas transformações',subject:'Ciências',grade:'8º ano',keywords:['energia','física','revisão'],questions:13,time:'11 min',author:'Rafael M.',description:'Relacione diferentes formas de energia a transformações observáveis no cotidiano.',content:'energia cinética potencial elétrica calor'},
  {id:8,title:'Porcentagem no orçamento',subject:'Matemática',grade:'8º ano',keywords:['porcentagem','finanças','cotidiano'],questions:16,time:'13 min',author:'Camila N.',description:'Resolva problemas de desconto, aumento e planejamento com porcentagens.',content:'porcentagem desconto juros orçamento razão'}
];
let view='discover'; let query=''; let subject='all'; let grade='all'; let keyword='all'; let sort='relevant'; const saved=new Set(); const copied=new Set();
let roster = JSON.parse(localStorage.getItem('atlas-roster') || '[]');
const $=s=>document.querySelector(s); const normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function populate(){for(const [id,values] of [['subject-filter',[...new Set(seed.map(x=>x.subject))]],['grade-filter',[...new Set(seed.map(x=>x.grade))]],['keyword-filter',[...new Set(seed.flatMap(x=>x.keywords))]]]){const el=$('#'+id); values.sort().forEach(value=>el.insertAdjacentHTML('beforeend',`<option value="${value}">${value}</option>`));}}
function score(item){const q=normalize(query);if(!q)return 0;return [item.title,item.subject,item.description,item.content,item.keywords.join(' ')].reduce((n,field)=>n+(normalize(field).includes(q)?(normalize(item.title)===q?5:1):0),0)}
function filtered(){let items=seed.filter(item=>{const hay=normalize([item.title,item.subject,item.description,item.content,item.keywords.join(' ')].join(' ')); return (!query||hay.includes(normalize(query)))&&(subject==='all'||item.subject===subject)&&(grade==='all'||item.grade===grade)&&(keyword==='all'||item.keywords.includes(keyword))&&(view!=='library'||copied.has(item.id))&&(view!=='deleted'||item.id===99)});if(sort==='az')items.sort((a,b)=>a.title.localeCompare(b.title));else if(query)items.sort((a,b)=>score(b)-score(a));return items;}
function card(item){return `<article class="result-card"><div class="card-top"><span class="subject-tag">${item.subject}</span><button class="bookmarked ${saved.has(item.id)?'saved':''}" data-save="${item.id}" aria-label="${saved.has(item.id)?'Remover dos favoritos':'Salvar avaliação'}">${saved.has(item.id)?'★':'☆'}</button></div><h4>${item.title}</h4><p class="description">${item.description}</p><div class="card-meta"><span>◈ ${item.questions} questões</span><span>◷ ${item.time}</span></div><div class="card-footer"><span class="author">por ${item.author} · ${item.grade}</span><button class="details-button" data-detail="${item.id}">${copied.has(item.id)?'Na biblioteca':'Ver detalhes →'}</button></div></article>`;}
function render(){const items=filtered();$('#result-count').textContent=items.length;$('#results-label').textContent=view==='discover'?'SUGESTÕES PARA SUA TURMA':view==='library'?'SUA BIBLIOTECA':'ITENS ARQUIVADOS';$('#page-title').textContent=view==='discover'?'Descobrir avaliações':view==='library'?'Minha biblioteca':'Itens arquivados';$('#results-grid').innerHTML=items.map(card).join('');$('#results-grid').classList.toggle('hidden',!items.length);$('#empty-state').classList.toggle('hidden',!!items.length);const active=[subject!=='all',grade!=='all',keyword!=='all'].filter(Boolean).length;$('#filter-count').textContent=active;$('#filter-count').classList.toggle('hidden',!active);document.querySelectorAll('[data-save]').forEach(b=>b.onclick=()=>{const id=Number(b.dataset.save);saved.has(id)?saved.delete(id):saved.add(id);render();});document.querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>openDetail(Number(b.dataset.detail)));}
function openDetail(id){const item=seed.find(x=>x.id===id);$('#dialog-content').innerHTML=`<span class="subject-tag">${item.subject}</span><h2>${item.title}</h2><p>${item.description}</p><div class="dialog-details"><span>${item.grade}</span><span>${item.questions} questões</span><span>${item.time}</span>${item.keywords.map(k=>`<span>#${k}</span>`).join('')}</div><button class="primary-button" id="copy-button">${copied.has(id)?'Já está na minha biblioteca':'Copiar para minha biblioteca'}</button>`;$('#detail-dialog').showModal();$('#copy-button').onclick=()=>{copied.add(id);showToast('Avaliação copiada para sua biblioteca');$('#detail-dialog').close();render();};}
function showToast(text){const t=$('#toast');t.textContent=text;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)}
function clear(){query='';subject='all';grade='all';keyword='all';$('#search-input').value='';$('#subject-filter').value='all';$('#grade-filter').value='all';$('#keyword-filter').value='all';render();}
function parseRoster(text){
  const rows=[];
  for(const raw of text.split(/\r?\n/)){
    const line=raw.replace(/^\uFEFF/,'').trim();
    const delimited=line.match(/^(\d{1,3})\s*[;,\t]\s*"?(.+?)"?\s*$/);
    const match=delimited||line.replace(/\s+/g,' ').match(/^(\d{1,3})\s+(.+?)(?:\s+[*FJ]\s*\d*\s*\d*)?$/i);
    if(match && !/estudante|presença|faltas|diário|governo|secretaria/i.test(match[2])) rows.push({number:match[1],name:match[2].trim()});
  }
  return [...new Map(rows.map(row=>[row.number,row])).values()];
}
async function readRosterFile(file){
  let text='';
  if(file.type==='application/pdf' || file.name.toLowerCase().endsWith('.pdf')){
    const pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
    const pages=[];
    for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){
      const page=await pdf.getPage(pageNumber); const content=await page.getTextContent();
      const lines=[];
      for(const item of content.items){
        const y=Math.round(item.transform?.[5]||0); let line=lines.find(entry=>Math.abs(entry.y-y)<3);
        if(!line){line={y,items:[]};lines.push(line)} line.items.push(item);
      }
      pages.push(lines.sort((a,b)=>b.y-a.y).map(line=>line.items.sort((a,b)=>a.transform[4]-b.transform[4]).map(item=>item.str).join(' ')).join('\n'));
    }
    text=pages.join('\n');
  }else text=await file.text();
  const parsed=parseRoster(text);
  roster=parsed; localStorage.setItem('atlas-roster',JSON.stringify(roster)); $('#send-roster').disabled=!parsed.length;
  $('#roster-status').innerHTML=parsed.length?`<strong>${parsed.length} alunos identificados.</strong> A coluna “#” será usada para iniciar a prova.`:'Não consegui identificar linhas no arquivo. Use um CSV com as colunas número e nome.';
  if(parsed.length) showToast(`${parsed.length} alunos carregados localmente`);
}
populate();render();$('#search-input').oninput=e=>{query=e.target.value.trim();render()};$('#subject-filter').onchange=e=>{subject=e.target.value;render()};$('#grade-filter').onchange=e=>{grade=e.target.value;render()};$('#keyword-filter').onchange=e=>{keyword=e.target.value;render()};$('#clear-filters').onclick=clear;$('#empty-clear').onclick=clear;$('#filter-toggle').onclick=()=>$('#filter-bar').classList.toggle('hidden');$('#sort-button').onclick=()=>{sort=sort==='relevant'?'az':'relevant';$('#sort-button').innerHTML=sort==='az'?'A–Z <span>⌄</span>':'Mais relevantes <span>⌄</span>';render()};$('#dialog-close').onclick=()=>$('#detail-dialog').close();$('#attendance-close').onclick=()=>$('#attendance-dialog').close();$('#attendance-button').onclick=()=>{$('#roster-status').innerHTML=roster.length?`<strong>${roster.length} alunos carregados.</strong> Selecione outro arquivo para substituir a lista.`:'Nenhuma lista carregada nesta sessão.';$('#send-roster').disabled=!roster.length;$('#attendance-dialog').showModal()};$('#roster-file').onchange=e=>e.target.files[0]&&readRosterFile(e.target.files[0]).catch(()=>{$('#roster-status').textContent='Não foi possível ler este arquivo neste dispositivo.'});$('#send-roster').onclick=async()=>{const response=await fetch('/api/roster',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({roster})});const result=await response.json();showToast(result.ok?`${result.count} alunos enviados ao servidor local`:'Servidor local indisponível');};document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{view=button.dataset.view;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b===button));render()});$('#create-button').onclick=()=>showToast('Editor de avaliação: pronto para conectar ao seu backend');document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#search-input').focus()}});
