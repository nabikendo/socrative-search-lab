import { api } from '../lib/api.js';
import { h } from '../lib/dom.js';

// Boas-vindas com dicas. Aparece na primeira vez de cada perfil e pode ser revista em Ajuda.
const icon = (path) => { const wrap = h('span', { class: 'welcome-icon', 'aria-hidden': 'true' }); wrap.innerHTML = `<svg viewBox="0 0 24 24">${path}</svg>`; return wrap; };

const SLIDES = [
  { tab: 'turma', title: 'Comece pela sua turma', text: 'Na aba Turma, importe a lista de alunos de uma planilha ou cole os nomes. Cada aluno entra na prova só com o número de chamada.',
    icon: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.7.8 2.7 2.5 3 5.2"/>' },
  { tab: 'prova', title: 'Monte a prova do seu jeito', text: 'Digite as questões, anexe o PDF da prova ou reaproveite questões do Banco. Você também pode criar questões pelos descritores do Saeb.',
    icon: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M9 8h6M9 12h6M9 16h3.5"/>' },
  { tab: 'prova', title: 'Abra para os alunos', text: 'Clique em “Abrir para os alunos”. Eles escaneiam o QR Code ou digitam o endereço no celular, conectados à mesma rede (o hotspot do seu celular funciona).',
    icon: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M20 20h.01M17 17v3"/>' },
  { tab: 'inicio', title: 'Acompanhe ao vivo', text: 'No Início e em Resultados você vê quem entrou, quem ainda não, quem pediu ajuda e o andamento de cada aluno. Se um aluno trocar de aparelho, use “Liberar dispositivo”.',
    icon: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>' },
  { tab: 'configuracoes', section: 'ai', title: 'Crie questões com IA', text: 'Em Configurações › Inteligência artificial, cole a chave de um provedor (Gemini, ChatGPT, Claude…) para criar e analisar questões na aba Descritores. É opcional.',
    icon: '<path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3z"/><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z"/>' },
  { title: 'Dicas rápidas', text: 'Aperte “/” para buscar alunos e provas. Antes de provas importantes, faça um backup em Configurações › Dados. Quer treinar sem risco? Ative o Modo de teste em Configurações.',
    icon: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>' },
];

let open = false;
export async function showWelcome({ goto, selectSection } = {}) {
  if (open) return;
  open = true;
  let index = 0;
  const done = async () => {
    dialog.close(); dialog.remove(); open = false;
    try { await api('/api/teacher-settings', { method: 'PUT', body: { welcomeSeen: true } }); } catch { /* sem o registro, a tela só aparece de novo */ }
  };
  const body = h('div', { class: 'stack welcome-body', 'aria-live': 'polite' });
  const dots = h('div', { class: 'welcome-dots', 'aria-hidden': 'true' }, SLIDES.map(() => h('span')));
  const back = h('button', { class: 'btn secondary', type: 'button' }, 'Voltar');
  const next = h('button', { class: 'btn', type: 'button' }, 'Próxima');
  const skip = h('button', { class: 'btn quiet', type: 'button' }, 'Pular');
  const go = h('button', { class: 'btn secondary welcome-go', type: 'button' });

  function draw() {
    const slide = SLIDES[index];
    body.replaceChildren(icon(slide.icon), h('h2', { class: 'headline', id: 'welcome-title' }, slide.title), h('p', { class: 'lead' }, slide.text));
    [...dots.children].forEach((dot, i) => dot.classList.toggle('on', i === index));
    back.hidden = index === 0;
    next.textContent = index === SLIDES.length - 1 ? 'Começar' : 'Próxima';
    skip.hidden = index === SLIDES.length - 1;
    go.hidden = !slide.tab || index === SLIDES.length - 1;
    go.textContent = slide.tab === 'turma' ? 'Ir para Turma' : slide.tab === 'prova' ? 'Ir para Prova' : slide.tab === 'inicio' ? 'Ir para Início' : 'Abrir configuração';
  }
  back.addEventListener('click', () => { index = Math.max(0, index - 1); draw(); });
  next.addEventListener('click', () => { if (index === SLIDES.length - 1) done(); else { index += 1; draw(); } });
  skip.addEventListener('click', done);
  go.addEventListener('click', async () => { const slide = SLIDES[index]; await done(); if (slide.section) selectSection?.(slide.section); goto?.(slide.tab); });

  const dialog = h('dialog', { class: 'welcome-dialog', 'aria-labelledby': 'welcome-title' },
    h('div', { class: 'welcome-brand' }, h('span', { class: 'atlas-brand-icon', 'aria-hidden': 'true' }, '◇'), h('strong', {}, 'Bem-vindo ao Atlas')),
    body, dots, h('div', { class: 'row welcome-actions' }, skip, go, h('span', { class: 'grow' }), back, next));
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); done(); });
  document.body.append(dialog);
  draw();
  dialog.showModal();
  next.focus();
}

export async function maybeWelcome(options) {
  try { if (!(await api('/api/teacher-settings')).welcomeSeen) await showWelcome(options); } catch { /* sem boas-vindas, o painel segue normal */ }
}
