import { api } from '../lib/api.js';
import { h, clear, toast } from '../lib/dom.js';

let root;
let questions = [];
let exams = [];
const filters = { text: '', skill: '', difficulty: '', type: '', topic: '', collection: 'all', mode: 'questions' };
const FAVORITES_KEY = 'atlas.bank.favorites';
const favoriteIds = new Set((() => { try { return JSON.parse(localStorage.getItem(FAVORITES_KEY)) || []; } catch { return []; } })());
const typeLabel = { choice: 'Múltipla escolha', multi: 'Múltiplas respostas', text: 'Discursiva', numeric: 'Numérica' };
const difficultyLabel = { easy: 'Fácil', medium: 'Média', hard: 'Difícil' };

export function mount(el) { root = el; }
export async function activate() { await load(); }
async function load() {
  const [bank, saved] = await Promise.all([api('/api/question-bank'), api('/api/exams')]);
  questions = bank.questions;
  exams = saved.exams;
  render();
}
function goToExam(examId = '') {
  if (examId) sessionStorage.setItem('atlas.jumpExam', examId);
  window.dispatchEvent(new CustomEvent('atlas:goto', { detail: 'prova' }));
}
function toggleFavorite(id) {
  if (favoriteIds.has(id)) favoriteIds.delete(id); else favoriteIds.add(id);
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favoriteIds]));
  render();
}
function option(value, label, selected) { return h('option', { value, selected }, label); }
function field(label, el) { return h('label', { class: 'field' }, h('span', {}, label), el); }

