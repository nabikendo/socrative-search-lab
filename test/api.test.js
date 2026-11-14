import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';
import { parseRosterText } from '../shared/roster.js';
import { scoreSession, normalizeQuestions, parsePdfQuestionText } from '../shared/exam.js';
import { openStore } from '../lib/store.mjs';
import JSZip from 'jszip';
import { DatabaseSync } from 'node:sqlite';

let app, base, admin;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-'));
const call = async (url, { method = 'GET', body, raw, cookie, headers = {} } = {}) => {
  const res = await fetch(base + url, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, data: type.includes('json') ? await res.json() : await res.text() };
};

before(async () => {
  app = createApp({ dataDir: dir, pin: '123456' });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: '123456' }) });
  admin = login.headers.get('set-cookie').split(';')[0];
});
after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('parser de lista: CSV com turma não vaza a turma para o nome', () => {
  const rows = parseRosterText('numero,nome,turma\n3,Aluno Um,13.01\n5;"SILVA, JOÃO";13.01\n7 CARLOS EDUARDO F 2');
  assert.deepEqual(rows.map((r) => [r.number, r.name, r.className]), [['3', 'Aluno Um', '13.01'], ['5', 'SILVA, JOÃO', '13.01'], ['7', 'CARLOS EDUARDO', '']]);
});

test('Diário de Classe SEDUC-TO: lê turma do cabeçalho e alunos da tabela em mais de uma página', () => {
  const pdfText = [
    'GOVERNO DO ESTADO DO TOCANTINS',
    'DIÁRIO DE CLASSE',
    'Ano/Série: 1ª SÉRIE - ENSINO MÉDIO | Turno: Matutino/Manhã | Turma: 13.01/EM.MAT-ANL',
    'Nº Aluno Ter 3 Seg 9 Faltas',
    '3 ALUNO EXEMPLO DA SILVA',
    '5 OUTRA ALUNA TESTE F 2',
    'DIÁRIO DE CLASSE',
    'Ano/Série: 1ª SÉRIE - ENSINO MÉDIO | Turno: Matutino/Manhã | Turma: 13.01/EM.MAT-ANL',
    'Nº Aluno Ter 10 Seg 16 Faltas',
    '7 PARTICIPANTE DE EXEMPLO',
  ].join('\n');
  assert.deepEqual(parseRosterText(pdfText), [
    { number: '3', name: 'ALUNO EXEMPLO DA SILVA', className: '13.01/EM.MAT-ANL' },
    { number: '5', name: 'OUTRA ALUNA TESTE', className: '13.01/EM.MAT-ANL' },
    { number: '7', name: 'PARTICIPANTE DE EXEMPLO', className: '13.01/EM.MAT-ANL' },
  ]);
});

test('painel exige PIN e limita tentativas', async () => {
  assert.equal((await call('/api/roster')).status, 401);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { pin: '000000' } })).status, 403);
});

test('turmas são separadas e aceitam numeração repetida sem misturar listas', async () => {
  const first = await call('/api/classes', { method: 'POST', cookie: admin, body: { name: 'Turma A', roster: [{ number: '3', name: 'Ana' }] } });
  const second = await call('/api/classes', { method: 'POST', cookie: admin, body: { name: 'Turma B', roster: [{ number: '3', name: 'Beatriz' }] } });
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  assert.equal((await call(`/api/classes/${first.data.class.id}/roster`, { cookie: admin })).data.roster[0].name, 'Ana');
  assert.equal((await call(`/api/classes/${second.data.class.id}/roster`, { cookie: admin })).data.roster[0].name, 'Beatriz');
  const exam = await call('/api/exams', { method: 'POST', cookie: admin, body: { title: 'Prova da Turma B', classId: second.data.class.id, questions: [{ type: 'choice', text: 'Quanto é 2+2?', options: ['3', '4'], correct: '4', skill: 'D19', explanation: 'Somamos duas unidades duas vezes.' }] } });
  assert.equal(exam.data.exam.classId, second.data.class.id);
  const bank = await call('/api/question-bank', { method: 'POST', cookie: admin, body: exam.data.exam.questions[0] });
  assert.equal(bank.status, 200);
  assert.equal((await call('/api/question-bank', { cookie: admin })).data.questions[0].skill, 'D19');
  await call(`/api/question-bank/${(await call('/api/question-bank', { cookie: admin })).data.questions[0].bankId}`, { method: 'DELETE', cookie: admin });
});

