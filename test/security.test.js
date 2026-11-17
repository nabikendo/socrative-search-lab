// Sprint 5: modos http | https | auto, certificado autoassinado por IP local e /diag/https.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { createApp } from '../server.mjs';
import { openSecuritySettings, deviceLabel } from '../lib/security.mjs';
import { ensureCertificate } from '../lib/tls.mjs';

let app, dir, httpPort, admin;
// IP de rede deste computador: simula um aparelho de aluno (não é 127.0.0.1, que é o computador do professor).
const lanIp = Object.values(os.networkInterfaces()).flat().find((i) => i?.family === 'IPv4' && !i.internal)?.address;

const request = (url, { method = 'GET', body, headers = {}, ca } = {}) => new Promise((resolve, reject) => {
  const target = new URL(url);
  const lib = target.protocol === 'https:' ? https : http;
  const req = lib.request(target, { method, headers: { connection: 'close', ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, ...(target.protocol === 'https:' ? { ca } : {}) }, (res) => {
    let data = ''; res.setEncoding('utf8'); res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => { let json = null; try { json = JSON.parse(data); } catch { /* html */ } resolve({ status: res.statusCode, headers: res.headers, text: data, json }); });
  });
  req.on('error', reject);
  if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
  req.end();
});
const setMode = (mode) => request(`http://127.0.0.1:${httpPort}/api/security`, { method: 'PUT', body: { mode }, headers: { cookie: admin } });

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-security-'));
  app = createApp({ dataDir: dir, pin: '123456', securePort: 0 });
  await new Promise((r) => app.server.listen(0, '0.0.0.0', r));
  await app.secureReady;
  httpPort = app.server.address().port;
  const login = await request(`http://127.0.0.1:${httpPort}/api/auth/login`, { method: 'POST', body: { pin: '123456' } });
  admin = login.headers['set-cookie'][0].split(';')[0];
});
after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('certificado autoassinado: cobre localhost, 127.0.0.1 e os IPs da rede; é reaproveitado e refeito quando o IP muda', async () => {
  assert.ok(app.secure.server, app.secure.error ?? 'HTTPS deveria estar no ar');
  const x509 = new crypto.X509Certificate(app.secure.cert.cert);
  assert.match(x509.subjectAltName, /DNS:localhost/);
  assert.match(x509.subjectAltName, /IP Address:127\.0\.0\.1/);
  if (lanIp) assert.ok(x509.subjectAltName.includes(`IP Address:${lanIp}`));
  assert.ok(Date.parse(x509.validTo) - Date.now() <= 398 * 24 * 3600_000, 'até 397 dias, limite dos navegadores');
  assert.equal(fs.statSync(path.join(dir, 'tls', 'key.pem')).mode & 0o777, process.platform === 'win32' ? fs.statSync(path.join(dir, 'tls', 'key.pem')).mode & 0o777 : 0o600);
  const again = await ensureCertificate(dir, lanIp ? [lanIp] : []);
  assert.equal(again.fingerprint, app.secure.cert.fingerprint, 'mesmo IP: reaproveita');
  const moved = await ensureCertificate(dir, ['10.99.0.7']);
  assert.notEqual(moved.fingerprint, app.secure.cert.fingerprint, 'outro Wi-Fi: refaz');
  assert.match(new crypto.X509Certificate(moved.cert).subjectAltName, /10\.99\.0\.7/);
});

test('modo http (padrão): tudo por HTTP; pelo HTTPS só responde o diagnóstico', async () => {
  assert.equal(app.security.get().mode, 'http');
  const ca = app.secure.cert.cert;
  // /api/open-exam é pública e não depende das páginas compiladas (no CI os testes rodam antes do build)
  assert.equal((await request(`http://127.0.0.1:${httpPort}/api/open-exam`)).status, 200);
  const blocked = await request(`https://127.0.0.1:${app.secure.port}/api/open-exam`, { ca });
  assert.equal(blocked.status, 404);
  assert.match(blocked.text, /HTTPS do Atlas está desligado/);
  assert.equal((await request(`https://127.0.0.1:${app.secure.port}/diag/https`, { ca })).status, 200);
  const net = await request(`http://127.0.0.1:${httpPort}/api/network`, { headers: { cookie: admin } });
  assert.ok(net.json.urls.every((url) => url.startsWith('http://')));
});

test('modo https: aparelhos da rede são levados ao HTTPS e não conseguem usar a API por HTTP', async (t) => {
  assert.equal((await setMode('https')).status, 200);
  try {
    const ca = app.secure.cert.cert;
    // o computador do professor (127.0.0.1) continua no HTTP local
    assert.equal((await request(`http://127.0.0.1:${httpPort}/api/auth/status`)).status, 200);
    // pelo HTTPS, com o certificado conferido (o mesmo que o aluno aceita no aviso), a prova abre
    const secure = await request(`https://127.0.0.1:${app.secure.port}/api/open-exam`, { ca });
    assert.equal(secure.status, 200);
    assert.match(secure.headers['content-type'], /application\/json/);
    const net = await request(`http://127.0.0.1:${httpPort}/api/network`, { headers: { cookie: admin } });
    assert.ok(net.json.urls.length === 0 || net.json.urls.every((url) => url.startsWith('https://')), 'QR Code só com https');
    if (!lanIp) { t.diagnostic('sem IP de rede neste computador: parte do aparelho da rede pulada'); return; }
    const page = await request(`http://${lanIp}:${httpPort}/prova?x=1`);
    assert.equal(page.status, 302);
    assert.equal(page.headers.location, `https://${lanIp}:${app.secure.port}/prova?x=1`);
    const api = await request(`http://${lanIp}:${httpPort}/api/identify`, { method: 'POST', body: { code: '1234', number: '1' } });
    assert.equal(api.status, 403); assert.equal(api.json.error, 'https_required');
    const viaTls = await request(`https://${lanIp}:${app.secure.port}/api/open-exam`, { ca });
    assert.equal(viaTls.status, 200, 'o certificado vale para o IP da rede');
  } finally { await setMode('http'); }
});

