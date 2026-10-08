const USERS_KEY = 'blobworm_users_v1';
const SESSION_KEY = 'blobworm_session_v1';

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function loadUsers() {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

export function getSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export async function register(username, password) {
  const name = String(username || '').trim().slice(0, 16);
  const pass = String(password || '');
  if (name.length < 3) return { ok: false, error: 'Имя от 3 символов' };
  if (pass.length < 4) return { ok: false, error: 'Пароль от 4 символов' };
  const users = loadUsers();
  const key = name.toLowerCase();
  if (users[key]) return { ok: false, error: 'Имя уже занято' };
  const salt = Math.random().toString(36).slice(2);
  const hash = await sha256(salt + pass);
  users[key] = { name, salt, hash, createdAt: Date.now() };
  saveUsers(users);
  const session = { name, at: Date.now() };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return { ok: true, session };
}

export async function login(username, password) {
  const name = String(username || '').trim();
  const pass = String(password || '');
  const users = loadUsers();
  const user = users[name.toLowerCase()];
  if (!user) return { ok: false, error: 'Неверный логин или пароль' };
  const hash = await sha256(user.salt + pass);
  if (hash !== user.hash) return { ok: false, error: 'Неверный логин или пароль' };
  const session = { name: user.name, at: Date.now() };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return { ok: true, session };
}
