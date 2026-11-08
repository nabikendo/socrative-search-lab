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
