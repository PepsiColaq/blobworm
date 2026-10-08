import { loadState, patchState } from './storage.js';
import { initBlobEditor, initWormEditor } from './editors.js';
import { createGame } from './game.js';
import { getSession, clearSession, login, register } from './auth.js';
import { createNet } from './net.js';
import { createVoiceChat } from './voice.js';
import { startMenuBg } from './menu-bg.js';
import { createCropModal } from './crop.js';
import { applyI18n, setLang, t } from './i18n.js';

const screens = {
  auth: document.getElementById('screen-auth'),
  device: document.getElementById('screen-device'),
  menu: document.getElementById('screen-menu'),
  mode: document.getElementById('screen-mode'),
  private: document.getElementById('screen-private'),
  room: document.getElementById('screen-room'),
  settings: document.getElementById('screen-settings'),
  layout: document.getElementById('screen-layout'),
  skins: document.getElementById('screen-skins'),
  blobSkin: document.getElementById('screen-blob-skin'),
  wormSkin: document.getElementById('screen-worm-skin'),
  game: document.getElementById('screen-game'),
};

let authMode = 'login';
let currentRoom = null;
let youAreHost = false;
let pendingBots = null;
let currentScreen = null;
let matchStartedAt = 0;
let leavingRoomQuiet = false;

const cropModal = createCropModal();
startMenuBg(document.getElementById('menu-bg'));

function applyUiTheme(theme) {
  document.body.classList.toggle('ui-classic', theme === 'classic');
}

function show(name) {
  const next = screens[name];
  if (!next) return;
  if (currentScreen === name) {
    next.classList.add('active');
    return;
  }
  const prev = currentScreen ? screens[currentScreen] : document.querySelector('.screen.active');
  if (prev && prev !== next) {
    prev.classList.add('leaving');
    prev.classList.remove('active');
    setTimeout(() => prev.classList.remove('leaving'), 280);
  }
  next.classList.add('active');
  currentScreen = name;
  document.getElementById('menu-bg').style.opacity = name === 'game' ? '0' : '1';
  if (name !== 'game') {
    document.getElementById('match-end-overlay')?.classList.add('hidden');
    document.getElementById('pause-overlay')?.classList.add('hidden');
    document.getElementById('death-overlay')?.classList.add('hidden');
  }
}

function applyMenuFromState() {
  const s = loadState();
  const session = getSession();
  document.getElementById('input-nick').value = s.nick || session?.name || '';
  document.getElementById('input-form').value = s.form || 'random';
  document.getElementById('menu-user').textContent = session?.name || 'игрок';
  applyUiTheme(s.uiTheme || 'polish');
}

async function refreshMicList() {
  const sel = document.getElementById('set-mic-device');
  if (!sel) return;
  const current = loadState().settings.micDeviceId || '';
  const mics = await voice.listMics();
  sel.innerHTML = '<option value="">По умолчанию</option>';
  mics.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `Микрофон ${i + 1}`;
    if (d.deviceId === current) opt.selected = true;
    sel.appendChild(opt);
  });
  if (current) sel.value = current;
}

function applySettingsFromState() {
  const st = loadState();
  const s = st.settings;
  document.getElementById('set-device').value = st.device || 'pc';
  document.getElementById('set-sound').checked = !!s.sound;
  document.getElementById('set-voice').checked = !!s.voiceChat;
  document.getElementById('set-sensitivity').value = s.sensitivity;
  document.getElementById('set-quality').value = s.quality;
  document.getElementById('set-bots').value = s.bots;
  document.getElementById('set-bots-label').textContent = s.bots;
  document.getElementById('set-show-names').checked = !!s.showNames;
  document.getElementById('set-minimap-side').value = s.minimapSide || 'left';
  document.getElementById('set-joystick').value = s.joystickSize || 120;
  document.getElementById('set-joy-label').textContent = s.joystickSize || 120;
  document.getElementById('set-joy-opacity').value = s.joystickOpacity || 0.55;
  document.getElementById('set-ui-theme').value = st.uiTheme || 'polish';
  document.getElementById('set-lang').value = st.lang || 'ru';
  document.getElementById('btn-mic-key').textContent = s.micKeyLabel || 'V';
  refreshMicList();
  applyMobileLayout();
  applyI18n();
}

function readSettingsToState() {
  const uiTheme = document.getElementById('set-ui-theme').value;
  const lang = document.getElementById('set-lang').value;
  const st = loadState();
  applyUiTheme(uiTheme);
  const next = patchState({
    device: document.getElementById('set-device').value,
    uiTheme,
    lang: lang === 'en' ? 'en' : 'ru',
    settings: {
      ...st.settings,
      sound: document.getElementById('set-sound').checked,
      voiceChat: document.getElementById('set-voice').checked,
      micDeviceId: document.getElementById('set-mic-device').value || '',
      sensitivity: Number(document.getElementById('set-sensitivity').value),
      quality: document.getElementById('set-quality').value,
      bots: Number(document.getElementById('set-bots').value),
      showNames: document.getElementById('set-show-names').checked,
      minimapSide: document.getElementById('set-minimap-side').value,
      joystickSize: Number(document.getElementById('set-joystick').value),
      joystickOpacity: Number(document.getElementById('set-joy-opacity').value),
      micKey: st.settings.micKey || 'KeyV',
      micKeyLabel: st.settings.micKeyLabel || 'V',
    },
  });
  applyI18n();
  voice.setDeviceId();
  game.refreshMinimapLayout?.();
  return next;
}

