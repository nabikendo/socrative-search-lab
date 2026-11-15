import { api } from '../lib/api.js';
import { getAppearance, setAppearance } from '../lib/theme.js';
import { h, clear } from '../lib/dom.js';

let root;
let preferences;
const appearanceKeys = new Set(['theme','fontSize','highContrast','compact','presentation']);
const sections = [
  ['Aparência', [
    ['theme','Tema','select',[['auto','Automático'],['light','Claro'],['dark','Escuro']]],
    ['fontSize','Tamanho da fonte','select',[['small','Pequena'],['medium','Média'],['large','Grande']]],
    ['highContrast','Alto contraste','checkbox'],
    ['compact','Modo compacto','checkbox'],
    ['presentation','Modo apresentação','checkbox']]],
  ['Prova — padrões', [
    ['defaultMinutes','Tempo padrão (minutos)','number'],
    ['shuffle','Embaralhar questões','checkbox'],
    ['showAnswerKey','Mostrar gabarito após envio','checkbox'],
    ['submissionSound','Notificação sonora ao receber envio','checkbox']]]
];
export function mount(el) { root=el; }
export function deactivate() {}
const status = (message) => { const el=root.querySelector('#settings-status'); if(el)el.textContent=message; };
async function save(key,value) {
  const before={...preferences};
  preferences[key]=value;
  if(appearanceKeys.has(key))setAppearance({[key]:value});
  try { preferences=await api('/api/teacher-settings',{method:'PUT',body:{[key]:value}}); status('Preferência salva.'); }
  catch(error) { preferences=before; if(appearanceKeys.has(key))setAppearance({[key]:before[key]});status('Erro ao salvar: '+error.message);render(); }
}
function setting([key,label,type,options]) {
  const input=document.createElement(type==='select'?'select':'input');
  input.id='setting-'+key;
  if(type==='select') for(const [value,name] of options) input.append(h('option',{value},name));
  else input.type=type;
  if(type==='checkbox') input.checked=!!preferences[key]; else input.value=String(preferences[key]);
  if(type==='number') {input.min='1';input.max='480';input.step='1';}
  input.addEventListener('change',()=>{
    const value=type==='checkbox'?input.checked:type==='number'?Number(input.value):input.value;
    save(key,value);
  });
  return h('label',{class:type==='checkbox'?'setting-check':''},...(type==='checkbox'?[input,document.createTextNode(label)]:[h('span',{},label),input]));
}
function group(title,children) { return h('section',{class:'settings-group'},h('h2',{class:'headline'},title),h('div',{class:'list'},...children)); }
function action(label,handler) {
  const button=h('button',{class:'btn secondary',type:'button'},label);
  button.addEventListener('click',()=>Promise.resolve(handler()).catch(error=>status(error.message)));
  return button;
}
function downloadBackup() {
  // Existing .atlas export includes attachments; keep its supported format.
  window.location.href='/api/backup';
}
async function restoreBackup() {
  const picker=document.createElement('input');picker.type='file';picker.accept='.atlas,application/json';picker.style.display='none';
  document.body.append(picker);
  picker.addEventListener('change',async()=>{
    try {
      const file=picker.files?.[0];if(!file)return;
      const raw=await file.arrayBuffer();
      const verified=await api('/api/restore/verify',{method:'POST',raw});
      if(!confirm('Restaurar '+verified.exams+' provas? Os dados atuais serão substituídos.'))return;
      await api('/api/restore',{method:'POST',raw});
      status('Backup restaurado. Atualize o painel.');
    } catch(error) {status(error.message);}
    finally {picker.remove();}
  },{once:true});
  picker.click();
}
async function loadNetwork() {
  const {urls}=await api('/api/network');
  const node=root.querySelector('#settings-network');
  if(node)node.textContent=urls.join(' · ')||'Nenhum endereço de rede detectado';
}
function render() {
  clear(root,h('h1',{class:'title-m'},'Configurações'),h('p',{id:'settings-status',role:'status',class:'caption'},'Alterações são salvas automaticamente.'));
  for(const [title,fields] of sections)root.append(group(title,fields.map(setting)));
  root.append(group('Rede',[
    h('p',{id:'settings-network',class:'caption'},'Carregando IP…'),
    action('Atualizar endereço e QR',async()=>{await loadNetwork();status('Endereços atualizados. O QR da prova é gerado a partir do endereço atual.');})
  ]));
  root.append(group('Dados',[
    h('p',{class:'caption'},'Backup completo no formato .atlas já compatível com o Atlas.'),
    h('div',{class:'settings-actions'},action('Exportar backup',downloadBackup),action('Importar backup',restoreBackup)),
    h('p',{class:'caption'},'Limpeza de provas antigas: utilize a gestão de provas existente até existir uma operação de exclusão segura com prévia.')
  ]));
  root.append(group('Sobre',[
    h('p',{},'Atlas 1.3.5'),
    h('a',{href:'https://github.com/nabikendo/socrative-search-lab/releases'},'Changelog / versões'),
    h('a',{href:'https://github.com/nabikendo/socrative-search-lab'},'Repositório GitHub')
  ]));
  loadNetwork().catch(error=>status(error.message));
}
export async function activate() {
  try {
    preferences=await api('/api/teacher-settings');
    // Server settings are authoritative for teacher profile.
    setAppearance(Object.fromEntries([...appearanceKeys].map(k=>[k,preferences[k]])));
    render();
  } catch(error) { clear(root,h('p',{class:'error',role:'alert'},error.message)); }
}
