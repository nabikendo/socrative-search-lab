import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import mammoth from 'mammoth';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const dataDir = path.join(root, 'data');
const documentDir = path.join(dataDir, 'documents');
const dataFile = path.join(dataDir, 'atlas-data.json');
const port = Number(process.env.PORT || 8080);
fs.mkdirSync(documentDir, { recursive: true });
const defaultExam = { id: 'demo', title: 'Química — revisão de ligações', status: 'draft', questions: [
  { id: 'q1', type: 'choice', text: 'Qual ligação ocorre pelo compartilhamento de elétrons?', options: ['Iônica', 'Covalente', 'Metálica', 'Nuclear'] },
  { id: 'q2', type: 'choice', text: 'Qual partícula possui carga negativa?', options: ['Próton', 'Nêutron', 'Elétron', 'Íon positivo'] },
  { id: 'q3', type: 'short', text: 'Escreva uma palavra que associe à tabela periódica.' }
] };
const initial = { roster: [], exams: [defaultExam], sessions: [], answers: {}, documents: {}, updatedAt: new Date().toISOString() };
let db = fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile, 'utf8')) : initial;
db.documents ??= {};
function save(){ db.updatedAt = new Date().toISOString(); fs.writeFileSync(dataFile, JSON.stringify(db, null, 2)); }
function json(res, status, body){ const text=JSON.stringify(body); res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'}); res.end(text); }
function body(req){ return new Promise((resolve,reject)=>{let raw=''; req.on('data',c=>{raw+=c; if(raw.length>40e6){reject(new Error('payload_too_large')); req.destroy();}}); req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{})}catch(e){reject(e)}});}); }
function csvEscape(v){ const s=String(v??''); return /[",\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s; }
function resultsCsv(){ const rows=[['numero','nome','prova','status','inicio','envio','respostas']]; for(const s of db.sessions){ const student=db.roster.find(x=>String(x.number)===String(s.number)); const answerCount=Object.keys(db.answers[s.id]||{}).length; rows.push([s.number,student?.name||'',s.examId,s.status,s.startedAt,s.submittedAt||'',answerCount]); } return rows.map(r=>r.map(csvEscape).join(',')).join('\n')+'\n'; }
function publicExam(exam){ return {...exam, document:exam.document ? {...exam.document, html:exam.document.kind==='docx'?db.documents[exam.document.id]?.html:undefined} : undefined}; }
function sendFile(req,res,pathname){ let rel=pathname==='/'?'index.html':pathname; if(rel==='/professor')rel='/professor.html'; if(rel==='/prova')rel='/prova.html'; const file=path.normalize(path.join(dist,rel)); if(!file.startsWith(dist)||!fs.existsSync(file)||fs.statSync(file).isDirectory()) return json(res,404,{error:'not_found'}); const ext=path.extname(file); const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.mjs':'text/javascript; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'}; res.writeHead(200,{'content-type':types[ext]||'application/octet-stream'}); fs.createReadStream(file).pipe(res); }
async function api(req,res,url){
  if(req.method==='GET'&&url.pathname==='/api/health') return json(res,200,{ok:true,updatedAt:db.updatedAt,rosterCount:db.roster.length});
  if(req.method==='GET'&&url.pathname==='/api/state') return json(res,200,{roster:db.roster,exams:db.exams.map(publicExam),sessions:db.sessions,updatedAt:db.updatedAt});
  if(req.method==='POST'&&url.pathname==='/api/roster'){ const input=await body(req); if(!Array.isArray(input.roster)) return json(res,400,{error:'roster_required'}); db.roster=[...new Map(input.roster.map(x=>[String(x.number),{number:String(x.number),name:String(x.name),className:String(x.className||'')}])).values()]; save(); return json(res,200,{ok:true,count:db.roster.length}); }
  if(req.method==='POST'&&url.pathname==='/api/exams'){ const input=await body(req); const exam={id:String(input.id||'demo'),title:String(input.title||'Avaliação'),status:'draft',questions:Array.isArray(input.questions)&&input.questions.length?input.questions:defaultExam.questions}; const old=db.exams.find(x=>x.id===exam.id); if(old?.document)exam.document=old.document; const idx=db.exams.findIndex(x=>x.id===exam.id); idx>=0?db.exams[idx]=exam:db.exams.push(exam); save(); return json(res,200,{ok:true,exam:publicExam(exam)}); }
  if(req.method==='POST'&&url.pathname==='/api/exam-document'){ const input=await body(req); const exam=db.exams.find(x=>x.id===String(input.examId||'demo')); if(!exam)return json(res,404,{error:'exam_not_found'}); const mime=String(input.mime||''); const name=String(input.name||'prova'); const kind=mime.includes('word')||name.toLowerCase().endsWith('.docx')?'docx':'pdf'; const id=`${exam.id}-${Date.now()}`; const buffer=Buffer.from(String(input.base64||''),'base64'); if(buffer.length>30e6)return json(res,413,{error:'document_too_large'}); const filePath=path.join(documentDir,`${id}.${kind}`); fs.writeFileSync(filePath,buffer); const document={id,name,kind,mime,size:buffer.length}; if(kind==='docx'){const converted=await mammoth.convertToHtml({buffer}); document.html=converted.value; document.warnings=converted.messages;} db.documents[id]={...document,filePath}; exam.document=document; save(); return json(res,200,{ok:true,document:{...document,html:kind==='docx'?document.html:undefined}}); }
  const documentMatch=url.pathname.match(/^\/api\/document\/([^/]+)$/); if(req.method==='GET'&&documentMatch){ const item=db.documents[documentMatch[1]]; if(!item||!fs.existsSync(item.filePath))return json(res,404,{error:'document_not_found'}); res.writeHead(200,{'content-type':item.mime||'application/octet-stream','content-disposition':`inline; filename="${item.name.replaceAll('"','')}"`}); return fs.createReadStream(item.filePath).pipe(res); }
  const start=url.pathname.match(/^\/api\/exams\/([^/]+)\/start$/); if(req.method==='POST'&&start){ const exam=db.exams.find(x=>x.id===start[1]); if(!exam)return json(res,404,{error:'exam_not_found'}); exam.status='open'; save(); return json(res,200,{ok:true,exam:publicExam(exam)}); }
  if(req.method==='POST'&&url.pathname==='/api/session/start'){ const input=await body(req); const exam=db.exams.find(x=>x.id===String(input.examId||'demo')); const number=String(input.number||''); const student=db.roster.find(x=>String(x.number)===number); if(!exam||exam.status!=='open')return json(res,409,{error:'exam_not_open'}); if(!student)return json(res,404,{error:'student_not_found'}); let session=db.sessions.find(x=>x.examId===exam.id&&x.number===number&&x.status!=='submitted'); if(!session){session={id:`${exam.id}-${number}-${Date.now()}`,examId:exam.id,number,status:'active',startedAt:new Date().toISOString()};db.sessions.push(session);save();} return json(res,200,{session,student,exam:publicExam(exam),answers:db.answers[session.id]||{}}); }
  if(req.method==='POST'&&url.pathname==='/api/answer'){ const input=await body(req); const session=db.sessions.find(x=>x.id===String(input.sessionId)); if(!session||session.status==='submitted')return json(res,409,{error:'session_closed'}); db.answers[session.id]??={}; db.answers[session.id][String(input.questionId)]=String(input.answer??''); save(); return json(res,200,{ok:true,savedAt:db.updatedAt}); }
  if(req.method==='POST'&&url.pathname==='/api/session/submit'){ const input=await body(req); const session=db.sessions.find(x=>x.id===String(input.sessionId)); if(!session)return json(res,404,{error:'session_not_found'}); session.status='submitted'; session.submittedAt=new Date().toISOString(); save(); return json(res,200,{ok:true,submittedAt:session.submittedAt}); }
  if(req.method==='GET'&&url.pathname==='/api/results.csv'){ res.writeHead(200,{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="resultados-atlas.csv"'}); return res.end(resultsCsv()); }
  return json(res,404,{error:'api_not_found'});
}
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`); if(url.pathname.startsWith('/api/'))return await api(req,res,url); sendFile(req,res,url.pathname)}catch(error){console.error(error);json(res,500,{error:'server_error',message:error.message})}});
server.listen(port,'0.0.0.0',()=>{console.log(`Atlas local ativo em http://localhost:${port}`);for(const item of Object.values(os.networkInterfaces()).flat().filter(x=>x?.family==='IPv4'&&!x.internal))console.log(`Na rede: http://${item.address}:${port}`);console.log('Professor: /professor | Alunos: /prova');});