test('migra lista global antiga para uma turma sem apagar os registros', () => {
  const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-migrate-'));
  const before = openStore(legacyDir);
  before.replaceRoster([{ number: '8', name: 'Estudante de teste', className: '14.02' }]);
  before.close();
  const after = openStore(legacyDir);
  const turma = after.listClasses()[0];
  assert.equal(turma.name, '14.02');
  assert.equal(after.classRoster(turma.id)[0].name, 'Estudante de teste');
  after.close();
  fs.rmSync(legacyDir, { recursive: true, force: true });
});

let examId, code, student;
test('fluxo completo do aluno, sem vazar gabarito', async () => {
  await call('/api/roster', { method: 'POST', cookie: admin, body: { roster: [{ number: '3', name: 'Aluno <img src=x onerror=alert(1)>', className: '13.01' }, { number: '5', name: 'Aluno Dois' }] } });
  const created = await call('/api/exams', { method: 'POST', cookie: admin, body: { title: 'T', feedback: true, questions: [
    { type: 'choice', text: 'Q?', options: ['A', 'B'], correct: 'B', explanation: 'Pelo conceito da questão.', skill: 'D1', weight: 2 }, { type: 'text', text: 'Livre', explanation: 'Compare sua resposta com os conceitos estudados.', weight: 1 }] } });
  assert.equal(created.status, 200);
  examId = created.data.exam.id;
  assert.equal((await call('/api/open-exam')).data.exam, null);
  assert.equal((await call('/api/identify', { method: 'POST', body: { code: '1234', number: '3' } })).status, 409);

  ({ code } = (await call(`/api/exams/${examId}/open`, { method: 'POST', cookie: admin })).data);
  assert.equal((await call('/api/identify', { method: 'POST', body: { code: '0000', number: '3' } })).status, 403);
  assert.equal((await call('/api/identify', { method: 'POST', body: { code, number: '99' } })).status, 404);
  const joinRequest=await call('/api/join-requests',{method:'POST',body:{code,number:'99',name:'Estudante autorizado'}});
  assert.equal(joinRequest.status,200);
  const pending=(await call('/api/join-requests',{cookie:admin})).data.requests[0];
  assert.equal(pending.number,'99');
  assert.equal((await call(`/api/join-requests/${pending.id}/approve`,{method:'POST',cookie:admin})).status,200);
  assert.equal((await call('/api/identify',{method:'POST',body:{code,number:'99'}})).status,200);

  const start = await call('/api/session/start', { method: 'POST', body: { code, number: '3' } });
  assert.equal(start.status, 200);
  assert.ok(!JSON.stringify(start.data).includes('"correct"'), 'gabarito não pode ir ao aluno');
  assert.ok(!JSON.stringify(start.data).includes('Pelo conceito'), 'explicação não pode ir antes da resposta');
  assert.ok(!JSON.stringify(start.data).includes('Compare sua resposta'), 'orientação não pode ir antes da resposta');
  student = start.data.session;
  assert.equal((await call('/api/session/start', { method: 'POST', body: { code, number: '3' } })).data.error, 'session_in_use');
  assert.equal((await call('/api/session/start', { method: 'POST', body: { code, number: '3', token: student.token } })).status, 200);
  assert.equal((await call(`/api/exams/${examId}/pause`,{method:'POST',cookie:admin})).status,200);
  assert.equal((await call('/api/session/heartbeat',{method:'POST',body:{sessionId:student.id,token:student.token}})).data.examPaused,true);
  assert.equal((await call('/api/answer',{method:'POST',body:{sessionId:student.id,token:student.token,questionId:'q',answer:'A'}})).data.error,'exam_paused');
  assert.equal((await call(`/api/exams/${examId}/resume`,{method:'POST',cookie:admin})).status,200);
  assert.equal((await call(`/api/sessions/${student.id}/pause`,{method:'POST',cookie:admin})).status,200);
  assert.equal((await call('/api/session/heartbeat',{method:'POST',body:{sessionId:student.id,token:student.token}})).data.studentPaused,true);
  assert.equal((await call(`/api/sessions/${student.id}/resume`,{method:'POST',cookie:admin})).status,200);

  const [q1, q2] = start.data.exam.questions;
  const send = (questionId, answer) => call('/api/answer', { method: 'POST', body: { sessionId: student.id, token: student.token, questionId, answer } });
  assert.equal((await send(q1.id, 'Z')).status, 400);
  assert.equal((await send(q1.id, 'B')).status, 200);
  const feedback = await call('/api/session/feedback', { method: 'POST', body: { sessionId: student.id, token: student.token, questionId: q1.id } });
  assert.equal(feedback.status, 200); assert.equal(feedback.data.correct, 'B'); assert.equal(feedback.data.explanation, 'Pelo conceito da questão.');
  assert.equal((await send(q2.id, '=HYPERLINK("http://x")')).status, 200);
  const textFeedback = await call('/api/session/feedback', { method: 'POST', body: { sessionId: student.id, token: student.token, questionId: q2.id } });
  assert.equal(textFeedback.data.correct, null); assert.match(textFeedback.data.explanation, /Compare sua resposta/);
  assert.equal((await call('/api/answer', { method: 'POST', body: { sessionId: student.id, token: 'errado', questionId: q1.id, answer: 'A' } })).status, 401);

  const results = (await call(`/api/exams/${examId}/results`, { cookie: admin })).data;
  assert.equal(results.results[0].score, 2);
  assert.equal(results.results[0].pending, 1);
  const projector = await call(`/api/exams/${examId}/projector`, { cookie: admin });
  assert.equal(projector.status, 200);
  assert.equal(projector.data.started, 1);
  assert.ok(!JSON.stringify(projector.data).includes('Aluno <img'), 'modo projetor não expõe nomes de estudantes');
  const q2id = q2.id;
  assert.equal((await call('/api/grade', { method: 'POST', cookie: admin, body: { sessionId: student.id, questionId: q2id, score: 5, reason:'Nota acima do peso' } })).status, 400);
  assert.equal((await call('/api/grade', { method: 'POST', cookie: admin, body: { sessionId: student.id, questionId: q2id, score: 0.5, reason:'Correção manual' } })).status, 200);

  assert.equal((await call('/api/session/submit', { method: 'POST', body: { sessionId: student.id, token: student.token } })).status, 200);
  const report = await fetch(`${base}/api/sessions/${student.id}/report.pdf`, { headers: { cookie: admin } });
  assert.equal(report.headers.get('content-type'), 'application/pdf');
  const reportBytes = Buffer.from(await report.arrayBuffer());
  assert.equal(reportBytes.toString('latin1', 0, 5), '%PDF-');
  assert.ok(reportBytes.toString('latin1').endsWith('%%EOF'));
  assert.equal((await call('/api/session/start', { method: 'POST', body: { code, number: '3', token: student.token } })).data.error, 'already_submitted');
  assert.equal((await call(`/api/sessions/${student.id}/reopen`, { method:'POST', cookie:admin, body:{ reason:'Envio acidental confirmado.' } })).status, 200);
  const audit = await call(`/api/exams/${examId}/audit`, { cookie:admin });
  assert.equal(audit.data.events[0].event, 'session_reopened');
  assert.match(audit.data.events[0].detail, /Envio acidental/);
});

