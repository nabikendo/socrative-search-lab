import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../lib/ai.mjs';
import { generateQuestion, reviewQuestion } from '../lib/ai-questions.mjs';

// Provedor OpenAI-compatível falso: devolve `answer` como texto do modelo e registra as chamadas.
const fake = (answer, seen = []) => async (url, options) => {
  seen.push({ url: String(url), options });
  return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: typeof answer === 'string' ? answer : JSON.stringify(answer) } }] }) };
};
const client = (fetchImpl) => createClient({ provider: 'groq', apiKey: 'chave-de-teste-123', model: 'modelo-x' }, { fetchImpl });

test('gera rascunho com a IA em nuvem escolhida, validando descritor e alternativas', async () => {
  const seen = [];
  const question = { text: 'Uma turma tem 200 estudantes, e 20% participam de um clube. Quantos participam?', options: ['20', '40', '80', '100'], correct: '40', explanation: '20% de 200 = 40 estudantes.' };
  const result = await generateQuestion({ skillId: 'SAEB3-D16' }, { client: client(fake(question, seen)) });
  assert.equal(result.question.skill, 'SAEB3-D16');
  assert.equal(result.question.correct, '40');
  assert.equal(result.source, 'ia-rascunho');
  assert.equal(result.provider, 'groq');
  assert.equal(seen.length, 1);
  assert.ok(seen[0].url.startsWith('https://api.groq.com/'));
  assert.ok(JSON.parse(seen[0].options.body).max_tokens >= 2000, 'limite de tokens suficiente para a questão completa');
});

test('aceita resposta do modelo dentro de cerca de markdown', async () => {
  const body = '```json\n' + JSON.stringify({ text: 'Qual é 2+2?', options: ['3', '4', '5', '6'], correct: '4', explanation: 'Soma.' }) + '\n```';
  const result = await generateQuestion({ skillId: 'SAEB3-D16' }, { client: client(fake(body)) });
  assert.equal(result.question.correct, '4');
});

test('exige IA configurada, texto-base em Língua Portuguesa e gabarito válido', async () => {
  await assert.rejects(() => generateQuestion({ skillId: 'SAEB3-D16' }, {}), /Configurações/);
  await assert.rejects(() => generateQuestion({ skillId: 'SAEBLP3-D16' }, { client: client(fake({})) }), /texto-base/);
  await assert.rejects(() => generateQuestion({ skillId: 'SAEB3-D16' }, { client: client(fake({ text: 'Q?', options: ['1', '2', '3', '4'], correct: '5', explanation: 'Erro.' })) }), /quatro alternativas/);
  await assert.rejects(() => generateQuestion({ skillId: 'SAEB3-D16' }, { client: client(fake('isto não é json')) }), /formato esperado/);
});

test('parecer de alinhamento é provisório e não altera a questão', async () => {
  const report = { aligned: false, confidence: 'medium', justification: 'O enunciado não exige porcentagem.', improvements: ['Incluir situação com percentual.'] };
  const result = await reviewQuestion({ skillId: 'SAEB3-D16', question: { text: 'Calcule 2 + 2, sem porcentagem.', options: ['3', '4', '5', '6'], correct: '4' } }, { client: client(fake(report)) });
  assert.equal(result.aligned, false);
  assert.equal(result.provisional, true);
  assert.equal(result.provider, 'groq');
});
