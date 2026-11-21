import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';
import { createClient, testConnection, validateBaseUrl, extractJson, AiError, PROVIDERS } from '../lib/ai.mjs';
import { openAiSettings } from '../lib/ai-settings.mjs';
import { SAEB_SKILLS } from '../shared/skills.js';

const json = (body, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
// Servidor falso que registra cada chamada.
const fakeFetch = (handler) => {
  const calls = [];
  const fn = async (url, options = {}) => { calls.push({ url: String(url), options, body: options.body ? JSON.parse(options.body) : null }); return handler(String(url), options, calls.at(-1)); };
  fn.calls = calls;
  return fn;
};
const KEY = 'sk-test-1234567890abcdef';

test('ChatGPT: usa Bearer, max_completion_tokens, JSON mode e não envia temperature', async () => {
  const f = fakeFetch(() => json({ choices: [{ message: { content: '{"ok":true}' } }] }));
  const text = await createClient({ provider: 'openai', apiKey: KEY, model: 'gpt-x' }, { fetchImpl: f }).chat({ system: 's', user: 'u', maxTokens: 300 });
  assert.equal(text, '{"ok":true}');
  const [call] = f.calls;
  assert.equal(call.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(call.options.headers.authorization, `Bearer ${KEY}`);
  assert.equal(call.options.redirect, 'error');
  assert.deepEqual(call.body.response_format, { type: 'json_object' });
  assert.ok(call.body.max_completion_tokens >= 2000);
  assert.equal('max_tokens' in call.body, false);
  assert.equal('temperature' in call.body, false);
});

test('DeepSeek, Groq e OpenRouter usam o protocolo compatível com OpenAI no endereço de cada um', async () => {
  const expected = { deepseek: 'https://api.deepseek.com/chat/completions', groq: 'https://api.groq.com/openai/v1/chat/completions', openrouter: 'https://openrouter.ai/api/v1/chat/completions' };
  for (const [provider, url] of Object.entries(expected)) {
    const f = fakeFetch(() => json({ choices: [{ message: { content: 'x' } }] }));
    await createClient({ provider, apiKey: KEY, model: 'm/x:free' }, { fetchImpl: f }).chat({ user: 'u' });
    assert.equal(f.calls[0].url, url);
    assert.equal(f.calls[0].body.max_tokens, 900);
    assert.equal(f.calls[0].body.temperature, 0.3);
  }
});

test('Claude: x-api-key, versão da API e texto concatenado', async () => {
  const f = fakeFetch(() => json({ content: [{ type: 'text', text: '{"a":' }, { type: 'text', text: '1}' }] }));
  const text = await createClient({ provider: 'anthropic', apiKey: KEY, model: 'claude-x' }, { fetchImpl: f }).chat({ system: 'sys', user: 'u' });
  assert.equal(text, '{"a":1}');
  assert.equal(f.calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(f.calls[0].options.headers['x-api-key'], KEY);
  assert.equal(f.calls[0].options.headers['anthropic-version'], '2023-06-01');
  assert.equal(f.calls[0].body.system, 'sys');
  assert.ok(f.calls[0].body.max_tokens >= 1024);
});

test('Gemini: chave no cabeçalho (nunca na URL), JSON mode e lista só modelos que geram conteúdo', async () => {
  const f = fakeFetch((url) => url.includes(':generateContent')
    ? json({ candidates: [{ content: { parts: [{ text: '{"g":1}' }] } }] })
    : json({ models: [{ name: 'models/gem-a', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embed-b', supportedGenerationMethods: ['embedContent'] }] }));
  const client = createClient({ provider: 'gemini', apiKey: KEY, model: 'gem-a' }, { fetchImpl: f });
  assert.deepEqual(await client.listModels(), ['gem-a']);
  assert.equal(await client.chat({ system: 's', user: 'u' }), '{"g":1}');
  for (const call of f.calls) { assert.equal(call.options.headers['x-goog-api-key'], KEY); assert.ok(!call.url.includes(KEY)); }
  assert.match(f.calls[1].url, /\/models\/gem-a:generateContent$/);
  assert.equal(f.calls[1].body.generationConfig.responseMimeType, 'application/json');
});

test('só há provedores em nuvem: IA local (Ollama/LM Studio) foi removida', () => {
  assert.ok(PROVIDERS.every((p) => !['ollama', 'lmstudio'].includes(p.id) && !p.local));
  assert.ok(PROVIDERS.filter((p) => p.id !== 'custom').every((p) => p.needsKey));
});

test('provedor da nuvem exige chave e seu endereço não pode ser desviado', () => {
  assert.throws(() => createClient({ provider: 'openai', model: 'm' }), (e) => e.code === 'missing_key');
  const client = createClient({ provider: 'openai', apiKey: KEY, baseUrl: 'https://evil.example/v1' }, { fetchImpl: fakeFetch(() => json({})) });
  assert.equal(client.baseUrl, 'https://api.openai.com/v1');
});

test('endereços: http só na máquina/rede local, sem credenciais, https liberado', () => {
  assert.equal(validateBaseUrl('http://localhost:8080/'), 'http://localhost:8080');
  assert.equal(validateBaseUrl('http://192.168.0.20:1234/v1/'), 'http://192.168.0.20:1234/v1');
  assert.equal(validateBaseUrl('https://meu-servidor.example.com/v1'), 'https://meu-servidor.example.com/v1');
  for (const bad of ['http://example.com/v1', 'http://8.8.8.8', 'ftp://localhost', 'https://user:pass@host.com', 'não é url', '']) {
    assert.throws(() => validateBaseUrl(bad), AiError, bad);
  }
});

test('falhas do provedor viram mensagens claras e a chave nunca aparece', async () => {
  const cases = [[401, 'recusada'], [403, 'recusada'], [404, 'não encontrado'], [429, 'Limite'], [503, 'indisponível']];
  for (const [status, pattern] of cases) {
    const f = fakeFetch(() => json({ error: { message: `chave ${KEY} inválida` } }, status));
    await assert.rejects(createClient({ provider: 'openai', apiKey: KEY, model: 'm' }, { fetchImpl: f }).chat({ user: 'u' }),
      (error) => new RegExp(pattern, 'i').test(error.message) && !error.message.includes(KEY));
  }
  const offline = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(createClient({ provider: 'openai', apiKey: KEY, model: 'm' }, { fetchImpl: offline }).chat({ user: 'u' }), /conectar ao provedor/);
  const slow = async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; };
  await assert.rejects(createClient({ provider: 'groq', apiKey: KEY, model: 'm' }, { fetchImpl: slow }).chat({ user: 'u' }), /a tempo/);
});

test('teste de conexão: lista modelos, faz chamada mínima e tolera provedor sem /models', async () => {
  const good = fakeFetch((url) => (url.endsWith('/models') ? json({ data: [{ id: 'gpt-b' }, { id: 'text-embedding-3' }, { id: 'gpt-a' }] }) : json({ choices: [{ message: { content: 'OK' } }] })));
  const result = await testConnection({ provider: 'openai', apiKey: KEY, model: 'gpt-a' }, { fetchImpl: good });
  assert.deepEqual(result.models, ['gpt-a', 'gpt-b']);
  assert.deepEqual(result.chat, { ok: true });
  const noList = fakeFetch((url) => (url.endsWith('/models') ? json({}, 404) : json({ choices: [{ message: { content: 'OK' } }] })));
  const partial = await testConnection({ provider: 'custom', baseUrl: 'http://localhost:8080/v1', model: 'm' }, { fetchImpl: noList });
  assert.equal(partial.ok, true); assert.ok(partial.listError);
  const dead = fakeFetch(() => json({}, 401));
  await assert.rejects(testConnection({ provider: 'openai', apiKey: KEY }, { fetchImpl: dead }), /recusada/);
});

test('extractJson aceita cercas de markdown e texto ao redor', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Claro! {"a":2} Espero ter ajudado.'), { a: 2 });
  assert.throws(() => extractJson('sem json'), AiError);
});

test('configurações: chave não volta ao navegador, é criptografada em repouso e protegida no arquivo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-ai-'));
  try {
    const box = { encrypt: (t) => Buffer.from([...t].reverse().join('')).toString('base64'), decrypt: (b) => [...Buffer.from(b, 'base64').toString()].reverse().join('') };
    const settings = openAiSettings(dir, { secretBox: box });
    const view = settings.updateProvider('openai', { apiKey: KEY, model: 'gpt-a' });
    assert.deepEqual([view.hasKey, view.keyHint, view.model, view.ready], [true, 'cdef', 'gpt-a', true]);
    assert.ok(!JSON.stringify(settings.publicView()).includes(KEY));
    assert.ok(!fs.readFileSync(path.join(dir, 'ai-settings.json'), 'utf8').includes(KEY));
    assert.equal(settings.getConfig('openai').apiKey, KEY);
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'ai-settings.json')).mode & 0o777, 0o600);
    // outro computador não consegue descriptografar: trata como sem chave
    const other = openAiSettings(dir, { secretBox: { encrypt: box.encrypt, decrypt: () => { throw new Error('x'); } } });
    assert.equal(other.publicView().providers.openai.hasKey, false);
    settings.updateProvider('openai', { clearKey: true });
    assert.equal(settings.publicView().providers.openai.hasKey, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('configurações: chave em texto puro é protegida assim que a criptografia fica disponível', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-ai-'));
  try {
    openAiSettings(dir).updateProvider('groq', { apiKey: KEY, model: 'm1' });
    assert.ok(fs.readFileSync(path.join(dir, 'ai-settings.json'), 'utf8').includes(KEY));
    const box = { encrypt: (t) => 'enc:' + t.length, decrypt: () => KEY };
    openAiSettings(dir, { secretBox: box }).updateProvider('groq', { model: 'm2' });
    const raw = fs.readFileSync(path.join(dir, 'ai-settings.json'), 'utf8');
    assert.ok(!raw.includes(KEY)); assert.ok(raw.includes('keyEnc'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('configurações: valida modelo, chave, endereço e escolha da IA por tarefa (padrão: primeira IA pronta)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-ai-'));
  try {
    const settings = openAiSettings(dir);
    assert.deepEqual(settings.getTasks(), { generate: 'gemini', review: 'gemini' });
    assert.throws(() => settings.updateProvider('openai', { model: 'com espaço' }), (e) => e.code === 'invalid_model');
    assert.throws(() => settings.updateProvider('openai', { apiKey: 'curta' }), (e) => e.code === 'invalid_key');
    assert.throws(() => settings.updateProvider('openai', { baseUrl: 'https://x.com' }), (e) => e.code === 'url_locked');
    assert.throws(() => settings.updateProvider('custom', { baseUrl: 'http://example.com/v1' }), (e) => e.code === 'insecure_url');
    assert.throws(() => settings.setTasks({ generate: 'inexistente' }), (e) => e.code === 'unknown_provider');
    settings.setTasks({ review: 'anthropic' });
    assert.deepEqual(settings.getTasks(), { generate: 'gemini', review: 'anthropic' });
    settings.updateProvider('groq', { apiKey: KEY, model: 'm1' });
    assert.equal(settings.getTasks().generate, 'groq', 'sem escolha salva, usa a primeira IA configurada');
    assert.equal(settings.clear(), true);
    assert.deepEqual(settings.getTasks(), { generate: 'gemini', review: 'gemini' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- Rotas HTTP ----
let app, base, admin, dir, aiFetch;
const call = async (url, { method = 'GET', body, cookie = admin } = {}) => {
  const res = await fetch(base + url, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, data: type.includes('json') ? await res.json() : await res.text() };
};
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-airoutes-'));
  aiFetch = fakeFetch((url, options, rec) => {
    if (url.includes('/models')) return json({ data: [{ id: 'claude-m' }] });
    if (url.endsWith('/messages')) {
      const wanted = JSON.stringify(rec.body.messages);
      if (wanted.includes('Avalie')) return json({ content: [{ type: 'text', text: '{"aligned":true,"confidence":"high","justification":"ok","improvements":[]}' }] });
      return json({ content: [{ type: 'text', text: '```json\n{"text":"Quanto é 2+2?","options":["3","4","5","6"],"correct":"4","explanation":"Soma simples."}\n```' }] });
    }
    return json({}, 404);
  });
  app = createApp({ dataDir: dir, pin: '123456', aiFetch });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: '123456' }) });
  admin = login.headers.get('set-cookie').split(';')[0];
});
after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('rotas de IA exigem o PIN do professor', async () => {
  for (const [method, url] of [['GET', '/api/ai/providers'], ['PUT', '/api/ai/providers/openai'], ['POST', '/api/ai/providers/openai/test'], ['PUT', '/api/ai/tasks']]) {
    assert.equal((await call(url, { method, cookie: '', body: method === 'GET' ? undefined : {} })).status, 401, url);
  }
});

test('fluxo completo: salvar chave, testar sem expor, escolher IA e gerar/analisar com Claude', async () => {
  const catalog = await call('/api/ai/providers');
  assert.ok(['openai', 'anthropic', 'gemini', 'deepseek', 'groq', 'openrouter'].every((id) => catalog.data.catalog.some((p) => p.id === id)));
  assert.ok(!catalog.data.catalog.some((p) => ['ollama', 'lmstudio'].includes(p.id)));
  assert.equal(catalog.data.tasks.generate, 'gemini');

  const tested = await call('/api/ai/providers/anthropic/test', { method: 'POST', body: { apiKey: KEY, model: 'claude-m' } });
  assert.equal(tested.status, 200); assert.deepEqual(tested.data.models, ['claude-m']);
  assert.equal((await call('/api/ai/providers')).data.providers.anthropic.hasKey, false, 'testar não salva a chave');

  const saved = await call('/api/ai/providers/anthropic', { method: 'PUT', body: { apiKey: KEY, model: 'claude-m' } });
  assert.deepEqual([saved.data.hasKey, saved.data.keyHint, saved.data.ready], [true, 'cdef', true]);
  assert.ok(!JSON.stringify((await call('/api/ai/providers')).data).includes(KEY));

  assert.equal((await call('/api/ai/tasks', { method: 'PUT', body: { generate: 'anthropic', review: 'anthropic' } })).status, 200);
  const status = await call('/api/ai/status');
  assert.deepEqual([status.data.generate.provider, status.data.generate.ready, status.data.review.name], ['anthropic', true, 'Claude (Anthropic)']);

  const skill = SAEB_SKILLS.find((item) => item.subject === 'Matemática');
  const generated = await call('/api/ai/descriptor-question', { method: 'POST', body: { skillId: skill.id } });
  assert.equal(generated.status, 200);
  assert.equal(generated.data.provider, 'anthropic'); assert.equal(generated.data.source, 'ia-rascunho');
  assert.equal(generated.data.question.correct, '4');
  const reviewed = await call('/api/ai/descriptor-review', { method: 'POST', body: { skillId: skill.id, question: generated.data.question } });
  assert.equal(reviewed.status, 200); assert.equal(reviewed.data.provider, 'anthropic'); assert.equal(reviewed.data.aligned, true);
  assert.ok(aiFetch.calls.every((c) => !c.url.includes(KEY)));
});

test('erro do provedor vira 422 (nunca 401, que deslogaria o professor) e sem vazar a chave', async () => {
  const failing = fakeFetch(() => json({ error: { message: 'bad key ' + KEY } }, 401));
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-airoutes2-'));
  const app2 = createApp({ dataDir: dir2, pin: '123456', aiFetch: failing });
  await new Promise((r) => app2.server.listen(0, '127.0.0.1', r));
  try {
    const b = `http://127.0.0.1:${app2.server.address().port}`;
    const login = await fetch(b + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: '123456' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const res = await fetch(b + '/api/ai/providers/openai/test', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ apiKey: KEY }) });
    assert.equal(res.status, 422);
    const text = await res.text();
    assert.match(text, /recusada/); assert.ok(!text.includes(KEY));
    const bad = await fetch(b + '/api/ai/providers/openai', { method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ model: 'com espaço' }) });
    assert.equal(bad.status, 400);
    const unknown = await fetch(b + '/api/ai/providers/nao-existe/test', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: '{}' });
    assert.equal(unknown.status, 404);
  } finally { await app2.close(); fs.rmSync(dir2, { recursive: true, force: true }); }
});

test('teste de conexão avisa quando o modelo escolhido não está na lista do provedor', async () => {
  const f = fakeFetch((url) => (url.endsWith('/models') ? json({ data: [{ id: 'gpt-a' }, { id: 'gpt-b' }] }) : json({ error: { message: 'model not found' } }, 404)));
  const typo = await testConnection({ provider: 'openai', apiKey: KEY, model: 'gpt-zzz' }, { fetchImpl: f });
  assert.equal(typo.modelListed, false);
  const ok = await testConnection({ provider: 'openai', apiKey: KEY, model: 'gpt-a' }, { fetchImpl: fakeFetch((url) => (url.endsWith('/models') ? json({ data: [{ id: 'gpt-a' }] }) : json({ choices: [{ message: { content: 'OK' } }] }))) });
  assert.equal(ok.modelListed, true);
});
