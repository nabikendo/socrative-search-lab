const KEY = 'atlas.theme';
const FONT = 'atlas.fontsize';
const CONTRAST = 'atlas.highcontrast';
const COMPACT = 'atlas.compact';
const PRESENT = 'atlas.presentation';
const themes = ['auto', 'light', 'dark'];
const sizes = ['small', 'medium', 'large'];
const read = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, value); } catch { /* storage may be disabled */ } };
export function getAppearance() {
  const theme = read(KEY, 'auto');
  const fontSize = read(FONT, 'medium');
  return { theme: themes.includes(theme) ? theme : 'auto', fontSize: sizes.includes(fontSize) ? fontSize : 'medium',
    highContrast: read(CONTRAST, 'false') === 'true', compact: read(COMPACT, 'false') === 'true',
    presentation: read(PRESENT, 'false') === 'true' };
}
export function applySavedTheme() {
  const settings = getAppearance();
  const root = document.documentElement;
  if (settings.theme === 'auto') root.removeAttribute('data-theme');
  else root.dataset.theme = settings.theme;
  root.dataset.fontSize = settings.fontSize;
  root.toggleAttribute('data-high-contrast', settings.highContrast);
  root.toggleAttribute('data-compact', settings.compact);
  root.toggleAttribute('data-presentation', settings.presentation);
  for (const control of document.querySelectorAll('[data-theme-toggle]')) {
    control.textContent = 'Tema: ' + ({ auto: 'Automático', light: 'Claro', dark: 'Escuro' }[settings.theme]);
    control.setAttribute('aria-label', 'Tema atual: ' + settings.theme);
  }
  window.dispatchEvent(new CustomEvent('atlas:appearance-changed', { detail: settings }));
  return settings;
}
export function setAppearance(partial) {
  if (partial.theme !== undefined && themes.includes(partial.theme)) save(KEY, partial.theme);
  if (partial.fontSize !== undefined && sizes.includes(partial.fontSize)) save(FONT, partial.fontSize);
  for (const [field, key] of [['highContrast', CONTRAST], ['compact', COMPACT], ['presentation', PRESENT]]) {
    if (typeof partial[field] === 'boolean') save(key, String(partial[field]));
  }
  return applySavedTheme();
}
export function toggleTheme() {
  const current = getAppearance().theme;
  return setAppearance({ theme: themes[(themes.indexOf(current) + 1) % themes.length] }).theme;
}
export function initializeThemeButton() {
  applySavedTheme();
  for (const button of document.querySelectorAll('[data-theme-toggle]')) button.addEventListener('click', toggleTheme);
}
