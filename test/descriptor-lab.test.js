import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAEB_LEVELS, SAEB_SKILLS, findSkill, skillLabel, MATRIZ_SOURCES } from '../shared/skills.js';
import { generateDescriptorQuestion, SUPPORTED_GENERATORS } from '../shared/descriptor-generator.js';
import { normalizeQuestions } from '../shared/exam.js';

test('Inep traditional matrices: correct number of descriptor records per stage', () => {
  assert.deepEqual(Object.fromEntries(SAEB_LEVELS.map(s => [s.id, s.max])), {
    SAEB5: 28, SAEB9: 37, SAEB3: 35, SAEBLP5: 15, SAEBLP9: 21, SAEBLP3: 21,
  });
  assert.equal(SAEB_SKILLS.length, 157);
  assert.equal(new Set(SAEB_SKILLS.map(s => s.id)).size, 157);
  for (const stage of SAEB_LEVELS) {
    const group=SAEB_SKILLS.filter(s=>s.level===stage.id);
    assert.equal(group.length,stage.max);
    assert.ok(group.every(s=>s.code && s.topic && s.description && s.source));
  }
  assert.ok(MATRIZ_SOURCES.LP.endsWith('/Matriz_de_Referencia_de_Lingua_Portuguesa.pdf'));
});

test('D16 is not interchangeable between Portuguese and Mathematics', () => {
  assert.match(findSkill('SAEB3-D16').description, /porcentagem/i);
  assert.match(findSkill('SAEBLP3-D16').description, /ironia ou humor/i);
  assert.match(findSkill('SAEBLP5-D11').description, /fato da opinião/i);
  assert.match(findSkill('SAEBLP9-D14').description, /fato da opinião/i);
  assert.match(skillLabel('D16'), /sem disciplina\/etapa/i);
  assert.equal(findSkill('SAEB5-D29'), null);
  assert.equal(findSkill('SAEBLP5-D16'), null);
});

test('automatic generation only supports tested templates; no fabricated Portuguese exercises', () => {
  assert.equal(generateDescriptorQuestion('SAEBLP3-D16', 7), null);
  assert.equal(generateDescriptorQuestion('SAEB3-D31', 7), null);
  for (const skill of SUPPORTED_GENERATORS) {
    assert.ok(findSkill(skill), 'template references existing descriptor '+skill);
    for (let seed=1;seed<=250;seed++){
      const draft=generateDescriptorQuestion(skill,seed);
      assert.ok(draft,'no draft for '+skill);
      const [validated] = normalizeQuestions([draft]);
      assert.equal(validated.skill,skill);
      assert.equal(validated.type,'choice');
      assert.equal(validated.options.length,4);
      assert.equal(new Set(validated.options).size,4);
      assert.ok(validated.options.includes(validated.correct));
      assert.ok(validated.explanation.length>5);
    }
  }
});

test('descriptor labels and source text are usable offline', () => {
  const s=findSkill('SAEB9-D28');
  assert.equal(s.subject,'Matemática');
  assert.equal(s.code,'D28');
  assert.match(s.description,/porcentagem/i);
  assert.match(skillLabel(s.id),/9º ano do Ensino Fundamental/);
});
