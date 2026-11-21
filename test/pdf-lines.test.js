import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinLineItems } from '../shared/pdf-lines.js';
import { parsePdfQuestionText } from '../shared/exam.js';

// Trechos como o pdf.js entrega: palavras separadas por ~4 pontos, coluna da direita a ~300 pontos.
const word = (str, x, width = str.length * 6) => ({ str, transform: [1, 0, 0, 1, x, 500], width });

test('palavras da mesma coluna continuam na mesma linha', () => {
  const items = [word('Quanto', 50), word('é', 100, 6), word('2+2?', 110, 18)];
  assert.equal(joinLineItems(items), 'Quanto é 2+2?');
});

test('texto da coluna da direita vira linha própria (não gruda no enunciado)', () => {
  const items = [word('Analisando a quantidade de raízes', 50, 190), word('E) O vértice sempre possui coordenada', 300, 200)];
  const text = joinLineItems(items);
  assert.equal(text.split('\n').length, 2);
  assert.match(text, /\nE\) O vértice/);
});

test('questão de duas colunas vira enunciado e alternativas separados', () => {
  const left = [word('1. Qual é o valor de x?', 50, 150)];
  const right = [word('A) 2', 300, 30)];
  const line = joinLineItems([...left, ...right]);
  const questions = parsePdfQuestionText(`${line}\nB) 3\nC) 4\nD) 5\nE) 6`);
  assert.equal(questions.length, 1);
  assert.equal(questions[0].text, 'Qual é o valor de x?');
  assert.deepEqual(questions[0].options, ['2', '3', '4', '5', '6']);
});
