import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../lib/store.mjs';
import { updateSafety } from '../desktop/update-safety.mjs';
import { answerFailure } from '../shared/answer-sync.js';

test('never discard a pending answer on 4xx, expired session or network failure', () => {
  assert.equal(answerFailure({ code:'invalid_answer', status:400 }).action,'review');
  assert.equal(answerFailure({ code:'unknown_question', status:400 }).action,'review');
  assert.equal(answerFailure({ code:'teacher_auth_required', status:401 }).action,'review');
  assert.equal(answerFailure({ code:'exam_closed', status:409 }).action,'locked');
  assert.equal(answerFailure({ code:'session_closed', status:409 }).action,'locked');
  assert.equal(answerFailure({ code:'session_paused', status:423 }).action,'retry');
  assert.equal(answerFailure({ code:'exam_paused', status:423 }).action,'retry');
  assert.equal(answerFailure({ code:'network', status:0 }).action,'retry');
  assert.equal(answerFailure({ status:503 }).action,'retry');
  const code=fs.readFileSync(new URL('../src/prova.js',import.meta.url),'utf8');
  assert.doesNotMatch(code,/delete state\.pending\[qid\];\s*\/\/ resposta recusada/);
  assert.match(code,/setAnswer\(q\.id, value, true\)/);
  assert.match(code,/writeJson\(queueKey\(state\.session\.id\), state\.pending\)/);
  assert.match(code,/hasUnconfirmedAnswers/);
});

test('pending submissions in recently closed exams block installation until confirmed', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-safety-'));
  const store=openStore(dir);
  try {
    const exam=store.saveExam({ title:'Prova simulada',questions:[
      {type:'choice',text:'Quanto é 2 + 2?',options:['3','4'],correct:'4',weight:1}
    ] });
    store.openExam(exam.id);
    const session=store.createSession(exam.id,'1',{name:'Aluno de teste'});
    assert.equal(store.unconfirmedRecentSessions(),1);
    assert.equal(updateSafety(store).reason,'exam_in_progress');
    store.closeExam(exam.id);
    assert.equal(updateSafety(store).reason,'unconfirmed_deliveries');
    assert.equal(updateSafety(store).count,1);
    store.submit(session.id);
    assert.equal(store.unconfirmedRecentSessions(),0);
    assert.equal(updateSafety(store).safe,true);
  } finally { store.close();fs.rmSync(dir,{recursive:true,force:true}); }
});

test('scheduled assessment starting soon prevents installer restart', () => {
  const now=Date.parse('2026-11-15T14:00:00.000Z');
  const mock={getOpenExam:()=>null,unconfirmedRecentSessions:()=>0,
    listExams:()=>[{id:'p1',status:'scheduled',scheduledStart:'2026-11-15T14:10:00.000Z'}]};
  assert.equal(updateSafety(mock,now).reason,'scheduled_soon');
  assert.equal(updateSafety(mock,now-3600_000).safe,true);
});

test('document removal and replacement delete orphaned attachment files', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-doc-'));
  const store=openStore(dir);
  try {
    const exam=store.saveExam({title:'Documentos',questions:[]});
    const a=path.join(store.documentDir,'old.pdf');
    const b=path.join(store.documentDir,'new.pdf');
    fs.writeFileSync(a,'pdf-old');
    store.setDocument(exam.id,{name:'old.pdf',kind:'pdf',size:7,file:'old.pdf'});
    fs.writeFileSync(b,'pdf-new');
    store.setDocument(exam.id,{name:'new.pdf',kind:'pdf',size:7,file:'new.pdf'});
    assert.equal(fs.existsSync(a),false);
    assert.equal(fs.existsSync(b),true);
    store.removeDocument(exam.id);
    assert.equal(fs.existsSync(b),false);
  } finally { store.close();fs.rmSync(dir,{recursive:true,force:true}); }
});
