// Camada única de acesso a provedores de IA em nuvem. Tudo que fala com um modelo passa por aqui, de modo que a
// geração e a análise de questões não dependem de qual provedor o professor escolheu.
import { isIP } from 'node:net';

export class AiError extends Error {
  constructor(code, message, status = 502) { super(message); this.code = code; this.status = status; }
}

// kind: protocolo usado. json: o provedor aceita response_format json_object. tokenParam: nome do limite de tokens.
export const PROVIDERS = [
  { id: 'openai', suggestions: ['gpt-5-mini', 'gpt-4o-mini'], name: 'ChatGPT (OpenAI)', kind: 'openai', needsKey: true, baseUrl: 'https://api.openai.com/v1', json: true, tokenParam: 'max_completion_tokens', noTemperature: true },
  { id: 'anthropic', suggestions: ['claude-haiku-4-5', 'claude-sonnet-4-5'], name: 'Claude (Anthropic)', kind: 'anthropic', needsKey: true, baseUrl: 'https://api.anthropic.com/v1' },
  { id: 'gemini', suggestions: ['gemini-3.5-flash-lite', 'gemini-3.8-flash'], name: 'Gemini (Google)', kind: 'gemini', needsKey: true, baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  { id: 'deepseek', suggestions: ['deepseek-chat'], name: 'DeepSeek', kind: 'openai', needsKey: true, baseUrl: 'https://api.deepseek.com', json: true },
  { id: 'groq', suggestions: ['llama-3.3-70b-versatile'], name: 'Groq', kind: 'openai', needsKey: true, baseUrl: 'https://api.groq.com/openai/v1', json: true },
  { id: 'openrouter', suggestions: ['openai/gpt-4o-mini'], name: 'OpenRouter', kind: 'openai', needsKey: true, baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'mistral', suggestions: ['mistral-small-latest'], name: 'Mistral AI', kind: 'openai', needsKey: true, baseUrl: 'https://api.mistral.ai/v1', json: true },
  { id: 'xai', suggestions: ['grok-3-mini'], name: 'xAI (Grok)', kind: 'openai', needsKey: true, baseUrl: 'https://api.x.ai/v1' },
  { id: 'custom', name: 'Outro serviço (compatível com OpenAI)', kind: 'openai', needsKey: false, optionalKey: true, baseUrl: '', editableUrl: true, custom: true },
];
export const providerById = (id) => PROVIDERS.find((provider) => provider.id === id);

const MODEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,199}$/;
export const validModelName = (name) => typeof name === 'string' && MODEL_PATTERN.test(name);
const NOT_CHAT = /embed|whisper|tts|dall-e|moderation|davinci|babbage|image|audio|realtime|transcribe|search|omni-moderation/i;
const MAX_BODY = 2_000_000;

const privateHost = (host) => {
  const name = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (name === 'localhost' || name.endsWith('.local') || name.endsWith('.lan') || name.endsWith('.home.arpa')) return true;
  const kind = isIP(name);
  if (kind === 4) {
    const [a, b] = name.split('.').map(Number);
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
  }
  if (kind === 6) return name === '::1' || /^f[cd]/.test(name) || name.startsWith('fe80');
  return false;
};

