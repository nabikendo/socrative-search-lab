import { api } from '../lib/api.js';
import { h, clear, toast, plural } from '../lib/dom.js';

let root;
let timer;
let diagBox;

export function mount(el) { root = el; }
export async function activate() {
  render();
  await refreshDiagnostics();
  timer = setInterval(refreshDiagnostics, 3000);
}
export function deactivate() { clearInterval(timer); }

const SAMPLE = [
  { type: 'choice', text: 'Qual partícula subatômica possui carga negativa?', options: ['Próton', 'Elétron', 'Nêutron'], correct: 'Elétron', weight: 2 },
  { type: 'choice', text: 'A ligação entre Na e Cl é classificada como:', options: ['Covalente', 'Metálica', 'Iônica'], correct: 'Iônica', weight: 2 },
  { type: 'choice', text: 'Qual é o número atômico do carbono?', options: ['4', '6', '8', '12'], correct: '6', weight: 2 },
  { type: 'text', text: 'Explique com suas palavras por que o NaCl conduz corrente elétrica dissolvido em água.', weight: 4 },
];

const guard = (fn) => async (event) => { try { await fn(event); } catch (error) { toast(error.message || 'Algo deu errado.'); } };
const goto = (tab) => window.dispatchEvent(new CustomEvent('atlas:goto', { detail: tab }));

function render() {
  clear(root, h('div', { class: 'stack' },
    h('h1', { class: 'title' }, 'Ajuda'),

    h('div', { class: 'card stack-s' },
      h('h2', { class: 'headline' }, 'Primeiros passos'),
      h('ol', { class: 'howto' },
        h('li', {}, h('strong', {}, 'Importe a lista de alunos'), ' na aba ', h('a', { href: '#turma', onclick: (e) => { e.preventDefault(); goto('turma'); } }, 'Turma'), '. PDF do diário, planilha ou texto.'),
        h('li', {}, h('strong', {}, 'Crie a prova'), ' na aba ', h('a', { href: '#prova', onclick: (e) => { e.preventDefault(); goto('prova'); } }, 'Prova'), ': escreva as questões e marque a resposta certa para correção automática.'),
        h('li', {}, h('strong', {}, 'Abra para os alunos'), ' e mostre o código e o QR Code na tela. Os alunos precisam estar no mesmo Wi‑Fi.'),
        h('li', {}, h('strong', {}, 'Acompanhe'), ' em ', h('a', { href: '#resultados', onclick: (e) => { e.preventDefault(); goto('resultados'); } }, 'Resultados'), ' e dê nota às questões abertas.'),
        h('li', {}, h('strong', {}, 'Encerre'), ' a prova na aba Prova e baixe a planilha, se quiser.')),
      h('div', { class: 'row' },
        h('button', { class: 'btn secondary', onclick: guard(createSample) }, 'Criar prova de exemplo'),
        h('button', { class: 'btn quiet', onclick: guard(createTestStudents) }, 'Criar alunos de teste'))),

    h('div', { class: 'card stack-s' },
      h('div', { class: 'row between' }, h('h2', { class: 'headline' }, 'Testar a conexão'), h('button', { class: 'btn secondary', onclick: guard(refreshDiagnostics) }, 'Testar de novo')),
      h('p', { class: 'sub' }, 'Confira se os alunos conseguem entrar. A lista atualiza sozinha: peça a um aluno para abrir o endereço e veja o aparelho aparecer aqui.'),
      (diagBox = h('div', { class: 'checks' }, h('p', { class: 'caption' }, 'Verificando…')))),

    h('div', { class: 'card stack-s' },
      h('h2', { class: 'headline' }, 'Backup e restauração'),
      h('p', { class: 'sub' }, 'O backup é um único arquivo com a turma, as provas, as respostas e os anexos. Guarde em um pendrive ou na nuvem. O Atlas também faz cópias automáticas na pasta data/backups.'),
      h('div', { class: 'row' },
        h('a', { class: 'btn secondary', href: '/api/backup', download: '' }, 'Baixar backup agora'),
        h('input', { type: 'file', id: 'restore-file', accept: '.atlas,application/json', hidden: true, onchange: guard(restore) }),
        h('label', { class: 'btn quiet', for: 'restore-file' }, 'Restaurar de um backup…')),
      h('p', { class: 'caption' }, 'Restaurar substitui tudo o que está no Atlas agora. Uma cópia do estado atual fica guardada em data/backups antes da troca.')),

    h('div', { class: 'card stack-s' },
      h('h2', { class: 'headline' }, 'Dúvidas frequentes'),
      faq('Os alunos não conseguem abrir a página', 'Use “Testar a conexão” acima. Confira se o computador e os aparelhos estão no mesmo Wi‑Fi e se os alunos usam o endereço com números (192.168…), nunca “localhost”. No Windows, permita o Atlas no Firewall para Redes privadas.'),
      faq('Esqueci o PIN', 'Abra o arquivo data/pin.txt dentro da pasta do Atlas. O PIN também aparece na janela preta ao iniciar.'),
      faq('Um aluno enviou sem querer', 'Em Resultados, abra o aluno e clique em “Reabrir para o aluno”.'),
      faq('Quero mudar uma prova que já tem respostas', 'As questões ficam travadas. Use “Duplicar” na aba Prova e altere a cópia.'),
      faq('O PDF não aparece direito no celular do aluno', 'O Atlas desenha o PDF dentro da prova, então deve aparecer. Se uma página falhar, o aluno pode tocar em “Abrir em outra aba”. Um DOCX também funciona.'))));
}