const LAYOUT_DEFAULTS = {
  map: { left: 2, top: 3, size: 110 },
  hud: { left: 18, top: 2, size: 100 },
  joy: { left: 4, bottom: 6, size: 120 },
  a: { left: 78, bottom: 40, size: 70 },
  b: { left: 78, bottom: 24, size: 70 },
  c: { left: 78, bottom: 8, size: 70 },
  mic: { left: 42, bottom: 4, size: 68 },
};

let layoutDraft = null;
let layoutSelected = null;

function applySlotSize(el, slot, size) {
  if (!el || size == null) return;
  if (slot === 'joy') {
    document.documentElement.style.setProperty('--joy-size', size + 'px');
    const base = document.getElementById('joystick-base');
    if (base) {
      base.style.width = size + 'px';
      base.style.height = size + 'px';
    }
  } else if (slot === 'map') {
    const mm = document.getElementById('minimap');
    if (mm) {
      mm.style.width = size + 'px';
      mm.style.height = size + 'px';
    }
  } else {
    el.style.width = size + 'px';
    el.style.height = size + 'px';
  }
}

function placeHudStack() {
  const stack = document.getElementById('hud-left-stack');
  const mm = document.getElementById('minimap');
  const screen = document.getElementById('screen-game');
  if (!stack || !mm || !screen) return;
  const layout = loadState().settings.mobileLayout;
  const hud = layout?.hud;
  if (hud && hud.left != null && hud.top != null) {
    stack.style.left = hud.left + '%';
    stack.style.top = hud.top + '%';
    stack.style.right = 'auto';
    stack.style.bottom = 'auto';
    return;
  }
  // по умолчанию — справа от миникарты с зазором
  const parent = screen.getBoundingClientRect();
  const r = mm.getBoundingClientRect();
  const left = Math.max(8, r.right - parent.left + 14);
  const top = Math.max(8, r.top - parent.top);
  stack.style.left = left + 'px';
  stack.style.top = top + 'px';
  stack.style.right = 'auto';
  stack.style.bottom = 'auto';
}

function abilityLayoutLooksBroken(layout) {
  if (!layout?.a || !layout?.b || !layout?.c) return true;
  const bottoms = [layout.a.bottom, layout.b.bottom, layout.c.bottom]
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((x, y) => x - y);
  if (bottoms.length < 3) return true;
  // старые пресеты с шагом ~10% на телефоне наезжают
  return bottoms[1] - bottoms[0] < 12 || bottoms[2] - bottoms[1] < 12;
}

function applyMobileLayout() {
  const layout = loadState().settings.mobileLayout;
  const stack = document.getElementById('mob-abil-stack');
  const map = {
    joy: document.getElementById('joystick'),
    a: document.getElementById('mob-a'),
    b: document.getElementById('mob-b'),
    c: document.getElementById('mob-c'),
    mic: document.getElementById('mob-mic'),
  };

  // по умолчанию / битый layout — колонка с gap (не наезжают)
  const useStack = !layout || abilityLayoutLooksBroken(layout);
  stack?.classList.toggle('stacked', useStack);

  Object.entries(map).forEach(([key, el]) => {
    if (!el) return;
    const pos = (!useStack && layout?.[key]) || LAYOUT_DEFAULTS[key];
    if (key === 'a' || key === 'b' || key === 'c') {
      if (useStack) {
        el.style.left = '';
        el.style.bottom = '';
        el.style.right = '';
        el.style.top = '';
      } else if (pos && pos.left != null && pos.bottom != null) {
        el.style.left = pos.left + '%';
        el.style.bottom = pos.bottom + '%';
        el.style.right = 'auto';
        el.style.top = 'auto';
      }
      applySlotSize(el, key, pos?.size ?? LAYOUT_DEFAULTS[key]?.size);
      return;
    }
    if (pos && pos.left != null && pos.bottom != null) {
      el.style.left = pos.left + '%';
      el.style.bottom = pos.bottom + '%';
      el.style.right = 'auto';
      el.style.top = 'auto';
      if (key === 'mic') el.style.transform = '';
    }
    applySlotSize(el, key, pos?.size ?? LAYOUT_DEFAULTS[key]?.size);
  });
  const mm = document.getElementById('minimap');
  const mapPos = layout?.map;
  const mapSize = mapPos?.size ?? LAYOUT_DEFAULTS.map.size;
  if (mm && mapPos && mapPos.left != null && mapPos.top != null) {
    mm.style.left = mapPos.left + '%';
    mm.style.top = mapPos.top + '%';
    mm.style.right = 'auto';
    mm.style.bottom = 'auto';
    mm.classList.remove('right');
    applySlotSize(mm, 'map', mapSize);
  } else if (typeof game !== 'undefined' && game?.refreshMinimapLayout) {
    game.refreshMinimapLayout();
  }
  requestAnimationFrame(placeHudStack);
}

