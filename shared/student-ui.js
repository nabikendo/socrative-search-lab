// Regras da tela do aluno sem dependência do navegador (testadas em test/student-experience.test.js).

// Avisos de tempo: um aviso aos 5 minutos e outro a 1 minuto, cada um uma única vez.
// left: segundos restantes calculados pelo relógio do servidor; warned: Set com os avisos já dados.
export const TIME_WARNINGS = [
  { id: '5min', seconds: 300, message: 'Faltam 5 minutos para o fim da prova. Revise e entregue.' },
  { id: '1min', seconds: 60, message: 'Falta 1 minuto! Entregue a prova agora.' },
];
export function timeWarning(left, warned) {
  if (!Number.isFinite(left) || left <= 0) return null;
  // Do aviso mais urgente para o menos urgente: quem reabre a prova com 40 s vê só o de 1 minuto.
  for (const warning of [...TIME_WARNINGS].sort((a, b) => a.seconds - b.seconds)) {
    if (left <= warning.seconds) {
      if (warned.has(warning.id)) return null;
      for (const other of TIME_WARNINGS) if (other.seconds >= warning.seconds) warned.add(other.id);
      return warning;
    }
  }
  return null;
}

// Segundos restantes pelo relógio do servidor (o relógio do celular pode estar errado).
export const secondsLeft = (endsAt, clockOffset, now = Date.now()) => (endsAt ? Math.max(0, Math.floor((endsAt - (now + clockOffset)) / 1000)) : null);

export const hasAnswer = (value) => (Array.isArray(value) ? value.length > 0 : String(value ?? '').trim().length > 0);

// Revisão antes de enviar: questões em branco e marcadas para revisar, com o número exibido ao aluno.
export function reviewSummary(questions, answerOf, flags) {
  const items = questions.map((question, index) => ({ id: question.id, number: index + 1, answered: hasAnswer(answerOf(question.id)), flagged: flags.has(question.id) }));
  return {
    total: items.length,
    answered: items.filter((item) => item.answered).length,
    blanks: items.filter((item) => !item.answered),
    flagged: items.filter((item) => item.flagged),
  };
}

// Identificador deste aparelho (fica no navegador). Usa getRandomValues, que funciona também em HTTP.
export function newDeviceId(cryptoImpl = globalThis.crypto) {
  const bytes = new Uint8Array(16);
  cryptoImpl.getRandomValues(bytes);
  return 'd-' + [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
