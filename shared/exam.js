// Regras de prova: validação de questões e cálculo de nota.

export class ExamError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

const MAX_QUESTIONS = 100;

export function questionId() {
  return 'q' + Math.random().toString(36).slice(2, 8);
}

const text = (value, max) => String(value ?? '').trim().slice(0, max);

export function normalizeQuestions(input) {
  if (!Array.isArray(input)) throw new ExamError('questions_required', 'Adicione questões ou anexe um PDF da prova.');
  if (input.length > MAX_QUESTIONS) throw new ExamError('too_many_questions', `No máximo ${MAX_QUESTIONS} questões.`);
  const seen = new Set();
  return input.map((raw, index) => {
    const label = `Questão ${index + 1}`;
    const body = text(raw?.text, 2000);
    if (!body) throw new ExamError('question_text_required', `${label}: escreva o enunciado.`);

    let id = text(raw?.id, 40).replace(/[^\w-]/g, '');
    if (!id || seen.has(id)) id = questionId();
    seen.add(id);

    const weight = Number(raw?.weight ?? 1);
    if (!Number.isFinite(weight) || weight <= 0 || weight > 100) throw new ExamError('invalid_weight', `${label}: o peso deve estar entre 0 e 100.`);

    const type = raw?.type === 'choice' ? 'choice' : 'text';
    if (type === 'text') return { id, type, text: body, options: [], weight: Math.round(weight * 100) / 100 };

    const options = (Array.isArray(raw.options) ? raw.options : []).map((o) => text(o, 500)).filter(Boolean);
    if (options.length < 2 || options.length > 10) throw new ExamError('invalid_options', `${label}: use de 2 a 10 alternativas.`);
    if (new Set(options).size !== options.length) throw new ExamError('duplicate_options', `${label}: há alternativas repetidas.`);
    const correct = options.includes(raw.correct) ? raw.correct : undefined;
    return { id, type, text: body, options, ...(correct ? { correct } : {}), weight: Math.round(weight * 100) / 100 };
  });
}

// Versão enviada ao aluno: nunca inclui o gabarito.
export function studentQuestions(questions) {
  return questions.map(({ correct, ...rest }) => rest);
}

const round = (n) => Math.round(n * 100) / 100;

export function scoreSession(exam, answers = {}, grades = {}) {
  let score = 0;
  let max = 0;
  let pending = 0;
  const detail = {};
  for (const q of exam.questions) {
    max += q.weight;
    const given = answers[q.id];
    if (q.type === 'choice' && q.correct) {
      const earned = given === q.correct ? q.weight : 0;
      score += earned;
      detail[q.id] = { mode: 'auto', earned };
    } else if (grades[q.id] !== undefined) {
      const earned = Math.min(Math.max(Number(grades[q.id]), 0), q.weight);
      score += earned;
      detail[q.id] = { mode: 'manual', earned };
    } else {
      if (given) pending += 1;
      detail[q.id] = { mode: 'manual', earned: null };
    }
  }
  return { score: round(score), max: round(max), pending, detail };
}

// Texto rápido: "Enunciado | A | *B | C || peso=2". Alternativa com * é o gabarito.
export function parseQuestionsText(input) {
  const questions = [];
  for (const line of String(input).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [body, ...extras] = line.split('||');
    const [stem, ...rawOptions] = body.split('|').map((part) => part.trim());
    if (!stem) continue;
    const weightPart = extras.map((x) => x.trim()).find((x) => /^peso\s*=/i.test(x));
    const weight = weightPart ? Number(weightPart.split('=')[1].trim().replace(',', '.')) : 1;
    const options = rawOptions.map((o) => o.replace(/^\*\s*/, '')).filter(Boolean);
    const starred = rawOptions.find((o) => o.startsWith('*'));
    questions.push({
      id: questionId(), type: options.length >= 2 ? 'choice' : 'text', text: stem, options: options.length >= 2 ? options : [],
      ...(starred ? { correct: starred.replace(/^\*\s*/, '') } : {}), weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
    });
  }
  return questions;
}
