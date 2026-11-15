// Shared filter for final assessment statistics. Active sessions represent
// provisional answers and must not be counted as final learning outcomes.
export function submittedOnly(results) {
  return (Array.isArray(results) ? results : []).filter((entry) => entry?.status === 'submitted');
}

export function finalAnswersForItem(results, questionId) {
  return submittedOnly(results)
    .map((entry) => entry.answers?.[questionId])
    .filter((answer) => answer !== undefined && answer !== null &&
      (Array.isArray(answer) ? answer.length > 0 : String(answer).trim() !== '' && String(answer).trim() !== '[]'));
}
