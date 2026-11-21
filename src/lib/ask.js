import { h } from './dom.js';

// Substitutos de window.prompt/confirm. O Electron (app instalado) não implementa prompt(),
// e o confirm() nativo foge do visual do Atlas. Ambos resolvem como os originais:
// askText → texto digitado ou null (cancelado); askYesNo → true/false.

function open({ title, message, field, okLabel = 'OK', cancelLabel = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    const ok = h('button', { class: 'btn' + (danger ? ' danger' : ''), type: 'button' }, okLabel);
    const cancel = h('button', { class: 'btn secondary', type: 'button' }, cancelLabel);
    const lines = String(message ?? '').split('\n');
    const dialog = h('dialog', { class: 'confirm-dialog ask-dialog', 'aria-label': title || lines[0] },
      h('form', { class: 'stack-s', method: 'dialog' },
        title && h('h2', { class: 'headline' }, title),
        ...lines.map((line) => (line.trim() ? h('p', {}, line) : null)),
        field && h('label', { class: 'field' }, field),
        h('div', { class: 'row confirm-actions' }, cancel, ok)));
    let done = false;
    const finish = (value) => { if (done) return; done = true; dialog.close(); dialog.remove(); resolve(value); };
    cancel.addEventListener('click', () => finish(field ? null : false));
    ok.addEventListener('click', () => finish(field ? field.value : true));
    field?.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); finish(field.value); } });
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(field ? null : false); });
    document.body.append(dialog);
    dialog.showModal();
    (field ?? ok).focus();
    field?.select?.();
  });
}

export function askText(message, value = '', { title, okLabel = 'OK', inputMode } = {}) {
  const field = h('input', { type: 'text', value: value ?? '', autocomplete: 'off', 'aria-label': String(message).split('\n')[0], ...(inputMode ? { inputmode: inputMode } : {}) });
  return open({ title, message, field, okLabel });
}

export function askYesNo(message, { title, okLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false } = {}) {
  return open({ title, message, okLabel, cancelLabel, danger });
}
