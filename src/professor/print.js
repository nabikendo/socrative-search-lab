import { h } from '../lib/dom.js';

// Plano B para o dia em que a rede não colabora: imprime a prova (ou o gabarito) a partir do painel.
export function printExam(title, questions, { key = false } = {}) {
  const letter = (index) => String.fromCharCode(65 + index);
  const isCorrect = (question, option) => Array.isArray(question.correct) ? question.correct.includes(option) : question.correct === option;
  const sheet = h('div', { id: 'print-sheet' },
    h('h1', {}, key ? `${title} — gabarito` : title),
    !key && h('p', { class: 'print-id' }, 'Nome: ________________________________   Nº: _____   Turma: __________   Data: ___/___/______'),
    questions.map((question, index) => h('section', { class: 'print-q' },
      h('p', {}, h('strong', {}, `${index + 1}. `), question.text, question.weight ? ` (${String(question.weight).replace('.', ',')} pt)` : ''),
      question.image && h('img', { src: question.image, alt: '' }),
      ['choice', 'multi'].includes(question.type)
        ? h('ul', { class: 'print-opts' }, question.options.map((option, i) => h('li', {},
          key && isCorrect(question, option) ? h('strong', {}, `(X) ${letter(i)}) ${option}`) : `(   ) ${letter(i)}) ${option}`)))
        : question.type === 'numeric'
          ? h('p', {}, key ? `Resposta: ${question.correct}` : 'Resposta: ______________________')
          : !key && [0, 1, 2, 3].map(() => h('div', { class: 'print-line' })))));
  const done = () => { sheet.remove(); document.body.classList.remove('printing'); };
  document.body.append(sheet);
  document.body.classList.add('printing');
  addEventListener('afterprint', done, { once: true });
  setTimeout(done, 300_000);
  print();
}
