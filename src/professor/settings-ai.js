import { api } from '../lib/api.js';
import { h, clear, toast } from '../lib/dom.js';
import { confirmAction } from '../lib/confirm.js';
import { card, field, button, badge, notice } from './settings-kit.js';
import { combobox } from '../lib/combobox.js';

const TASKS = [['generate', 'Elaborar questões'], ['review', 'Analisar questões']];

export async function render(panel, { status }) {
  let data;
  try { data = await api('/api/ai/providers'); }
  catch (error) { clear(panel, notice(error.message, 'danger')); return; }

  const view = (id) => data.providers[id];
  const stateBadge = (provider) => {
    const info = view(provider.id);
    return info.ready ? badge('Pronto', 'ok') : badge('Não configurado');
  };

  async function saveTask(task, provider) {
    const previous = data.tasks[task];
    try { data = { ...data, ...(await api('/api/ai/tasks', { method: 'PUT', body: { [task]: provider } })) }; status('IA escolhida.'); }
    catch (error) { data.tasks[task] = previous; status(error.message); }
    draw();
  }

  function taskCard() {
    const selects = TASKS.map(([task, label]) => {
      const select = h('select', { 'aria-label': label }, data.catalog.map((provider) => {
        const ready = view(provider.id).ready;
        return h('option', { value: provider.id, selected: data.tasks[task] === provider.id },
          provider.name + (ready || data.tasks[task] === provider.id ? '' : ' (não configurado)'));
      }));
      select.addEventListener('change', () => saveTask(task, select.value));
      return field(label, select);
    });
    const unready = TASKS.filter(([task]) => !view(data.tasks[task]).ready);
    return card('IA usada em cada tarefa', 'Escolha qual IA cria e qual analisa as questões (aba Descritores).',
      h('div', { class: 'settings-grid' }, selects),
      unready.length ? notice('Falta configurar a IA escolhida: abra o provedor abaixo, cole a chave, escolha o modelo e salve.', 'warn') : null,
      notice('O enunciado, o descritor e o texto-base são enviados ao provedor escolhido. Nomes e respostas de alunos nunca são enviados.'));
  }

  function providerCard(provider) {
    const info = view(provider.id);
    const key = h('input', { type: 'password', autocomplete: 'off', spellcheck: false, placeholder: info.hasKey ? `•••• ${info.keyHint} (salva) — deixe em branco para manter` : 'Cole a chave de API' });
    const url = provider.editableUrl ? h('input', { type: 'url', value: info.baseUrl, placeholder: provider.baseUrl || 'https://servidor.exemplo/v1', autocomplete: 'off' }) : null;
    const model = combobox({ value: info.model, placeholder: 'Escolha ou digite o modelo', suggestions: provider.suggestions ?? [] });
    const result = h('p', { class: 'caption', role: 'status' });
    let loaded = false;
    const fill = (names) => { loaded = true; model.setItems(names); };
    // Ao abrir o campo pela primeira vez com a chave já salva, carrega os modelos do provedor.
    model.input.addEventListener('focus', async () => {
      if (loaded || !info.hasKey) return;
      loaded = true;
      try { fill((await api(`/api/ai/providers/${provider.id}/models`)).models); } catch { loaded = false; }
    });

    const test = button('Testar conexão', async () => {
      result.className = 'caption'; result.textContent = 'Testando…';
      try {
        const outcome = await api(`/api/ai/providers/${provider.id}/test`, { method: 'POST', body: { apiKey: key.value, baseUrl: url?.value ?? '', model: model.value } });
        fill(outcome.models);
        const parts = [`Conexão ok (${outcome.latencyMs} ms)`, `${outcome.models.length} modelo(s) disponível(is)`];
        if (outcome.chat) parts.push(outcome.chat.ok ? 'modelo respondeu' : `modelo não respondeu: ${outcome.chat.error}`);
        if (outcome.modelListed === false) parts.push(`o modelo “${model.value}” não está na lista deste provedor; escolha um dos modelos listados`);
        result.className = (outcome.chat && !outcome.chat.ok) || outcome.modelListed === false ? 'notice warn' : 'notice';
        result.textContent = parts.join(' · ') + '.';
        if (!model.value && outcome.models.length) model.input.placeholder = `Ex.: ${outcome.models[0]}`;
      } catch (error) { result.className = 'notice danger'; result.textContent = error.message; }
    }, { status });
    const save = button('Salvar', async () => {
      const body = { model: model.value };
      if (key.value.trim()) body.apiKey = key.value;
      if (url) body.baseUrl = url.value;
      data.providers[provider.id] = await api(`/api/ai/providers/${provider.id}`, { method: 'PUT', body });
      toast('Configuração salva.'); draw(provider.id);
    }, { kind: '', status });
    const clearKey = info.hasKey ? button('Remover chave', async () => {
      const { confirmed } = await confirmAction({ title: `Remover a chave de ${provider.name}?`, lead: 'A chave será apagada deste computador. Você poderá cadastrá-la de novo.', confirmLabel: 'Remover chave', danger: true });
      if (!confirmed) return;
      data.providers[provider.id] = await api(`/api/ai/providers/${provider.id}`, { method: 'PUT', body: { clearKey: true } });
      toast('Chave removida.'); draw(provider.id);
    }, { kind: 'quiet', status }) : null;

    const used = TASKS.filter(([task]) => data.tasks[task] === provider.id).map(([, label]) => label.toLowerCase());
    return h('details', { class: 'ai-provider', dataset: { provider: provider.id } },
      h('summary', { class: 'row' }, h('strong', { class: 'grow' }, provider.name), used.length ? badge('Usada: ' + used.join(' e ')) : null, stateBadge(provider)),
      h('div', { class: 'stack-s ai-provider-body' },
        provider.needsKey || provider.optionalKey ? field('Chave de API', key, data.encrypted ? 'A chave fica criptografada neste computador e nunca é exibida de novo.' : 'A chave fica salva neste computador, em arquivo protegido do seu usuário, e nunca é exibida de novo.') : null,
        url ? field('Endereço do serviço', url, provider.baseUrl ? `Padrão: ${provider.baseUrl}` : 'Obrigatório. Use http:// só para endereços da sua rede.') : null,
        field('Modelo', model.el),
        h('div', { class: 'settings-actions' }, test, save, clearKey),
        result));
  }

  function draw(openId) {
    const wasOpen = new Set([...panel.querySelectorAll('details[open]')].map((node) => node.dataset.provider));
    if (openId) wasOpen.add(openId);
    clear(panel, taskCard(),
      card('Provedores de IA', 'Informe a chave de API, teste a conexão e escolha o modelo. Você paga direto ao provedor, conforme o uso.', h('div', { class: 'ai-list' }, data.catalog.map(providerCard))));
    for (const node of panel.querySelectorAll('details')) if (wasOpen.has(node.dataset.provider)) node.open = true;
  }
  draw();
}
