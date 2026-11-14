import { api } from '../lib/api.js';
import { h, clear } from '../lib/dom.js';

let root;
let questions = [];
const filters={text:'',skill:'',difficulty:''};
export function mount(el) { root = el; }
export async function activate() { await load(); }
async function load() { questions = (await api('/api/question-bank')).questions; render(); }
function render() {
  const skills=[...new Set(questions.map((q)=>q.skill).filter(Boolean))].sort();
  const filtered=questions.filter((q)=>`${q.text} ${q.topic||''}`.toLocaleLowerCase().includes(filters.text.toLocaleLowerCase())&&(!filters.skill||q.skill===filters.skill)&&(!filters.difficulty||q.difficulty===filters.difficulty));
  clear(root, h('div', { class: 'stack' },
    h('h1', { class: 'title' }, 'Banco de questões'),
    h('p', { class: 'lead' }, 'Guarde questões para reutilizar em outras provas. A habilidade SAEB fica associada à questão.'),
    h('div',{class:'row'},
      h('input',{id:'bank-search',type:'search',placeholder:'Buscar enunciado ou conteúdo',value:filters.text,oninput:(e)=>{filters.text=e.target.value;const cursor=e.target.selectionStart;render();const input=root.querySelector('#bank-search');input.focus();input.setSelectionRange(cursor,cursor);}}),
      h('select',{value:filters.skill,onchange:(e)=>{filters.skill=e.target.value;render();}},h('option',{value:''},'Todas as habilidades'),skills.map((skill)=>h('option',{value:skill},skill))),
      h('select',{value:filters.difficulty,onchange:(e)=>{filters.difficulty=e.target.value;render();}},h('option',{value:''},'Todas as dificuldades'),h('option',{value:'easy'},'Fácil'),h('option',{value:'medium'},'Média'),h('option',{value:'hard'},'Difícil'))),
    questions.length&&filtered.length ? h('div', { class: 'list' }, filtered.map((q) => h('div', { class: 'list-row' },
      h('span', { class: 'badge' }, q.skill || 'Sem descritor'),
      h('span', { class: 'grow' }, h('div',{},q.text),h('div',{class:'caption'},[q.topic,q.difficulty==='easy'?'Fácil':q.difficulty==='medium'?'Média':q.difficulty==='hard'?'Difícil':''].filter(Boolean).join(' · '))),
      h('button', { class: 'btn secondary', onclick: async () => {
        window.dispatchEvent(new CustomEvent('atlas:add-bank-question', { detail: q }));
      } }, 'Usar na prova'),
      h('button', { class: 'btn quiet', 'aria-label': 'Excluir questão', onclick: async () => { await api(`/api/question-bank/${q.bankId}`, { method: 'DELETE' }); await load(); } }, 'Excluir'))))
      : questions.length ? h('div',{class:'notice'},'Nenhuma questão corresponde aos filtros.') : h('div', { class: 'notice' }, 'O banco ainda está vazio. Na aba Prova, use “Salvar questão no banco” em uma questão existente.')));
}

