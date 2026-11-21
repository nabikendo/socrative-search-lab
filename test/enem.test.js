import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ENEM_AREAS, ENEM_AXES, ENEM_ESSAY, ENEM_SOURCE, essayCriteria } from '../shared/enem.js';
import { ENEM_LEVELS, ENEM_SKILLS, SAEB_SKILLS, MATRIX_SKILLS, findSkill, skillLabel, enemArea } from '../shared/skills.js';
import { normalizeQuestions, studentQuestions } from '../shared/exam.js';
import { createClient } from '../lib/ai.mjs';
import { generateQuestion, reviewQuestion } from '../lib/ai-questions.mjs';
import { createApp } from '../server.mjs';

test('matriz do ENEM completa: 4 áreas, 30 competências, 120 habilidades H1–H30 por área', () => {
  assert.deepEqual(ENEM_AREAS.map((a) => [a.id, a.competencias.length]), [['LC', 9], ['MT', 7], ['CN', 8], ['CH', 6]]);
  for (const area of ENEM_AREAS) {
    const codes = area.competencias.flatMap((c) => c.skills.map(([code]) => code));
    assert.deepEqual(codes, Array.from({ length: 30 }, (_, i) => `H${i + 1}`), `sequência de ${area.id}`);
    for (const c of area.competencias) { assert.ok(c.text.length > 20); for (const [, d] of c.skills) assert.match(d, /\.$/); }
  }
  assert.equal(ENEM_SKILLS.length, 120);
  assert.equal(new Set(MATRIX_SKILLS.map((s) => s.id)).size, SAEB_SKILLS.length + 120);
  assert.ok(MATRIX_SKILLS.every((s) => s.id.length <= 12), 'o identificador cabe no campo de descritor');
  assert.equal(ENEM_LEVELS.length, 4);
  assert.equal(ENEM_AXES.length, 5);
  assert.equal(ENEM_SOURCE.pdf, '/matrizes/enem-matriz-de-referencia-2026.pdf');
});

test('habilidades guardam área e competência; códigos iguais em áreas diferentes não se confundem', () => {
  const h24 = findSkill('enemcn-h24');
  assert.equal(h24.competencia, 7);
  assert.match(h24.description, /nomenclatura da química/);
  assert.match(skillLabel('ENEMCN-H24'), /^ENEM · Ciências da Natureza e suas Tecnologias · C7 · H24:/);
  assert.notEqual(findSkill('ENEMMT-H24').description, h24.description);
  assert.equal(findSkill('ENEMCH-H30').competencia, 6);
});

test('objetos de conhecimento do anexo e redação com cinco competências de 0 a 200', () => {
  const cn = enemArea('ENEMCN');
  assert.deepEqual([...new Set(cn.objetos.map((t) => t.disciplina))], ['Física', 'Química', 'Biologia']);
  assert.ok(cn.objetos.find((t) => t.tema === 'Água').itens.includes('Solubilidade'));
  assert.ok(enemArea('MT').objetos.some((t) => t.tema === 'Conhecimentos geométricos'));
  assert.equal(ENEM_AREAS.reduce((n, a) => n + a.objetos.reduce((m, t) => m + t.itens.length, 0), 0), 379);
  assert.deepEqual(ENEM_ESSAY.map((c) => c.id), ['I', 'II', 'III', 'IV', 'V']);
  for (const c of ENEM_ESSAY) assert.deepEqual(c.levels.map((l) => l.score), [200, 160, 120, 80, 40, 0]);
});

test('questão com habilidade ENEM e correção por competências; o aluno não recebe os critérios', () => {
  const [q] = normalizeQuestions([{ type: 'text', text: 'Redija.', weight: 10, skill: 'ENEMLC-H18', criteria: essayCriteria() }]);
  assert.equal(q.skill, 'ENEMLC-H18');
  assert.equal(q.criteria.length, 5);
  assert.equal(q.criteria[0].levels.length, 6);
  const [student] = studentQuestions([q]);
  assert.equal(student.criteria, undefined);
});

const fake = (answer, seen = []) => async (url, options) => {
  seen.push({ url: String(url), options });
  return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }) };
};
const client = (fetchImpl) => createClient({ provider: 'groq', apiKey: 'chave-de-teste-123', model: 'modelo-x' }, { fetchImpl });

test('IA no estilo ENEM: 5 alternativas, competência e objeto de conhecimento no pedido', async () => {
  const seen = [];
  const draft = { text: 'Em uma estação de tratamento, adiciona-se sulfato de alumínio à água…', options: ['A) Floculação', 'B) Destilação', 'C) Filtração', 'D) Cloração', 'E) Decantação'], correct: 'A) Floculação', explanation: 'O sulfato de alumínio forma flocos que agregam partículas.' };
  const result = await generateQuestion({ skillId: 'ENEMCN-H25', objeto: 'Poluição e tratamento de água' }, { client: client(fake(draft, seen)) });
  assert.deepEqual(result.question.options, ['Floculação', 'Destilação', 'Filtração', 'Cloração', 'Decantação']);
  assert.equal(result.question.correct, 'Floculação');
  assert.equal(result.question.topic, 'Poluição e tratamento de água');
  const body = JSON.parse(seen[0].options.body);
  const sent = body.messages.map((m) => m.content).join('\n');
  assert.match(sent, /exatamente 5 alternativas/);
  assert.match(sent, /Competência de área 7/);
  assert.match(sent, /Objeto de conhecimento: Poluição e tratamento de água/);
  await assert.rejects(() => generateQuestion({ skillId: 'ENEMCN-H25' }, { client: client(fake({ ...draft, options: draft.options.slice(0, 4), correct: 'A) Floculação' })) }), /cinco alternativas/);
});

test('análise com IA cita a habilidade do ENEM e a competência', async () => {
  const seen = [];
  await reviewQuestion({ skillId: 'ENEMMT-H25', question: { text: 'A tabela mostra o consumo de água…', options: ['1', '2', '3', '4', '5'], correct: '3' } },
    { client: client(fake({ aligned: true, confidence: 'high', justification: 'Usa dados de tabela.', improvements: [] }, seen)) });
  const sent = JSON.parse(seen[0].options.body).messages.map((m) => m.content).join('\n');
  assert.match(sent, /Matriz: ENEM · Matemática e suas Tecnologias · Competência de área 6/);
  assert.match(sent, /Habilidade: H25/);
});

let app, base, dir;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-enem-'));
  app = createApp({ dataDir: dir, pin: '123456', securePort: 0 });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('o PDF oficial da matriz vem junto com o Atlas e abre sem Internet', { skip: !fs.existsSync(new URL('../dist/matrizes/enem-matriz-de-referencia-2026.pdf', import.meta.url)) && 'rode npm run build' }, async () => {
  const res = await fetch(base + ENEM_SOURCE.pdf, { headers: { connection: 'close' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
});