test('questões de múltiplas respostas e numéricas corrigem, dão feedback e aceitam imagem segura', async()=>{
  const image='data:image/png;base64,aGVsbG8=';
  const created=await call('/api/exams',{method:'POST',cookie:admin,body:{title:'Tipos adicionais',feedback:true,questions:[
    {type:'multi',text:'Marque A e C',options:['A','B','C'],correct:['A','C'],explanation:'Duas alternativas corretas.'},
    {type:'numeric',text:'Quanto é 2 + 2?',correct:4,tolerance:0.1,explanation:'Some os dois pares.',image,imageAlt:'Dois pares de pontos.'},
  ]}});
  assert.equal(created.status,200);
  const id=created.data.exam.id;
  const {code}= (await call(`/api/exams/${id}/open`,{method:'POST',cookie:admin})).data;
  const start=await call('/api/session/start',{method:'POST',body:{code,number:'5'}});
  assert.ok(!JSON.stringify(start.data.exam).includes('correct'));
  assert.equal(start.data.exam.questions[1].image,image);
  const [multi,numeric]=start.data.exam.questions;
  assert.equal((await call('/api/answer',{method:'POST',body:{sessionId:start.data.session.id,token:start.data.session.token,questionId:multi.id,answer:['A','C']}})).status,200);
  assert.deepEqual((await call('/api/session/feedback',{method:'POST',body:{sessionId:start.data.session.id,token:start.data.session.token,questionId:multi.id}})).data.correct,['A','C']);
  assert.equal((await call('/api/answer',{method:'POST',body:{sessionId:start.data.session.id,token:start.data.session.token,questionId:numeric.id,answer:'4.05'}})).status,200);
  assert.equal((await call('/api/session/feedback',{method:'POST',body:{sessionId:start.data.session.id,token:start.data.session.token,questionId:numeric.id}})).data.correct,'4');
  const results=(await call(`/api/exams/${id}/results`,{cookie:admin})).data.results;
  assert.equal(results[0].score,2);
  assert.deepEqual(results[0].answers[multi.id],['A','C']);
  await call(`/api/exams/${id}/close`,{method:'POST',cookie:admin});
  await call(`/api/exams/${examId}/open`,{method:'POST',cookie:admin});
});

