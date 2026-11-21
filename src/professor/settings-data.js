import { api, downloadFile } from '../lib/api.js';
import { h, clear, toast } from '../lib/dom.js';
import { confirmAction } from '../lib/confirm.js';
import { card, field, button, badge, notice } from './settings-kit.js';

// Textos de apoio de cada ação (as regras e os alcances válidos vêm do servidor).
const HELP = {
  drafts: ['Provas', 'Apaga avaliações que ainda estão em elaboração (rascunhos).'],
  restart: ['Provas', 'Zera as respostas e participações de uma prova em andamento e gera um novo código de acesso.'],
  disconnect: ['Provas', 'Desliga os aparelhos conectados sem apagar respostas. O aluno entra de novo com o número de chamada.'],
  results: ['Resultados', 'Apaga respostas, notas e participações. As provas e suas questões são mantidas.'],
  classes: ['Turmas e alunos', 'Remove turmas ou alunos da lista. Resultados já registrados são mantidos.'],
  cache: ['Aplicativo', 'Remove arquivos temporários e o cache de páginas. Nenhum dado seu é apagado.'],
  settings: ['Aplicativo', 'Volta tema, tamanho do texto e padrões de prova ao original.'],
  ai: ['Aplicativo', 'Apaga as chaves de API e as escolhas de IA deste perfil.'],
  reset: ['Geral', 'Apaga tudo deste perfil (provas, resultados, turmas, banco de questões, preferências e IA).'],
};
const SCOPE_LABEL = { session: 'Um participante', student: 'Um aluno', exam: 'Uma prova', class: 'Uma turma', profile: 'Todo o perfil' };
const STATUS_LABEL = { draft: 'rascunho', open: 'aberta', paused: 'pausada', closed: 'encerrada', scheduled: 'agendada' };

function backupSection(status) {
  const pick = () => {
    const picker = h('input', { type: 'file', accept: '.atlas,application/json', style: 'display:none' });
    document.body.append(picker);
    picker.addEventListener('change', async () => {
      try {
        const file = picker.files?.[0]; if (!file) return;
        const raw = await file.arrayBuffer();
        const verified = await api('/api/restore/verify', { method: 'POST', raw });
        const { confirmed } = await confirmAction({ title: 'Importar backup?', lead: `Os dados atuais serão substituídos por ${verified.exams} prova(s) do backup.`, phrase: 'SUBSTITUIR', danger: true, confirmLabel: 'Importar' });
        if (!confirmed) return;
        await api('/api/restore', { method: 'POST', raw });
        toast('Backup restaurado.'); setTimeout(() => location.reload(), 900);
      } catch (error) { status(error.message); } finally { picker.remove(); }
    }, { once: true });
    picker.click();
  };
  return card('Backup', 'Cópia completa no formato .atlas, com provas, turmas, resultados e anexos. Backup automático, restauração seletiva e privacidade ficam em Ajuda.',
    h('div', { class: 'settings-actions' },
      button('Exportar backup', async () => { const name = await downloadFile('/api/backup'); status?.(`Backup salvo: ${name}`); }, { status }),
      button('Importar backup', pick, { status })));
}

