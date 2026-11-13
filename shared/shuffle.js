// Embaralhamento determinístico: o mesmo aluno vê sempre a mesma ordem, mesmo ao recarregar a página.
function hash(text) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) { h = Math.imul(h ^ text.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; };
}

export function seededShuffle(list, seed) {
  const next = hash(String(seed));
  let a = next();
  const random = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

// Questões e alternativas na ordem própria de cada aluno (a resposta continua sendo o texto da alternativa).
export function orderForStudent(questions, seed) {
  return seededShuffle(questions, `${seed}:q`).map((q) => (q.type === 'choice' ? { ...q, options: seededShuffle(q.options, `${seed}:${q.id}`) } : q));
}
