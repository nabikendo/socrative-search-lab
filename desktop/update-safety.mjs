// Check the persisted Atlas state before replacing the application binaries.
// A disconnected student can still have a local queue after the exam is closed,
// so recently closed exams with unsubmitted sessions block automatic installation.
export function updateSafety(store, now = Date.now()) {
  if (!store || typeof store.getOpenExam !== 'function') return { safe:false, reason:'store_unavailable' };
  try {
    const exam = store.getOpenExam();
    if (exam && ['open','paused'].includes(exam.status)) return { safe:false, reason:'exam_in_progress', examId:exam.id };
    if (exam && !['closed','draft'].includes(exam.status)) return { safe:false, reason:'exam_state_unknown' };
    if (typeof store.unconfirmedRecentSessions === 'function') {
      const unconfirmed = store.unconfirmedRecentSessions(72);
      if (!Number.isSafeInteger(unconfirmed) || unconfirmed < 0) return { safe:false, reason:'session_state_unknown' };
      if (unconfirmed > 0) return { safe:false, reason:'unconfirmed_deliveries', count:unconfirmed };
    }
    if (typeof store.listExams === 'function') {
      // Do not restart the school server just before a scheduled exam begins.
      const soon = store.listExams().find(item => item.status === 'scheduled' &&
        Number.isFinite(Date.parse(item.scheduledStart)) &&
        Date.parse(item.scheduledStart) <= now + 15 * 60_000 &&
        Date.parse(item.scheduledStart) >= now - 60_000);
      if (soon) return { safe:false, reason:'scheduled_soon', examId:soon.id };
    }
    return { safe:true, reason:null };
  } catch {
    return { safe:false, reason:'store_error' };
  }
}
