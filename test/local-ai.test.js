import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listLocalModels, generateLocalQuestion } from '../lib/local-ai.mjs';

const mock = (answer, seen = []) => async (url, options) => {
  seen.push({url,options});
  return { ok:true,status:200,text:async()=>JSON.stringify(
    String(url).endsWith('/api/tags')?{models:[{name:'modelo:local'}]}:
      {message:{content:JSON.stringify(answer)}}) };
};
test('IA usa somente o endereço local, valida o descritor e nunca publica automaticamente', async () => {
  const seen=[];
  const question={
    text:'Uma turma tem 200 estudantes, e 20% participam de um clube. Quantos participam?',
    options:['20','40','80','100'],correct:'40',
    explanation:'20% de 200 = 40 estudantes.',
  };
  const result=await generateLocalQuestion({skillId:'SAEB3-D16',model:'modelo:local'},{fetchImpl:mock(question,seen)});
  assert.equal(result.question.skill,'SAEB3-D16');
  assert.equal(result.question.correct,'40');
  assert.equal(result.source,'ia-local-rascunho');
  assert.deepEqual(seen.map(s=>s.url),['http://127.0.0.1:11434/api/tags','http://127.0.0.1:11434/api/chat']);
  assert.equal(JSON.parse(seen[1].options.body).stream,false);
  assert.ok(JSON.parse(seen[1].options.body).messages[0].content.includes('originais'));
});
test('IA exige texto-base para Língua Portuguesa e modelo instalado', async () => {
  await assert.rejects(()=>generateLocalQuestion({skillId:'SAEBLP3-D16',model:'modelo:local'},{fetchImpl:mock({})}),/texto-base/);
  await assert.rejects(()=>generateLocalQuestion({skillId:'SAEB3-D16',model:'outro:inexistente'},{fetchImpl:mock({})}),/não instalado/);
  assert.deepEqual(await listLocalModels({fetchImpl:async()=>{throw new Error('offline');}}),[]);
});
test('IA recusa gabarito fora das alternativas e respostas malformadas', async () => {
  await assert.rejects(()=>generateLocalQuestion({skillId:'SAEB3-D16',model:'modelo:local'},
    {fetchImpl:mock({text:'Qual é a resposta?',options:['1','2','3','4'],correct:'5',explanation:'Erro.'})}),/quatro alternativas/);
});