function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

async function toggleFullscreen() {
  try {
    if (isFullscreen()) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } else {
      const root = document.documentElement;
      if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
      else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
    }
  } catch {
    /* iOS Safari без поддержки — ок */
  }
  syncFullscreenBtn();
}

function syncFullscreenBtn() {
  const btn = document.getElementById('btn-fs');
  if (!btn) return;
  const on = isFullscreen();
  btn.textContent = on ? '⛶' : '⛶';
  btn.title = on ? 'Выйти из полного экрана' : 'Полный экран';
  btn.classList.toggle('on', on);
}

const blobEditor = initBlobEditor(cropModal);
const wormEditor = initWormEditor(cropModal);

const game = createGame({
  onDeath(score) {
    document.getElementById('death-score').textContent = `${t('score')}: ${score}`;
    document.getElementById('death-overlay').classList.remove('hidden');
  },
  onPause() {
    game.pause();
    document.getElementById('pause-overlay').classList.remove('hidden');
  },
  onMatchEnd({ score }) {
    document.getElementById('match-end-score').textContent = `${t('score')}: ${score}`;
    document.getElementById('match-end-overlay').classList.remove('hidden');
  },
});

const net = createNet({
  onMessage(msg) {
    if (msg.type === 'error') {
      const el = document.getElementById('room-error');
      if (el) el.textContent = msg.text || 'Ошибка';
      return;
    }
    if (msg.type === 'rooms:list') renderRoomList(msg.rooms || []);
    if (msg.type === 'room:joined') {
      currentRoom = msg.room;
      youAreHost = !!msg.youAreHost;
      enterRoomUI();
    }
    if (msg.type === 'match:joined') {
      currentRoom = msg.room;
      if (currentScreen === 'game') {
        updateVoiceButtons();
        if (!voice.isEnabled()) {
          voice
            .enable()
            .then(() => {
              voice.setMuted(true);
              updateVoiceButtons();
            })
            .catch(() => {});
        }
        return;
      }
      startMatch({
        bots: msg.room?.bots ?? loadState().settings.bots,
        voice: true,
        timed: true,
      });
    }
    if (msg.type === 'match:end') {
      // обычный матч считает время только локально — серверный конец не трогаем
      return;
    }
    if (msg.type === 'room:peers') {
      try {
        renderPeers(msg.peers || []);
      } catch (e) {
        console.warn('peers', e);
      }
    }
    if (msg.type === 'room:start') {
      pendingBots = msg.bots;
      startMatch({ bots: msg.bots, voice: true, timed: false });
    }
    if (msg.type === 'room:left') {
      currentRoom = null;
      if (leavingRoomQuiet) {
        leavingRoomQuiet = false;
        return;
      }
      // не кидать на «приват» если уже ушли в меню / режим / игру
      if (currentScreen === 'room') show('private');
    }
    if (msg.type === 'voice:signal') {
      voice.onSignal(msg.from, msg.data);
    }
    if (msg.type === 'game:state' && msg.from && msg.payload) {
      const p = msg.payload;
      game.upsertVoicePeer(msg.from, {
        x: p.x,
        y: p.y,
        name: msg.name || p.name,
        micOn: !!p.micOn,
        level: p.level || 0,
        form: p.form,
        color: p.color,
        cells: p.cells,
        segs: p.segs,
        score: p.score,
        alive: p.alive !== false,
      });
    }
  },
});

const voice = createVoiceChat({
  net,
  getLocalId: () => net.getId(),
  getDeviceId: () => loadState().settings.micDeviceId || '',
});

function renderPeers(peers) {
  const box = document.getElementById('room-peers');
  if (box) {
    box.innerHTML = peers.map((p) => `<span class="peer-chip">${p.name}</span>`).join('');
  }
  const startBtn = document.getElementById('btn-room-start');
  if (startBtn) startBtn.style.display = youAreHost ? '' : 'none';
  // голос не блокирует игровой цикл
  Promise.resolve()
    .then(() => voice.syncPeers(peers))
    .catch((e) => console.warn('voice peers', e));
}

function enterRoomUI() {
  document.getElementById('room-error').textContent = '';
  document.getElementById('room-code-view').textContent = currentRoom.code;
  document.getElementById('room-bots-view').textContent = currentRoom.bots;
  document.getElementById('room-pass-view').textContent = currentRoom.hasPassword
    ? 'с паролем'
    : 'без пароля';
  document.getElementById('btn-room-start').style.display = youAreHost ? '' : 'none';
  show('room');
  updateVoiceButtons();
}

