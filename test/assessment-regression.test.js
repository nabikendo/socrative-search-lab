import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { submittedOnly, finalAnswersForItem } from '../shared/assessment-results.js';

test('desempenho por questão utiliza somente avaliações entregues', () => {
  const rows=[
    { status:'active', answers:{ q1:'Errada' } },
    { status:'paused', answers:{ q1:'Errada' } },
    { status:'submitted', answers:{ q1:'Certa' } },
    { status:'submitted', answers:{ q1:'', q2:'0' } },
    { status:'submitted', answers:{ q1:'Certa', q2:'[]' } },
  ];
  assert.equal(submittedOnly(rows).length,3);
  assert.deepEqual(finalAnswersForItem(rows,'q1'),['Certa','Certa']);
  assert.deepEqual(finalAnswersForItem(rows,'q2'),['0']);
  assert.deepEqual(finalAnswersForItem(null,'q1'),[]);
  assert.deepEqual(finalAnswersForItem([{status:'submitted'}],'q1'),[]);
});

test('botão adicionar questão ativa editor digital saindo de modo PDF', () => {
  const source=fs.readFileSync(new URL('../src/professor/exam.js',import.meta.url),'utf8');
  assert.match(source,/function appendManualQuestion\(model, type\)/);
  assert.match(source,/if \(model\.pdfOnly\)\s*\{\s*model\.pdfOnly = false;/);
  assert.match(source,/appendManualQuestion\(m, 'choice'\)/);
  assert.match(source,/appendManualQuestion\(m, 'text'\)/);
});

test('estatísticas agregadas usam apenas respostas de provas entregues', () => {
  const source=fs.readFileSync(new URL('../src/professor/results.js',import.meta.url),'utf8');
  assert.equal((source.match(/finalAnswersForItem\(d\.results, q\.id\)/g)||[]).length,2);
});