const faq = (title, text) => h('details', { class: 'faq' }, h('summary', {}, title), h('p', { class: 'sub' }, text));

async function createSample() {
  const { exam } = await api('/api/exams', { method: 'POST', body: { title: 'Exemplo — ligações químicas', questions: SAMPLE } });
  toast('Prova de exemplo criada');
  goto('prova');
  return exam;
}
async function createTestStudents() {
  const { roster } = await api('/api/roster');
  if (roster.length) { toast('Você já tem uma lista de alunos. Nada foi alterado.'); return; }
  await api('/api/roster', { method: 'POST', body: { roster: [1, 2, 3].map((n) => ({ number: String(n), name: `Aluno de teste ${n}`, className: 'Teste' })) } });
  toast('Criei 3 alunos de teste (números 1, 2 e 3)');
}
async function restore(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  if (!confirm('Restaurar este backup vai SUBSTITUIR tudo o que está no Atlas agora (turma, provas e respostas).\n\nUma cópia do estado atual será guardada antes. Continuar?')) return;
  const result = await api('/api/restore', { method: 'POST', raw: file });
  toast(`Backup restaurado: ${plural(result.exams, 'prova', 'provas')} e ${plural(result.students, 'aluno', 'alunos')}`);
  setTimeout(() => location.reload(), 1200);
}

// ---------- diagnóstico de rede
const row = (state, title, text) => h('div', { class: `check ${state}` }, h('span', { class: 'check-dot', 'aria-hidden': 'true' }), h('div', {}, h('div', { class: 'check-title' }, title), text && h('div', { class: 'caption' }, text)));

function checks(d) {
  const out = [row('ok', 'O Atlas está funcionando', 'Este computador está respondendo.')];
  const reachable = d.urls.filter((u) => u.reachable);
  if (!d.urls.length) {
    out.push(row('bad', 'Este computador não está conectado a uma rede', 'Conecte-o ao Wi‑Fi da sala (ou ligue o roteador) e teste de novo.'));
  } else if (!reachable.length) {
    out.push(row('warn', 'O endereço da rede não respondeu', `${d.urls.map((u) => `${u.url}/prova`).join(' · ')}. Pode ser um bloqueio do Firewall ou do antivírus deste computador.`));
  } else {
    out.push(row('ok', 'Endereço para os alunos', reachable.map((u) => `${u.url}/prova`).join(' · ') + (reachable.length > 1 ? '. Se um não funcionar, tente o outro.' : '')));
  }
  const bad = d.interfaces.filter((i) => i.virtual || i.linkLocal);
  if (bad.length && d.interfaces.length > bad.length) out.push(row('warn', 'Há redes virtuais neste computador', `Ignore endereços de ${bad.map((i) => i.name).join(', ')}. Use o que começa com 192.168 ou 10.`));
  out.push(d.examOpen ? row('ok', 'Há uma prova aberta') : row('warn', 'Nenhuma prova está aberta', 'Os alunos verão “Aguarde”. Abra a prova na aba Prova.'));
  out.push(d.students ? row('ok', plural(d.students, 'aluno na lista', 'alunos na lista')) : row('warn', 'A lista de alunos está vazia', 'Importe a turma na aba Turma (ou crie alunos de teste acima).'));
  const first = reachable[0]?.url || d.urls[0]?.url;
  if (d.devices.length) out.push(row('ok', `${plural(d.devices.length, 'aparelho de aluno conectado', 'aparelhos de alunos conectados')}`, 'Viram a página nos últimos 60 segundos. Está tudo certo.'));
  else out.push(row('warn', 'Nenhum aparelho de aluno conectou ainda', `Peça a um aluno para abrir ${first ? `${first}/prova` : 'o endereço acima'} (ou ler o QR Code). Se o endereço respondeu aqui mas o aluno não consegue, quase sempre é o Firewall do computador ou um Wi‑Fi diferente.`));
  return out;
}

async function refreshDiagnostics() {
  if (!diagBox || root.hidden) return;
  try { clear(diagBox, ...checks(await api('/api/diagnostics'))); }
  catch { clear(diagBox, row('bad', 'Não consegui falar com o Atlas', 'Verifique se a janela preta do Atlas continua aberta.')); }
}
