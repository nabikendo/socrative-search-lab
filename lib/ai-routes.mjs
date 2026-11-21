import { createClient, testConnection, PROVIDERS, providerById, AiError } from './ai.mjs';
import { generateQuestion, reviewQuestion } from './ai-questions.mjs';

// Registra as rotas de IA. A chave de API só trafega do navegador para o servidor (ao salvar ou testar);
// nenhuma resposta devolve a chave, apenas se ela existe e seus quatro últimos caracteres.
export function registerAiRoutes({ route, readJson, HttpError, limit, aiSettings, fetchImpl = fetch }) {
  // Erro do provedor nunca vira 401/403 para o navegador: isso seria lido como "PIN do professor expirou".
  const asHttp = (error, fallbackCode) => {
    if (error instanceof AiError) return new HttpError(error.status === 400 ? 400 : 422, error.code, error.message);
    return new HttpError(422, fallbackCode, error.message);
  };
  const catalog = () => PROVIDERS.map(({ id, name, needsKey, optionalKey, editableUrl, baseUrl, custom, suggestions }) =>
    ({ id, name, suggestions: suggestions ?? [], needsKey: !!needsKey, optionalKey: !!optionalKey, editableUrl: !!editableUrl, baseUrl, custom: !!custom }));
  const needProvider = (id) => providerById(id) ?? (() => { throw new HttpError(404, 'unknown_provider', 'Provedor de IA desconhecido.'); })();
  const clientFor = (id, overrides) => createClient(aiSettings.getConfig(id, overrides), { fetchImpl });
  const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

  route('GET', '/api/ai/providers', { admin: true }, () => ({ catalog: catalog(), ...aiSettings.publicView() }));

  route('GET', '/api/ai/status', { admin: true }, () => {
    const view = aiSettings.publicView();
    const describe = (id) => ({ provider: id, name: providerById(id).name, model: view.providers[id].model, ready: view.providers[id].ready });
    return { generate: describe(view.tasks.generate), review: describe(view.tasks.review) };
  });

  route('PUT', '/api/ai/providers/:id', { admin: true }, async ({ req, params }) => {
    needProvider(params.id);
    const input = await readJson(req);
    try {
      return aiSettings.updateProvider(params.id, {
        apiKey: input.apiKey, clearKey: input.clearKey === true, model: input.model, baseUrl: input.baseUrl,
      });
    } catch (error) { throw asHttp(error, 'ai_settings_invalid'); }
  });

  route('POST', '/api/ai/providers/:id/test', { admin: true }, async ({ req, params }) => {
    needProvider(params.id);
    limit(req, 'ai-test', 20);
    const input = await readJson(req);
    try {
      return await testConnection(aiSettings.getConfig(params.id, { apiKey: text(input.apiKey), model: text(input.model), baseUrl: text(input.baseUrl) }), { fetchImpl });
    } catch (error) { throw asHttp(error, 'ai_test_failed'); }
  });

  route('GET', '/api/ai/providers/:id/models', { admin: true }, async ({ params, req }) => {
    needProvider(params.id);
    limit(req, 'ai-models', 20);
    try { return { models: await clientFor(params.id).listModels() }; }
    catch (error) { throw asHttp(error, 'ai_models_failed'); }
  });

  route('PUT', '/api/ai/tasks', { admin: true }, async ({ req }) => {
    const input = await readJson(req);
    try { return { tasks: aiSettings.setTasks({ generate: input.generate, review: input.review }) }; }
    catch (error) { throw asHttp(error, 'ai_tasks_invalid'); }
  });

  // Elaboração e análise usam a IA escolhida para cada tarefa (ou a indicada na própria chamada).
  const taskClient = (task, input) => {
    const id = text(input.provider) ?? aiSettings.getTasks()[task];
    needProvider(id);
    return clientFor(id, { model: text(input.model) });
  };
  route('POST', '/api/ai/descriptor-question', { admin: true }, async ({ req }) => {
    limit(req, 'ai-descriptor', 10);
    const input = await readJson(req);
    try {
      const client = taskClient('generate', input);
      const result = await generateQuestion({ skillId: input.skillId, model: client.model, context: input.context }, { client });
      return { ...result, disclaimer: 'Rascunho: confira descritor, fatos, cálculos, gabarito e linguagem antes de usar.' };
    } catch (error) { throw asHttp(error, 'ai_question_unavailable'); }
  });
  route('POST', '/api/ai/descriptor-review', { admin: true }, async ({ req }) => {
    limit(req, 'ai-review', 15);
    const input = await readJson(req);
    try {
      const client = taskClient('review', input);
      const report = await reviewQuestion({ skillId: input.skillId, model: client.model, question: input.question }, { client });
      return { ...report, disclaimer: 'Parecer automático provisório, não equivale à validação do Inep.' };
    } catch (error) { throw asHttp(error, 'ai_review_unavailable'); }
  });
}
