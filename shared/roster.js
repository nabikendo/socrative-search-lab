// Leitura de listas de frequência (CSV, TXT, texto extraído de PDF).
// Usado pelo painel do professor e pelos testes.

const NOT_A_STUDENT = /estudante|presen[cç]a|faltas|di[aá]rio|governo|secretaria/i;

function splitDelimited(text, delimiter) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { cells.push(cell); cell = ''; }
    else cell += ch;
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);

export function parseRosterTextDetailed(text) {
  const rows = [];
  const source = String(text);
  // O Diário de Classe SEDUC-TO informa turma no cabeçalho, enquanto as
  // linhas da tabela trazem somente número e nome. Reaproveitamos a turma
  // do cabeçalho em cada aluno para a prévia e para a lista persistida.
  const classMatch = source.match(/\bTurma\s*:\s*([^\r\n|]+)/i);
  const headerClass = clean(classMatch?.[1]?.split(/\s{2,}/)[0]?.trim());
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, '').trim();
    if (!line) continue;

    let number;
    let name;
    let className = headerClass;

    const delimited = line.match(/^(\d{1,3})\s*([;,\t])\s*(.*)$/);
    if (delimited) {
      number = delimited[1];
      const cells = splitDelimited(delimited[3], delimited[2]);
      name = cells[0];
      className = cells[1] || headerClass;
    } else {
      // Linha de PDF: "3 NOME DO ALUNO" com marcas de presença opcionais no fim.
      const plain = line.replace(/\s+/g, ' ').match(/^(\d{1,3}) (.+?)(?: [*FJ]\d*(?: \d+)*)?$/i);
      if (!plain) continue;
      number = plain[1];
      name = plain[2];
    }

    name = clean(name);
    if (!name || NOT_A_STUDENT.test(name) || /^(?:n[º°.]?\s*)?aluno$/i.test(name)) continue;
    rows.push({ number: String(Number(number)), name, className: clean(className) });
  }
  const counts = new Map();
  for (const row of rows) counts.set(row.number, (counts.get(row.number) || 0) + 1);
  return { rows: dedupeRoster(rows), duplicates: [...counts].filter(([, count]) => count > 1).map(([number, count]) => ({ number, count })) };
}

export function parseRosterText(text) { return parseRosterTextDetailed(text).rows; }

// Linhas de planilha (XLSX): [número, nome, turma?], com ou sem cabeçalho.
export function parseRosterRows(rows) {
  const out = [];
  for (const row of rows) {
    const number = String(row?.[0] ?? '').trim();
    const name = clean(row?.[1]);
    if (!/^\d{1,3}$/.test(number) || !name) continue;
    out.push({ number: String(Number(number)), name, className: clean(row?.[2]) });
  }
  return dedupeRoster(out);
}

export function dedupeRoster(rows) {
  return [...new Map(rows.map((row) => [row.number, row])).values()];
}

