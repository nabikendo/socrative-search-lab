import { h } from './dom.js';

// Diálogo de confirmação para ações destrutivas. Resolve { confirmed, backup }.
// phrase: se informada, o botão só habilita depois de digitá-la (exact: respeita maiúsculas/minúsculas).
export function confirmAction({ title, lead, rows = [], notes = [], phrase, exact = false, confirmLabel = 'Confirmar', danger = false, backup, backupLabel }) {
  return new Promise((resolve) => {
    const same = (value) => (exact ? value.trim() === phrase : value.trim().toUpperCase() === phrase.toUpperCase());
    const input = phrase ? h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, placeholder: phrase, 'aria-label': `Digite ${phrase} para confirmar` }) : null;
    const backupBox = backup === undefined ? null : h('input', { type: 'checkbox', checked: !!backup });
    const ok = h('button', { class: 'btn' + (danger ? ' danger' : ''), type: 'button', disabled: !!phrase }, confirmLabel);
    const cancel = h('button', { class: 'btn secondary', type: 'button' }, 'Cancelar');
    const dialog = h('dialog', { class: 'confirm-dialog', 'aria-label': title },
      h('div', { class: 'stack-s' },
        h('h2', { class: 'headline' }, title),
        lead && h('p', {}, lead),
        rows.length ? h('ul', { class: 'confirm-rows' }, rows.map((row) => h('li', {}, h('span', {}, row.label), h('strong', {}, String(row.count))))) : null,
        ...notes.map((note) => h('p', { class: 'caption' }, note)),
        backupBox && h('label', { class: 'setting-check' }, backupBox, backupLabel ?? 'Fazer uma cópia de segurança antes'),
        input && h('label', { class: 'field' }, h('span', {}, `Para confirmar, digite ${phrase}`), input),
        h('div', { class: 'row confirm-actions' }, cancel, ok)));
    const finish = (confirmed) => { dialog.close(); dialog.remove(); resolve({ confirmed, backup: backupBox ? backupBox.checked : undefined }); };
    input?.addEventListener('input', () => { ok.disabled = !same(input.value); });
    input?.addEventListener('keydown', (event) => { if (event.key === 'Enter' && same(input.value)) { event.preventDefault(); finish(true); } });
    cancel.addEventListener('click', () => finish(false));
    ok.addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(false); });
    document.body.append(dialog);
    dialog.showModal();
    (input ?? cancel).focus();
  });
}
