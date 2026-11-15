import { findSkill } from './skills.js';

// Gerador determinístico por regras matemáticas; NÃO é um modelo de IA.
// Só habilitar um descritor quando houver template com enunciado e gabarito verificáveis.
const choice = (stem, answer, incorrect, explanation, skill) => {
  const correct = String(answer);
  const options = [...new Set([correct, ...incorrect.map(String)])].slice(0, 4);
  // Algumas combinações numéricas produzem distratores coincidentes. Completar
  // sem incluir segunda alternativa numericamente idêntica à resposta.
  const asFraction = /^(-?\d+)\/(\d+)$/.exec(correct);
  for (let delta = 1; options.length < 4 && delta < 20; delta++) {
    const candidate = asFraction ? `${Number(asFraction[1]) + delta}/${asFraction[2]}` :
      String(Number(correct) + delta * (Number.isInteger(Number(correct)) ? 1 : 0.5));
    if (!options.includes(candidate)) options.push(candidate);
  }
  if (options.length !== 4) throw new Error('O modelo gerou alternativas insuficientes.');
  return { type: 'choice', text: stem, options, correct, weight: 1, difficulty: 'medium',
    topic: skill.topic, skill: skill.id, explanation };
};
const rngFrom = (seed) => {
  let state = (Number(seed) >>> 0) || 137;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
};
const between = (r, min, max) => min + Math.floor(r() * (max - min + 1));
const shuffle = (items, r) => {
  const list = [...items]; for (let i = list.length - 1; i > 0; i--) {
    const j = between(r, 0, i); [list[i], list[j]] = [list[j], list[i]];
  } return list;
};
export const SUPPORTED_GENERATORS = [
  'SAEB5-D17', 'SAEB5-D18', 'SAEB5-D26', 'SAEB9-D28',
  'SAEB9-D29', 'SAEB9-D30', 'SAEB3-D15', 'SAEB3-D16',
  'SAEB3-D19', 'SAEB3-D33',
];
export function generateDescriptorQuestion(skillId, seed = 1) {
  const skill = findSkill(skillId);
  if (!skill || !SUPPORTED_GENERATORS.includes(skill.id)) return null;
  const r = rngFrom(seed);
  const num = (...args) => between(r, ...args);
  let question;
  if (skill.id === 'SAEB5-D17') {
    const a = num(21, 80), b = num(5, 19), total = a + b;
    question = choice(`Em uma biblioteca havia ${a} livros de Ciências. Chegaram mais ${b} livros. Quantos livros de Ciências há agora?`, total,
      [total+5, total-5, a], `A operação é ${a} + ${b} = ${total}.`, skill);
  } else if (skill.id === 'SAEB5-D18') {
    const a=num(4,12), b=num(3,9), result=a*b;
    question=choice(`Uma escola organiza ${a} caixas, com ${b} lápis em cada caixa. Quantos lápis há ao todo?`, result,
      [result+a, result-b, a+b], `Multiplicação: ${a} × ${b} = ${result}.`, skill);
  } else if (['SAEB5-D26','SAEB9-D28','SAEB3-D16'].includes(skill.id)) {
    const percent = skill.id==='SAEB5-D26'?[25,50,100][num(0,2)]:[10,20,25,40,50][num(0,4)];
    const base = num(8,25)*20;
    const result = base*percent/100;
    question=choice(`Uma escola tem ${base} estudantes matriculados. ${percent}% deles participam de uma atividade. Quantos estudantes participam?`,
      result, [result+base/20, result+base/10, base-result],
      `${percent}% de ${base} = (${percent}/100) × ${base} = ${result}.`, skill);
  } else if (['SAEB9-D29','SAEB3-D15'].includes(skill.id)) {
    const unit=num(3,12), initial=num(2,5), target=initial+num(2,5);
    const total=unit*initial, answer=unit*target;
    question=choice(`Em uma papelaria, ${initial} cadernos iguais custam R$ ${total},00. Mantendo o mesmo preço unitário, quanto custam ${target} cadernos?`,
      answer, [answer+unit, answer-unit, total+unit],
      `Preço de um caderno: ${total}/${initial} = ${unit} reais. Preço de ${target}: ${target} × ${unit} = ${answer} reais.`, skill);
  } else if (skill.id === 'SAEB9-D30') {
    const a=num(2,8), b=num(3,11), x=num(3,9), result=a*x+b;
    question=choice(`Calcule o valor da expressão ${a}x + ${b} para x = ${x}.`,
      result, [result+a, result-b, result+x],
      `Substituindo x por ${x}: ${a} × ${x} + ${b} = ${result}.`, skill);
  } else if (skill.id === 'SAEB3-D19') {
    const a=num(3,8), b=num(4,15), x=num(3,9), result=a*x+b;
    question=choice(`O preço de uma corrida é dado por P(x) = ${a}x + ${b}, em reais, para x quilômetros percorridos. Qual é o preço para uma corrida de ${x} km?`,
      result, [result+a, result+b, result-x],
      `P(${x}) = ${a} × ${x} + ${b} = ${result} reais.`, skill);
  } else if (skill.id === 'SAEB3-D33') {
    const red=num(2,6), blue=num(3,7), total=red+blue;
    const answer=`${red}/${total}`;
    question=choice(`Uma urna contém ${red} bolas vermelhas e ${blue} bolas azuis, todas com a mesma chance de retirada. Qual é a probabilidade de retirar uma bola vermelha?`,
      answer, [`${blue}/${total}`, `${red}/${blue}`, `1/${total}`],
      `Casos favoráveis: ${red}; casos possíveis: ${total}. Probabilidade = ${red}/${total}.`, skill);
  }
  if (!question) return null;
  question.options = shuffle(question.options, r);
  return question;
}
