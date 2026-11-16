import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(base, relative), 'utf8');

test('painel do professor contém as seis abas e o visual compartilhado', () => {
  const page = read('professor.html');
  for (const tab of ['turma', 'prova', 'banco', 'descritores', 'resultados', 'ajuda']) {
    assert.match(page, new RegExp('data-tab="'+tab+'"'));
    assert.match(page, new RegExp('id="tab-'+tab+'"'));
  }
  assert.match(page, /reference-redesign\.css/);
  assert.match(page, /id="settings-open"/);
});

test('tela do aluno conserva controles de prova e rascunho sem IDs duplicados', () => {
  const page = read('prova.html');
  const ids = [...page.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'IDs HTML duplicados confundem os eventos e o salvamento');
  for (const id of ['exam','q-card','grid','scratch','submit','submit-side','hud-label','progress-bar','save-state']) {
    assert.ok(ids.includes(id), 'controle ausente: '+id);
  }
  assert.match(page, /reference-redesign\.css/);
});

test('Banco mostra dados do sistema e não contém exemplos artificiais das referências', () => {
  const bank = read('src/professor/bank.js');
  assert.match(bank, /api\('\/api\/question-bank'\)/);
  assert.match(bank, /api\('\/api\/exams'\)/);
  assert.match(bank, /atlas\.bank\.pending/);
  assert.doesNotMatch(bank, /Prof\. Ricardo|148 questões|Q-2041|68\.4%/);
});

test('layout é responsivo e mantém suporte a tema escuro', () => {
  assert.match(read('src/styles/reference-redesign.css'), /@media \(max-width:820px\)/);
  assert.match(read('src/styles/base.css'), /data-theme="dark"/);
});

test('cada aba registrada no main.js tem botão e seção no HTML (aba sem seção deixa as outras em branco)', () => {
  const page = read('professor.html');
  const main = read('src/professor/main.js');
  const registered = [...main.match(/const tabs = \{([^}]*)\}/)[1].matchAll(/(\w+):/g)].map((match) => match[1]);
  assert.deepEqual(registered.sort(), ['ajuda', 'banco', 'configuracoes', 'descritores', 'prova', 'resultados', 'turma']);
  for (const tab of registered) {
    if (tab === 'configuracoes') assert.match(page, /id="settings-open"/, 'engrenagem ausente');
    else assert.match(page, new RegExp('data-tab="' + tab + '"'), 'botão ausente: ' + tab);
    assert.match(page, new RegExp('<section id="tab-' + tab + '"'), 'seção ausente: ' + tab);
  }
});


test('navegação do professor registra os eventos em todos os botões de aba', () => {
  const main = read('src/professor/main.js');
  assert.match(main, /for \\(const button of \\$\\$\\('\\[data-tab\\]'\\)\\) button\\.addEventListener\\('click'/);
  assert.doesNotMatch(main, /for \\(const button of \\$\\('\\[data-tab\\]'\\)\\)/);
});