function renderRoomList(rooms) {
  const list = document.getElementById('room-list');
  if (!rooms.length) {
    list.innerHTML = '<p class="hint">Комнат пока нет — создай свою</p>';
    return;
  }
  list.innerHTML = rooms
    .map(
      (r) => `
    <div class="room-item">
      <div>
        <strong>${r.code}</strong>
        <div class="hint">${r.players} игроков · ботов ${r.bots}${r.hasPassword ? ' · 🔒' : ''}</div>
      </div>
      <button class="btn" data-join-code="${r.code}">Войти</button>
    </div>`,
    )
    .join('');
  list.querySelectorAll('[data-join-code]').forEach((btn) => {
    btn.onclick = () => {
      document.getElementById('room-code-join').value = btn.dataset.joinCode;
      document.getElementById('room-list-panel').classList.add('hidden');
      document.getElementById('room-join-panel').classList.remove('hidden');
    };
  });
}

function updateVoiceButtons() {
  const on = voice.isEnabled();
  const live = on && !voice.isMuted();
  document.getElementById('btn-voice-toggle').textContent = on ? '🎤 Голос: вкл' : '🎤 Голос: выкл';
  document.getElementById('btn-voice-mute').textContent = voice.isMuted() ? '🔇 Мут' : '🔊 Звук';
  const ingame = document.getElementById('btn-voice-ingame');
  const mobMic = document.getElementById('mob-mic');
  const status = document.getElementById('mic-status');
  const key = loadState().settings.micKeyLabel || 'V';
  if (ingame) {
    ingame.classList.remove('hidden');
    ingame.classList.toggle('on', live);
    ingame.textContent = live ? `🎤 Вкл` : `🎤 ${key}`;
  }
  if (mobMic) {
    mobMic.classList.toggle('on', live);
    mobMic.textContent = live ? '🎤 ON' : '🎤';
  }
  status?.classList.toggle('hidden', !live);
}

async function toggleMicLive() {
  if (!voice.isEnabled()) {
    const ok = await voice.enable();
    if (!ok) return;
    voice.setMuted(false);
  } else {
    voice.setMuted(!voice.isMuted());
  }
  updateVoiceButtons();
  syncLocalVoiceVisual();
}

function syncLocalVoiceVisual() {
  const live = voice.isEnabled() && !voice.isMuted();
  game.setLocalVoice(live, live ? voice.getLocalLevel() : 0);
}

/** голос: иконка + рассылка позиции; слышно только кто в FOV */
let voiceTickTimer = 0;
function startVoiceGameplayLoop() {
  if (voiceTickTimer) clearInterval(voiceTickTimer);
  voiceTickTimer = setInterval(() => {
    if (currentScreen !== 'game') return;
    const live = voice.isEnabled() && !voice.isMuted();
    const level = live ? voice.getLocalLevel() : 0;
    game.setLocalVoice(live, level);

    const snap = game.getVoiceSnapshot();
    if (snap && currentRoom) {
      net.sendState(snap);
    }

    // пространственный звук: слышим только видимых
    for (const id of voice.getPeerIds()) {
      const vp = game.getVoicePeer(id);
      if (!vp) {
        voice.setPeerAudible(id, false);
        continue;
      }
      const see = game.isWorldPointVisible(vp.x, vp.y);
      voice.setPeerAudible(id, see);
      // подтянуть уровень анимации с реального аудио если есть
      if (see && vp.micOn) {
        const rl = voice.getRemoteLevel(id);
        if (rl > (vp.level || 0)) {
          game.upsertVoicePeer(id, { ...vp, level: rl });
        }
      }
    }
  }, 80);
}

async function ensureNet() {
  const session = getSession();
  net.connect(session?.name || loadState().nick || 'Player');
}

function resolveForm(raw) {
  if (raw === 'random') return Math.random() < 0.5 ? 'blob' : 'worm';
  return raw === 'worm' ? 'worm' : 'blob';
}