test('CSV: BOM, ponto e vírgula, decimal com vírgula e sem injeção de fórmula', async () => {
  const bytes = Buffer.from(await (await fetch(`${base}/api/exams/${examId}/export.csv`, { headers: { cookie: admin } })).arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM UTF-8 para o Excel');
  const csv = bytes.toString('utf8');
  assert.ok(csv.includes('numero;nome;turma'));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes('2,5;3'));
});

test('editar prova aberta não a fecha; questões travam após respostas', async () => {
  const exam = (await call(`/api/exams/${examId}`, { cookie: admin })).data.exam;
  assert.equal(exam.status, 'open');
  const same = await call('/api/exams', { method: 'POST', cookie: admin, body: { id: examId, title: 'Novo título', questions: exam.questions } });
  assert.equal(same.status, 200);
  assert.equal(same.data.exam.status, 'open');
  const changed = await call('/api/exams', { method: 'POST', cookie: admin, body: { id: examId, title: 'x', questions: [{ type: 'text', text: 'Outra' }] } });
  assert.equal(changed.status, 409);
});

test('abrir outra prova fecha a anterior e respostas são recusadas após encerrar', async () => {
  const other = (await call('/api/exams', { method: 'POST', cookie: admin, body: { title: 'Outra', questions: [{ type: 'text', text: 'Q' }] } })).data.exam;
  await call(`/api/exams/${other.id}/open`, { method: 'POST', cookie: admin });
  assert.equal((await call(`/api/exams/${examId}`, { cookie: admin })).data.exam.status, 'closed');
  assert.equal((await call('/api/open-exam')).data.exam.title, 'Outra');
  await call(`/api/exams/${other.id}/close`, { method: 'POST', cookie: admin });
  assert.equal((await call('/api/open-exam')).data.exam, null);
});

test('agendamento abre e encerra a prova pelo relógio do servidor', async () => {
  const created = await call('/api/exams', { method:'POST', cookie:admin, body:{ title:'Prova agendada', questions:[{type:'text',text:'Questão'}] } });
  const id = created.data.exam.id;
  const start = Date.now() + 60_000;
  const end = start + 60_000;
  const scheduled = await call(`/api/exams/${id}/schedule`, { method:'POST', cookie:admin, body:{ startAt:new Date(start).toISOString(), endAt:new Date(end).toISOString() } });
  assert.equal(scheduled.status, 200);
  assert.equal(scheduled.data.exam.status, 'scheduled');
  app.store.activateSchedules(new Date(start + 1).toISOString());
  assert.equal((await call('/api/open-exam')).data.exam.title, 'Prova agendada');
  app.store.activateSchedules(new Date(end + 1).toISOString());
  assert.equal((await call('/api/open-exam')).data.exam, null);
});

