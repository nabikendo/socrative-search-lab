import { api } from '../lib/api.js';
import { h, clear } from '../lib/dom.js';

let root;
let questions = [];
export function mount(el) { root = el; }
export async function activate() { await load(); }
async function load() { questions = (await api('/api/question-bank')).questions; render(); }
function render() {
  clear(root, h('div', { class: 'stack' },
    h('h1', { class: 'title' }, 'Banco de questões'),
    h('p', { class: 'lead' }, 'Guarde questões para reutilizar em outras provas. A habilidade SAEB fica associada à questão.'),
    questions.length ? h('div', { class: 'list' }, questions.map((q) => h('div', { class: 'list-row' },
      h('span', { class: 'badge' }, q.skill || 'Sem descritor'),
      h('span', { class: 'grow' }, q.text),
      h('button', { class: 'btn secondary', onclick: async () => {
        window.dispatchEvent(new CustomEvent('atlas:add-bank-question', { detail: q }));
      } }, 'Usar na prova'),
      h('button', { class: 'btn quiet', 'aria-label': 'Excluir questão', onclick: async () => { await api(`/api/question-bank/${q.bankId}`, { method: 'DELETE' }); await load(); } }, 'Excluir'))))
      : h('div', { class: 'notice' }, 'O banco ainda está vazio. Na aba Prova, use “Salvar questão no banco” em uma questão existente.')));
}

