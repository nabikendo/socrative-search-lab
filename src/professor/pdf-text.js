import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

// Reconstrói as linhas do PDF agrupando os trechos pela posição vertical.
export async function extractPdfText(file, { recognizePage } = {}) {
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  try {
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const lines = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = Math.round(item.transform[5]);
      let line = lines.find((l) => Math.abs(l.y - y) < 3);
      if (!line) { line = { y, items: [] }; lines.push(line); }
      line.items.push(item);
    }
    const text = lines.sort((a, b) => b.y - a.y).map((l) => l.items.sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join(' ')).join('\n');
    pages.push(recognizePage && text.replace(/[^\p{L}\p{N}]/gu, '').length < 30
      ? await recognizePage(await renderPage(page), n, pdf.numPages)
      : text);
  }
  return pages.join('\n');
  } finally {
    await pdf.destroy();
  }
}

async function renderPage(page) {
  const original = page.getViewport({ scale: 1 });
  const scale = Math.min(3, 2600 / Math.max(original.width, original.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error('Não consegui preparar a imagem da página para OCR.'));
  }, 'image/png'));
}

