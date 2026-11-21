import { h, clear } from './dom.js';

// Seletor de modelo com busca. A lista tem altura fixa e rolagem própria, então funciona com centenas de itens
// (a lista nativa <datalist> não rola em alguns navegadores embutidos). Também aceita digitar um nome livre.
export function combobox({ value = '', placeholder = '', suggestions = [], label = 'Modelo', onChange } = {}) {
  let items = [];
  let active = -1;
  const input = h('input', { type: 'text', value, placeholder, autocomplete: 'off', spellcheck: false, role: 'combobox', 'aria-label': label, 'aria-expanded': 'false', 'aria-autocomplete': 'list' });
  const list = h('ul', { class: 'combo-list', role: 'listbox', hidden: true, tabindex: '-1' });
  const count = h('p', { class: 'caption combo-count', hidden: true });
  const chips = h('div', { class: 'combo-chips' });
  const root = h('div', { class: 'combo' }, input, chips, list, count);

  const set = (next) => { input.value = next; input.dispatchEvent(new Event('input', { bubbles: true })); onChange?.(next); close(); };
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
  const open = () => { draw(); list.hidden = !items.length; input.setAttribute('aria-expanded', String(!list.hidden)); };

  function draw() {
    const term = input.value.trim().toLowerCase();
    const exact = items.includes(input.value.trim());
    const shown = term && !exact ? items.filter((name) => name.toLowerCase().includes(term)) : items;
    clear(list, shown.map((name, index) => h('li', {
      role: 'option', id: `combo-${index}`, class: 'combo-option' + (name === input.value.trim() ? ' selected' : ''), 'aria-selected': String(name === input.value.trim()),
      onmousedown: (event) => { event.preventDefault(); set(name); },
    }, name)));
    count.hidden = !items.length;
    count.textContent = shown.length === items.length ? `${items.length} modelos. Digite para filtrar.` : `${shown.length} de ${items.length} modelos.`;
    if (!shown.length && items.length) list.append(h('li', { class: 'combo-empty' }, 'Nenhum modelo com esse nome. O texto digitado será usado como está.'));
    active = -1;
  }
  const move = (step) => {
    const options = [...list.querySelectorAll('.combo-option')];
    if (!options.length) return;
    active = (active + step + options.length) % options.length;
    options.forEach((node, index) => node.classList.toggle('active', index === active));
    options[active].scrollIntoView({ block: 'nearest' });
  };

  input.addEventListener('focus', open);
  input.addEventListener('click', open);
  input.addEventListener('input', () => { if (document.activeElement === input) open(); });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); if (list.hidden) open(); move(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
    else if (event.key === 'Enter' && active >= 0) { event.preventDefault(); set(list.querySelectorAll('.combo-option')[active].textContent); }
    else if (event.key === 'Escape') close();
  });

  function drawChips() {
    const available = items.length ? suggestions.filter((name) => items.includes(name)) : suggestions;
    clear(chips, available.length ? [h('span', { class: 'caption' }, 'Sugestões:'), ...available.map((name) => h('button', { type: 'button', class: 'chip', onclick: () => set(name) }, name))] : []);
  }
  drawChips();

  return {
    el: root, input,
    get value() { return input.value.trim(); },
    // Ao chegar a lista (ex.: depois de carregar os modelos), abre se o campo ainda estiver em foco.
    setItems(names) { items = [...names]; drawChips(); if (document.activeElement === input) open(); else if (!list.hidden) draw(); },
  };
}
