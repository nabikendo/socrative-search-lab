import { api } from '../lib/api.js';
import { h, clear, toast } from '../lib/dom.js';
import { confirmAction } from '../lib/confirm.js';
import { card, field, button, badge, notice } from './settings-kit.js';

// Perfis de professores: cada perfil tem turmas, alunos, avaliações, resultados, preferências e IA próprios.
export async function render(panel, { status }) {
  let data;
  try { data = await api('/api/desktop/profiles'); }
  catch (error) {
    clear(panel, card('Perfis', 'Cada perfil de professor mantém turmas, alunos, avaliações e resultados separados.',
      notice(error.status === 404 || error.status === 403
        ? 'Os perfis estão disponíveis no aplicativo Atlas para computador. Para separar dados na versão com janela preta, use outra pasta de dados (variável ATLAS_DATA_DIR).'
        : error.message, 'warn')));
    return;
  }
  const refresh = (next) => { data = next; draw(); };

  async function create(form) {
    const name = form.elements.name.value; const pin = form.elements.pin.value;
    refresh(await api('/api/desktop/profiles', { method: 'POST', body: { name, pin } }));
    toast('Perfil criado.');
  }

  function editDialog(profile) {
    const isActive = profile.id === data.active;
    const name = h('input', { type: 'text', value: profile.name, maxLength: 70, required: true });
    const pin = h('input', { type: 'password', inputMode: 'numeric', pattern: '\\d{6}', maxLength: 6, autocomplete: 'new-password', placeholder: isActive ? 'Troque de perfil para alterar o PIN' : 'Deixe em branco para manter', disabled: isActive });
    const error = h('p', { class: 'error', role: 'alert' });
    const dialog = h('dialog', { class: 'confirm-dialog', 'aria-label': 'Editar perfil' },
      h('form', { class: 'stack-s', onsubmit: async (event) => {
        event.preventDefault(); error.textContent = '';
        try {
          const body = { name: name.value };
          if (pin.value) body.pin = pin.value;
          refresh(await api(`/api/desktop/profiles/${profile.id}`, { method: 'PUT', body }));
          dialog.close(); toast('Perfil atualizado.');
        } catch (failure) { error.textContent = failure.message; }
      } },
      h('h2', { class: 'headline' }, 'Editar perfil'),
      field('Nome do perfil', name),
      field('Novo PIN de seis dígitos', pin, 'O PIN é pedido ao entrar neste perfil.'),
      error,
      h('div', { class: 'row confirm-actions' }, h('button', { class: 'btn secondary', type: 'button', onclick: () => dialog.close() }, 'Cancelar'), h('button', { class: 'btn', type: 'submit' }, 'Salvar'))));
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog); dialog.showModal(); name.focus(); name.select();
  }

  async function open(profile) {
    const { confirmed } = await confirmAction({
      title: `Abrir o perfil ${profile.name}?`, lead: 'O Atlas salva o trabalho, fecha e reabre neste perfil. Será pedido o PIN dele.', confirmLabel: 'Trocar de perfil',
    });
    if (!confirmed) return;
    await api('/api/desktop/profiles/switch', { method: 'POST', body: { id: profile.id } });
    clear(panel, card('Trocando de perfil…', 'O Atlas vai reabrir em instantes.'));
  }

  async function remove(profile) {
    const { confirmed, backup } = await confirmAction({
      title: `Excluir o perfil ${profile.name}?`,
      lead: 'Todas as turmas, alunos, avaliações, resultados, preferências e chaves de IA deste perfil serão apagados. Outros perfis não são afetados.',
      phrase: profile.name, exact: true, danger: true, confirmLabel: 'Excluir perfil',
      backup: true, backupLabel: 'Salvar uma cópia (.atlas) em Documentos › Atlas › PerfisExcluidos antes de excluir',
    });
    if (!confirmed) return;
    const result = await api(`/api/desktop/profiles/${profile.id}`, { method: 'DELETE', body: { confirm: profile.name, backup } });
    refresh(result);
    toast(result.backupFile ? 'Perfil excluído. Cópia salva em Documentos › Atlas › PerfisExcluidos.' : 'Perfil excluído.');
  }

  function row(profile) {
    const active = profile.id === data.active;
    return h('div', { class: 'list-row profile-row' },
      h('div', { class: 'grow' }, h('strong', {}, profile.name), ' ', active ? badge('Em uso', 'ok') : null, profile.main ? badge('Principal') : null),
      h('div', { class: 'settings-actions' },
        !active && button('Abrir', () => open(profile), { kind: 'quiet', status }),
        !profile.main && button('Editar', () => editDialog(profile), { kind: 'quiet', status }),
        !profile.main && !active && button('Excluir', () => remove(profile), { kind: 'quiet', status })));
  }

  function draw() {
    const form = h('form', { class: 'row profile-new', onsubmit: async (event) => {
      event.preventDefault();
      try { await create(form); form.reset(); } catch (error) { status(error.message); }
    } },
    field('Nome', h('input', { name: 'name', type: 'text', maxLength: 70, required: true, placeholder: 'Ex.: Prof. Marina — Matemática' })),
    field('PIN (6 dígitos)', h('input', { name: 'pin', type: 'password', inputMode: 'numeric', pattern: '\\d{6}', maxLength: 6, required: true, autocomplete: 'new-password' })),
    h('button', { class: 'btn', type: 'submit' }, 'Criar perfil'));
    clear(panel,
      card('Perfis de professores', 'Cada perfil tem turmas, alunos, avaliações, resultados, preferências e IA próprios. Nada é compartilhado entre perfis.',
        h('div', { class: 'list' }, data.profiles.map(row))),
      card('Novo perfil', 'Use um PIN diferente para cada perfil.', form),
      notice('Para limpar ou redefinir os dados de outro perfil, abra-o primeiro e use Dados e limpeza. Não é possível trocar de perfil com uma prova aberta.'));
  }
  draw();
}
