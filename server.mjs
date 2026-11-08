import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import crypto from 'node:crypto';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const dataDir = path.join(root, 'data');
const documentDir = path.join(dataDir, 'documents');
const backupDir = path.join(dataDir, 'backups');
const dataFile = path.join(dataDir, 'atlas-data.json');
const port = Number(process.env.PORT || 8080);
fs.mkdirSync(documentDir, { recursive: true }); fs.mkdirSync(backupDir, { recursive: true });
const defaultExam = { id: 'demo', title: 'Química — revisão de ligações', status: 'draft', questions: [
  { id: 'q1', type: 'choice', text: 'Qual ligação ocorre pelo compartilhamento de elétrons?', options: ['Iônica', 'Covalente', 'Metálica', 'Nuclear'] },
  { id: 'q2', type: 'choice', text: 'Qual partícula possui carga negativa?', options: ['Próton', 'Nêutron', 'Elétron', 'Íon positivo'] },
  { id: 'q3', type: 'short', text: 'Escreva uma palavra que associe à tabela periódica.' }
] };
const initial = { roster: [], exams: [defaultExam], sessions: [], answers: {}, grades: {}, documents: {}, updatedAt: new Date().toISOString() };
let db = fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile, 'utf8')) : initial;
db.documents ??= {};
function save(){ db.updatedAt = new Date().toISOString(); const snapshot=JSON.stringify(db, null, 2); const temp=`${dataFile}.tmp`; fs.writeFileSync(temp,snapshot); if(fs.existsSync(dataFile))fs.copyFileSync(dataFile,path.join(backupDir,`atlas-${Date.now()}.json`)); fs.renameSync(temp,dataFile); }
function json(res, status, body){ const text=JSON.stringify(body); res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'}); res.end(text); }
function body(req){ return new Promise((resolve,reject)=>{let raw=''; req.on('data',c=>{raw+=c; if(raw.length>40e6){reject(new Error('payload_too_large')); req.destroy();}}); req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{})}catch(e){reject(e)}});}); }
function csvEscape(v){ const s=String(v??''); return /[",\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s; }
function resultsCsv(){ const rows=[['numero','nome','prova','status','inicio','envio','respostas']]; for(const s of db.sessions){ const student=db.roster.find(x=>String(x.number)===String(s.number)); const answerCount=Object.keys(db.answers[s.id]||{}).length; rows.push([s.number,student?.name||'',s.examId,s.status,s.startedAt,s.submittedAt||'',answerCount]); } return rows.map(r=>r.map(csvEscape).join(',')).join('\n')+'\n'; }
function detailedResultsCsv(){
  const sessions=db.sessions; const questionList=[...new Map(sessions.flatMap(s=>(db.exams.find(e=>e.id===s.examId)?.questions||[]).map(q=>[q.id,q]))).values()];
  const header=['numero','nome','prova','status','inicio','envio','nota','maximo',...questionList.map((q,i)=>`Q${i+1} — ${q.text}`)];
  const rows=[header];
  for(const s of sessions){ const student=db.roster.find(x=>String(x.number)===String(s.number)); const exam=db.exams.find(e=>e.id===s.examId); const answers=db.answers[s.id]||{}; const grades=db.grades?.[s.id]||{}; const graded=(exam?.questions||[]).filter(q=>q.correct||q.weight); const max=graded.reduce((sum,q)=>sum+Number(q.weight||1),0); const score=graded.reduce((sum,q)=>sum+(q.correct?(answers[q.id]===q.correct?Number(q.weight||1):0):Number(grades[q.id]||0)),0); rows.push([s.number,student?.name||'',s.examId,s.status,s.startedAt,s.submittedAt||'',graded.length?score:'',graded.length?max:'',...questionList.map(q=>answers[q.id]||'')]); }
  return rows.map(r=>r.map(csvEscape).join(',')).join('\n')+'\n';
}
function publicExam(exam){ return {...exam, document:exam.document ? {...exam.document, html:exam.document.kind==='docx'?db.documents[exam.document.id]?.html:undefined} : undefined}; }
function sendFile(req,res,pathname){ let rel=pathname==='/'?'index.html':pathname; if(rel==='/professor')rel='/professor.html'; if(rel==='/prova')rel='/prova.html'; const file=path.normalize(path.join(dist,rel)); if(!file.startsWith(dist)||!fs.existsSync(file)||fs.statSync(file).isDirectory()) return json(res,404,{error:'not_found'}); const ext=path.extname(file); const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.mjs':'text/javascript; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'}; res.writeHead(200,{'content-type':types[ext]||'application/octet-stream'}); fs.createReadStream(file).pipe(res); }
async function api(req,res,url){
  if(req.method==='GET'&&url.pathname==='/api/health') return json(res,200,{ok:true,updatedAt:db.updatedAt,rosterCount:db.roster.length});
  if(req.method==='GET'&&url.pathname==='/api/state') return json(res,200,{roster:db.roster,exams:db.exams.map(publicExam),sessions:db.sessions,updatedAt:db.updatedAt});
  if(req.method==='GET'&&url.pathname==='/api/open-exam') return json(res,200,{exam:publicExam(db.exams.find(item=>item.status==='open')||null)});
  if(req.method==='GET'&&url.pathname==='/api/teacher/results'){
    return json(res,200,{updatedAt:db.updatedAt,results:db.sessions.map(session=>{
      const exam=db.exams.find(item=>item.id===session.examId); const student=db.roster.find(item=>String(item.number)===String(session.number));
      const answers=db.answers[session.id]||{};
      const grades=db.grades?.[session.id]||{}; const online=session.status!=='submitted'&&Date.now()-Number(session.lastSeen||0)<30000;
      return {...session,studentName:student?.name||'Aluno não encontrado',answerCount:Object.keys(answers).length,totalQuestions:exam?.questions.length||0,answers,grades,online,questions:exam?.questions||[]};
    })});
  }
  if(req.method==='POST'&&url.pathname==='/api/roster'){ const input=await body(req); if(!Array.isArray(input.roster)) return json(res,400,{error:'roster_required'}); db.roster=[...new Map(input.roster.map(x=>[String(x.number),{number:String(x.number),name:String(x.name),className:String(x.className||'')}])).values()]; save(); return json(res,200,{ok:true,count:db.roster.length}); }
  if(req.method==='POST'&&url.pathname==='/api/roster-xlsx'){ const input=await body(req); const rows=XLSX.utils.sheet_to_json(XLSX.read(Buffer.from(String(input.base64||''),'base64'),{type:'buffer'}).Sheets[XLSX.read(Buffer.from(String(input.base64||''),'base64'),{type:'buffer'}).SheetNames[0]],{header:1,defval:''}); const roster=rows.slice(1).map(row=>({number:String(row[0]||'').trim(),name:String(row[1]||'').trim(),className:String(row[2]||'').trim()})).filter(row=>row.number&&row.name); db.roster=[...new Map(roster.map(x=>[x.number,x])).values()]; save(); return json(res,200,{ok:true,count:db.roster.length}); }
  if(req.method==='POST'&&url.pathname==='/api/exams'){ const input=await body(req); const exam={id:String(input.id||'demo'),title:String(input.title||'Avaliação'),status:'draft',questions:Array.isArray(input.questions)&&input.questions.length?input.questions:defaultExam.questions}; const old=db.exams.find(x=>x.id===exam.id); if(old?.document)exam.document=old.document; const idx=db.exams.findIndex(x=>x.id===exam.id); idx>=0?db.exams[idx]=exam:db.exams.push(exam); save(); return json(res,200,{ok:true,exam:publicExam(exam)}); }
  if(req.method==='POST'&&url.pathname==='/api/exam-document'){ const input=await body(req); const exam=db.exams.find(x=>x.id===String(input.examId||'demo')); if(!exam)return json(res,404,{error:'exam_not_found'}); const mime=String(input.mime||''); const name=String(input.name||'prova'); const kind=mime.includes('word')||name.toLowerCase().endsWith('.docx')?'docx':'pdf'; const id=`${exam.id}-${Date.now()}`; const buffer=Buffer.from(String(input.base64||''),'base64'); if(buffer.length>30e6)return json(res,413,{error:'document_too_large'}); const filePath=path.join(documentDir,`${id}.${kind}`); fs.writeFileSync(filePath,buffer); const document={id,name,kind,mime,size:buffer.length}; if(kind==='docx'){const converted=await mammoth.convertToHtml({buffer}); document.html=converted.value; document.warnings=converted.messages;} db.documents[id]={...document,filePath}; exam.document=document; save(); return json(res,200,{ok:true,document:{...document,html:kind==='docx'?document.html:undefined}}); }
  const documentMatch=url.pathname.match(/^\/api\/document\/([^/]+)$/); if(req.method==='GET'&&documentMatch){ const item=db.documents[documentMatch[1]]; if(!item||!fs.existsSync(item.filePath))return json(res,404,{error:'document_not_found'}); res.writeHead(200,{'content-type':item.mime||'application/octet-stream','content-disposition':`inline; filename="${item.name.replaceAll('"','')}"`}); return fs.createReadStream(item.filePath).pipe(res); }
  const start=url.pathname.match(/^\/api\/exams\/([^/]+)\/start$/); if(req.method==='POST'&&start){ const exam=db.exams.find(x=>x.id===start[1]); if(!exam)return json(res,404,{error:'exam_not_found'}); exam.status='open'; save(); return json(res,200,{ok:true,exam:publicExam(exam)}); }
  if(req.method==='POST'&&url.pathname==='/api/session/start'){ const input=await body(req); const exam=db.exams.find(x=>x.id===String(input.examId||'demo')); const number=String(input.number||''); const student=db.roster.find(x=>String(x.number)===number); if(!exam||exam.status!=='open')return json(res,409,{error:'exam_not_open'}); if(!student)return json(res,404,{error:'student_not_found'}); let session=db.sessions.find(x=>x.examId===exam.id&&x.number===number&&x.status!=='submitted'); if(!session){session={id:`${exam.id}-${number}-${Date.now()}`,token:crypto.randomUUID(),examId:exam.id,number,status:'active',startedAt:new Date().toISOString(),lastSeen:Date.now()};db.sessions.push(session);save();} return json(res,200,{session,student,exam:publicExam(exam),answers:db.answers[session.id]||{}}); }
  if(req.method==='POST'&&url.pathname==='/api/session/heartbeat'){ const input=await body(req); const session=db.sessions.find(x=>x.id===String(input.sessionId)&&x.token===String(input.token)); if(!session)return json(res,401,{error:'invalid_session'}); session.lastSeen=Date.now(); save(); return json(res,200,{ok:true}); }
  if(req.method==='POST'&&url.pathname==='/api/answer'){ const input=await body(req); const session=db.sessions.find(x=>x.id===String(input.sessionId)&&x.token===String(input.token)); if(!session||session.status==='submitted')return json(res,409,{error:'session_closed'}); session.lastSeen=Date.now(); db.answers[session.id]??={}; db.answers[session.id][String(input.questionId)]=String(input.answer??''); save(); return json(res,200,{ok:true,savedAt:db.updatedAt}); }
  if(req.method==='POST'&&url.pathname==='/api/grade'){ const input=await body(req); const session=db.sessions.find(x=>x.id===String(input.sessionId)); if(!session)return json(res,404,{error:'session_not_found'}); db.grades??={}; db.grades[session.id]??={}; db.grades[session.id][String(input.questionId)]=Number(input.score||0); save(); return json(res,200,{ok:true}); }
  if(req.method==='POST'&&url.pathname==='/api/session/submit'){ const input=await body(req); const session=db.sessions.find(x=>x.id===String(input.sessionId)&&x.token===String(input.token)); if(!session)return json(res,404,{error:'session_not_found'}); session.status='submitted'; session.submittedAt=new Date().toISOString(); session.lastSeen=Date.now(); save(); return json(res,200,{ok:true,submittedAt:session.submittedAt}); }
  if(req.method==='GET'&&url.pathname==='/api/results.csv'){ res.writeHead(200,{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="resultados-atlas.csv"'}); return res.end(resultsCsv()); }
  if(req.method==='GET'&&url.pathname==='/api/results-detailed.csv'){ res.writeHead(200,{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="respostas-finais-atlas.csv"'}); return res.end(detailedResultsCsv()); }
  return json(res,404,{error:'api_not_found'});
}
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`); if(url.pathname.startsWith('/api/'))return await api(req,res,url); sendFile(req,res,url.pathname)}catch(error){console.error(error);json(res,500,{error:'server_error',message:error.message})}});
server.listen(port,'0.0.0.0',()=>{console.log(`Atlas local ativo em http://localhost:${port}`);for(const item of Object.values(os.networkInterfaces()).flat().filter(x=>x?.family==='IPv4'&&!x.internal))console.log(`Na rede: http://${item.address}:${port}`);console.log('Professor: /professor | Alunos: /prova');});