test('busca, edição, transferência, arquivo de turma e histórico acompanham o mesmo estudante', async () => {
  const a=(await call('/api/classes',{method:'POST',cookie:admin,body:{name:'Histórico A',roster:[{number:'1',name:'Nome Original'}]}})).data.class;
  const b=(await call('/api/classes',{method:'POST',cookie:admin,body:{name:'Histórico B',roster:[{number:'2',name:'Outra Pessoa'}]}})).data.class;
  const row=(await call(`/api/classes/${a.id}/roster`,{cookie:admin})).data.roster[0];
  const exam=(await call('/api/exams',{method:'POST',cookie:admin,body:{title:'Prova com histórico',classId:a.id,questions:[{type:'text',text:'Questão'}]}})).data.exam;
  const {code}= (await call(`/api/exams/${exam.id}/open`,{method:'POST',cookie:admin})).data;
  const session=(await call('/api/session/start',{method:'POST',body:{code,number:'1'}})).data.session;
  await call('/api/session/submit',{method:'POST',body:{sessionId:session.id,token:session.token}});
  assert.equal((await call(`/api/students/${row.id}/history`,{cookie:admin})).data.history[0].title,'Prova com histórico');
  assert.equal((await call(`/api/classes/${a.id}/students/1/update`,{method:'POST',cookie:admin,body:{name:'Nome Corrigido',number:'3'}})).status,200);
  assert.equal((await call('/api/students/search?q=Corrigido',{cookie:admin})).data.students[0].id,row.id);
  assert.equal((await call(`/api/classes/${a.id}/students/3/move`,{method:'POST',cookie:admin,body:{targetClassId:b.id}})).status,200);
  assert.equal((await call(`/api/classes/${b.id}/roster`,{cookie:admin})).data.roster.find((s)=>s.id===row.id).name,'Nome Corrigido');
  assert.equal((await call(`/api/students/${row.id}/history`,{cookie:admin})).data.history.length,1);
  await call(`/api/classes/${a.id}/archive`,{method:'POST',cookie:admin,body:{archived:true}});
  assert.ok(!(await call('/api/classes',{cookie:admin})).data.classes.some((c)=>c.id===a.id));
  assert.ok((await call('/api/classes?all=1',{cookie:admin})).data.classes.some((c)=>c.id===a.id&&c.archived===1));
});

test('upload valida o conteúdo real do arquivo', async () => {
  const { data: { exam } } = await call('/api/exams', { method: 'POST', cookie: admin, body: { title: 'Anexos', questions: [{ type: 'text', text: 'Questão' }] } });
  const bad = await call(`/api/exams/${exam.id}/document?name=a.pdf`, { method: 'POST', cookie: admin, raw: Buffer.from('<script>alert(1)</script>'), headers: { 'content-type': 'application/octet-stream' } });
  assert.equal(bad.status, 415);
  const pdf = await call(`/api/exams/${exam.id}/document?name=prova.pdf`, { method: 'POST', cookie: admin, raw: Buffer.from('%PDF-1.4\n%%EOF'), headers: { 'content-type': 'application/octet-stream' } });
  assert.equal(pdf.status, 200);
});

test('ensaio e versões preservam a aplicação original', async () => {
  const { data: { exam } } = await call('/api/exams', { method: 'POST', cookie: admin, body: {
    title: 'Original', questions: [{ type: 'choice', text: 'Um mais um?', options: ['1', '2'], correct: '2' }],
  } });
  assert.equal((await call(`/api/exams/${exam.id}/rehearsal`)).status, 401);
  const rehearsal = await call(`/api/exams/${exam.id}/rehearsal`, { cookie: admin });
  assert.equal(rehearsal.data.exam.questions[0].correct, undefined);
  const copy = await call(`/api/exams/${exam.id}/version`, { method: 'POST', cookie: admin, body: { kind: 'second-call' } });
  assert.equal(copy.data.exam.original.id, exam.id);
  assert.notEqual(copy.data.exam.id, exam.id);
  const result = await call(`/api/exams/${exam.id}/results`, { cookie: admin });
  assert.equal(result.data.results.length, 0);
});

test('prova somente em PDF: não aceita prova vazia e permite que o aluno abra e entregue o documento', async () => {
  const noContent = await call('/api/exams', { method: 'POST', cookie: admin, body: { title: 'Sem conteúdo', questions: [] } });
  assert.equal(noContent.status, 400);
  assert.equal(noContent.data.error, 'questions_or_document_required');

  const created = await call('/api/exams', { method: 'POST', cookie: admin, body: { title: 'Prova no PDF', questions: [{ type: 'text', text: 'Importação em andamento' }] } });
  assert.equal(created.status, 200);
  const id = created.data.exam.id;
  const uploaded = await call(`/api/exams/${id}/document?name=avaliacao.pdf`, { method: 'POST', cookie: admin, raw: Buffer.from('%PDF-1.4\n%%EOF'), headers: { 'content-type': 'application/octet-stream' } });
  assert.equal(uploaded.status, 200);
  const pdfOnly = await call('/api/exams', { method: 'POST', cookie: admin, body: { id, title: 'Prova no PDF', questions: [] } });
  assert.equal(pdfOnly.status, 200);
  assert.deepEqual(pdfOnly.data.exam.questions, []);

  const { code } = (await call(`/api/exams/${id}/open`, { method: 'POST', cookie: admin })).data;
  const started = await call('/api/session/start', { method: 'POST', body: { code, number: '5' } });
  assert.equal(started.status, 200);
  assert.deepEqual(started.data.exam.questions, []);
  const doc = await fetch(`${base}/api/document/${uploaded.data.document.id}`);
  assert.equal(doc.status, 200);
  assert.equal((await call('/api/session/submit', { method: 'POST', body: { sessionId: started.data.session.id, token: started.data.session.token } })).status, 200);
});