async function startMatch({ bots, voice: useVoice, timed = false, endsAt } = {}) {
  const nick = document.getElementById('input-nick').value.trim() || getSession()?.name || 'Player';
  const formChoice = document.getElementById('input-form').value || 'random';
  const form = resolveForm(formChoice);
  patchState({ nick, form });
  show('game');
  document.getElementById('match-end-overlay')?.classList.add('hidden');
  document.getElementById('pause-overlay')?.classList.add('hidden');
  document.getElementById('death-overlay')?.classList.add('hidden');
  matchStartedAt = Date.now();
  const botCount = bots != null ? bots : loadState().settings.bots;
  await game.start({
    bots: botCount,
    timed: !!timed,
    endsAt: timed ? undefined : endsAt,
    matchMs: 30 * 60 * 1000,
  });
  game.resume();
  if (formChoice === 'random') patchState({ form: 'random' });

  applyMobileLayout();
  placeHudStack();
  startVoiceGameplayLoop();
  // с телефона — сразу полный экран (убирает строку Chrome)
  if (loadState().device === 'mobile' || matchMedia('(pointer: coarse)').matches) {
    toggleFullscreen().catch(() => {});
  }
  // микрофон в фоне — не ждём getUserMedia, чтобы не стопорить матч
  if (useVoice || loadState().settings.voiceChat) {
    voice
      .enable()
      .then(() => {
        voice.setMuted(true);
        updateVoiceButtons();
        syncLocalVoiceVisual();
      })
      .catch(() => {});
  }
  updateVoiceButtons();
  syncLocalVoiceVisual();
  applyI18n();
  syncFullscreenBtn();
  setTimeout(() => {
    if (currentScreen === 'game') game.resume();
  }, 100);
}

function leaveRoomQuietly() {
  leavingRoomQuiet = true;
  currentRoom = null;
  try {
    net.leaveRoom();
  } catch {
    leavingRoomQuiet = false;
  }
}

/* ——— Auth ——— */
document.querySelectorAll('[data-auth-tab]').forEach((tab) => {
  tab.onclick = () => {
    authMode = tab.dataset.authTab;
    document.querySelectorAll('[data-auth-tab]').forEach((t) => t.classList.toggle('active', t === tab));
    document.getElementById('btn-auth-submit').textContent =
      authMode === 'login' ? 'Войти' : 'Зарегистрироваться';
    document.getElementById('auth-error').textContent = '';
  };
});

document.getElementById('btn-auth-submit').onclick = async () => {
  const user = document.getElementById('auth-user').value;
  const pass = document.getElementById('auth-pass').value;
  const res = authMode === 'login' ? await login(user, pass) : await register(user, pass);
  const err = document.getElementById('auth-error');
  if (!res.ok) {
    err.textContent = res.error;
    return;
  }
  err.textContent = '';
  patchState({ nick: res.session.name });
  routeAfterAuth();
};

document.getElementById('btn-logout').onclick = () => {
  clearSession();
  voice.disable();
  show('auth');
};

function routeAfterAuth() {
  const st = loadState();
  applyMenuFromState();
  if (!st.device) show('device');
  else {
    document.body.classList.toggle('mobile', st.device === 'mobile');
    show('menu');
  }
}

document.getElementById('btn-device-pc').onclick = () => {
  patchState({ device: 'pc' });
  document.body.classList.remove('mobile');
  show('menu');
};
document.getElementById('btn-device-mobile').onclick = () => {
  patchState({ device: 'mobile' });
  document.body.classList.add('mobile');
  show('menu');
};

/* ——— Menu / modes ——— */
document.getElementById('btn-play').onclick = () => show('mode');
document.getElementById('btn-mode-back').onclick = () => show('menu');
document.getElementById('btn-mode-public').onclick = async () => {
  // голос готовим (на муте), чтобы в комнате сразу была связь + иконки/FOV
  await startMatch({ bots: loadState().settings.bots, timed: true, voice: true });
  try {
    await ensureNet();
    net.joinPublic();
  } catch {
    /* локально ок */
  }
};
document.getElementById('btn-mode-private').onclick = async () => {
  try {
    await ensureNet();
  } catch {
    /* optional */
  }
  document.getElementById('room-error').textContent = '';
  show('private');
};
document.getElementById('btn-private-back').onclick = () => {
  leaveRoomQuietly();
  show('mode');
};

document.getElementById('btn-room-create-open').onclick = () => {
  document.getElementById('room-create-panel').classList.remove('hidden');
  document.getElementById('room-list-panel').classList.add('hidden');
};
document.getElementById('btn-room-search').onclick = () => {
  document.getElementById('room-list-panel').classList.remove('hidden');
  document.getElementById('room-create-panel').classList.add('hidden');
  net.listRooms();
};
document.getElementById('btn-room-refresh').onclick = () => net.listRooms();

document.getElementById('room-bots').oninput = (e) => {
  document.getElementById('room-bots-label').textContent = e.target.value;
};

document.getElementById('btn-room-create').onclick = async () => {
  await ensureNet();
  net.createRoom({
    code: document.getElementById('room-code-create').value,
    password: document.getElementById('room-pass-create').value,
    bots: Number(document.getElementById('room-bots').value),
    name: getSession()?.name || 'Room',
  });
};

document.getElementById('btn-room-join').onclick = async () => {
  await ensureNet();
  net.joinRoom({
    code: document.getElementById('room-code-join').value,
    password: document.getElementById('room-pass-join').value,
  });
};

document.getElementById('btn-room-start').onclick = () => net.startRoom();
document.getElementById('btn-room-leave').onclick = () => {
  voice.disable();
  leaveRoomQuietly();
  show('private');
};

