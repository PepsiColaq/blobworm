export function createNet(handlers = {}) {
  let ws = null;
  let uid = null;
  const queue = [];

  function url() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }

  function send(msg) {
    const raw = JSON.stringify(msg);
    if (ws && ws.readyState === 1) ws.send(raw);
    else queue.push(raw);
  }

  function connect(name) {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) {
      send({ type: 'auth', name });
      return;
    }
    ws = new WebSocket(url());
    ws.onopen = () => {
      send({ type: 'auth', name });
      while (queue.length) ws.send(queue.shift());
      handlers.onOpen?.();
    };
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === 'hello') uid = msg.id;
      handlers.onMessage?.(msg);
    };
    ws.onclose = () => handlers.onClose?.();
    ws.onerror = () => handlers.onError?.();
  }

  return {
    connect,
    send,
    getId: () => uid,
    listRooms: () => send({ type: 'rooms:list' }),
    createRoom: (opts) => send({ type: 'room:create', ...opts }),
    joinRoom: (opts) => send({ type: 'room:join', ...opts }),
    joinPublic: () => send({ type: 'match:join-public' }),
    leaveRoom: () => send({ type: 'room:leave' }),
    startRoom: () => send({ type: 'room:start' }),
    sendState: (payload) => send({ type: 'game:state', payload }),
    signalVoice: (to, data) => send({ type: 'voice:signal', to, data }),
  };
}