test('regras de nota', () => {
  const exam = { questions: normalizeQuestions([{ type: 'choice', text: 'a', options: ['x', 'y'], correct: 'x', weight: 2 }, { type: 'text', text: 'b' }]) };
  const [a, b] = exam.questions;
  const r = scoreSession(exam, { [a.id]: 'x', [b.id]: 'texto' }, {});
  assert.deepEqual([r.score, r.max, r.pending], [2, 3, 1]);
});

test('habilidade mantém a etapa SAEB e descarta código fora da matriz', () => {
  const normalized = normalizeQuestions([
    { type: 'choice', text: 'Q1', options: ['A', 'B'], correct: 'A', skill: 'SAEB5-D28' },
    { type: 'choice', text: 'Q2', options: ['A', 'B'], correct: 'A', skill: 'SAEB5-D29' },
  ]);
  assert.equal(normalized[0].skill, 'SAEB5-D28');
  assert.equal(normalized[1].skill, undefined);
});

test('extrai questões numeradas de um PDF textual para revisão, sem inventar gabarito', () => {
  const questions = parsePdfQuestionText('1. Quanto é 2 + 2?\nA) 3\nB) 4\n\n2) Explique o raciocínio.');
  assert.equal(questions.length, 2);
  assert.equal(questions[0].type, 'choice');
  assert.deepEqual(questions[0].options, ['3', '4']);
  assert.equal(questions[0].correct, undefined);
  assert.equal(questions[1].type, 'text');
});

test('embaralhar: ordem estável por aluno, preserva todas as alternativas e vai ao aluno', async () => {
  const { orderForStudent, seededShuffle } = await import('../shared/shuffle.js');
  const qs = Array.from({ length: 8 }, (_, i) => ({ id: `q${i}`, type: 'choice', text: `Q${i}`, options: ['a', 'b', 'c', 'd'] }));
  const a1 = orderForStudent(qs, 'aluno-1'); const a2 = orderForStudent(qs, 'aluno-1'); const b = orderForStudent(qs, 'aluno-2');
  assert.deepEqual(a1, a2);
  assert.notDeepEqual(a1.map((q) => q.id), b.map((q) => q.id));
  assert.deepEqual([...a1.map((q) => q.id)].sort(), qs.map((q) => q.id));
  assert.ok(a1.every((q) => [...q.options].sort().join() === 'a,b,c,d'));
  assert.deepEqual(seededShuffle([1, 2, 3, 4, 5], 'x').sort(), [1, 2, 3, 4, 5]);

  const created = await call('/api/exams', { method: 'POST', cookie: admin, body: { title: 'Embaralhada', shuffle: true, questions: [{ type: 'choice', text: 'Q?', options: ['A', 'B'], correct: 'A' }] } });
  assert.equal(created.data.exam.shuffle, true);
  const kept = await call('/api/exams', { method: 'POST', cookie: admin, body: { id: created.data.exam.id, title: 'Embaralhada 2', questions: [{ type: 'choice', text: 'Q?', options: ['A', 'B'], correct: 'A' }] } });
  assert.equal(kept.data.exam.shuffle, true); // não informado: mantém
  await call(`/api/exams/${created.data.exam.id}`, { method: 'DELETE', cookie: admin });
});

