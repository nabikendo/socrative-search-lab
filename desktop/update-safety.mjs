// Guards installer launch against a live exam; used by the Electron main process.
// This is deliberately fail-closed if the database cannot be inspected.
export function updateSafety(store) {
  if (!store || typeof store.getOpenExam !== 'function') {
    return { safe: false, reason: 'store_unavailable' };
  }
  try {
    const exam = store.getOpenExam();
    if (exam && ['open', 'paused'].includes(exam.status)) {
      return { safe: false, reason: 'exam_in_progress', examId: exam.id };
    }
    if (exam && exam.status !== 'closed' && exam.status !== 'draft') {
      return { safe: false, reason: 'exam_state_unknown' };
    }
    return { safe: true, reason: null };
  } catch {
    return { safe: false, reason: 'store_error' };
  }
}