document.getElementById('btn-voice-toggle').onclick = async () => {
  if (voice.isEnabled()) voice.disable();
  else {
    await voice.enable();
    voice.setMuted(true);
  }
  updateVoiceButtons();
};
document.getElementById('btn-voice-mute').onclick = () => toggleMicLive();
document.getElementById('btn-voice-ingame').onclick = () => toggleMicLive();

/* ——— Settings / skins ——— */
document.getElementById('btn-settings').onclick = async () => {
  applySettingsFromState();
  await refreshMicList();
  show('settings');
};
document.getElementById('btn-settings-back').onclick = () => show('menu');
document.getElementById('btn-settings-save').onclick = () => {
  readSettingsToState();
  document.body.classList.toggle('mobile', loadState().device === 'mobile');
  show('menu');
};
document.getElementById('set-bots').oninput = (e) => {
  document.getElementById('set-bots-label').textContent = e.target.value;
};
document.getElementById('set-joystick').oninput = (e) => {
  document.getElementById('set-joy-label').textContent = e.target.value;
};
document.getElementById('set-mic-device').onchange = async () => {
  const st = loadState();
  patchState({ settings: { ...st.settings, micDeviceId: document.getElementById('set-mic-device').value } });
  await voice.setDeviceId();
};
function clearMobileLayoutStyles() {
  ['joystick', 'mob-a', 'mob-b', 'mob-c', 'mob-mic'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.left = '';
    el.style.bottom = '';
    el.style.right = '';
    el.style.top = '';
    el.style.width = '';
    el.style.height = '';
  });
  const mm = document.getElementById('minimap');
  if (mm) {
    mm.style.left = '';
    mm.style.top = '';
    mm.style.right = '';
    mm.style.bottom = '';
    mm.style.width = '';
    mm.style.height = '';
  }
  document.documentElement.style.removeProperty('--joy-size');
}

function resetMobileLayout() {
  const st = loadState();
  patchState({ settings: { ...st.settings, mobileLayout: null } });
  clearMobileLayoutStyles();
  applyMobileLayout();
}

document.getElementById('btn-layout-reset').onclick = () => resetMobileLayout();

function applyLayoutItemSize(el, slot, size) {
  if (!el || size == null) return;
  if (slot === 'joy') {
    const base = el.querySelector('.layout-joy-base');
    if (base) {
      base.style.width = size + 'px';
      base.style.height = size + 'px';
    }
  } else if (slot === 'map') {
    el.style.width = size + 'px';
    el.style.height = size + 'px';
  } else {
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.fontSize = Math.max(10, Math.round(size * 0.2)) + 'px';
  }
}

function selectLayoutSlot(slot) {
  layoutSelected = slot;
  document.querySelectorAll('#layout-stage .layout-item').forEach((el) => {
    el.classList.toggle('selected', el.dataset.slot === slot);
  });
  const panel = document.getElementById('layout-size-panel');
  const range = document.getElementById('layout-size-range');
  const label = document.getElementById('layout-size-label');
  const value = document.getElementById('layout-size-value');
  if (!slot) {
    panel?.classList.add('hidden');
    return;
  }
  const pos = layoutDraft?.[slot] || LAYOUT_DEFAULTS[slot];
  const size = pos?.size ?? 100;
  const names = {
    joy: t('joystick'),
    map: t('minimap_item'),
    hud: 'HUD',
    a: 'Split',
    b: 'Eject',
    c: 'Pulse',
    mic: 'Mic',
  };
  if (label) label.textContent = `${names[slot] || slot}: ${getLangSizeHint(slot)}`;
  if (range) {
    range.min = slot === 'joy' || slot === 'map' ? '70' : '44';
    range.max = slot === 'joy' || slot === 'map' ? '200' : '120';
    range.value = String(size);
  }
  if (value) value.textContent = String(size);
  panel?.classList.remove('hidden');
}

function getLangSizeHint(slot) {
  return loadState().lang === 'en' ? 'size' : 'размер';
}

function applyLayoutDraftToStage() {
  const draft = layoutDraft || {};
  document.querySelectorAll('#layout-stage .layout-item').forEach((el) => {
    const slot = el.dataset.slot;
    const pos = draft[slot] || LAYOUT_DEFAULTS[slot];
    if (!pos) return;
    el.style.left = pos.left + '%';
    if (pos.top != null) {
      el.style.top = pos.top + '%';
      el.style.bottom = 'auto';
    } else {
      el.style.bottom = pos.bottom + '%';
      el.style.top = 'auto';
    }
    el.style.right = 'auto';
    applyLayoutItemSize(el, slot, pos.size ?? LAYOUT_DEFAULTS[slot]?.size);
  });
}

function openLayoutEditor() {
  const saved = loadState().settings.mobileLayout || {};
  layoutDraft = structuredClone({ ...LAYOUT_DEFAULTS, ...saved });
  for (const key of Object.keys(LAYOUT_DEFAULTS)) {
    layoutDraft[key] = { ...LAYOUT_DEFAULTS[key], ...(saved[key] || {}) };
  }
  layoutSelected = null;
  selectLayoutSlot(null);
  applyLayoutDraftToStage();
  applyI18n();
  show('layout');
}

