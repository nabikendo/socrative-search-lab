const KEY = 'atlas.theme';

export function applySavedTheme() {
  const theme = localStorage.getItem(KEY);
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else document.documentElement.removeAttribute('data-theme');
}

export function toggleTheme() {
  const current = document.documentElement.dataset.theme
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const saved = localStorage.getItem(KEY) || 'auto';
  const next = saved === 'auto' ? 'light' : saved === 'light' ? 'dark' : 'auto';
  if (next === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = next;
  localStorage.setItem(KEY, next);
  for (const control of document.querySelectorAll('[data-theme-toggle]')) {
    control.textContent = `Tema: ${next === 'auto' ? 'Automático' : next === 'dark' ? 'Escuro' : 'Claro'}`;
    control.setAttribute('aria-label', `Tema atual: ${next === 'auto' ? 'automático' : next}`);
  }
  return next;
}

export function initializeThemeButton() {
  applySavedTheme();
  const buttons = [...document.querySelectorAll('[data-theme-toggle]')];
  if (!buttons.length) return;
  const current = localStorage.getItem(KEY) || 'auto';
  for (const button of buttons) {
    button.textContent = `Tema: ${current === 'auto' ? 'Automático' : current === 'dark' ? 'Escuro' : 'Claro'}`;
    button.setAttribute('aria-label', `Tema atual: ${current === 'auto' ? 'automático' : current}`);
    button.title = 'Clique para alternar entre automático, claro e escuro';
    button.addEventListener('click', toggleTheme);
  }
}
