import globals from 'globals';

// Só procura variáveis não definidas (como o `current is not defined` que deixou a aba Turma vazia).
const extra = { URLPattern: 'readonly', Temporal: 'readonly' };
const rules = { 'no-undef': 'error' };
const language = (kind) => ({ ecmaVersion: 'latest', sourceType: 'module', globals: { ...kind, ...extra } });

export default [
  { ignores: ['dist/**', 'release/**', 'release-desktop/**', 'node_modules/**', 'android/**'] },
  { files: ['src/**/*.js'], languageOptions: language(globals.browser), rules },
  { files: ['shared/**/*.js'], languageOptions: language({ ...globals.browser, ...globals.node }), rules },
  { files: ['server.mjs', 'lib/**/*.mjs', 'desktop/**/*.mjs', 'scripts/**/*.mjs', 'vite.config.js', 'test/**/*.js'], languageOptions: language(globals.node), rules },
];