document.getElementById('btn-layout-open').onclick = () => openLayoutEditor();
document.getElementById('btn-layout-cancel').onclick = () => {
  layoutDraft = null;
  layoutSelected = null;
  show('settings');
};
document.getElementById('btn-layout-reset2').onclick = () => {
  layoutDraft = structuredClone(LAYOUT_DEFAULTS);
  layoutSelected = null;
  selectLayoutSlot(null);
  applyLayoutDraftToStage();
};
document.getElementById('btn-layout-save').onclick = () => {
  const st = loadState();
  patchState({ settings: { ...st.settings, mobileLayout: structuredClone(layoutDraft) } });
  layoutDraft = null;
  layoutSelected = null;
  applyMobileLayout();
  show('settings');
};

document.getElementById('layout-size-range').oninput = (e) => {
  if (!layoutSelected || !layoutDraft) return;
  const size = Number(e.target.value);
  layoutDraft[layoutSelected] = { ...layoutDraft[layoutSelected], size };
  document.getElementById('layout-size-value').textContent = String(size);
  const el = document.querySelector(`#layout-stage .layout-item[data-slot="${layoutSelected}"]`);
  applyLayoutItemSize(el, layoutSelected, size);
};

document.getElementById('set-lang').onchange = () => {
  setLang(document.getElementById('set-lang').value);
};

let capturingKey = false;
document.getElementById('btn-mic-key').onclick = () => {
  const btn = document.getElementById('btn-mic-key');
  capturingKey = true;
  btn.textContent = 'Нажми клавишу…';
};
window.addEventListener('keydown', (e) => {
  if (capturingKey) {
    e.preventDefault();
    capturingKey = false;
    const st = loadState();
    const label = e.key.length === 1 ? e.key.toUpperCase() : e.code.replace('Key', '');
    patchState({ settings: { ...st.settings, micKey: e.code, micKeyLabel: label } });
    document.getElementById('btn-mic-key').textContent = label;
    return;
  }
  const micCode = loadState().settings.micKey || 'KeyV';
  if (e.code === micCode && !e.repeat && currentScreen === 'game') {
    e.preventDefault();
    toggleMicLive();
  }
});

document.getElementById('btn-skins').onclick = () => show('skins');
document.getElementById('btn-skins-back').onclick = () => show('menu');
document.getElementById('btn-skin-blob').onclick = async () => {
  show('blobSkin');
  await blobEditor.open();
};
document.getElementById('btn-skin-worm').onclick = async () => {
  show('wormSkin');
  await wormEditor.open();
};
document.getElementById('btn-blob-skin-back').onclick = () => show('skins');
document.getElementById('btn-worm-skin-back').onclick = () => show('skins');

/* ——— Game overlays ——— */
document.getElementById('btn-pause').onclick = () => {
  game.pause();
  document.getElementById('pause-overlay').classList.remove('hidden');
};
document.getElementById('btn-resume').onclick = () => {
  document.getElementById('pause-overlay').classList.add('hidden');
  game.resume();
};
document.getElementById('btn-quit').onclick = () => {
  game.stop();
  voice.disable();
  game.clearVoicePeers();
  if (voiceTickTimer) clearInterval(voiceTickTimer);
  voiceTickTimer = 0;
  leaveRoomQuietly();
  document.getElementById('pause-overlay').classList.add('hidden');
  matchStartedAt = 0;
  show('menu');
};
document.getElementById('btn-respawn').onclick = () => game.respawn();
document.getElementById('btn-death-menu').onclick = () => {
  game.stop();
  voice.disable();
  game.clearVoicePeers();
  if (voiceTickTimer) clearInterval(voiceTickTimer);
  voiceTickTimer = 0;
  leaveRoomQuietly();
  document.getElementById('death-overlay').classList.add('hidden');
  matchStartedAt = 0;
  show('menu');
};
document.getElementById('btn-match-end-menu').onclick = () => {
  game.stop();
  voice.disable();
  game.clearVoicePeers();
  if (voiceTickTimer) clearInterval(voiceTickTimer);
  voiceTickTimer = 0;
  leaveRoomQuietly();
  document.getElementById('match-end-overlay').classList.add('hidden');
  matchStartedAt = 0;
  show('menu');
};

