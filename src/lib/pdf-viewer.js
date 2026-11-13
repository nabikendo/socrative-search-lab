// Leitor de PDF próprio: desenha as páginas em canvas, então funciona em celulares e Chromebooks
// que não mostram PDF dentro de <iframe>. As páginas são desenhadas só quando aparecem na tela.
import * as pdfjs from 'pdfjs-dist';
import { h } from './dom.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();

export async function mountPdf(container, url) {
  container.replaceChildren(h('p', { class: 'caption', style: 'text-align:center;padding:24px' }, 'Carregando documento…'));
  const pdf = await pdfjs.getDocument({ url, withCredentials: true }).promise;
  const holder = h('div', { class: 'pdf-pages' });
  container.replaceChildren(holder);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pages = [];
  let zoom = 1;

  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const canvas = h('canvas', { class: 'pdf-page', role: 'img', 'aria-label': `Página ${n} de ${pdf.numPages}` });
    canvas.style.aspectRatio = `${base.width} / ${base.height}`;
    holder.append(canvas);
    pages.push({ page, canvas, base, drawn: 0 });
  }

  async function draw(entry) {
    const width = entry.canvas.clientWidth;
    if (!width || entry.drawn === zoom) return;
    entry.drawn = zoom;
    const viewport = entry.page.getViewport({ scale: (width / entry.base.width) * dpr });
    entry.canvas.width = Math.floor(viewport.width);
    entry.canvas.height = Math.floor(viewport.height);
    await entry.page.render({ canvasContext: entry.canvas.getContext('2d'), canvas: entry.canvas, viewport }).promise.catch(() => { entry.drawn = 0; });
  }

  const observer = new IntersectionObserver((items) => { for (const item of items) if (item.isIntersecting) draw(pages.find((p) => p.canvas === item.target)); }, { root: container, rootMargin: '600px 0px' });
  pages.forEach((p) => observer.observe(p.canvas));

  return {
    pageCount: pdf.numPages,
    setZoom(value) {
      zoom = Math.min(3, Math.max(1, value));
      holder.style.width = `${zoom * 100}%`;
      for (const p of pages) { p.drawn = 0; observer.unobserve(p.canvas); observer.observe(p.canvas); }
      return zoom;
    },
  };
}
