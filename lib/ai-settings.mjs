import fs from 'node:fs';
import path from 'node:path';
import { PROVIDERS, providerById, validModelName, validateBaseUrl, AiError } from './ai.mjs';

const FILE = 'ai-settings.json';
export const TASKS = ['generate', 'review'];
const DEFAULT_PROVIDER = 'gemini'; // usado só enquanto nenhuma IA estiver configurada

// secretBox (opcional) criptografa a chave em repouso. No aplicativo para Windows usa o safeStorage do Electron.
export function openAiSettings(dataDir, { secretBox } = {}) {
  const file = path.join(dataDir, FILE);

  const read = () => {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
  };
  const decryptKey = (entry) => {
    try {
      if (typeof entry?.keyEnc === 'string') return secretBox ? String(secretBox.decrypt(entry.keyEnc) ?? '') : '';
      return typeof entry?.key === 'string' ? entry.key : '';
    } catch { return ''; } // criptografia de outro computador/usuário: trata como sem chave
  };
  const write = (data) => {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  };

  function providerEntry(data, id) { return data.providers?.[id] && typeof data.providers[id] === 'object' ? data.providers[id] : {}; }

  const api = {
    // Configuração completa, com a chave. Uso interno do servidor: NUNCA enviar ao navegador.
    getConfig(id, overrides = {}) {
      const provider = providerById(id);
      if (!provider) throw new AiError('unknown_provider', 'Provedor de IA desconhecido.', 400);
      const entry = providerEntry(read(), id);
      return {
        provider: id,
        baseUrl: overrides.baseUrl ?? entry.baseUrl ?? '',
        model: overrides.model ?? entry.model ?? '',
        apiKey: overrides.apiKey ? overrides.apiKey : decryptKey(entry),
      };
    },
    // Sem escolha salva (ou com uma IA que não existe mais, como as locais da versão anterior), usa a primeira IA pronta.
    getTasks() {
      const data = read();
      const stored = data.tasks ?? {};
      const firstReady = PROVIDERS.find((provider) => {
        const entry = providerEntry(data, provider.id);
        return !!entry.model && (!provider.needsKey || !!decryptKey(entry)) && (!provider.custom || !!entry.baseUrl);
      })?.id;
      return Object.fromEntries(TASKS.map((task) => [task, providerById(stored[task]) ? stored[task] : (firstReady ?? DEFAULT_PROVIDER)]));
    },
    // Visão segura para a interface: sem chave, só se existe e os quatro últimos caracteres.
    publicView() {
      const data = read();
      const providers = {};
      for (const provider of PROVIDERS) {
        const entry = providerEntry(data, provider.id);
        const key = decryptKey(entry);
        const model = typeof entry.model === 'string' ? entry.model : '';
        providers[provider.id] = {
          hasKey: !!key, keyHint: key.length >= 8 ? key.slice(-4) : '',
          model, baseUrl: provider.editableUrl ? String(entry.baseUrl ?? '') : '',
          ready: !!model && (!provider.needsKey || !!key) && (!provider.custom || !!entry.baseUrl),
        };
      }
      return { providers, tasks: api.getTasks(), encrypted: !!secretBox };
    },
    updateProvider(id, { apiKey, clearKey, model, baseUrl } = {}) {
      const provider = providerById(id);
      if (!provider) throw new AiError('unknown_provider', 'Provedor de IA desconhecido.', 400);
      const data = read();
      data.providers = data.providers && typeof data.providers === 'object' ? data.providers : {};
      const entry = { ...providerEntry(data, id) };
      if (model !== undefined) {
        const name = String(model).trim();
        if (name && !validModelName(name)) throw new AiError('invalid_model', 'Nome de modelo inválido.', 400);
        entry.model = name;
      }
      if (baseUrl !== undefined) {
        if (!provider.editableUrl) throw new AiError('url_locked', 'O endereço deste provedor não pode ser alterado.', 400);
        const text = String(baseUrl).trim();
        entry.baseUrl = text ? validateBaseUrl(text) : '';
      }
      if (clearKey) { delete entry.key; delete entry.keyEnc; }
      const newKey = typeof apiKey === 'string' ? apiKey.trim() : '';
      if (newKey) {
        if (newKey.length < 8 || newKey.length > 400 || /\s/.test(newKey)) throw new AiError('invalid_key', 'A chave de API parece inválida.', 400);
        delete entry.key; delete entry.keyEnc;
        if (secretBox) entry.keyEnc = secretBox.encrypt(newKey); else entry.key = newKey;
      } else if (!clearKey && entry.key && secretBox) {
        entry.keyEnc = secretBox.encrypt(entry.key); delete entry.key; // protege chaves salvas antes da criptografia existir
      }
      data.providers[id] = entry;
      write(data);
      return api.publicView().providers[id];
    },
    setTasks(tasks = {}) {
      const data = read();
      const next = { ...(data.tasks && typeof data.tasks === 'object' ? data.tasks : {}) }; // só o que o professor escolheu
      for (const task of TASKS) {
        if (tasks[task] === undefined) continue;
        if (!providerById(tasks[task])) throw new AiError('unknown_provider', 'Provedor de IA desconhecido.', 400);
        next[task] = tasks[task];
      }
      data.tasks = next;
      write(data);
      return api.getTasks();
    },
    clear() { const existed = fs.existsSync(file); fs.rmSync(file, { force: true }); return existed; },
    exists: () => fs.existsSync(file),
  };
  return api;
}
