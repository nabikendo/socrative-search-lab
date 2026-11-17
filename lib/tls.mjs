import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import selfsigned from 'selfsigned';

// Certificado autoassinado para a rede da sala, válido para os IPs locais deste computador e para "localhost".
// Fica em <dados>/tls e é refeito quando os IPs mudam (outro Wi-Fi) ou quando falta menos de 30 dias para vencer.
const DAYS = 397; // limite aceito pelos navegadores para certificados de servidor
const RENEW_BEFORE_MS = 30 * 24 * 3600_000;

export async function ensureCertificate(dataDir, ips) {
  const dir = path.join(dataDir, 'tls');
  const files = { key: path.join(dir, 'key.pem'), cert: path.join(dir, 'cert.pem'), meta: path.join(dir, 'meta.json') };
  const wanted = [...new Set(['127.0.0.1', ...ips])].sort();
  try {
    const meta = JSON.parse(fs.readFileSync(files.meta, 'utf8'));
    const key = fs.readFileSync(files.key, 'utf8');
    const cert = fs.readFileSync(files.cert, 'utf8');
    const x509 = new crypto.X509Certificate(cert);
    const covers = wanted.every((ip) => meta.ips?.includes(ip));
    if (covers && Date.parse(x509.validTo) - Date.now() > RENEW_BEFORE_MS) return describe(key, cert, meta.ips);
  } catch { /* sem certificado ainda: gera abaixo */ }

  const generated = await selfsigned.generate([{ name: 'commonName', value: 'Atlas — rede local da sala' }, { name: 'organizationName', value: 'Atlas Provas' }], {
    days: DAYS, keySize: 2048, algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, ...wanted.map((ip) => ({ type: 7, ip }))] },
    ],
  });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(files.key, generated.private, { mode: 0o600 });
  fs.writeFileSync(files.cert, generated.cert);
  fs.writeFileSync(files.meta, JSON.stringify({ ips: wanted, createdAt: new Date().toISOString() }));
  return describe(generated.private, generated.cert, wanted);
}

function describe(key, cert, ips) {
  const x509 = new crypto.X509Certificate(cert);
  return { key, cert, ips, fingerprint: x509.fingerprint256, validTo: new Date(x509.validTo).toISOString() };
}
