import { h } from '../lib/dom.js';

// Peças comuns das seções de Configurações (mantém o visual e o comportamento iguais entre elas).
export const card = (title, lead, ...children) => h('section', { class: 'card stack-s settings-card' },
  title && h('h2', { class: 'headline' }, title), lead && h('p', { class: 'caption' }, lead), ...children);

export const field = (label, control, hint) => h('label', { class: 'field' }, h('span', {}, label), control, hint && h('span', { class: 'caption' }, hint));

// Executa uma ação assíncrona desabilitando o botão e mostrando erros no status da tela.
export function button(label, handler, { kind = 'secondary', status } = {}) {
  const el = h('button', { class: 'btn ' + kind, type: 'button' }, label);
  el.addEventListener('click', async () => {
    if (el.disabled) return;
    el.disabled = true;
    try { await handler(el); } catch (error) { status?.(error.message); }
    finally { el.disabled = false; }
  });
  return el;
}

export const badge = (text, tone = '') => h('span', { class: 'badge' + (tone ? ' ' + tone : '') }, text);
export const notice = (text, tone = '') => h('p', { class: 'notice' + (tone ? ' ' + tone : ''), role: tone ? 'alert' : undefined }, text);
