// Canal de eventos em tempo real (Server-Sent Events) para o painel do professor.
// SSE basta aqui: o servidor só precisa empurrar mudanças para o navegador, funciona em HTTP simples,
// atravessa a rede da escola como uma requisição comum e o navegador reconecta sozinho se cair.
export function createPresenceHub({ snapshot, pingMs = 15_000, debounceMs = 150 } = {}) {
  const channels = new Map(); // examId -> Set(res)
  const pending = new Map(); // examId -> timer

  const send = (res, event, data) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* conexão já fechada */ }
  };
  const broadcast = (examId) => {
    pending.delete(examId);
    const listeners = channels.get(examId);
    if (!listeners?.size) return;
    let data;
    try { data = snapshot(examId); } catch { return; } // prova apagada: os ouvintes recebem erro na próxima leitura
    for (const res of listeners) send(res, 'presence', data);
  };
  const ping = setInterval(() => {
    for (const listeners of channels.values()) for (const res of listeners) { try { res.write(': ping\n\n'); } catch { /* fechada */ } }
  }, pingMs);
  ping.unref?.();

  return {
    subscribe(examId, req, res) {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform',
        connection: 'keep-alive', 'x-accel-buffering': 'no',
      });
      res.write('retry: 3000\n\n');
      req.socket.setKeepAlive?.(true);
      req.socket.setTimeout?.(0);
      if (!channels.has(examId)) channels.set(examId, new Set());
      channels.get(examId).add(res);
      send(res, 'presence', snapshot(examId));
      const drop = () => { channels.get(examId)?.delete(res); if (!channels.get(examId)?.size) channels.delete(examId); };
      req.on('close', drop);
      res.on('close', drop);
    },
    // Agrupa várias mudanças seguidas (ex.: 30 alunos entrando juntos) num único envio.
    notify(examId) {
      if (!examId || !channels.has(examId) || pending.has(examId)) return;
      const timer = setTimeout(() => broadcast(examId), debounceMs);
      timer.unref?.();
      pending.set(examId, timer);
    },
    listeners: (examId) => channels.get(examId)?.size ?? 0,
    close() {
      clearInterval(ping);
      for (const timer of pending.values()) clearTimeout(timer);
      for (const listeners of channels.values()) for (const res of listeners) { try { res.end(); } catch { /* fechada */ } }
      channels.clear();
    },
  };
}