test('modo auto: QR Code com HTTPS primeiro e HTTP ainda aceito na rede', async (t) => {
  assert.equal((await setMode('auto')).status, 200);
  try {
    const net = await request(`http://127.0.0.1:${httpPort}/api/network`, { headers: { cookie: admin } });
    if (net.json.urls.length) assert.ok(net.json.urls[0].startsWith('https://'));
    assert.equal((await request(`https://127.0.0.1:${app.secure.port}/api/open-exam`, { ca: app.secure.cert.cert })).status, 200);
    if (!lanIp) { t.diagnostic('sem IP de rede'); return; }
    assert.equal((await request(`http://${lanIp}:${httpPort}/api/open-exam`)).status, 200, 'HTTP continua aceito no modo auto');
  } finally { await setMode('http'); }
});

test('modo inválido é recusado e a troca de modo exige o PIN', async () => {
  assert.equal((await setMode('ftp')).status, 400);
  assert.equal((await request(`http://127.0.0.1:${httpPort}/api/security`, { method: 'PUT', body: { mode: 'http' } })).status, 401);
  const view = await request(`http://127.0.0.1:${httpPort}/api/security`, { headers: { cookie: admin } });
  assert.deepEqual(view.json.modes, ['http', 'https', 'auto']);
  assert.ok(view.json.https.running); assert.match(view.json.https.fingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
});

test('/diag/https: página HTTP com instruções, página HTTPS registra sucesso e o professor vê os resultados', async () => {
  const ca = app.secure.cert.cert;
  const plain = await request(`http://127.0.0.1:${httpPort}/diag/https`);
  assert.equal(plain.status, 200);
  assert.match(plain.headers['content-type'], /text\/html/);
  assert.match(plain.headers['content-security-policy'], /default-src 'none'/);
  assert.match(plain.text, /Diagnóstico HTTPS do Atlas/);
  assert.ok(plain.text.includes(`https://127.0.0.1:${app.secure.port}/diag/https`), 'link para o teste seguro');
  assert.ok(plain.text.includes(app.secure.cert.fingerprint), 'impressão digital para conferência');
  assert.doesNotMatch(plain.text, /<script/i, 'funciona sem JavaScript');
  const chromebook = { 'user-agent': 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/120' };
  const ok = await request(`https://127.0.0.1:${app.secure.port}/diag/https`, { ca, headers: chromebook });
  assert.equal(ok.status, 200); assert.match(ok.text, /HTTPS funcionou/);
  const blocked = await request(`http://127.0.0.1:${httpPort}/diag/https/result`, { method: 'POST', body: 'outcome=blocked', headers: { 'content-type': 'application/x-www-form-urlencoded', ...chromebook } });
  assert.equal(blocked.status, 200);
  // por HTTP não dá para "forjar" sucesso
  assert.equal((await request(`http://127.0.0.1:${httpPort}/diag/https/result`, { method: 'POST', body: 'outcome=ok', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status, 400);
  const view = await request(`http://127.0.0.1:${httpPort}/api/security`, { headers: { cookie: admin } });
  assert.deepEqual(view.json.diagnostics.slice(0, 2).map((d) => [d.outcome, d.device]), [['blocked', 'Chromebook'], ['ok', 'Chromebook']]);
});

test('configuração de segurança: padrão http e 10 min; persistida e validada', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-sec-'));
  try {
    const settings = openSecuritySettings(tmp);
    assert.deepEqual(settings.get(), { mode: 'http', tokenTtlMinutes: 10 });
    assert.equal(settings.ttlMs(), 600_000);
    settings.set({ mode: 'auto', tokenTtlMinutes: 20 });
    assert.deepEqual(openSecuritySettings(tmp).get(), { mode: 'auto', tokenTtlMinutes: 20 });
    assert.throws(() => settings.set({ tokenTtlMinutes: 1 }), /entre 2 e 120/);
    assert.throws(() => settings.set({ tokenTtlMinutes: 10.5 }));
    fs.writeFileSync(path.join(tmp, 'security.json'), '{"mode":"xyz","tokenTtlMinutes":0}');
    assert.deepEqual(openSecuritySettings(tmp).get(), { mode: 'http', tokenTtlMinutes: 10 }, 'arquivo inválido volta ao padrão seguro');
    assert.equal(deviceLabel('Mozilla/5.0 (X11; CrOS x86_64)'), 'Chromebook');
    assert.equal(deviceLabel('Mozilla/5.0 (Linux; Android 12) Mobile'), 'Celular Android');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
