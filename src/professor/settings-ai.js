import { api } from '../lib/api.js';
import { h, clear, toast } from '../lib/dom.js';
import { confirmAction } from '../lib/confirm.js';
import { card, field, button, badge, notice } from './settings-kit.js';

const TASKS = [['generate', 'Elaborar questões'], ['review', 'Analisar questões']];

export async function render(panel, { status }) {
  let data;
  try { data = await api('/api/ai/providers'); }
  catch (error) { clear(panel, notice(error.message, 'danger')); return; }

  const view = (id) => data.providers[id];
  const stateBadge = (provider) => {
    const info = view(provider.id);
    if (info.ready) return badge(provider.local ? 'Local · pronto' : 'Pronto', 'ok');
    return badge(provider.local && !info.model ? 'Local' : 'Não configurado');
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
    const cloud = TASKS.some(([task]) => !data.catalog.find((item) => item.id === data.tasks[task]).local);
    return card('IA usada em cada tarefa', 'Escolha qual IA cria e qual analisa as questões (aba Descritores).',
      h('div', { class: 'settings-grid' }, selects),
      cloud ? notice('Com provedores na nuvem, o enunciado, o descritor e o texto-base são enviados ao provedor escolhido. Nomes e respostas de alunos nunca são enviados.', 'warn')
        : notice('A IA local roda neste computador e não envia dados para a internet.'));
  }

  function providerCard(provider) {
    const info = view(provider.id);
    const key = h('input', { type: 'password', autocomplete: 'off', spellcheck: false, placeholder: info.hasKey ? `•••• ${info.keyHint} (salva) — deixe em branco para manter` : 'Cole a chave de API' });
    const url = provider.editableUrl ? h('input', { type: 'url', value: info.baseUrl, placeholder: provider.baseUrl || 'https://servidor.exemplo/v1', autocomplete: 'off' }) : null;
    const listId = `models-${provider.id}`;
    const models = h('datalist', { id: listId });
    const model = h('input', { type: 'text', value: info.model, list: listId, placeholder: 'Escolha na lista ou digite o nome do modelo', autocomplete: 'off', spellcheck: false });
    const result = h('p', { class: 'caption', role: 'status' });
    const fill = (names) => { clear(models, names.map((name) => h('option', { value: name }))); };

    const test = button('Testar conexão', async () => {
      result.className = 'caption'; result.textContent = 'Testando…';
      try {
        const outcome = await api(`/api/ai/providers/${provider.id}/test`, { method: 'POST', body: { apiKey: key.value, baseUrl: url?.value ?? '', model: model.value } });
        fill(outcome.models);
        const parts = [`Conexão ok (${outcome.latencyMs} ms)`, `${outcome.models.length} modelo(s) disponível(is)`];
        if (outcome.chat) parts.push(outcome.chat.ok ? 'modelo respondeu' : `modelo não respondeu: ${outcome.chat.error}`);
        result.className = outcome.chat && !outcome.chat.ok ? 'notice warn' : 'notice';
        result.textContent = parts.join(' · ') + '.';
        if (!model.value && outcome.models.length) model.placeholder = `Ex.: ${outcome.models[0]}`;
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
        provider.local ? notice('Funciona no seu computador ou rede local. Nenhum dado sai para a internet.') : null,
        provider.needsKey || provider.optionalKey ? field('Chave de API', key, data.encrypted ? 'A chave fica criptografada neste computador e nunca é exibida de novo.' : 'A chave fica salva neste computador, em arquivo protegido do seu usuário, e nunca é exibida de novo.') : null,
        url ? field('Endereço do serviço', url, provider.baseUrl ? `Padrão: ${provider.baseUrl}` : 'Obrigatório. Use http:// só para endereços da sua rede.') : null,
        field('Modelo', model), models,
        h('div', { class: 'settings-actions' }, test, save, clearKey),
        result));
  }

  function draw(openId) {
    const wasOpen = new Set([...panel.querySelectorAll('details[open]')].map((node) => node.dataset.provider));
    if (openId) wasOpen.add(openId);
    const local = data.catalog.filter((provider) => provider.local);
    const cloud = data.catalog.filter((provider) => !provider.local);
    clear(panel, taskCard(),
      card('Provedores locais', 'Ollama e LM Studio rodam no seu computador.', h('div', { class: 'ai-list' }, local.map(providerCard))),
      card('Provedores na nuvem', 'Informe a chave de API, teste a conexão e escolha o modelo. Você paga direto ao provedor, conforme o uso.', h('div', { class: 'ai-list' }, cloud.map(providerCard))));
    for (const node of panel.querySelectorAll('details')) if (wasOpen.has(node.dataset.provider)) node.open = true;
  }
  draw();
}