/* ——— Mobile joystick + abilities + layout editor ——— */
function setupJoystick() {
  const base = document.getElementById('joystick-base');
  const knob = document.getElementById('joystick-knob');
  if (!base || !knob) return;
  let active = false;
  let pid = null;

  const setKnob = (dx, dy, max) => {
    const d = Math.hypot(dx, dy) || 1;
    const clamped = Math.min(d, max);
    const nx = (dx / d) * clamped;
    const ny = (dy / d) * clamped;
    const mag = Math.min(1, clamped / max);
    knob.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
    if (clamped > 8) game.setJoystickAim(nx / max, ny / max, mag);
    else game.clearJoystickAim();
  };

  const onStart = (e) => {
    const t = e.changedTouches ? e.changedTouches[0] : e;
    active = true;
    pid = t.identifier ?? 'mouse';
    onMove(e);
  };
  const onMove = (e) => {
    if (!active) return;
    const t = e.changedTouches
      ? [...e.changedTouches].find((x) => x.identifier === pid) || e.touches[0]
      : e;
    if (!t) return;
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    setKnob(t.clientX - cx, t.clientY - cy, rect.width * 0.35);
    e.preventDefault?.();
  };
  const onEnd = () => {
    active = false;
    pid = null;
    knob.style.transform = 'translate(-50%, -50%)';
    game.clearJoystickAim();
  };

  base.addEventListener('touchstart', onStart, { passive: false });
  base.addEventListener('touchmove', onMove, { passive: false });
  base.addEventListener('touchend', onEnd);
  base.addEventListener('mousedown', onStart);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onEnd);

  const hold = (el, down, up) => {
    if (!el) return;
    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      down();
    }, { passive: false });
    el.addEventListener('touchend', () => up?.());
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      down();
    });
    el.addEventListener('mouseup', () => up?.());
  };
  hold(document.getElementById('mob-a'), () => game.abilityA(), () => game.abilityAEnd());
  hold(document.getElementById('mob-b'), () => game.abilityB());
  hold(document.getElementById('mob-c'), () => game.abilityC());
  document.getElementById('mob-mic')?.addEventListener('click', (e) => {
    e.preventDefault();
    toggleMicLive();
  });
}

function setupLayoutEditorDrag() {
  const stage = document.getElementById('layout-stage');
  if (!stage) return;
  let dragging = null;
  let moved = false;
  let startX = 0;
  let startY = 0;

  const posFromEvent = (e) => {
    const t = e.touches ? e.touches[0] : e;
    const rect = stage.getBoundingClientRect();
    const left = ((t.clientX - rect.left) / rect.width) * 100;
    const top = ((t.clientY - rect.top) / rect.height) * 100;
    const bottom = 100 - top;
    return {
      left: Math.max(1, Math.min(88, left)),
      top: Math.max(1, Math.min(88, top)),
      bottom: Math.max(1, Math.min(88, bottom)),
      clientX: t.clientX,
      clientY: t.clientY,
    };
  };

  const applyPos = (el, pos) => {
    const slot = el.dataset.slot;
    el.style.left = pos.left + '%';
    el.style.right = 'auto';
    if (slot === 'map' || slot === 'hud') {
      el.style.top = pos.top + '%';
      el.style.bottom = 'auto';
    } else {
      el.style.bottom = pos.bottom + '%';
      el.style.top = 'auto';
    }
  };

  stage.querySelectorAll('.layout-item').forEach((el) => {
    const onDown = (e) => {
      if (currentScreen !== 'layout') return;
      dragging = el;
      moved = false;
      const pos = posFromEvent(e);
      startX = pos.clientX;
      startY = pos.clientY;
      selectLayoutSlot(el.dataset.slot);
      e.preventDefault();
      e.stopPropagation();
    };
    el.addEventListener('touchstart', onDown, { passive: false });
    el.addEventListener('mousedown', onDown);
  });

  const onMove = (e) => {
    if (!dragging || currentScreen !== 'layout') return;
    const pos = posFromEvent(e);
    if (Math.hypot(pos.clientX - startX, pos.clientY - startY) > 6) moved = true;
    if (!moved) return;
    applyPos(dragging, pos);
    e.preventDefault?.();
  };
  const onUp = () => {
    if (!dragging) return;
    const slot = dragging.dataset.slot;
    if (layoutDraft && slot && moved) {
      const left = parseFloat(dragging.style.left);
      const prev = layoutDraft[slot] || LAYOUT_DEFAULTS[slot] || {};
      if (slot === 'map' || slot === 'hud') {
        layoutDraft[slot] = { ...prev, left, top: parseFloat(dragging.style.top) };
      } else {
        layoutDraft[slot] = { ...prev, left, bottom: parseFloat(dragging.style.bottom) };
      }
    }
    dragging = null;
    moved = false;
  };
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('touchend', onUp);
  window.addEventListener('mouseup', onUp);
}

setupJoystick();
setupLayoutEditorDrag();
document.getElementById('btn-fs')?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  toggleFullscreen();
});
document.addEventListener('fullscreenchange', syncFullscreenBtn);
document.addEventListener('webkitfullscreenchange', syncFullscreenBtn);
window.addEventListener('resize', () => {
  if (currentScreen === 'game') placeHudStack();
});

/* ——— Boot ——— */
applyI18n();
syncFullscreenBtn();
const session = getSession();
if (session) routeAfterAuth();
else show('auth');
