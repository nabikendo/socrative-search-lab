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

export function parseRosterText(text) {
  const rows = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, '').trim();
    if (!line) continue;

    let number;
    let name;
    let className = '';

    const delimited = line.match(/^(\d{1,3})\s*([;,\t])\s*(.*)$/);
    if (delimited) {
      number = delimited[1];
      const cells = splitDelimited(delimited[3], delimited[2]);
      name = cells[0];
      className = cells[1] || '';
    } else {
      // Linha de PDF: "3 NOME DO ALUNO" com marcas de presença opcionais no fim.
      const plain = line.replace(/\s+/g, ' ').match(/^(\d{1,3}) (.+?)(?: [*FJ]\d*(?: \d+)*)?$/i);
      if (!plain) continue;
      number = plain[1];
      name = plain[2];
    }

    name = clean(name);
    if (!name || NOT_A_STUDENT.test(name)) continue;
    rows.push({ number: String(Number(number)), name, className: clean(className) });
  }
  return dedupeRoster(rows);
}

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
