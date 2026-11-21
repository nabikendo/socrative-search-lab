// Regras de prova: validação de questões e cálculo de nota.
import { MATRIX_SKILLS } from './skills.js';

export class ExamError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

const MAX_QUESTIONS = 100;
const SAEB_SKILL_IDS = new Set(MATRIX_SKILLS.map((item) => item.id)); // SAEB e ENEM
const LEGACY_SKILL_IDS = new Set(Array.from({ length: 37 }, (_, i) => `D${i + 1}`));

export function questionId() {
  return 'q' + Math.random().toString(36).slice(2, 8);
}

const text = (value, max) => String(value ?? '').trim().slice(0, max);
const answered = (value) => Array.isArray(value) ? value.length > 0 : String(value ?? '').trim().length > 0;

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

    let type = ['choice','multi','numeric','text'].includes(raw?.type) ? raw.type : 'text';
    if (raw?.type === 'truefalse') type = 'choice';
    const skill = text(raw?.skill, 12).toUpperCase();
    const explanation = text(raw?.explanation, 1200);
    const topic = text(raw?.topic, 80);
    const difficulty = ['easy','medium','hard'].includes(raw?.difficulty) ? raw.difficulty : undefined;
    const image = typeof raw?.image === 'string' && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(raw.image) && raw.image.length <= 300_000 ? raw.image : undefined;
    const imageAlt = text(raw?.imageAlt, 200);
    const rubric = Array.isArray(raw?.rubric) ? raw.rubric.slice(0, 8).map((level) => ({
      label: text(level?.label, 80), description: text(level?.description, 240), score: Number(level?.score),
    })).filter((level) => level.label && Number.isFinite(level.score) && level.score >= 0 && level.score <= weight) : [];
    // Correção por competências (ex.: redação do ENEM, I a V, 0–200 cada). A nota da questão é
    // (soma dos níveis escolhidos ÷ soma dos máximos) × peso. Só para questões abertas.
    const criteria = type === 'text' && Array.isArray(raw?.criteria) ? raw.criteria.slice(0, 6).map((criterion) => ({
      id: text(criterion?.id, 8), label: text(criterion?.label, 260),
      levels: (Array.isArray(criterion?.levels) ? criterion.levels : []).slice(0, 8).map((level) => ({ score: Number(level?.score), description: text(level?.description, 400) }))
        .filter((level) => Number.isFinite(level.score) && level.score >= 0 && level.score <= 1000),
    })).filter((criterion) => criterion.label && criterion.levels.length >= 2) : [];
    const metadata = { ...(SAEB_SKILL_IDS.has(skill) || LEGACY_SKILL_IDS.has(skill) ? { skill } : {}), ...(explanation ? { explanation } : {}), ...(topic ? { topic } : {}), ...(difficulty ? { difficulty } : {}), ...(image ? { image, imageAlt } : {}), ...(rubric.length ? { rubric } : {}), ...(criteria.length ? { criteria } : {}) };
    if (type === 'text') return { id, type, text: body, options: [], weight: Math.round(weight * 100) / 100, ...metadata };

    if (type === 'numeric') {
      const correct = Number(raw?.correct);
      const tolerance = Number(raw?.tolerance ?? 0);
      if (!Number.isFinite(correct) || !Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1_000_000) throw new ExamError('invalid_numeric_answer', `${label}: informe uma resposta numérica correta e uma tolerância válida.`);
      return { id, type, text: body, options: [], correct: String(correct), tolerance, weight: Math.round(weight * 100) / 100, ...metadata };
    }

    const options = raw?.type === 'truefalse' && !Array.isArray(raw.options) ? ['Verdadeiro','Falso'] : (Array.isArray(raw.options) ? raw.options : []).map((o) => text(o, 500)).filter(Boolean);
    if (options.length < 2 || options.length > 10) throw new ExamError('invalid_options', `${label}: use de 2 a 10 alternativas.`);
    if (new Set(options).size !== options.length) throw new ExamError('duplicate_options', `${label}: há alternativas repetidas.`);
    if (type === 'multi') {
      const correct = Array.isArray(raw.correct) ? [...new Set(raw.correct.filter((answer) => options.includes(answer)))] : [];
      return { id, type, text: body, options, ...(correct.length ? { correct } : {}), weight: Math.round(weight * 100) / 100, ...metadata };
    }
    const correct = options.includes(raw.correct) ? raw.correct : undefined;
    return { id, type, text: body, options, ...(correct ? { correct } : {}), weight: Math.round(weight * 100) / 100, ...metadata };
  });
}

