// Answers must stay on the student's device until the server confirms them.
// A 4xx response is not proof that the student intended to discard the answer.
export function answerFailure(error) {
  if (error?.code === 'exam_closed' || error?.code === 'session_closed') return { action: 'locked', message: 'Prova encerrada. Há respostas neste aparelho não confirmadas pelo servidor. Avise o professor antes de sair.' };
  if (error?.code === 'exam_paused' || error?.code === 'session_paused') return { action: 'retry', message: 'Prova pausada — respostas aguardando a retomada.' };
  if (error?.code === 'invalid_answer' || error?.code === 'unknown_question') return { action: 'review', message: 'Uma resposta foi recusada e permanece neste aparelho. Avise o professor.' };
  // acesso vencido por inatividade: o aparelho vinculado renova sozinho, sem perder nada
  if (error?.code === 'session_expired') return { action: 'renew', message: 'Reconectando…' };
  if (error?.status === 401 || error?.status === 403) return { action: 'review', message: 'Sessão não autorizada. Respostas preservadas neste aparelho; solicite ajuda ao professor.' };
  if (error?.status >= 400 && error?.status < 500 && error?.status !== 429) return { action: 'review', message: 'Não foi possível confirmar uma resposta. Ela permanece salva neste aparelho.' };
  return { action: 'retry', message: 'Sem conexão com o servidor — respostas aguardando sincronização.' };
}