export async function render(panel, { status }) {
  let targets;
  try { targets = await api('/api/maintenance/targets'); }
  catch (error) { clear(panel, notice(error.message, 'danger')); return; }

  const state = { action: 'results', scope: 'exam', examId: targets.exams[0]?.id ?? '', classId: targets.classes[0]?.id ?? '', sessionId: '', studentNumber: '', participants: [], roster: [] };
  const out = h('div', { class: 'stack-s' });
  const backups = h('div', { class: 'stack-s' });

  const def = () => targets.actions.find((item) => item.id === state.action);
  const ensureScope = () => { if (!def().scopes.includes(state.scope)) state.scope = def().scopes[0]; };

  const scopeRequest = () => {
    if (state.scope === 'exam') return { type: 'exam', id: state.examId };
    if (state.scope === 'class') return { type: 'class', id: state.classId };
    if (state.scope === 'session') return { type: 'session', id: state.sessionId };
    if (state.scope === 'student') return { type: 'student', id: state.classId, number: state.studentNumber };
    return { type: 'profile' };
  };
  const ready = () => {
    const s = scopeRequest();
    return s.type === 'profile' || !!(s.type === 'student' ? s.id && s.number : s.id);
  };

  async function loadParticipants() {
    state.participants = state.examId ? (await api(`/api/maintenance/exams/${state.examId}/participants`)).participants : [];
    state.sessionId = state.participants[0]?.id ?? '';
  }
  async function loadRoster() {
    state.roster = state.classId ? (await api(`/api/classes/${state.classId}/roster`)).roster : [];
    state.studentNumber = state.roster[0]?.number ?? '';
  }
  async function prepareScope() {
    if (state.scope === 'session') await loadParticipants();
    if (state.scope === 'student') await loadRoster();
  }

  function selectOf(label, items, value, onChange, empty) {
    const select = h('select', { 'aria-label': label }, items.length ? items.map((item) => h('option', { value: item.value, selected: item.value === value }, item.label)) : h('option', { value: '' }, empty));
    select.addEventListener('change', () => onChange(select.value));
    return field(label, select);
  }

  function pickers() {
    const examItems = targets.exams.map((exam) => ({ value: exam.id, label: `${exam.title} · ${STATUS_LABEL[exam.status] ?? exam.status}${exam.sessions ? ` · ${exam.sessions} participação(ões)` : ''}` }));
    const classItems = targets.classes.map((item) => ({ value: item.id, label: `${item.name} · ${item.students} aluno(s)` }));
    const list = [];
    if (['exam', 'session'].includes(state.scope)) {
      list.push(selectOf('Prova', examItems, state.examId, async (value) => { state.examId = value; if (state.scope === 'session') await loadParticipants(); draw(); }, 'Nenhuma prova'));
    }
    if (state.scope === 'session') {
      list.push(selectOf('Participante', state.participants.map((p) => ({ value: p.id, label: `${p.number} · ${p.name || 'sem nome'} · ${p.status === 'submitted' ? 'enviou' : 'em andamento'}` })), state.sessionId, (value) => { state.sessionId = value; clear(out); }, 'Nenhum participante'));
    }
    if (['class', 'student'].includes(state.scope)) {
      list.push(selectOf('Turma', classItems, state.classId, async (value) => { state.classId = value; if (state.scope === 'student') await loadRoster(); draw(); }, 'Nenhuma turma'));
    }
    if (state.scope === 'student') {
      list.push(selectOf('Aluno', state.roster.map((r) => ({ value: r.number, label: `${r.number} · ${r.name}` })), state.studentNumber, (value) => { state.studentNumber = value; clear(out); }, 'Nenhum aluno'));
    }
    return list;
  }

  async function preview() {
    clear(out);
    const request = { action: state.action, scope: scopeRequest() };
    const planned = await api('/api/maintenance/preview', { method: 'POST', body: request });
    const rows = planned.summary.map((row) => h('li', {}, h('span', {}, row.label), h('strong', {}, String(row.count))));
    clear(out, h('div', { class: 'card stack-s preview-card' },
      h('h3', { class: 'headline' }, planned.label),
      h('ul', { class: 'confirm-rows' }, rows),
      ...planned.notes.map((note) => h('p', { class: 'caption' }, note)),
      ...planned.blocked.map((reason) => notice(reason, 'warn')),
      planned.canRun && button(planned.destructive ? 'Continuar…' : planned.label, () => confirmRun(planned, request), { kind: planned.destructive ? 'danger' : '', status })));
    out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function confirmRun(planned, request) {
    const { confirmed, backup } = await confirmAction({
      title: planned.label, lead: planned.destructive ? 'Esta ação não pode ser desfeita sem um backup.' : 'Confirme para continuar.',
      rows: planned.summary, notes: planned.notes, phrase: planned.confirmPhrase, danger: planned.destructive, confirmLabel: planned.label,
      backup: planned.backupAvailable ? true : undefined, backupLabel: 'Fazer uma cópia de segurança antes (recomendado)',
    });
    if (!confirmed) return;
    const result = await api('/api/maintenance/run', { method: 'POST', body: { ...request, confirm: planned.confirmPhrase, backup } });
    try { sessionStorage.removeItem('atlas.bank.pending'); sessionStorage.removeItem('atlas.jumpExam'); } catch { /* sem armazenamento */ }
    targets = await api('/api/maintenance/targets');
    if (!targets.exams.some((exam) => exam.id === state.examId)) state.examId = targets.exams[0]?.id ?? '';
    if (!targets.classes.some((item) => item.id === state.classId)) state.classId = targets.classes[0]?.id ?? '';
    await prepareScope();
    draw();
    clear(out, h('div', { class: 'card stack-s' },
      badge('Concluído', 'ok'), h('h3', { class: 'headline' }, result.label),
      result.backup ? h('p', {}, 'Cópia de segurança salva: ', h('a', { href: `/api/maintenance/backups/${result.backup.name}` }, result.backup.name)) : null,
      result.backup ? h('p', { class: 'caption' }, 'Para desfazer, use Importar backup (acima) com este arquivo.') : null));
    toast('Concluído.');
    await loadBackups();
    if (['settings', 'reset', 'ai'].includes(request.action)) setTimeout(() => location.reload(), 1500);
  }

  async function loadBackups() {
    const { backups: list } = await api('/api/maintenance/backups');
    clear(backups, list.length
      ? list.map((item) => h('div', { class: 'list-row' }, h('span', { class: 'grow mono-name' }, item.name), h('span', { class: 'meta' }, new Date(item.createdAt).toLocaleString('pt-BR')), h('a', { class: 'btn quiet', href: `/api/maintenance/backups/${item.name}` }, 'Baixar')))
      : h('p', { class: 'caption' }, 'Nenhum backup de segurança ainda. Eles são criados automaticamente antes de apagar dados (guardamos os 10 mais recentes).'));
  }

  function wizard() {
    ensureScope();
    const groups = [...new Set(Object.values(HELP).map((item) => item[0]))];
    const actionSelect = h('select', { 'aria-label': 'O que deseja fazer' }, groups.map((group) => h('optgroup', { label: group },
      targets.actions.filter((item) => HELP[item.id]?.[0] === group).map((item) => h('option', { value: item.id, selected: item.id === state.action }, item.label)))));
    actionSelect.addEventListener('change', async () => {
      state.action = actionSelect.value; ensureScope(); await prepareScope(); clear(out); draw();
    });
    const scopes = h('div', { class: 'segmented scope-picker', role: 'group', 'aria-label': 'Alcance' }, def().scopes.map((scope) => h('button', {
      type: 'button', 'aria-pressed': String(scope === state.scope),
      onclick: async () => { state.scope = scope; await prepareScope(); clear(out); draw(); },
    }, SCOPE_LABEL[scope])));
    const go = button('Ver o que será afetado', preview, { status });
    go.disabled = !ready();
    return card('Limpeza e redefinição', 'Escolha o que limpar e o alcance. Antes de apagar, você vê exatamente o que será afetado e pode fazer uma cópia de segurança.',
      field('O que deseja fazer', actionSelect, HELP[state.action][1]),
      h('div', { class: 'field' }, h('span', {}, 'Alcance'), scopes),
      ...pickers(),
      h('div', { class: 'settings-actions' }, go),
      notice('Cada perfil é independente. Para limpar outro perfil, abra-o primeiro (Perfis). Se o modo de teste estiver ativo, a limpeza afeta apenas os dados de teste.'));
  }

  const wizardSlot = h('div');
  function draw() { clear(wizardSlot, wizard()); }
  clear(panel, backupSection(status), wizardSlot, out,
    card('Backups de segurança', 'Cópias criadas automaticamente antes de limpezas. Podem ser importadas em Importar backup.', backups));
  draw();
  await loadBackups().catch((error) => status(error.message));
}
