import { api } from '../lib/api.js';
import { h, clear, toast } from '../lib/dom.js';
import { confirmAction } from '../lib/confirm.js';
import { card, button, badge, notice } from './settings-kit.js';

// Modo de teste: dados fictícios num banco separado. Os dados reais não são lidos nem alterados enquanto ele está ativo.
export async function render(panel, { status }) {
  let state;
  try { state = await api('/api/test-mode'); }
  catch (error) { clear(panel, notice(error.message, 'danger')); return; }

  const send = async (action) => { state = await api('/api/test-mode', { method: 'POST', body: { action } }); return state; };
  const reloadSoon = (message) => { toast(message); setTimeout(() => location.reload(), 700); };

  async function enable() { await send('enable'); reloadSoon('Modo de teste ativado.'); }
  async function reseed() {
    const { confirmed } = await confirmAction({ title: 'Recriar os dados de teste?', lead: 'Tudo o que você criou ou alterou no modo de teste será descartado e os dados fictícios voltam ao início. Seus dados reais não são afetados.', confirmLabel: 'Recriar' });
    if (!confirmed) return;
    await send('reseed'); reloadSoon('Dados de teste recriados.');
  }
  async function exit() { await send('exit'); reloadSoon('Voltando aos seus dados reais.'); }
  async function purge() {
    const wasActive = state.active;
    const { confirmed } = await confirmAction({ title: 'Apagar os dados de teste?', lead: wasActive ? 'Os dados fictícios serão apagados e você volta aos seus dados reais.' : 'Os dados fictícios guardados serão apagados.', confirmLabel: 'Apagar dados de teste', danger: true });
    if (!confirmed) return;
    await send('purge');
    if (wasActive) reloadSoon('Dados de teste apagados.');
    else { toast('Dados de teste apagados.'); await render(panel, { status }); }
  }

  const counts = state.counts && h('ul', { class: 'confirm-rows' },
    [['Turmas', state.counts.classes], ['Provas', state.counts.exams], ['Participações', state.counts.sessions], ['Questões no banco', state.counts.bank]]
      .map(([label, count]) => h('li', {}, h('span', {}, label), h('strong', {}, String(count)))));

  clear(panel,
    card('Modo de teste', 'Experimente o Atlas com turma, provas e resultados fictícios, sem risco para os dados reais.',
      h('div', { class: 'row' }, state.active ? badge('Ativo', 'warn') : badge('Desativado'), state.exists && !state.active ? badge('Há dados de teste guardados') : null),
      notice('Os dados de teste ficam num banco separado. Enquanto o modo estiver ativo você só vê dados fictícios, e backup, restauração e cópias automáticas ficam bloqueados para não misturar com os reais.'),
      counts,
      h('div', { class: 'settings-actions' },
        !state.active && button(state.exists ? 'Retomar modo de teste' : 'Ativar modo de teste', enable, { kind: '', status }),
        state.active && button('Recriar dados fictícios', reseed, { status }),
        state.active && button('Sair do modo de teste', exit, { kind: '', status }),
        (state.active || state.exists) && button('Apagar dados de teste', purge, { kind: 'danger', status }))),
    notice('Não é possível ativar o modo de teste com uma prova real aberta ou agendada: os alunos perderiam o acesso.'));
}
