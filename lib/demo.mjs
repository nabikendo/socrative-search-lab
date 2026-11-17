// Dados fictícios para o modo de teste. São gravados SOMENTE no banco isolado do modo de teste
// (nunca no banco real) e usam nomes inventados, sem relação com pessoas reais.
export const DEMO_PREFIX = '[TESTE]';

const FIRST = ['Alice', 'Bruno', 'Camila', 'Davi', 'Elisa', 'Felipe', 'Gabriela', 'Heitor', 'Isabela', 'João', 'Karina', 'Lucas', 'Marina', 'Nicolas', 'Olívia', 'Pedro', 'Rafaela', 'Samuel', 'Talita', 'Vinícius', 'Yasmin', 'Arthur', 'Beatriz', 'Caio', 'Débora', 'Enzo', 'Fernanda', 'Gustavo'];
const LAST = ['Almeida', 'Barbosa', 'Cardoso', 'Duarte', 'Esteves', 'Ferraz', 'Guimarães', 'Henrique', 'Ibrahim', 'Jardim', 'Klein', 'Lacerda', 'Monteiro', 'Nogueira', 'Oliveira', 'Pacheco', 'Queiroz', 'Ribeiro', 'Siqueira', 'Teixeira'];

// Gerador pseudoaleatório determinístico: o mesmo "seed" sempre produz os mesmos dados (testes estáveis).
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const QUESTIONS = [
  { type: 'choice', text: 'Qual ligação química ocorre pelo compartilhamento de elétrons?', options: ['Iônica', 'Covalente', 'Metálica', 'Dipolo-dipolo'], correct: 'Covalente', explanation: 'Na ligação covalente os átomos compartilham pares de elétrons.', topic: 'Ligações químicas' },
  { type: 'choice', text: 'Qual partícula subatômica possui carga elétrica negativa?', options: ['Próton', 'Nêutron', 'Elétron', 'Pósitron'], correct: 'Elétron', explanation: 'O elétron tem carga negativa.', topic: 'Estrutura atômica' },
  { type: 'choice', text: 'Qual é o número atômico do carbono?', options: ['4', '6', '8', '12'], correct: '6', explanation: 'O carbono tem 6 prótons.', topic: 'Tabela periódica' },
  { type: 'choice', text: 'Uma solução com pH 3 é:', options: ['Básica', 'Neutra', 'Ácida', 'Salina'], correct: 'Ácida', explanation: 'pH menor que 7 indica solução ácida.', topic: 'Ácidos e bases' },
  { type: 'choice', text: 'Qual substância é formada por ligação iônica?', options: ['H2O', 'NaCl', 'CO2', 'O2'], correct: 'NaCl', explanation: 'O NaCl une um metal e um ametal por transferência de elétrons.', topic: 'Ligações químicas' },
  { type: 'text', text: 'Explique com suas palavras a diferença entre ligação iônica e covalente.', weight: 2, topic: 'Ligações químicas' },
];
const DRAFT_QUESTIONS = [
  { type: 'choice', text: 'Qual é o pH da água pura a 25 °C?', options: ['0', '7', '10', '14'], correct: '7', explanation: 'A água pura é neutra.', topic: 'Ácidos e bases' },
  { type: 'choice', text: 'Qual indicador natural muda de cor conforme o pH?', options: ['Sal', 'Repolho roxo', 'Açúcar', 'Óleo'], correct: 'Repolho roxo', explanation: 'As antocianinas mudam de cor com o pH.', topic: 'Ácidos e bases' },
];

// Cria uma turma, banco de questões, uma prova encerrada com resultados e uma prova em elaboração.
export function seedDemo(store, { seed = 20261116, students = 28 } = {}) {
  // Banco descartável: sem esperar cada gravação chegar ao disco, o preenchimento leva milissegundos em vez de segundos
  // (no Windows eram vários segundos com o servidor parado). A segurança normal volta ao final.
  store.raw.run('PRAGMA synchronous = OFF');
  try { return fill(store, { seed, students }); } finally { store.raw.run('PRAGMA synchronous = FULL'); }
}

function fill(store, { seed, students }) {
  const random = rng(seed);
  const names = new Set();
  const rows = [];
  while (rows.length < students) {
    const name = `${FIRST[Math.floor(random() * FIRST.length)]} ${LAST[Math.floor(random() * LAST.length)]}`.toUpperCase();
    if (!names.has(name)) { names.add(name); rows.push({ number: String(rows.length + 1), name }); }
  }
  const klass = store.saveClass(`${DEMO_PREFIX} 9º Ano A`, rows);
  const roster = store.classRoster(klass.id);
  store.setAccommodation(roster[0].id, { extraTime: 15, note: 'Dado fictício de teste' });

  for (const question of QUESTIONS) store.saveBankQuestion(question);

  const exam = store.saveExam({ title: `${DEMO_PREFIX} Prova de Ligações Químicas`, questions: QUESTIONS, classId: klass.id, feedback: true });
  const draft = store.saveExam({ title: `${DEMO_PREFIX} Rascunho — Ácidos e bases`, questions: DRAFT_QUESTIONS, classId: klass.id });
  const full = store.getExam(exam.id);
  store.openExam(exam.id);
  const submitted = Math.max(1, students - 4); // alguns alunos ficam sem participar, como numa turma real
  let sessions = 0;
  for (const student of roster.slice(0, submitted)) {
    const ability = 0.35 + random() * 0.6;
    const session = store.createSession(exam.id, student.number, { id: student.id, name: student.name, className: klass.name });
    for (const question of full.questions) {
      if (question.type === 'choice') {
        const right = random() < ability;
        const wrong = question.options.filter((option) => option !== question.correct);
        store.saveAnswer(session.id, question.id, right ? question.correct : wrong[Math.floor(random() * wrong.length)]);
      } else {
        store.saveAnswer(session.id, question.id, 'Resposta fictícia de teste: a iônica transfere elétrons e a covalente os compartilha.');
        store.setGrade(session.id, question.id, Math.round(random() * 2 * ability * 2) / 2);
      }
    }
    store.submit(session.id);
    sessions += 1;
  }
  store.closeExam(exam.id);
  return { classId: klass.id, examId: exam.id, draftId: draft.id, students: roster.length, sessions, bank: QUESTIONS.length };
}