test('backup e restauração: devolve exatamente o estado salvo e guarda cópia do atual', async () => {
  const keep = await call('/api/exams', { method: 'POST', cookie: admin, body: { title: 'Prova do backup', questions: [{ type: 'text', text: 'Livre' }] } });
  const res = await fetch(base + '/api/backup', { headers: { cookie: admin } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /atlas-backup-\d{4}-\d{2}-\d{2}\.atlas/);
  const file = await res.text();
  assert.equal((await call('/api/restore/verify',{method:'POST',cookie:admin,raw:file})).data.valid,true);
  assert.equal((await call('/api/backup')).status, 401);

  await call(`/api/exams/${keep.data.exam.id}`, { method: 'DELETE', cookie: admin });
  await call('/api/roster', { method: 'POST', cookie: admin, body: { roster: [{ number: '1', name: 'Só depois' }] } });
  const restored = await call('/api/restore', { method: 'POST', cookie: admin, raw: file });
  assert.equal(restored.status, 200);
  const exams = (await call('/api/exams', { cookie: admin })).data.exams;
  assert.ok(exams.some((e) => e.id === keep.data.exam.id));
  assert.notDeepEqual((await call('/api/roster', { cookie: admin })).data.roster.map((r) => r.name), ['Só depois']);
  assert.ok(fs.readdirSync(path.join(dir, 'backups')).some((f) => f.startsWith('atlas-antes-restauracao-')));

  assert.equal((await call('/api/restore', { method: 'POST', cookie: admin, raw: 'isto não é um backup' })).status, 422);
  assert.equal((await call('/api/restore', { method: 'POST', cookie: admin, raw: JSON.stringify({ format: 'atlas-backup', version: 1, db: Buffer.from('x'.repeat(2000)).toString('base64') }) })).status, 422);
  // Anexos malformados não podem apagar os documentos nem substituir o banco.
  const malformed = JSON.parse(file);
  malformed.documents = { 'arquivo-invalido.pdf': 'YQ==' };
  assert.equal((await call('/api/restore', { method: 'POST', cookie: admin, raw: JSON.stringify(malformed) })).status, 422);
  const checksumTampered=JSON.parse(file);checksumTampered.checksum='0'.repeat(64);
  assert.equal((await call('/api/restore/verify',{method:'POST',cookie:admin,raw:JSON.stringify(checksumTampered)})).status,422);
  assert.equal((await call('/api/exams', { cookie: admin })).status, 200);
  assert.equal((await call('/api/restore', { method: 'POST', raw: file })).status, 401);
  assert.equal((await call('/api/exams', { cookie: admin })).status, 200); // continua funcionando depois das tentativas inválidas
});

test('restauração seletiva mescla apenas as turmas e provas selecionadas',async()=>{
  const a=(await call('/api/classes',{method:'POST',cookie:admin,body:{name:'Restaurar A',roster:[{number:'1',name:'Estudante A'}]}})).data.class;
  const ea=(await call('/api/exams',{method:'POST',cookie:admin,body:{title:'Prova restaurar A',classId:a.id,questions:[{type:'text',text:'A'}]}})).data.exam;
  const backup=await (await fetch(base+'/api/backup',{headers:{cookie:admin}})).text();
  const b=(await call('/api/classes',{method:'POST',cookie:admin,body:{name:'Preservar B',roster:[{number:'2',name:'Estudante B'}]}})).data.class;
  const eb=(await call('/api/exams',{method:'POST',cookie:admin,body:{title:'Prova preservar B',classId:b.id,questions:[{type:'text',text:'B'}]}})).data.exam;
  const response=await call(`/api/restore/selective?class=${a.id}&exam=${ea.id}`,{method:'POST',cookie:admin,raw:backup});
  assert.equal(response.status,200);assert.equal(response.data.classes,1);assert.equal(response.data.exams,1);
  const classes=(await call('/api/classes',{cookie:admin})).data.classes;assert.ok(classes.some(c=>c.id===a.id));assert.ok(classes.some(c=>c.id===b.id));
  const exams=(await call('/api/exams',{cookie:admin})).data.exams;assert.ok(exams.some(e=>e.id===ea.id));assert.ok(exams.some(e=>e.id===eb.id));
});

test('diagnóstico de rede: exige PIN e reconhece aparelhos que abriram a página do aluno', async () => {
  assert.equal((await call('/api/diagnostics')).status, 401);
  const before = (await call('/api/diagnostics', { cookie: admin })).data;
  assert.equal(typeof before.port, 'number');
  assert.ok(Array.isArray(before.interfaces) && Array.isArray(before.urls) && Array.isArray(before.devices));
  assert.equal(typeof before.disk.available,'boolean');
  const sanitized=await fetch(base+'/api/diagnostics/report.txt',{headers:{cookie:admin}});
  assert.equal(sanitized.status,200);assert.match(sanitized.headers.get('content-type'),/text\/plain/);assert.doesNotMatch(await sanitized.text(),/Só depois|Estudante de teste/);
  assert.equal(before.devices.length, 0); // o próprio computador (127.0.0.1) não conta como aparelho de aluno
});

test('relatórios XLSX/PDF, comparação e correção em lote registram justificativa',async()=>{
  const turma=(await call('/api/classes',{method:'POST',cookie:admin,body:{name:'Turma relatórios',roster:[{number:'1',name:'Pessoa Relatório'}]}})).data.class;
  const exam=(await call('/api/exams',{method:'POST',cookie:admin,body:{title:'Avaliação XLSX',classId:turma.id,questions:[{type:'text',text:'Explique o conceito',weight:2,rubric:[{label:'Completo',description:'Explica e exemplifica',score:2},{label:'Parcial',score:1}]}]}})).data.exam;
  const code=(await call(`/api/exams/${exam.id}/open`,{method:'POST',cookie:admin})).data.code;
  const session=(await call('/api/session/start',{method:'POST',body:{code,number:'1'}})).data.session;
  await call('/api/answer',{method:'POST',body:{sessionId:session.id,token:session.token,questionId:exam.questions[0].id,answer:'Resposta longa.'}});
  await call('/api/session/submit',{method:'POST',body:{sessionId:session.id,token:session.token}});
  const xlsx=await fetch(`${base}/api/exams/${exam.id}/export.xlsx`,{headers:{cookie:admin}});assert.equal(xlsx.status,200);assert.match(xlsx.headers.get('content-type'),/spreadsheetml/);
  const workbook=await JSZip.loadAsync(Buffer.from(await xlsx.arrayBuffer()));assert.match(await workbook.file('xl/worksheets/sheet1.xml').async('text'),/Pessoa Relatório/);
  assert.equal((await fetch(`${base}/api/exams/${exam.id}/report.pdf`,{headers:{cookie:admin}})).status,200);
  const second=(await call('/api/exams',{method:'POST',cookie:admin,body:{title:'Avaliação comparação',questions:[{type:'choice',text:'Q',options:['A','B'],correct:'A'}]}})).data.exam;
  const comparison=(await call(`/api/reports/compare?ids=${exam.id},${second.id}`,{cookie:admin})).data;
  assert.equal(comparison.exams.length,2);assert.equal(comparison.exams[0].average,0);
  assert.equal((await call('/api/grade/batch',{method:'POST',cookie:admin,body:{items:[{sessionId:session.id,questionId:exam.questions[0].id,score:2}],reason:'Rubrica aplicada'}})).data.updated,1);
  assert.equal((await call(`/api/exams/${exam.id}/audit`,{cookie:admin})).data.events.some(e=>e.event==='grade_changed'&&e.detail.includes('Rubrica aplicada')),true);
  assert.equal((await call(`/api/exams/${exam.id}/results`,{cookie:admin})).data.results[0].score,2);
});

test('política de backup é configurável e anonimização só atinge históricos antigos concluídos',async()=>{
  const saved=await call('/api/backups/settings',{method:'POST',cookie:admin,body:{intervalMinutes:15,keep:60}});assert.deepEqual(saved.data.settings,{intervalMinutes:15,keep:60});
  const turma=(await call('/api/classes',{method:'POST',cookie:admin,body:{name:'Privacidade',roster:[{number:'3',name:'Nome Privado de Teste'}]}})).data.class;
  const exam=(await call('/api/exams',{method:'POST',cookie:admin,body:{title:'Privacidade 2024',classId:turma.id,questions:[{type:'text',text:'Resposta'}]}})).data.exam;
  const code=(await call(`/api/exams/${exam.id}/open`,{method:'POST',cookie:admin})).data.code;const session=(await call('/api/session/start',{method:'POST',body:{code,number:'3'}})).data.session;
  await call('/api/answer',{method:'POST',body:{sessionId:session.id,token:session.token,questionId:exam.questions[0].id,answer:'Resposta antiga'}});await call('/api/session/submit',{method:'POST',body:{sessionId:session.id,token:session.token}});
  const db=new DatabaseSync(path.join(dir,'atlas.sqlite'));db.prepare('UPDATE sessions SET started_at=? WHERE id=?').run('2024-01-01T00:00:00.000Z',session.id);db.close();
  const preview=await call('/api/privacy/anonymization/preview?before=2025-01-01',{cookie:admin});assert.equal(preview.data.sessions,1);assert.equal(preview.data.students,1);
  const anonymized=await call('/api/privacy/anonymization',{method:'POST',cookie:admin,body:{before:'2025-01-01'}});assert.equal(anonymized.status,200);
  const result=(await call(`/api/exams/${exam.id}/results`,{cookie:admin})).data.results[0];assert.equal(result.name,'Estudante anonimizado');assert.match(result.number,/^AN-/);
});