// Versão enviada ao aluno: nunca inclui o gabarito.
export function studentQuestions(questions) {
  return questions.map(({ correct, explanation, rubric, criteria, ...rest }) => rest);
}

const round = (n) => Math.round(n * 100) / 100;

export function scoreSession(exam, answers = {}, grades = {}) {
  let score = 0;
  let max = 0;
  let pending = 0;
  const detail = {};
  for (const q of exam.questions) {
    const annulment = exam.annulled?.[q.id];
    if (annulment) {
      const earned = annulment.mode === 'credit' ? q.weight : 0;
      score += earned;
      max += earned;
      detail[q.id] = { mode: 'annulled', earned };
      continue;
    }
    max += q.weight;
    const given = answers[q.id];
    if (q.type === 'choice' && q.correct) {
      const earned = given === q.correct ? q.weight : 0;
      score += earned;
      detail[q.id] = { mode: 'auto', earned };
    } else if (q.type === 'multi' && q.correct?.length) {
      let selected = given;
      if (typeof selected === 'string') { try { selected = JSON.parse(selected); } catch { selected = []; } }
      const actual=Array.isArray(selected)?[...new Set(selected)].sort():[];
      const expected=[...q.correct].sort();
      const earned = actual.length===expected.length && actual.every((value,index)=>value===expected[index]) ? q.weight : 0;
      score += earned; detail[q.id] = { mode:'auto', earned };
    } else if (q.type === 'numeric' && q.correct !== undefined) {
      const value=Number(String(given ?? '').replace(',','.'));
      const earned=answered(given) && Number.isFinite(value) && Math.abs(value-Number(q.correct))<=q.tolerance ? q.weight : 0;
      score+=earned; detail[q.id]={mode:'auto',earned};
    } else if (grades[q.id] !== undefined) {
      const earned = Math.min(Math.max(Number(grades[q.id]), 0), q.weight);
      score += earned;
      detail[q.id] = { mode: 'manual', earned };
    } else {
      if (answered(given)) pending += 1;
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

// Recupera questões numeradas de PDFs com camada de texto. A extração é sempre
// uma proposta revisável; o arquivo escaneado sem texto deve continuar em PDF.
export function parsePdfQuestionText(input) {
  const source = String(input || '').replace(/\r/g, '');
  const markers = [...source.matchAll(/^[ \t]*(?:quest(?:ão|ao)\s*)?(\d{1,2})[.)-]\s+/gim)];
  if (!markers.length || Number(markers[0][1]) !== 1) return [];
  const questions = [];
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].index + markers[i][0].length;
    const end = markers[i + 1]?.index ?? source.length;
    let body = source.slice(start, end).trim();
    if (!body) continue;
    const optionPattern = /^[ \t]*(?:\(([A-E])\)|([A-E])[.)])\s+(.+)$/gim;
    const options = [];
    let match;
    while ((match = optionPattern.exec(body))) options.push({ start: match.index, end: optionPattern.lastIndex, text: match[3].trim() });
    let text = body;
    let type = 'text';
    let choices = [];
    if (options.length >= 2 && options.length <= 10) {
      type = 'choice';
      choices = options.map((option) => option.text);
      text = body.slice(0, options[0].start).trim();
      if (options[0].start === 0) text = '';
    }
    text = text.replace(/\n{3,}/g, '\n\n').trim();
    if (!text && type === 'text') continue;
    questions.push({ id: questionId(), type, text: text || `Questão ${i + 1}`, options: choices, weight: 1 });
    if (questions.length >= MAX_QUESTIONS) break;
  }
  return questions;
}