// Endereços editáveis só aceitam http(s) sem credenciais; http fica restrito à máquina e à rede local,
// para que uma chave nunca trafegue sem criptografia pela internet.
export function validateBaseUrl(value) {
  let url;
  try { url = new URL(String(value ?? '').trim()); } catch { throw new AiError('invalid_url', 'Informe um endereço válido, como http://192.168.0.10:8080/v1.', 400); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new AiError('invalid_url', 'O endereço deve começar com http:// ou https://.', 400);
  if (url.username || url.password) throw new AiError('invalid_url', 'Não coloque usuário ou senha no endereço.', 400);
  if (url.protocol === 'http:' && !privateHost(url.hostname)) throw new AiError('insecure_url', 'Endereços da internet precisam usar https://.', 400);
  return (url.origin + url.pathname).replace(/\/+$/, '');
}

export function resolveBaseUrl(provider, override) {
  if (!provider.editableUrl) return provider.baseUrl;
  const chosen = String(override ?? '').trim() || provider.baseUrl;
  if (!chosen) throw new AiError('missing_url', 'Informe o endereço do serviço.', 400);
  return validateBaseUrl(chosen);
}

const redact = (text, secrets) => {
  let out = String(text ?? '');
  for (const secret of secrets) if (secret && secret.length >= 6) out = out.split(secret).join('***');
  return out.replace(/\s+/g, ' ').trim().slice(0, 220);
};

function describeFailure(status, body, secrets) {
  let detail = '';
  try {
    const parsed = JSON.parse(body);
    const raw = parsed?.error?.message ?? parsed?.error ?? parsed?.message;
    detail = redact(typeof raw === 'string' ? raw : '', secrets);
  } catch { /* corpo não é JSON */ }
  // Modelo aposentado pelo provedor (ex.: "models/gemini-2.5-flash is no longer available to new users.
  // Please update your code to use models/gemini-3.8-flash"): explica em português e indica o substituto.
  if (/no longer available|deprecated|discontinued|has been retired|not available to new users/i.test(detail)) {
    const old = detail.match(/(?:models\/)?([\w.\-/]+) is no longer/i)?.[1];
    const next = detail.match(/\buse (?:the )?(?:models\/)?([a-z0-9][\w.\-/]*[a-z0-9])/i)?.[1];
    const error = new AiError('model_retired', `O provedor desativou ${old ? `o modelo ${old}` : 'este modelo'} para contas novas.` + (next ? ` Troque para ${next}.` : ' Escolha outro modelo da lista.'), 400);
    if (next) error.suggestedModel = next;
    return error;
  }
  if (status === 401 || status === 403) return new AiError('auth_failed', 'A chave de API foi recusada pelo provedor. Confira a chave e as permissões.', 401);
  if (status === 404) return new AiError('not_found', 'Modelo ou endereço não encontrado no provedor.' + (detail ? ` (${detail})` : ''), 404);
  if (status === 429) return new AiError('rate_limited', 'Limite de uso ou cota do provedor excedido. Tente novamente mais tarde.', 429);
  if (status >= 500) return new AiError('provider_down', `O provedor está indisponível no momento (HTTP ${status}).`, 502);
  return new AiError('bad_request', `O provedor recusou a solicitação (HTTP ${status}).` + (detail ? ` ${detail}` : ''), 400);
}

// Extrai um objeto JSON mesmo quando o modelo responde com cercas de markdown ou texto extra.
export function extractJson(text) {
  const raw = String(text ?? '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try { return JSON.parse(raw); } catch { /* tenta recortar */ }
  const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) { try { return JSON.parse(raw.slice(start, end + 1)); } catch { /* sem JSON */ } }
  throw new AiError('invalid_json', 'O modelo não respondeu em JSON válido.', 502);
}

export function createClient(config, { fetchImpl = fetch } = {}) {
  const provider = providerById(config?.provider);
  if (!provider) throw new AiError('unknown_provider', 'Provedor de IA desconhecido.', 400);
  const baseUrl = resolveBaseUrl(provider, config.baseUrl);
  const apiKey = String(config.apiKey ?? '').trim();
  const model = String(config.model ?? '').trim();
  if (provider.needsKey && !apiKey) throw new AiError('missing_key', `Informe a chave de API de ${provider.name}.`, 400);

  const authHeaders = () => {
    if (provider.kind === 'anthropic') return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
    if (provider.kind === 'gemini') return { 'x-goog-api-key': apiKey };
    return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  };

  async function request(method, endpoint, body, timeoutMs = 30_000) {
    let response;
    try {
      response = await fetchImpl(baseUrl + endpoint, {
        method, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...authHeaders() },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new AiError('timeout', 'O provedor demorou demais para responder. Tente de novo ou escolha um modelo mais rápido (os “flash-lite” costumam responder em poucos segundos).', 504);
      throw new AiError('unreachable', 'Não foi possível conectar ao provedor. Verifique a internet e o endereço.', 502);
    }
    const text = await response.text();
    if (text.length > MAX_BODY) throw new AiError('too_large', 'A resposta do modelo excede o tamanho permitido.', 502);
    if (!response.ok) throw describeFailure(response.status, text, [apiKey]);
    try { return JSON.parse(text); } catch { throw new AiError('invalid_response', 'O provedor enviou uma resposta ilegível.', 502); }
  }

  async function listModels() {
    let names;
    if (provider.kind === 'anthropic') {
      names = (await request('GET', '/models?limit=1000')).data?.map((item) => item.id);
    } else if (provider.kind === 'gemini') {
      names = (await request('GET', '/models?pageSize=1000')).models
        ?.filter((item) => !item.supportedGenerationMethods || item.supportedGenerationMethods.includes('generateContent'))
        .map((item) => String(item.name).replace(/^models\//, ''));
    } else {
      const result = await request('GET', '/models');
      names = (result.data ?? result.models)?.map((item) => item.id ?? item.name);
      if (provider.id === 'openai') names = names?.filter((name) => !NOT_CHAT.test(String(name)));
    }
    return [...new Set((Array.isArray(names) ? names : []).filter(validModelName))].sort((a, b) => a.localeCompare(b)).slice(0, 500);
  }

  // Retorna o texto bruto do modelo. A decisão de interpretar como JSON fica com quem chamou.
  async function chat({ system, user, schema, temperature = 0.3, maxTokens = 900, timeoutMs = 90_000 }) {
    if (!model) throw new AiError('missing_model', 'Escolha um modelo para esta IA.', 400);
    if (!validModelName(model)) throw new AiError('invalid_model', 'Nome de modelo inválido.', 400);
    if (provider.kind === 'anthropic') {
      const result = await request('POST', '/messages', {
        model, max_tokens: Math.max(maxTokens, 2048), ...(system ? { system } : {}),
        messages: [{ role: 'user', content: user }],
      }, timeoutMs);
      return (result.content ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('');
    }
    if (provider.kind === 'gemini') {
      const result = await request('POST', `/models/${encodeURIComponent(model)}:generateContent`, {
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { responseMimeType: 'application/json', temperature, maxOutputTokens: Math.max(maxTokens, 8192) },
      }, timeoutMs);
      return (result.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? '').join('');
    }
    const limit = provider.tokenParam ?? 'max_tokens';
    const result = await request('POST', '/chat/completions', {
      model,
      messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: user }],
      ...(provider.json ? { response_format: { type: 'json_object' } } : {}),
      ...(provider.noTemperature ? {} : { temperature }),
      [limit]: provider.noTemperature ? Math.max(maxTokens * 3, 6000) : maxTokens,
    }, timeoutMs);
    return String(result.choices?.[0]?.message?.content ?? '');
  }

  return { provider, baseUrl, model, listModels, chat };
}

// Teste de conexão: lista os modelos (valida endereço e chave) e, se houver modelo escolhido, faz uma chamada mínima.
export async function testConnection(config, options = {}) {
  const started = Date.now();
  const client = createClient(config, options);
  let models = []; let listError = null;
  try { models = await client.listModels(); } catch (error) { listError = error; }
  let chat = null;
  if (client.model) {
    try { await client.chat({ user: 'Responda apenas: OK', maxTokens: 16, timeoutMs: 45_000 }); chat = { ok: true }; }
    catch (error) { chat = { ok: false, error: error.message, ...(error.suggestedModel ? { suggestedModel: error.suggestedModel } : {}) }; }
  }
  const ok = !listError || chat?.ok === true;
  if (!ok) throw listError;
  // modelListed: false quando o provedor lista modelos e o escolhido não está entre eles (nome digitado errado ou modelo antigo).
  const modelListed = client.model && models.length ? models.includes(client.model) : null;
  return { ok: true, models, chat, modelListed, latencyMs: Date.now() - started, listError: listError ? listError.message : null };
}
