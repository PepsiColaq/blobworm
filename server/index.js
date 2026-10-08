import express from 'express';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '0.0.0.0';

const PUBLIC_CAP = 50;
const MATCH_MS = 30 * 60 * 1000;

const app = express();
app.disable('x-powered-by');

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, uptime: process.uptime() | 0 });
});

app.use(express.static(ROOT, { index: 'index.html', extensions: ['html'] }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

/** @type {Map<string, any>} */
const rooms = new Map();
let publicSeq = 0;

function genCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 5; i++) s += alphabet[(Math.random() * alphabet.length) | 0];
  return s;
}

function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) out.push(n.address);
    }
  }
  return out;
}

function publicRoom(room) {
  return {
    code: room.code,
    name: room.name,
    host: room.hostName,
    players: room.clients.size,
    maxPlayers: room.maxPlayers,
    bots: room.bots,
    hasPassword: !!room.password,
    mode: room.mode,
    inGame: room.inGame,
    endsAt: room.endsAt || 0,
    shard: room.shard || 1,
  };
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg, except = null) {
  const raw = JSON.stringify(msg);
  for (const c of room.clients) {
    if (c !== except && c.readyState === 1) c.send(raw);
  }
}

function clearMatchTimer(room) {
  if (room.matchTimer) {
    clearTimeout(room.matchTimer);
    room.matchTimer = null;
  }
}

function leaveRoom(ws) {
  const room = ws.room;
  if (!room) return;
  room.clients.delete(ws);
  broadcast(room, {
    type: 'room:peers',
    peers: [...room.clients].map((c) => ({ id: c.uid, name: c.uname })),
  });
  if (room.clients.size === 0) {
    clearMatchTimer(room);
    rooms.delete(room.code);
  }
  ws.room = null;
}

function isRoomExpired(room) {
  return !!(room.ended || (room.endsAt && Date.now() >= room.endsAt));
}

/** Таймер 30 мин стартует только с первым игроком в комнате */
function startPublicMatchClock(room) {
  if (room.clients.size < 1) return;
  if (room.startedAt && !isRoomExpired(room)) return;

  clearMatchTimer(room);
  room.ended = false;
  room.startedAt = Date.now();
  room.endsAt = room.startedAt + MATCH_MS;
  room.inGame = true;
  room.matchTimer = setTimeout(() => {
    room.ended = true;
    room.inGame = false;
    broadcast(room, { type: 'match:end', reason: 'time', endsAt: room.endsAt });
  }, MATCH_MS);
}

function createPublicShard() {
  publicSeq += 1;
  const code = `PUB${publicSeq}`;
  const room = {
    code,
    name: `Публичный #${publicSeq}`,
    password: '',
    bots: 10,
    maxPlayers: PUBLIC_CAP,
    mode: 'public',
    hostName: 'Server',
    hostId: null,
    clients: new Set(),
    inGame: false,
    ended: false,
    startedAt: 0,
    endsAt: 0,
    matchTimer: null,
    shard: publicSeq,
  };
  rooms.set(code, room);
  return room;
}

function findOpenPublicRoom() {
  for (const room of rooms.values()) {
    if (room.mode !== 'public') continue;
    if (isRoomExpired(room)) continue;
    if (room.clients.size >= room.maxPlayers) continue;
    return room;
  }
  return null;
}

