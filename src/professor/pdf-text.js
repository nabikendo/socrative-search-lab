import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

// Reconstrói as linhas do PDF agrupando os trechos pela posição vertical.
export async function extractPdfText(file) {
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    const lines = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = Math.round(item.transform[5]);
      let line = lines.find((l) => Math.abs(l.y - y) < 3);
      if (!line) { line = { y, items: [] }; lines.push(line); }
      line.items.push(item);
    }
    pages.push(lines.sort((a, b) => b.y - a.y).map((l) => l.items.sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join(' ')).join('\n'));
  }
  return pages.join('\n');
}

