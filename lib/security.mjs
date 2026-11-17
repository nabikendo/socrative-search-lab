import fs from 'node:fs';
import path from 'node:path';

// Configuração de segurança da rede da sala (por pasta de dados).
// - http  (padrão): sem criptografia; as mitigações abaixo ficam SEMPRE ligadas e não podem ser desligadas.
// - https: alunos só entram por HTTPS (certificado autoassinado); HTTP na rede é redirecionado ou recusado.
// - auto : o QR Code usa HTTPS, mas HTTP continua aceito para os aparelhos que não abrirem HTTPS.
// Mitigações sempre ativas: token de sessão com validade curta (renovada a cada batimento), vínculo do aluno ao
// primeiro aparelho (troca só com liberação do professor), registro de IP/entrada/saída/troca e alerta de 2 aparelhos.
export const MODES = ['http', 'https', 'auto'];
export const TTL_LIMITS = { min: 2, max: 120, default: 10 };
const FILE = 'security.json';
const MAX_DIAG = 30;

export class SecurityError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

export function openSecuritySettings(dataDir) {
  const file = path.join(dataDir, FILE);
  const read = () => {
    try { const data = JSON.parse(fs.readFileSync(file, 'utf8')); return data && typeof data === 'object' && !Array.isArray(data) ? data : {}; }
    catch { return {}; }
  };
  const write = (data) => {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  };
  const normalize = (data) => ({
    mode: MODES.includes(data.mode) ? data.mode : 'http',
    tokenTtlMinutes: Number.isInteger(data.tokenTtlMinutes) && data.tokenTtlMinutes >= TTL_LIMITS.min && data.tokenTtlMinutes <= TTL_LIMITS.max ? data.tokenTtlMinutes : TTL_LIMITS.default,
  });
  let cache = normalize(read());

  return {
    get: () => ({ ...cache }),
    ttlMs: () => cache.tokenTtlMinutes * 60_000,
    set(input = {}) {
      const next = { ...read() };
      if (input.mode !== undefined) {
        if (!MODES.includes(input.mode)) throw new SecurityError('invalid_mode', 'Modo de segurança inválido.');
        next.mode = input.mode;
      }
      if (input.tokenTtlMinutes !== undefined) {
        const minutes = Number(input.tokenTtlMinutes);
        if (!Number.isInteger(minutes) || minutes < TTL_LIMITS.min || minutes > TTL_LIMITS.max) {
          throw new SecurityError('invalid_ttl', `A validade do acesso deve ficar entre ${TTL_LIMITS.min} e ${TTL_LIMITS.max} minutos.`);
        }
        next.tokenTtlMinutes = minutes;
      }
      write(next);
      cache = normalize(next);
      return { ...cache };
    },
    // Resultados do /diag/https vindos dos aparelhos (para o professor decidir o modo e preencher o AUDIT.md).
    diagnostics: () => (Array.isArray(read().diagnostics) ? read().diagnostics : []),
    addDiagnostic(entry) {
      const data = read();
      const list = Array.isArray(data.diagnostics) ? data.diagnostics : [];
      list.unshift({ at: new Date().toISOString(), outcome: entry.outcome, device: String(entry.device ?? '').slice(0, 60), ip: String(entry.ip ?? '').slice(0, 45), note: String(entry.note ?? '').slice(0, 200) });
      data.diagnostics = list.slice(0, MAX_DIAG);
      write(data);
      return data.diagnostics;
    },
    clearDiagnostics() { const data = read(); delete data.diagnostics; write(data); },
  };
}

// Identifica o aparelho de forma legível para o professor (não é usado para segurança, só para exibição).
export function deviceLabel(userAgent = '') {
  const ua = String(userAgent);
  if (/CrOS/i.test(ua)) return 'Chromebook';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Celular Android' : 'Tablet Android';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Aparelho';
}

export const cleanDeviceId = (value) => (typeof value === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(value) ? value : null);
export const clientIp = (req) => String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
export const isLoopback = (ip) => ip === '127.0.0.1' || ip === '::1';