wss.on('connection', (ws) => {
  ws.uid = Math.random().toString(36).slice(2, 10);
  ws.uname = 'Player';
  ws.room = null;

  send(ws, { type: 'hello', id: ws.uid });

  ws.on('message', (buf) => {
    let msg;
    try {
      msg = JSON.parse(String(buf));
    } catch {
      return;
    }

    if (msg.type === 'auth') {
      ws.uname = String(msg.name || 'Player').slice(0, 16);
      return;
    }

    if (msg.type === 'rooms:list') {
      send(ws, {
        type: 'rooms:list',
        rooms: [...rooms.values()]
          .filter((r) => r.mode !== 'public' && (!r.inGame || r.clients.size > 0))
          .map(publicRoom),
      });
      return;
    }

    if (msg.type === 'match:join-public') {
      leaveRoom(ws);
      let room = findOpenPublicRoom();
      let overflow = false;
      if (!room || room.clients.size >= PUBLIC_CAP) {
        if (room && room.clients.size >= PUBLIC_CAP) overflow = true;
        room = createPublicShard();
        if (publicSeq > 1) overflow = true;
      }
      const firstPlayer = room.clients.size === 0;
      room.clients.add(ws);
      ws.room = room;
      if (firstPlayer || !room.startedAt || isRoomExpired(room)) {
        startPublicMatchClock(room);
      }
      if (!room.endsAt || room.endsAt <= Date.now()) {
        startPublicMatchClock(room);
      }
      send(ws, {
        type: 'match:joined',
        room: publicRoom(room),
        endsAt: room.endsAt,
        duration: MATCH_MS,
        overflow,
        capacity: PUBLIC_CAP,
        fresh: firstPlayer,
      });
      broadcast(room, {
        type: 'room:peers',
        peers: [...room.clients].map((c) => ({ id: c.uid, name: c.uname })),
      });
      return;
    }

    if (msg.type === 'room:create') {
      leaveRoom(ws);
      let code = String(msg.code || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 8);
      if (!code) code = genCode();
      if (rooms.has(code)) {
        send(ws, { type: 'error', text: 'Код комнаты уже занят' });
        return;
      }
      const room = {
        code,
        name: String(msg.name || code).slice(0, 24),
        password: String(msg.password || ''),
        bots: Math.max(0, Math.min(24, Number(msg.bots) || 8)),
        maxPlayers: Math.max(2, Math.min(50, Number(msg.maxPlayers) || 8)),
        mode: msg.mode === 'public' ? 'public' : 'private',
        hostName: ws.uname,
        hostId: ws.uid,
        clients: new Set([ws]),
        inGame: false,
        ended: false,
        startedAt: 0,
        endsAt: 0,
        matchTimer: null,
        shard: 0,
      };
      rooms.set(code, room);
      ws.room = room;
      send(ws, { type: 'room:joined', room: publicRoom(room), youAreHost: true });
      broadcast(room, { type: 'room:peers', peers: [{ id: ws.uid, name: ws.uname }] });
      return;
    }

    if (msg.type === 'room:join') {
      const code = String(msg.code || '').toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        send(ws, { type: 'error', text: 'Комната не найдена' });
        return;
      }
      if (room.password && room.password !== String(msg.password || '')) {
        send(ws, { type: 'error', text: 'Неверный пароль комнаты' });
        return;
      }
      if (room.clients.size >= room.maxPlayers) {
        send(ws, { type: 'error', text: 'Комната полная' });
        return;
      }
      leaveRoom(ws);
      room.clients.add(ws);
      ws.room = room;
      send(ws, {
        type: 'room:joined',
        room: publicRoom(room),
        youAreHost: room.hostId === ws.uid,
      });
      broadcast(room, {
        type: 'room:peers',
        peers: [...room.clients].map((c) => ({ id: c.uid, name: c.uname })),
      });
      return;
    }

    if (msg.type === 'room:leave') {
      leaveRoom(ws);
      send(ws, { type: 'room:left' });
      return;
    }

    if (msg.type === 'room:start') {
      const room = ws.room;
      if (!room || room.hostId !== ws.uid) {
        send(ws, { type: 'error', text: 'Только хост может начать' });
        return;
      }
      room.inGame = true;
      if (room.mode === 'public') startPublicMatchClock(room);
      broadcast(room, {
        type: 'room:start',
        bots: room.bots,
        seed: Date.now(),
        endsAt: room.endsAt || 0,
        peers: [...room.clients].map((c) => ({ id: c.uid, name: c.uname })),
      });
      return;
    }

    if (msg.type === 'game:state' && ws.room) {
      broadcast(
        ws.room,
        {
          type: 'game:state',
          from: ws.uid,
          name: ws.uname,
          payload: msg.payload,
        },
        ws,
      );
      return;
    }

    if (msg.type === 'voice:signal' && ws.room && msg.to) {
      for (const c of ws.room.clients) {
        if (c.uid === msg.to) {
          send(c, { type: 'voice:signal', from: ws.uid, data: msg.data });
          break;
        }
      }
    }
  });

  ws.on('close', () => leaveRoom(ws));
});

server.listen(PORT, HOST, () => {
  console.log(`BlobWorm listening on ${HOST}:${PORT}`);
  console.log(`  Local:   http://localhost:${PORT}`);
  for (const ip of lanAddresses()) {
    console.log(`  Network: http://${ip}:${PORT}  ← друзья в одной Wi‑Fi`);
  }
  console.log(`  Health:  http://localhost:${PORT}/health`);
});
