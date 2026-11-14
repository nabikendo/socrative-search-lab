// Etapas e faixas de descritores extraídas da Matriz de Referência de Matemática do SAEB (INEP).
export const SAEB_LEVELS = [
  { id: 'SAEB5', label: '5º ano do Ensino Fundamental', max: 28 },
  { id: 'SAEB9', label: '9º ano do Ensino Fundamental', max: 37 },
  { id: 'SAEB3', label: '3ª série do Ensino Médio', max: 35 },
];

export const SAEB_SKILLS = SAEB_LEVELS.flatMap((level) => Array.from({ length: level.max }, (_, i) => ({
  id: `${level.id}-D${i + 1}`, label: `${level.label} · D${i + 1}`,
})));

export function skillLabel(id) {
  const known = SAEB_SKILLS.find((item) => item.id === id);
  if (known) return known.label;
  return /^D\d{1,2}$/.test(String(id || '')) ? `D${String(id).slice(1)} · etapa não informada` : '';
}

