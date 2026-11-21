// Junta os trechos de uma mesma linha do PDF. Em provas de duas colunas, o texto da esquerda e o da direita
// ficam na mesma altura; um espaço horizontal grande entre eles indica outra coluna, então vira quebra de linha.
// Assim "E) opção" da coluna da direita não fica grudada no enunciado da coluna da esquerda.
export const COLUMN_GAP = 14; // em unidades de PDF (pontos); espaço entre palavras costuma ser menor que 6

export function joinLineItems(items) {
  const sorted = [...items].sort((a, b) => a.transform[4] - b.transform[4]);
  let out = '';
  let previousEnd = null;
  for (const item of sorted) {
    const x = item.transform[4];
    if (previousEnd !== null && x - previousEnd > COLUMN_GAP) out += '\n';
    else if (out) out += ' ';
    out += item.str;
    previousEnd = x + (Number(item.width) || 0);
  }
  return out;
}