function editor(existing = null) {
  const question = existing || {};
  const form = h('form', { class: 'stack-s', onsubmit: async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const type = String(data.get('type'));
    const values = String(data.get('options') || '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    const answer = String(data.get('correct') || '').trim();
    const text = String(data.get('text') || '').trim();
    const payload = {
      type, text, weight: Number(data.get('weight') || 1),
      topic: String(data.get('topic') || '').trim(),
      skill: String(data.get('skill') || '').trim(),
      difficulty: String(data.get('difficulty') || '') || undefined,
      explanation: String(data.get('explanation') || '').trim(),
      options: type === 'choice' || type === 'multi' ? values : [],
      ...(type === 'choice' && answer ? { correct: answer } : {}),
      ...(type === 'multi' && answer ? { correct: answer.split(/\s*[;,]\s*/).filter(Boolean) } : {}),
      ...(type === 'numeric' && answer !== '' ? { correct: Number(answer), tolerance: 0 } : {}),
    };
    if ((type === 'choice' || type === 'multi') && values.length < 2) { toast('Insira ao menos duas alternativas.'); return; }
    if (type === 'choice' && answer && !values.includes(answer)) { toast('O gabarito precisa coincidir com uma alternativa.'); return; }
    if (type === 'multi' && answer && !answer.split(/\s*[;,]\s*/).filter(Boolean).every((value) => values.includes(value))) { toast('Cada resposta correta precisa coincidir com uma alternativa.'); return; }
    if (type === 'numeric' && (!answer || !Number.isFinite(Number(answer)))) { toast('Informe um gabarito numérico válido.'); return; }
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    try {
      // A API do banco adiciona novos itens. Na edição, só elimina o original depois do novo registro existir.
      const created = await api('/api/question-bank', { method: 'POST', body: payload });
      if (existing) {
        try {
          await api(`/api/question-bank/${existing.bankId}`, { method: 'DELETE' });
          if (favoriteIds.delete(existing.bankId)) favoriteIds.add(created.question.bankId);
          localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favoriteIds]));
        } catch { toast('Cópia salva. O item anterior permanece no banco.'); }
      }
      dialog.close();
      await load();
      toast(existing ? 'Questão atualizada no banco' : 'Questão adicionada ao banco');
    } catch (error) { toast(error.message); }
    finally { submit.disabled = false; }
  } },
    field('Enunciado', h('textarea', { name: 'text', required: true, maxLength: 2000, rows: 4, value: question.text || '', placeholder: 'Escreva a questão' })),
    h('div', { class: 'row' },
      field('Tipo', h('select', { name: 'type' }, Object.entries(typeLabel).map(([key, label]) => option(key, label, key === (question.type || 'choice'))))),
      field('Peso', h('input', { type: 'number', min: '0.01', max: '100', step: '0.25', name: 'weight', value: question.weight || 1, required: true })),
      field('Dificuldade', h('select', { name: 'difficulty' }, option('', 'Não definida', !question.difficulty), Object.entries(difficultyLabel).map(([key, label]) => option(key, label, key === question.difficulty))))),
    field('Alternativas (uma por linha, para questões objetivas)', h('textarea', { name: 'options', rows: 4, placeholder: 'Alternativa A\nAlternativa B\nAlternativa C', value: (question.options || []).join('\n') })),
    field('Resposta correta (igual à alternativa; para numérica, informe o valor)', h('input', { name: 'correct', value: Array.isArray(question.correct) ? question.correct.join('; ') : question.correct ?? '' })),
    h('div', { class: 'row' },
      field('Tópico', h('input', { name: 'topic', value: question.topic || '', placeholder: 'Ex.: Ligações químicas', maxLength: 80 })),
      field('Descritor', h('input', { name: 'skill', value: question.skill || '', placeholder: 'Opcional', maxLength: 12 }))),
    field('Explicação / comentário pedagógico', h('textarea', { name: 'explanation', rows: 2, maxLength: 1200, value: question.explanation || '' })),
    h('div', { class: 'row', style: 'justify-content:flex-end' },
      h('button', { type: 'button', class: 'btn secondary', onclick: () => dialog.close() }, 'Cancelar'),
      h('button', { type: 'submit', class: 'btn' }, 'Salvar questão')));
  const dialog = h('dialog', { class: 'atlas-bank-editor', 'aria-label': existing ? 'Editar questão' : 'Nova questão' },
    h('div', { class: 'row between' }, h('h2', { class: 'headline' }, existing ? 'Editar questão do banco' : 'Nova questão')),
    h('p', { class: 'caption', style: 'margin:9px 0 16px' }, 'O gabarito não é compartilhado com os alunos antes da correção.'),
    form);
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
}
function questionCard(question) {
  const correct = Array.isArray(question.correct) ? question.correct : [question.correct];
  const difficulty = difficultyLabel[question.difficulty] || 'Não definida';
  return h('article', { class: 'card atlas-bank-question' },
    h('div', { class: 'atlas-bank-question-header' },
      h('span', { class: 'badge' }, typeLabel[question.type] || 'Questão'),
      question.topic && h('span', { class: 'badge' }, question.topic),
      h('span', { class: 'badge' }, difficulty),
      question.skill && h('span', { class: 'badge' }, question.skill),
      h('span', { class: 'caption right' }, '#'+question.bankId)),
    h('div', { class: 'atlas-bank-question-title' }, question.text),
    question.image && h('img', { src: question.image, alt: question.imageAlt || 'Imagem associada à questão', style: 'max-width:100%;max-height:240px;object-fit:contain;justify-self:start' }),
    question.options?.length ? h('div', { class: 'atlas-bank-answers' }, question.options.map((answer, index) => h('div', { class: 'atlas-bank-answer'+(correct.includes(answer) ? ' correct' : '') },
      h('span', { class: 'atlas-bank-letter' }, String.fromCharCode(65+index)),
      h('span', {}, answer),
      correct.includes(answer) && h('span', { class: 'right', 'aria-label': 'Gabarito correto' }, '✓'))))
      : question.type === 'numeric' ? h('div', { class: 'atlas-bank-note' }, 'Resposta numérica: ', question.correct === undefined ? 'sem gabarito' : String(question.correct))
      : h('div', { class: 'atlas-bank-note' }, question.rubric?.length ? 'Questão discursiva com rubrica de correção.' : 'Questão discursiva: correção manual.'),
    question.explanation && h('div', { class: 'atlas-bank-note' }, h('strong', {}, 'Comentário pedagógico'), h('div', {}, question.explanation)),
    h('div', { class: 'atlas-bank-foot' },
      h('span', { class: 'caption' }, 'Peso ', String(question.weight), question.skill ? ' · '+question.skill : ''),
      h('button', { class: 'btn quiet', type: 'button', 'aria-pressed': String(favoriteIds.has(question.bankId)), onclick: () => toggleFavorite(question.bankId) }, favoriteIds.has(question.bankId) ? '★ Favorita' : '☆ Favoritar'),
      h('button', { class: 'btn quiet', type: 'button', onclick: () => editor(question) }, 'Editar'),
      h('button', { class: 'btn', type: 'button', onclick: () => {
        sessionStorage.setItem('atlas.bank.pending', JSON.stringify(question));
        goToExam();
      } }, '+ Adicionar à prova'),
      h('button', { class: 'btn quiet atlas-bank-danger', type: 'button', onclick: async () => {
        if (!confirm('Excluir esta questão do banco? Questões já usadas em provas não serão alteradas.')) return;
        try { await api(`/api/question-bank/${question.bankId}`, { method: 'DELETE' }); favoriteIds.delete(question.bankId); await load(); toast('Questão excluída do banco'); }
        catch (error) { toast(error.message); }
      } }, 'Excluir')));
}
function examCard(exam) {
  const name = exam.title || 'Avaliação sem título';
  const status = exam.status === 'open' ? 'Aberta aos alunos' : exam.status === 'closed' ? 'Encerrada' : exam.status === 'paused' ? 'Pausada' : 'Rascunho';
  return h('article', { class: 'card atlas-bank-question' },
    h('div', { class: 'atlas-bank-question-header' },
      h('span', { class: 'badge' }, status),
      h('span', { class: 'badge' }, `${exam.questionCount || 0} questões`),
      exam.document && h('span', { class: 'badge' }, 'Documento anexado')),
    h('h2', { class: 'headline' }, name),
    h('div', { class: 'caption' }, 'Prova salva no Atlas. Abra para editar, aplicar, duplicar ou imprimir, conforme o estado da avaliação.'),
    h('div', { class: 'atlas-bank-foot' },
      h('button', { class: 'btn', onclick: () => goToExam(exam.id) }, 'Abrir na aba Prova'),
      h('button', { class: 'btn secondary', onclick: () => window.dispatchEvent(new CustomEvent('atlas:goto', { detail: 'resultados' })) }, 'Resultados')));
}
function render() {
  if (!root) return;
  const topics = [...new Set(questions.map(q => q.topic).filter(Boolean))].sort((a,b) => a.localeCompare(b,'pt-BR'));
  const skills = [...new Set(questions.map(q => q.skill).filter(Boolean))].sort();
  const counts = { all:questions.length, favorites:questions.filter(q => favoriteIds.has(q.bankId)).length, choice:questions.filter(q => q.type === 'choice' || q.type === 'multi').length, text:questions.filter(q => q.type === 'text').length };
  const filtered = questions.filter(q => {
    const search = [q.text,q.topic,q.skill,...(q.options||[])].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR');
    return search.includes(filters.text.toLocaleLowerCase('pt-BR')) &&
      (!filters.skill || q.skill === filters.skill) && (!filters.difficulty || q.difficulty === filters.difficulty) &&
      (!filters.topic || q.topic === filters.topic) && (!filters.type || q.type === filters.type) &&
      (filters.collection !== 'favorites' || favoriteIds.has(q.bankId)) &&
      (filters.collection !== 'choice' || ['choice','multi'].includes(q.type)) &&
      (filters.collection !== 'text' || q.type === 'text');
  });
  const searchInput = h('input', { id:'bank-search', type:'search', placeholder:'Buscar por enunciado, tema, habilidade ou alternativa…', value:filters.text, oninput:(event) => {
    filters.text = event.target.value;
    const cursor = event.target.selectionStart;
    render();
    const el = root.querySelector('#bank-search');
    el.focus(); try { el.setSelectionRange(cursor,cursor); } catch {}
  } });
  const collectionButton=(key,label)=>h('button',{class:'btn secondary', 'aria-pressed':String(filters.collection===key),onclick:()=>{filters.collection=key;render();}},
    h('span',{},label), h('span',{class:'badge'},String(counts[key])));
  clear(root, h('div', { class:'stack' },
    h('div', { class:'atlas-bank-header' },
      h('div', { class:'stack-s' },
        h('div',{class:'row'},h('h1',{class:'title'},filters.mode==='exams'?'Simulados e avaliações':'Banco de questões'),h('span',{class:'badge'},filters.mode==='exams'?`${exams.length} provas salvas`:`${questions.length} disponíveis`)),
        h('p',{class:'sub'},filters.mode==='exams'?'Cadernos e provas salvos no computador do professor.':'Questões reais cadastradas no Atlas, disponíveis para reutilização em novas provas.')),
      h('div', { class:'row' },
        h('button',{class:'btn secondary',onclick:()=>{ goToExam(); toast('Na aba Prova, anexe o PDF e use “Extrair questões para revisar”.'); }},'Importar questões de PDF'),
        h('button',{class:'btn',onclick:()=>editor()},'+ Nova questão'))),
    h('div',{class:'atlas-bank-toolbar'},
      h('div',{class:'row between'},
        h('div',{class:'segmented'},
          h('button',{type:'button','aria-pressed':String(filters.mode==='questions'),onclick:()=>{filters.mode='questions';render();}},'Questões'),
          h('button',{type:'button','aria-pressed':String(filters.mode==='exams'),onclick:()=>{filters.mode='exams';render();}},'Cadernos e simulados'))),
      searchInput,
      filters.mode==='questions' && h('div',{class:'atlas-bank-filters'},
        h('select',{value:filters.type,'aria-label':'Tipo de questão',onchange:e=>{filters.type=e.target.value;render();}},
          option('','Todos os tipos',!filters.type),Object.entries(typeLabel).map(([key,label])=>option(key,label,key===filters.type))),
        h('select',{value:filters.difficulty,'aria-label':'Dificuldade',onchange:e=>{filters.difficulty=e.target.value;render();}},
          option('','Dificuldade: todas',!filters.difficulty),Object.entries(difficultyLabel).map(([key,label])=>option(key,label,key===filters.difficulty))),
        h('select',{value:filters.skill,'aria-label':'Habilidade',onchange:e=>{filters.skill=e.target.value;render();}},
          option('','Habilidades: todas',!filters.skill),skills.map(skill=>option(skill,skill,skill===filters.skill))),
        (filters.text || filters.type || filters.difficulty || filters.skill || filters.topic || filters.collection!=='all') &&
          h('button',{class:'btn quiet',onclick:()=>{Object.assign(filters,{text:'',skill:'',difficulty:'',type:'',topic:'',collection:'all'});render();}},'Limpar filtros'))),
    filters.mode==='exams'
      ? h('div',{class:'atlas-bank-cards'},exams.filter(e=>e.title.toLocaleLowerCase('pt-BR').includes(filters.text.toLocaleLowerCase('pt-BR'))).map(examCard),
        !exams.length && h('div',{class:'card atlas-bank-empty'},'Nenhuma prova salva. Crie uma avaliação na aba Prova.'))
      : h('div',{class:'atlas-bank-layout'},
        h('aside',{class:'card atlas-bank-sidebar'},
          h('h3',{},'Coleções'),
          collectionButton('all','Minhas questões'),
          collectionButton('favorites','Favoritas'),
          collectionButton('choice','Objetivas'),
          collectionButton('text','Discursivas'),
          h('h3',{},'Tópicos'),
          topics.length ? h('div',{class:'topic-chips'},topics.map(topic=>h('button',{type:'button','aria-pressed':String(filters.topic===topic),onclick:()=>{filters.topic=filters.topic===topic?'':topic;render();}},'#'+topic))) : h('p',{class:'caption'},'Adicione tópicos ao cadastrar suas questões.'),
          h('div',{class:'atlas-bank-stats'},`${filtered.length} de ${questions.length} questões exibidas`)),
        h('div',{class:'atlas-bank-cards'},
          filtered.map(questionCard),
          !filtered.length && h('div',{class:'card atlas-bank-empty'},questions.length?'Nenhuma questão corresponde aos filtros.':'Seu banco está vazio. Cadastre uma questão ou importe questões de uma prova PDF.')))));
}
