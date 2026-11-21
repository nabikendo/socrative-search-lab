export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export async function api(path, { method = 'GET', body, raw } = {}) {
  const options = { method, credentials: 'same-origin', headers: {} };
  if (raw !== undefined) { options.body = raw; options.headers['content-type'] = 'application/octet-stream'; }
  else if (body !== undefined) { options.body = JSON.stringify(body); options.headers['content-type'] = 'application/json'; }

  let response;
  try { response = await fetch(path, options); }
  catch { throw new ApiError(0, 'network', 'Sem conexão com o servidor.'); }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && data.error === 'teacher_auth_required') window.dispatchEvent(new Event('atlas:auth-required'));
    throw new ApiError(response.status, data.error || 'error', data.message || 'Algo deu errado. Tente novamente.');
  }
  return data;
}

// Baixa um arquivo sem sair da tela. Se o servidor recusar, lança o erro com a mensagem dele
// (antes, location.href levava o app instalado para uma página só com o JSON do erro).
export async function downloadFile(path) {
  let response;
  try { response = await fetch(path, { credentials: 'same-origin' }); }
  catch { throw new ApiError(0, 'network', 'Sem conexão com o servidor.'); }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && data.error === 'teacher_auth_required') window.dispatchEvent(new Event('atlas:auth-required'));
    throw new ApiError(response.status, data.error || 'error', data.message || 'Não foi possível baixar o arquivo.');
  }
  const disposition = response.headers.get('content-disposition') || '';
  const name = decodeURIComponent(disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1] || disposition.match(/filename="([^"]+)"/i)?.[1] || path.split('/').pop().split('?')[0] || 'arquivo');
  const url = URL.createObjectURL(await response.blob());
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return name;
}
