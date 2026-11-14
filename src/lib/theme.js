const KEY = 'atlas.theme';

export function applySavedTheme() {
  const theme = localStorage.getItem(KEY);
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
}

export function toggleTheme() {
  const current = document.documentElement.dataset.theme
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem(KEY, next);
  for (const control of document.querySelectorAll('[data-theme-toggle]')) {
    control.textContent = next === 'dark' ? '☀ Claro' : '☾ Escuro';
    control.setAttribute('aria-label', `Ativar modo ${next === 'dark' ? 'claro' : 'escuro'}`);
  }
  return next;
}

export function initializeThemeButton() {
  applySavedTheme();
  const buttons = [...document.querySelectorAll('[data-theme-toggle]')];
  if (!buttons.length) return;
  const current = document.documentElement.dataset.theme
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  for (const button of buttons) {
    button.textContent = current === 'dark' ? '☀ Claro' : '☾ Escuro';
    button.setAttribute('aria-label', `Ativar modo ${current === 'dark' ? 'claro' : 'escuro'}`);
    button.addEventListener('click', () => toggleTheme(button));
  }
}
