import { loadState } from './storage.js';
import {
  resolveBlobSkin,
  resolveWormSkin,
  drawCircledImage,
  loadImage,
  BLOB_PRESETS,
  WORM_PRESETS,
} from './skins.js';
import { t } from './i18n.js';

const WORLD = 4800;
const GRID = 28;
const POP_K = 1.25;
const MAX_BLOB_MASS = 2500;
const WORM_EAT_MASS = 1.8; // масса за сегмент (было 7 — слишком жирно)
const WORM_EAT_MAX_PER_SEC = 28;
const WORM_INVIZ_DURATION = 4;
const WORM_INVIZ_CD = 100;
const WORM_INVIZ_MIN_SCORE = 500;
const SAFE_SPAWN_PAD = GRID * 2; // ~2 клетки сетки от врагов/шипов
const MATCH_DEFAULT_MS = 30 * 60 * 1000;
const PULSE_AURA_T = 4; // неуязвимость + отталкивание голов
const PULSE_AURA_PAD = GRID * 2; // аура = радиус большого куска + 2 клетки
const PULSE_CD = 25;
const EJECT_COLORS = [
  '#ff6b6b', '#feca57', '#48dbfb', '#1dd1a1', '#ff9ff3', '#54a0ff',
  '#5f27cd', '#00d2d3', '#ff9f43', '#ee5a24', '#10ac84', '#c8d6e5',
  '#f368e0', '#ff9ff3', '#0abde3', '#2ecc71',
];

const NAMES = [
  'BigBlob', 'CellKing', 'Wormy', 'GreenGuy', 'Newbie', 'Sigma', 'Pepe', 'Doge',
  'Amogus', 'Nyan', 'Chad', 'Sus', 'Pixel', 'Noodles', 'Booster', 'Spike',
];

function rand(a, b) {
  return a + Math.random() * (b - a);
}
function pick(arr) {
  return arr[(Math.random() * arr.length) | 0];
}
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function massToRadius(m) {
  return Math.sqrt(Math.max(1, m)) * 3.05;
}

function wormPower(segs) {
  return segs.length * 10;
}

export function createGame(hooks = {}) {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const lbList = document.getElementById('lb-list');
  const lbYou = document.getElementById('lb-you');
  const lbRoot = document.getElementById('leaderboard');
  const scoreEl = document.getElementById('hud-score');
  const hintEl = document.getElementById('hud-hint');
  const toastEl = document.getElementById('hud-toast');
  const invizHud = document.getElementById('hud-inviz');
  const minimap = document.getElementById('minimap');
  const mctx = minimap?.getContext('2d');
  let lbCollapsed = false;

  let state = loadState();
  let running = false;
  let paused = false;
  let raf = 0;
  let last = 0;

  let foods = [];
  let viruses = [];
  let players = [];
  let me = null;
  let pointer = { x: 0, y: 0, active: false };
  let joystickAim = null; // {x,y} world dir from player, or null
  let cam = { x: 0, y: 0, zoom: 1 };
  let blobSkinImg = null;
  let wormSegImgs = [];
  let botBlobColors = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#9b5de5', '#f15bb5'];
  let toasts = [];
  let keys = { space: false, w: false, q: false };
  let ejectAcc = 0;
  let matchEndsAt = 0;
  let matchTimed = false;
  let matchEnded = false;
  let pulseFx = []; // {x,y,r0,t,tmax,color}
  let botSpawnCd = 0;
  let foodSpawnCd = 0;
  let minimapDomReady = false;
  let minimapAcc = 0;
  let hudAcc = 0;
  /** удалённые игроки для голоса/иконки: id -> {x,y,name,micOn,level,t} */
  const voicePeers = new Map();
  let localMicOn = false;
  let localVoiceLevel = 0;
  /** что шлём друзьям для скина */
  let localSkinMeta = { id: '', src: '', form: 'blob' };
  let multiplayerSpawn = false;
  let localPeerId = '';
  let lastCustomSkinSent = 0;

  function renderScale() {
    const dpr = window.devicePixelRatio || 1;
    // на телефоне ограничиваем DPR — иначе 3x canvas = ~30 FPS
    const mobile = state?.device === 'mobile' || matchMedia('(pointer: coarse)').matches;
    if (mobile) return Math.min(1.5, dpr);
    return Math.min(2, dpr);
  }

  function resize() {
    const scale = renderScale();
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  function toast(msg) {
    toasts.push({ msg, t: 2.2 });
  }

  /** мир → экран (общий — иначе Pulse/mic падают с ReferenceError внутри draw) */
  function toScreen(x, y) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const z = cam.zoom;
    return {
      x: (x - cam.x) * z + w / 2,
      y: (y - cam.y) * z + h / 2,
    };
  }

  function spawnFood(n = 1, bigChance = 0.08) {
    for (let i = 0; i < n; i++) {
      const big = Math.random() < bigChance;
      const huge = Math.random() < 0.015;
      let r;
      let mass;
      if (huge) {
        r = rand(14, 22);
        mass = rand(28, 48);
      } else if (big) {
        r = rand(7, 11);
        mass = rand(8, 16);
      } else {
        r = rand(2.2, 4.2);
        mass = r * 0.55;
      }
      foods.push({
        x: rand(40, WORLD - 40),
        y: rand(40, WORLD - 40),
        r,
        mass,
        color: huge
          ? `hsl(${(Math.random() * 40 + 10) | 0} 90% 50%)`
          : `hsl(${(Math.random() * 360) | 0} 80% 55%)`,
        big: big || huge,
      });
    }
  }

  /** Разные размеры шипов: мелкие / средние / большие / огромные (укрытие для червей) */
  function makeVirus() {
    const roll = Math.random();
    let r;
    if (roll < 0.28) r = rand(22, 30); // мелкий
    else if (roll < 0.58) r = rand(36, 48); // средний
    else if (roll < 0.82) r = rand(60, 85); // большой
    else r = rand(100, 145); // огромный — прятаться от жирных шаров
    return {
      x: rand(280, WORLD - 280),
      y: rand(280, WORLD - 280),
      r,
      // масса, которую получит шар при съедении
      mass: Math.round(r * r * 0.045),
    };
  }

  function spawnViruses(n = 14) {
    viruses = [];
    for (let i = 0; i < n; i++) viruses.push(makeVirus());
  }

  function respawnVirusSoon(index) {
    // убрать съеденный, через мгновение новый в другом месте
    viruses.splice(index, 1);
    setTimeout(() => {
      if (!running) return;
      viruses.push(makeVirus());
    }, 1200);
  }

  function makeBlob(opts) {
    const mass = opts.mass ?? 36;
    return {
      type: 'blob',
      id: opts.id,
      name: opts.name,
      cells: [
        {
          x: opts.x,
          y: opts.y,
          mass,
          vx: 0,
          vy: 0,
          boostVx: 0,
          boostVy: 0,
          born: 0,
        },
      ],
      alive: true,
      isPlayer: !!opts.isPlayer,
      color: opts.color || pick(botBlobColors),
      skin: opts.skin || null,
      splitCd: 0,
      pulseCd: 0,
      pulseAura: 0,
      ejectCd: 0,
      wormEatBank: 0,
      ai: opts.ai || null,
    };
  }

  function makeWorm(opts) {
    const segs = [];
    const n = opts.segments ?? 14;
    for (let i = 0; i < n; i++) segs.push({ x: opts.x - i * 12, y: opts.y });
    return {
      type: 'worm',
      id: opts.id,
      name: opts.name,
      segs,
      angle: 0,
      alive: true,
      isPlayer: !!opts.isPlayer,
      boosting: false,
      boostKey: false,
      boostMouse: false,
      invizT: 0,
      invizCd: 0,
      color: opts.color || pick(botBlobColors),
      skins: opts.skins || null,
      ai: opts.ai || null,
    };
  }

  function isInviz(p) {
    return p.type === 'worm' && p.invizT > 0;
  }

  function syncWormBoost(p) {
    if (!p || p.type !== 'worm') return;
    p.boosting = !!(p.boostKey || p.boostMouse);
  }

  function blobMass(p) {
    return p.cells.reduce((s, c) => s + c.mass, 0);
  }

  function blobCenter(p) {
    let x = 0;
    let y = 0;
    let m = 0;
    for (const c of p.cells) {
      x += c.x * c.mass;
      y += c.y * c.mass;
      m += c.mass;
    }
    return { x: x / m, y: y / m };
  }

  /** самый большой кусок — только он защищён Pulse */
  function largestBlobCell(p) {
    if (!p?.cells?.length) return null;
    let best = p.cells[0];
    for (let i = 1; i < p.cells.length; i++) {
      if (p.cells[i].mass > best.mass) best = p.cells[i];
    }
    return best;
  }

  function pulseAuraOf(p) {
    const cell = largestBlobCell(p);
    if (!cell) return null;
    const br = massToRadius(cell.mass);
    return { cell, x: cell.x, y: cell.y, br, r: br + PULSE_AURA_PAD };
  }

  function radiusOfWorm(p) {
    return 10 + Math.min(9, p.segs.length * 0.12);
  }

  function scoreOf(p) {
    if (!p.alive) return 0;
    if (p.type === 'blob') return Math.floor(blobMass(p));
    return Math.floor(wormPower(p.segs));
  }

  function head(p) {
    if (p.type === 'blob') return blobCenter(p);
    return p.segs[0];
  }

  function dropPellets(x, y, amount, spread = 40, along = null) {
    const n = Math.min(55, Math.max(6, Math.ceil(amount / 6)));
    for (let i = 0; i < n; i++) {
      let px = x + rand(-spread, spread);
      let py = y + rand(-spread, spread);
      if (along && along.length) {
        const s = along[(Math.random() * along.length) | 0];
        px = s.x + rand(-10, 10);
        py = s.y + rand(-10, 10);
      }
      const big = amount > 80 && Math.random() < 0.25;
      foods.push({
        x: clamp(px, 20, WORLD - 20),
        y: clamp(py, 20, WORLD - 20),
        r: big ? rand(6, 10) : rand(3, 5.5),
        mass: big ? rand(10, 18) : rand(2.5, 5),
        color: `hsl(${(Math.random() * 360) | 0} 75% 50%)`,
        big,
      });
    }
  }

  function kill(p) {
    if (!p.alive) return;
    if (isInviz(p)) return; // бессмертие в инвизе
    const sc = scoreOf(p);
    const h = head(p);
    p.alive = false;
    if (p.type === 'worm') {
      dropPellets(h.x, h.y, Math.max(24, sc), 30, p.segs);
    } else {
      for (const c of p.cells) dropPellets(c.x, c.y, Math.max(12, c.mass * 0.7), massToRadius(c.mass));
    }
    if (p.isPlayer) hooks.onDeath?.(sc);
    else if (!p.ai) toast(t('eliminated', { name: p.name })); // только реальные игроки, не боты
  }

  function spawnClearance(x, y, selfR) {
    for (const v of viruses) {
      if (dist({ x, y }, v) < v.r + selfR + SAFE_SPAWN_PAD) return false;
    }
    for (const p of players) {
      if (!p.alive) continue;
      if (p.type === 'blob') {
        const c = p.cells[0];
        if (c && dist({ x, y }, c) < massToRadius(c.mass) + selfR + SAFE_SPAWN_PAD) return false;
      } else if (p.segs?.[0]) {
        if (dist({ x, y }, p.segs[0]) < radiusOfWorm(p) + selfR + SAFE_SPAWN_PAD) return false;
      }
    }
    return true;
  }

  function findSafeSpawn(selfR = 36, margin = 700, attempts = 24) {
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < attempts; i++) {
      const x = rand(margin, WORLD - margin);
      const y = rand(margin, WORLD - margin);
      if (spawnClearance(x, y, selfR)) return { x, y };
      let minD = Infinity;
      for (const v of viruses) minD = Math.min(minD, dist({ x, y }, v) - v.r);
      for (const p of players) {
        if (!p.alive) continue;
        if (p.type === 'blob' && p.cells[0]) {
          minD = Math.min(minD, dist({ x, y }, p.cells[0]) - massToRadius(p.cells[0].mass));
        } else if (p.segs?.[0]) {
          minD = Math.min(minD, dist({ x, y }, p.segs[0]) - radiusOfWorm(p));
        }
      }
      if (minD > bestScore) {
        bestScore = minD;
        best = { x, y };
      }
    }
    return best || { x: WORLD / 2, y: WORLD / 2 };
  }

  function multiplayerSpawnPos() {
    // общий кластер в центре мира — друзья спавнятся рядом, а не на разных концах карты
    let hash = 0;
    const s = String(localPeerId || state.nick || 'p');
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    const ang = ((hash % 360) / 360) * Math.PI * 2;
    const rad = 80 + (hash % 140);
    return {
      x: clamp(WORLD / 2 + Math.cos(ang) * rad, 200, WORLD - 200),
      y: clamp(WORLD / 2 + Math.sin(ang) * rad, 200, WORLD - 200),
    };
  }

  function spawnPlayer() {
    const selfR = state.form === 'worm' ? 18 : massToRadius(42);
    const { x, y } = multiplayerSpawn ? multiplayerSpawnPos() : findSafeSpawn(selfR, 700);
    if (state.form === 'worm') {
      me = makeWorm({
        id: 'me',
        name: state.nick || 'Player',
        x,
        y,
        segments: 16,
        isPlayer: true,
        skins: wormSegImgs,
      });
    } else {
      me = makeBlob({
        id: 'me',
        name: state.nick || 'Player',
        x,
        y,
        mass: 42,
        isPlayer: true,
        skin: blobSkinImg,
      });
    }
    players.push(me);
  }

  function buildLocalSkinMeta() {
    if (state.form === 'worm') {
      const id = state.wormSkinId || 'nyan';
      if (id === 'custom' && state.customWorm?.segments?.[0]) {
        return { id, src: state.customWorm.segments[0], form: 'worm' };
      }
      const preset = WORM_PRESETS.find((p) => p.id === id) || WORM_PRESETS[4];
      return { id, src: preset.src || '', form: 'worm' };
    }
    const id = state.blobSkinId || 'doge';
    if (id === 'custom' && state.customBlob?.dataUrl) {
      return { id, src: state.customBlob.dataUrl, form: 'blob' };
    }
    const preset = BLOB_PRESETS.find((p) => p.id === id) || BLOB_PRESETS[1];
    return { id, src: preset.src || '', form: 'blob' };
  }

  async function ensurePeerSkin(rp) {
    if (!rp?.skinSrc) {
      rp.skinImg = null;
      return;
    }
    if (rp._skinKey === rp.skinSrc && rp.skinImg) return;
    rp._skinKey = rp.skinSrc;
    rp.skinImg = null;
    const img = await loadImage(rp.skinSrc);
    if (rp._skinKey === rp.skinSrc) rp.skinImg = img;
  }

  function spawnBots(n) {
    for (let i = 0; i < n; i++) {
      const isWorm = Math.random() < 0.45;
      // быстрый спавн ботов без тяжёлого поиска — не лагает миникарта/кадр
      const x = rand(200, WORLD - 200);
      const y = rand(200, WORLD - 200);
      const name = pick(NAMES) + (i + 1);
      if (isWorm) {
        players.push(
          makeWorm({
            id: 'bot' + Math.random().toString(36).slice(2, 7),
            name,
            x,
            y,
            segments: 10 + ((Math.random() * 18) | 0),
            ai: { tx: x, ty: y, think: 0, mode: 'forage', targetId: null },
          }),
        );
      } else {
        players.push(
          makeBlob({
            id: 'bot' + Math.random().toString(36).slice(2, 7),
            name,
            x,
            y,
            mass: 30 + Math.random() * 70,
            ai: { tx: x, ty: y, think: 0, mode: 'forage', targetId: null },
          }),
        );
      }
    }
  }

  function worldPointer() {
    if (joystickAim && me && me.alive) {
      const h = head(me);
      // дистанция цели зависит от силы наклона — не всегда «полный газ»
      const mag = clamp(joystickAim.mag ?? 1, 0, 1);
      const reach = 50 + mag * 220;
      return { x: h.x + joystickAim.x * reach, y: h.y + joystickAim.y * reach };
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    const z = cam.zoom;
    return {
      x: cam.x + (pointer.x - w / 2) / z,
      y: cam.y + (pointer.y - h / 2) / z,
    };
  }

  function playerMoveScale() {
    if (!joystickAim) return 1;
    // квадрат для более мягкого старта стика
    const mag = clamp(joystickAim.mag ?? 1, 0, 1);
    return mag * mag;
  }

  function applyMinimapDomPos() {
    if (!minimap) return;
    const pos = state.settings.mobileLayout?.map;
    if (pos && pos.left != null && pos.top != null) {
      minimap.style.left = pos.left + '%';
      minimap.style.top = pos.top + '%';
      minimap.style.right = 'auto';
      minimap.style.bottom = 'auto';
      minimap.classList.remove('right');
      return;
    }
    minimap.style.left = '';
    minimap.style.top = '';
    minimap.style.right = '';
    minimap.style.bottom = '';
    const side = state.settings.minimapSide || 'left';
    minimap.classList.toggle('right', side === 'right' || side === 'top-right');
  }

  function drawMinimap(force = false) {
    if (!mctx || !minimap || !me || !me.alive) return;
    if (!force && minimapAcc < 0.22) return; // ~4–5 FPS — меньше хитчей
    minimapAcc = 0;

    if (!minimapDomReady) {
      applyMinimapDomPos();
      minimapDomReady = true;
    }

    const size = minimap.width;
    mctx.clearRect(0, 0, size, size);
    mctx.fillStyle = '#fafafa';
    mctx.fillRect(0, 0, size, size);
    mctx.strokeStyle = '#ccc';
    mctx.strokeRect(0.5, 0.5, size - 1, size - 1);

    const mapW = window.innerWidth / cam.zoom;
    const mapH = window.innerHeight / cam.zoom;
    const left = cam.x - mapW / 2;
    const top = cam.y - mapH / 2;
    const invW = size / mapW;
    const invH = size / mapH;

    // только игроки (шипы на миникарте убраны — главный источник лагов)
    let mePx = 0;
    let mePy = 0;
    mctx.fillStyle = '#9b5de5';
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (!p.alive || p.isPlayer) continue;
      const pos = p.type === 'blob' ? p.cells[0] : p.segs?.[0];
      if (!pos) continue;
      if (pos.x < left || pos.x > left + mapW || pos.y < top || pos.y > top + mapH) continue;
      if (p.type === 'worm') mctx.fillStyle = '#118ab2';
      else mctx.fillStyle = '#9b5de5';
      const px = (pos.x - left) * invW;
      const py = (pos.y - top) * invH;
      mctx.fillRect(px - 2, py - 2, 4, 4);
    }
    if (me.alive) {
      const pos = me.type === 'blob' ? (largestBlobCell(me) || me.cells[0]) : me.segs?.[0];
      if (pos) {
        mePx = (pos.x - left) * invW;
        mePy = (pos.y - top) * invH;
        mctx.fillStyle = '#e76f51';
        mctx.fillRect(mePx - 4, mePy - 4, 8, 8);
        mctx.strokeStyle = '#e76f51';
        mctx.strokeRect(mePx - 6, mePy - 6, 12, 12);
      }
    }
  }

  function eatFoodBlob(cell, owner) {
    const r = massToRadius(cell.mass);
    for (let i = foods.length - 1; i >= 0; i--) {
      const f = foods[i];
      // свои выстрелы сразу не подбираем
      if (f.grace > 0 && owner && f.ownerId === owner.id) continue;
      if (dist(cell, f) < r + f.r * 0.6) {
        cell.mass = Math.min(MAX_BLOB_MASS, cell.mass + (f.mass ?? f.r * 0.55));
        foods.splice(i, 1);
      }
    }
  }

  function updateBlob(p, dt, target) {
    if (!p.cells?.length || !target) return;
    p.splitCd = Math.max(0, p.splitCd - dt);
    p.pulseCd = Math.max(0, p.pulseCd - dt);
    p.ejectCd = Math.max(0, p.ejectCd - dt);
    if (p.pulseAura > 0) p.pulseAura = Math.max(0, p.pulseAura - dt);
    p.wormEatBank = Math.max(0, p.wormEatBank - WORM_EAT_MAX_PER_SEC * dt);

    // merge cells
    for (let i = 0; i < p.cells.length; i++) {
      for (let j = i + 1; j < p.cells.length; j++) {
        const a = p.cells[i];
        const b = p.cells[j];
        const age = Math.min(a.born, b.born);
        if (age < 6) continue;
        const ra = massToRadius(a.mass);
        const rb = massToRadius(b.mass);
        if (dist(a, b) < Math.max(ra, rb) * 0.55) {
          const total = a.mass + b.mass;
          a.x = (a.x * a.mass + b.x * b.mass) / total;
          a.y = (a.y * a.mass + b.y * b.mass) / total;
          a.mass = total;
          p.cells.splice(j, 1);
          j--;
        }
      }
    }

    for (const cell of p.cells) {
      cell.born += dt;
      const r = massToRadius(cell.mass);
      const baseSpeed = 200 / Math.pow(r / 18, 0.42);
      const sens = state.settings.sensitivity || 1;
      const dx = target.x - cell.x;
      const dy = target.y - cell.y;
      const d = Math.hypot(dx, dy) || 1;
      const stick = p.isPlayer ? playerMoveScale() : 1;
      const sp = baseSpeed * sens * stick;
      cell.vx = (dx / d) * sp + cell.boostVx;
      cell.vy = (dy / d) * sp + cell.boostVy;
      cell.boostVx *= Math.pow(0.05, dt);
      cell.boostVy *= Math.pow(0.05, dt);
      cell.x = clamp(cell.x + cell.vx * dt, r, WORLD - r);
      cell.y = clamp(cell.y + cell.vy * dt, r, WORLD - r);

      // soft drain when huge
      if (cell.mass > 900) cell.mass -= dt * (cell.mass - 900) * 0.012;

      eatFoodBlob(cell, p);
    }
  }

  function updateWorm(p, dt, target) {
    if (!p.segs?.length || !target) return;
    const h = p.segs[0];
    const dx = target.x - h.x;
    const dy = target.y - h.y;
    // цель слишком близко к голове — не дёргаем угол (анти-спин на месте)
    const aimDist = Math.hypot(dx, dy);
    if (aimDist > 18) {
      const desired = Math.atan2(dy, dx);
      let diff = desired - p.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      // Wormax-style разворот, но в 2 раза шустрее прежнего
      // ~4.3 рад/с ≈ 245°/с — разворот на 180° ~0.75с
      const turnRate = p.boosting ? 3.1 : 4.3;
      p.angle += clamp(diff, -turnRate * dt, turnRate * dt);
    }

    const cruise = 150;
    const boost = p.boosting && p.segs.length > 8 ? 235 : cruise;
    const sens = state.settings.sensitivity || 1;
    const stick = p.isPlayer ? playerMoveScale() : 1;
    // без наклона стика червь не несётся на полном ходу
    if (p.isPlayer && joystickAim && stick < 0.02) {
      // стоим / почти стоим — только слегка подтягиваем тело
    } else {
      const sp = boost * sens * (p.isPlayer && joystickAim ? Math.max(0.2, stick) : 1);
      const nx = clamp(h.x + Math.cos(p.angle) * sp * dt, 14, WORLD - 14);
      const ny = clamp(h.y + Math.sin(p.angle) * sp * dt, 14, WORLD - 14);
      h.x = nx;
      h.y = ny;
    }
    const spacing = 11;
    for (let i = 1; i < p.segs.length; i++) {
      const prev = p.segs[i - 1];
      const cur = p.segs[i];
      const d = dist(prev, cur) || 0.0001;
      if (d > spacing) {
        const pull = (d - spacing) / d;
        cur.x += (prev.x - cur.x) * pull;
        cur.y += (prev.y - cur.y) * pull;
      } else if (d < spacing * 0.85) {
        // слегка раздвигаем, чтобы сегменты не схлопывались в кучу
        const push = (spacing - d) / d;
        cur.x -= (prev.x - cur.x) * push * 0.5;
        cur.y -= (prev.y - cur.y) * push * 0.5;
      }
    }

    if (p.boosting && p.segs.length > 9) {
      if (Math.random() < dt * 5) {
        const tail = p.segs[p.segs.length - 1];
        foods.push({
          x: tail.x + rand(-3, 3),
          y: tail.y + rand(-3, 3),
          r: 3.2,
          mass: 2.2,
          color: p.color,
        });
        if (p.segs.length > 10) p.segs.pop();
      }
    }

    const hr = radiusOfWorm(p);
    const headSeg = p.segs[0];
    for (let i = foods.length - 1; i >= 0; i--) {
      const f = foods[i];
      if (dist(headSeg, f) < hr + f.r) {
        const gain = Math.max(1, Math.round((f.mass ?? 3) / 3));
        const tail = p.segs[p.segs.length - 1];
        for (let g = 0; g < gain; g++) {
          p.segs.push({ x: tail.x, y: tail.y });
        }
        foods.splice(i, 1);
      }
    }
    // потолок длины
    while (p.segs.length > 140) p.segs.pop();

    if (p.invizT > 0) p.invizT = Math.max(0, p.invizT - dt);
    if (p.invizCd > 0) p.invizCd = Math.max(0, p.invizCd - dt);
  }

  function predictPos(pos, velApprox, t) {
    return {
      x: clamp(pos.x + (velApprox?.x || 0) * t, 40, WORLD - 40),
      y: clamp(pos.y + (velApprox?.y || 0) * t, 40, WORLD - 40),
    };
  }

  function entityVel(o) {
    if (o.type === 'blob') {
      const c = o.cells[0];
      return { x: c?.vx || 0, y: c?.vy || 0 };
    }
    const sp = o.boosting ? 235 : 150;
    return { x: Math.cos(o.angle) * sp, y: Math.sin(o.angle) * sp };
  }

  function steerAwayFromViruses(from, to, myR, isWormHead) {
    let x = to.x;
    let y = to.y;
    for (const v of viruses) {
      const dangerR = v.r + myR + (isWormHead ? 28 : 8);
      const d = dist(from, v);
      if (d < dangerR * 1.8) {
        const ang = Math.atan2(from.y - v.y, from.x - v.x);
        const push = (dangerR * 1.8 - d) * 0.65;
        x += Math.cos(ang) * push;
        y += Math.sin(ang) * push;
      }
    }
    return { x: clamp(x, 60, WORLD - 60), y: clamp(y, 60, WORLD - 60) };
  }

  function bestFoodTarget(from, preferBig = true) {
    let best = null;
    let bestScore = -Infinity;
    for (const f of foods) {
      if (f.grace > 0) continue;
      const d = dist(from, f) || 1;
      if (d > 700) continue;
      let s = (f.mass || f.r) / (d * 0.15 + 1);
      if (preferBig && f.big) s *= 2.4;
      // штраф если еда у опасного шипа для червя считается снаружи
      if (s > bestScore) {
        bestScore = s;
        best = f;
      }
    }
    return best;
  }

  /** Утилитарный ИИ: все цели равны (бот/игрок), без «травли» человека пачкой */
  function decideBlobAI(p) {
    const ai = p.ai;
    const c = blobCenter(p);
    const myMass = blobMass(p);
    const myR = massToRadius(myMass / Math.max(1, p.cells.length));

    let best = { score: -1e9, mode: 'forage', tx: c.x, ty: c.y, targetId: null, act: null };

    const consider = (score, mode, tx, ty, extra = {}) => {
      if (score > best.score) best = { score, mode, tx, ty, ...extra };
    };

    // еда
    const food = bestFoodTarget(c, true);
    if (food) consider(12 + (food.mass || 3) * 0.4 - dist(c, food) * 0.02, 'forage', food.x, food.y);

    // шипы
    for (const v of viruses) {
      const d = dist(c, v);
      if (d > 650) continue;
      if (myR >= v.r * 1.05) {
        consider(18 + v.mass * 0.08 - d * 0.015, 'virus', v.x, v.y);
      } else {
        // обходить как стену — лёгкий штраф если путь через него
        const toFood = food || { x: ai.tx, y: ai.ty };
        if (dist(c, toFood) > d && dist(v, toFood) < v.r + 80) {
          const ang = Math.atan2(c.y - v.y, c.x - v.x);
          consider(6, 'avoid', v.x + Math.cos(ang) * (v.r + myR + 50), v.y + Math.sin(ang) * (v.r + myR + 50));
        }
      }
    }

    for (const o of players) {
      if (!o.alive || o === p) continue;

      if (o.type === 'blob') {
        const om = blobMass(o);
        const oc = blobCenter(o);
        const d = dist(c, oc);
        if (d > 950) continue;
        const ratio = myMass / (om || 1);

        if (ratio < 1 / 1.15 && d < 560) {
          // бежать — чем ближе и жирнее враг, тем выше приоритет
          const threat = (om / myMass) * (500 / (d + 40));
          const away = {
            x: c.x - (oc.x - c.x) * 1.4,
            y: c.y - (oc.y - c.y) * 1.4,
          };
          consider(40 + threat, 'flee', away.x, away.y, { act: 'fleeBlob', foe: o });
        } else if (ratio > 1.15 && d < 780) {
          // преследование с предиктом
          const vel = entityVel(o);
          const eta = clamp(d / 180, 0.15, 1.1);
          const pred = predictPos(oc, vel, eta);
          const hunt = (myMass - om) * 0.04 + 28 - d * 0.03;
          // не все бегут на одну жирную цель: лёгкий рандом + штраф если уже много охотников рядом
          let contest = 0;
          for (const other of players) {
            if (!other.alive || other === p || other.type !== 'blob' || !other.ai) continue;
            if (other.ai.targetId === o.id && other.ai.mode === 'chase') contest += 1;
          }
          consider(hunt - contest * 7 + rand(-2, 2), 'chase', pred.x, pred.y, {
            targetId: o.id,
            act: 'chaseBlob',
            foe: o,
          });
        }
      } else if (!isInviz(o)) {
        const head = o.segs[0];
        const W = wormPower(o.segs);
        const dHead = dist(c, head);

        // опасная голова
        if (W * 1.2 >= myMass * POP_K * 0.85 && dHead < myR + 220) {
          const away = {
            x: c.x - (head.x - c.x) * 1.6,
            y: c.y - (head.y - c.y) * 1.6,
          };
          consider(55 + W * 0.05 - dHead * 0.05, 'flee', away.x, away.y, {
            act: 'fleeWorm',
            foe: o,
          });
        }

        // грызть тело: хвост вкуснее головы (безопаснее)
        const n = o.segs.length;
        for (let i = Math.floor(n * 0.35); i < n; i += 2) {
          const s = o.segs[i];
          const d = dist(c, s);
          if (d > myR + 160) continue;
          // чем дальше сегмент от головы — тем выгоднее
          const safe = i / n;
          const headThreat = W * 1.2 >= myMass * POP_K * 0.9 ? dist(s, head) : 999;
          let graze = 22 + safe * 16 - d * 0.05;
          if (headThreat < 140) graze -= 25; // голова близко к точке укуса — опасно
          consider(graze, 'graze', s.x, s.y, { act: 'graze', foe: o });
        }
      }
    }

    // применить лучший план
    let goal = steerAwayFromViruses(c, { x: best.tx, y: best.ty }, myR, false);
    ai.mode = best.mode;
    ai.targetId = best.targetId || null;
    ai.tx = goal.x;
    ai.ty = goal.y;

    // способности по ситуации
    if (best.act === 'fleeWorm' || best.act === 'fleeBlob') {
      if (best.act === 'fleeWorm' && p.pulseCd <= 0) doBlobPulse(p);
      if (p.splitCd <= 0 && myMass > 100 && Math.random() < 0.4) {
        doBlobSplit(p, { x: ai.tx, y: ai.ty });
      }
    }
    if (best.act === 'chaseBlob' && best.foe) {
      const d = dist(c, blobCenter(best.foe));
      if (d > 160 && d < 380 && p.splitCd <= 0 && myMass > 110) {
        doBlobSplit(p, blobCenter(best.foe));
      }
    }
  }

  function decideWormAI(p) {
    const ai = p.ai;
    const h = p.segs[0];
    const power = wormPower(p.segs);
    const myR = radiusOfWorm(p);

    let best = { score: -1e9, mode: 'forage', tx: h.x, ty: h.y, boost: false, act: null, foe: null };

    const consider = (score, mode, tx, ty, extra = {}) => {
      if (score > best.score) best = { score, mode, tx, ty, boost: false, ...extra };
    };

    // тело подгрызают? срочно уводить хвост (= вести голову от угрозы так, чтобы лента ушла)
    for (const o of players) {
      if (!o.alive || o === p || o.type !== 'blob') continue;
      const oc = blobCenter(o);
      const br = massToRadius(blobMass(o) / Math.max(1, o.cells.length));
      for (let i = 4; i < p.segs.length; i += 3) {
        const s = p.segs[i];
        if (dist(oc, s) < br + 8) {
          // уводим голову перпендикулярно / от шара, чтобы вытянуть тело
          const ang = Math.atan2(h.y - oc.y, h.x - oc.x) + (Math.random() < 0.5 ? 1.1 : -1.1);
          consider(
            70,
            'escapeBody',
            h.x + Math.cos(ang) * 260,
            h.y + Math.sin(ang) * 260,
            { boost: true, act: 'bodyEaten', foe: o },
          );
          break;
        }
      }
    }

    const food = bestFoodTarget(h, true);
    if (food) {
      let fs = 10 + (food.mass || 3) * 0.5 - dist(h, food) * 0.02;
      // не есть у шипа
      for (const v of viruses) {
        if (dist(food, v) < v.r + 30) fs -= 20;
      }
      consider(fs, 'forage', food.x, food.y);
    }

    for (const o of players) {
      if (!o.alive || o === p || isInviz(o)) continue;

      if (o.type === 'blob') {
        const om = blobMass(o);
        const oc = blobCenter(o);
        const br = massToRadius(om);
        const d = dist(h, oc);
        if (d > 900) continue;
        const canPop = power * (1.15) >= om * POP_K;
        const canPopBoost = power * 1.25 >= om * POP_K;

        if (!canPopBoost && d < br + 200) {
          const away = { x: h.x - (oc.x - h.x) * 1.5, y: h.y - (oc.y - h.y) * 1.5 };
          consider(50 + (br + 200 - d) * 0.2, 'flee', away.x, away.y, {
            boost: d < br + 140,
            act: 'fleeBlob',
            foe: o,
          });
        } else if (canPop && d < 720) {
          const vel = entityVel(o);
          const eta = clamp(d / 220, 0.1, 0.9);
          const pred = predictPos(oc, vel, eta);
          // атака в край круга, не в центр
          const ang = Math.atan2(h.y - pred.y, h.x - pred.x) + rand(-0.35, 0.35);
          const aim = {
            x: pred.x + Math.cos(ang) * br * 0.55,
            y: pred.y + Math.sin(ang) * br * 0.55,
          };
          let hunt = 30 + (power - om * POP_K) * 0.08 - d * 0.025;
          // не толпой на одного: штраф за уже охотящихся червей
          let contest = 0;
          for (const w of players) {
            if (!w.alive || w === p || w.type !== 'worm' || !w.ai) continue;
            if (w.ai.targetId === o.id && (w.ai.mode === 'hunt' || w.ai.mode === 'cut')) contest++;
          }
          hunt -= contest * 8;
          consider(hunt + rand(-3, 3), 'hunt', aim.x, aim.y, {
            boost: d < 380 && canPopBoost,
            targetId: o.id,
            act: 'huntBlob',
            foe: o,
          });
        }
      } else {
        // резка: целимся в сегменты с перехватом
        const oh = o.segs[0];
        const dHead = dist(h, oh);
        // не врезаться в чужую голову в лоб без преимущества
        if (dHead < 90) {
          const ang = Math.atan2(h.y - oh.y, h.x - oh.x);
          consider(25, 'avoidHead', h.x + Math.cos(ang) * 120, h.y + Math.sin(ang) * 120, {
            boost: true,
          });
        }
        for (let i = 8; i < o.segs.length; i += 3) {
          const s = o.segs[i];
          const d = dist(h, s);
          if (d > 480) continue;
          const vel = entityVel(o);
          // тело почти стоит относительно головы — лёгкий предикт вдоль ленты
          const pred = { x: s.x + vel.x * 0.05, y: s.y + vel.y * 0.05 };
          let cut = 26 - d * 0.04 + i * 0.02;
          let contest = 0;
          for (const w of players) {
            if (!w.alive || w === p || w.type !== 'worm' || !w.ai) continue;
            if (w.ai.targetId === o.id && w.ai.mode === 'cut') contest++;
          }
          cut -= contest * 6;
          consider(cut, 'cut', pred.x, pred.y, {
            boost: d < 260,
            targetId: o.id,
            act: 'cut',
          });
        }
      }
    }

    // инвиз: только критично и с 1500+
    if (
      (best.act === 'fleeBlob' || best.act === 'bodyEaten') &&
      scoreOf(p) >= WORM_INVIZ_MIN_SCORE &&
      p.invizCd <= 0 &&
      p.invizT <= 0 &&
      best.foe &&
      dist(h, best.foe.type === 'blob' ? blobCenter(best.foe) : best.foe.segs[0]) < 240
    ) {
      doWormInviz(p);
    }

    // укрытие за огромным шипом при побеге
    if (best.mode === 'flee' || best.mode === 'escapeBody') {
      let cover = null;
      for (const v of viruses) {
        if (v.r < 75) continue;
        const d = dist(h, v);
        if (d < 520 && (!cover || d < dist(h, cover))) cover = v;
      }
      if (cover && best.foe) {
        const foeP = best.foe.type === 'blob' ? blobCenter(best.foe) : best.foe.segs[0];
        const ang = Math.atan2(cover.y - foeP.y, cover.x - foeP.x);
        best.tx = cover.x + Math.cos(ang) * (cover.r + 55);
        best.ty = cover.y + Math.sin(ang) * (cover.r + 55);
        best.boost = true;
      }
    }

    const goal = steerAwayFromViruses(h, { x: best.tx, y: best.ty }, myR, true);
    ai.mode = best.mode;
    ai.targetId = best.targetId || null;
    ai.tx = goal.x;
    ai.ty = goal.y;
    p.boosting = !!best.boost && p.segs.length > 9;
  }

  function updateAI(p, dt) {
    if (!p.ai) return { x: 0, y: 0 };
    const ai = p.ai;
    ai.think = (ai.think || 0) - dt;

    // экстренный пересмотр: угроза рядом
    if (ai.think > 0.05) {
      const mePos = p.type === 'blob' ? blobCenter(p) : p.segs[0];
      for (const o of players) {
        if (!o.alive || o === p) continue;
        if (p.type === 'blob' && o.type === 'blob') {
          if (blobMass(o) > blobMass(p) * 1.2 && dist(mePos, blobCenter(o)) < 200) {
            ai.think = 0;
            break;
          }
        }
        if (p.type === 'worm' && o.type === 'blob') {
          const oc = blobCenter(o);
          const br = massToRadius(blobMass(o));
          if (dist(mePos, oc) < br + 90) {
            ai.think = 0;
            break;
          }
          // грызут тело
          for (let i = 5; i < p.segs.length; i += 4) {
            if (dist(oc, p.segs[i]) < br + 6) {
              ai.think = 0;
              break;
            }
          }
        }
      }
    }

    if (ai.think <= 0) {
      ai.think = rand(0.18, 0.45); // чаще думают = умнее реагируют
      if (p.type === 'blob') decideBlobAI(p);
      else decideWormAI(p);
    } else {
      // догоняем цель между тиками мысли
      if (ai.targetId && (ai.mode === 'chase' || ai.mode === 'hunt' || ai.mode === 'cut')) {
        const prey = players.find((o) => o.id === ai.targetId && o.alive);
        if (!prey) ai.think = 0;
        else if (prey.type === 'blob') {
          const pc = blobCenter(prey);
          const pred = predictPos(pc, entityVel(prey), 0.35);
          ai.tx = pred.x;
          ai.ty = pred.y;
          if (p.type === 'blob' && blobMass(prey) * 1.12 >= blobMass(p)) ai.think = 0;
          if (p.type === 'worm' && wormPower(p.segs) * 1.25 < blobMass(prey) * POP_K) ai.think = 0;
        }
      }
      if (ai.mode === 'flee' || ai.mode === 'escapeBody') {
        if (p.type === 'worm') p.boosting = true;
      }
    }

    return { x: ai.tx, y: ai.ty };
  }

  function collisions() {
    const alive = players.filter((p) => p.alive);

    // worm vs worm
    for (const a of alive) {
      // в инвизе проходим сквозь всех и никого не «триггерим» на свою смерть от тела
      if (a.type !== 'worm' || !a.alive || isInviz(a)) continue;
      const ah = a.segs[0];
      const ar = radiusOfWorm(a);
      for (const b of alive) {
        if (b === a || b.type !== 'worm' || !b.alive) continue;
        // тело инвиз-червя неосязаемо — сквозь него можно проходить
        if (isInviz(b)) continue;
        for (let i = 5; i < b.segs.length; i++) {
          if (dist(ah, b.segs[i]) < ar + 5) {
            kill(a);
            break;
          }
        }
      }
    }

    // blob vs blob (cells)
    for (let i = 0; i < alive.length; i++) {
      const A = alive[i];
      if (A.type !== 'blob' || !A.alive) continue;
      for (let j = 0; j < alive.length; j++) {
        if (i === j) continue;
        const B = alive[j];
        if (B.type !== 'blob' || !B.alive) continue;
        for (const ca of A.cells) {
          for (let bi = B.cells.length - 1; bi >= 0; bi--) {
            const cb = B.cells[bi];
            const ra = massToRadius(ca.mass);
            const rb = massToRadius(cb.mass);
            if (ca.mass > cb.mass * 1.15 && dist(ca, cb) < ra - rb * 0.15) {
              ca.mass = Math.min(MAX_BLOB_MASS, ca.mass + cb.mass * 0.75);
              B.cells.splice(bi, 1);
              if (!B.cells.length) kill(B);
            }
          }
        }
      }
    }

    // blob eats worm body (rate-limited)
    for (const blob of alive) {
      if (blob.type !== 'blob' || !blob.alive) continue;
      for (const worm of alive) {
        if (worm.type !== 'worm' || !worm.alive || isInviz(worm)) continue;
        for (const cell of blob.cells) {
          const br = massToRadius(cell.mass);
          for (let i = worm.segs.length - 1; i >= 4; i--) {
            const s = worm.segs[i];
            if (dist(cell, s) < br * 0.92) {
              if (blob.wormEatBank >= WORM_EAT_MAX_PER_SEC) break;
              worm.segs.splice(i, 1);
              cell.mass = Math.min(MAX_BLOB_MASS, cell.mass + WORM_EAT_MASS);
              blob.wormEatBank += WORM_EAT_MASS;
              foods.push({
                x: s.x + rand(-6, 6),
                y: s.y + rand(-6, 6),
                r: 3,
                mass: 2,
                color: worm.color,
              });
              if (worm.segs.length < 7) kill(worm);
            }
          }
        }
      }
    }

    // Pulse-аура только у самого большого куска: черви не входят в зону
    for (const blob of alive) {
      if (blob.type !== 'blob' || !blob.alive || !(blob.pulseAura > 0)) continue;
      const aura = pulseAuraOf(blob);
      if (!aura) continue;
      for (const worm of alive) {
        if (worm.type !== 'worm' || !worm.alive || isInviz(worm)) continue;
        const h = worm.segs[0];
        let d = dist(aura, h);
        if (d >= aura.r) continue;
        const ang = d < 0.001
          ? Math.atan2(h.y - aura.y || 1, h.x - aura.x || 1)
          : Math.atan2(h.y - aura.y, h.x - aura.x);
        // жёстко выставляем голову на границу ауры (+ запас)
        const outR = aura.r + 6;
        const nx = Math.cos(ang);
        const ny = Math.sin(ang);
        const dx = aura.x + nx * outR - h.x;
        const dy = aura.y + ny * outR - h.y;
        for (let i = 0; i < Math.min(10, worm.segs.length); i++) {
          const k = 1 - i * 0.07;
          worm.segs[i].x += dx * k;
          worm.segs[i].y += dy * k;
        }
      }
    }

    // worm pops blob cells (Pulse защищает только самый большой кусок)
    for (const worm of alive) {
      if (worm.type !== 'worm' || !worm.alive || isInviz(worm)) continue;
      const wh = worm.segs[0];
      const W = wormPower(worm.segs) * (worm.boosting ? 1.25 : 1);
      for (const blob of alive) {
        if (blob.type !== 'blob' || !blob.alive) continue;
        const protectedCell = blob.pulseAura > 0 ? largestBlobCell(blob) : null;
        for (let ci = blob.cells.length - 1; ci >= 0; ci--) {
          const cell = blob.cells[ci];
          if (protectedCell && cell === protectedCell) continue;
          const br = massToRadius(cell.mass);
          if (dist(wh, cell) < br * 0.8) {
            if (W >= cell.mass * POP_K) {
              dropPellets(cell.x, cell.y, cell.mass * 0.7, br);
              blob.cells.splice(ci, 1);
              if (!blob.cells.length) kill(blob);
            } else {
              if (worm.segs.length > 10) worm.segs.pop();
              const ang = Math.atan2(wh.y - cell.y, wh.x - cell.x);
              wh.x += Math.cos(ang) * 22;
              wh.y += Math.sin(ang) * 22;
            }
          }
        }
      }
    }

    // viruses / шипы
    for (let vi = viruses.length - 1; vi >= 0; vi--) {
      const v = viruses[vi];
      let eaten = false;
      for (const p of alive) {
        if (!p.alive || eaten) continue;
        if (p.type === 'worm') {
          if (isInviz(p)) continue;
          // голова в шип = смерть (зато за большим шипом можно прятаться от шаров)
          if (dist(p.segs[0], v) < v.r * 0.62) {
            dropPellets(v.x, v.y, 18, 24);
            kill(p);
          }
        } else {
          for (const cell of p.cells) {
            const r = massToRadius(cell.mass);
            const d = dist(cell, v);
            if (d >= r + v.r * 0.15) continue;

            if (r >= v.r * 1.05) {
              // достаточно большой — СЪЕДАЕТ шип, масса растёт
              cell.mass = Math.min(MAX_BLOB_MASS, cell.mass + (v.mass || r * 2));
              if (p.isPlayer) toast(`Шип съеден +${v.mass | 0}`);
              respawnVirusSoon(vi);
              eaten = true;
              break;
            }

            // маленький шар — свободно прячется внутри шипа (не отталкиваем от центра)
            // черви по-прежнему умирают от головы в шип выше
          }
        }
      }
    }
  }

  function doBlobSplit(p, target) {
    if (!p || p.type !== 'blob' || !p.alive) return false;
    if (p.splitCd > 0) return false;
    if (p.cells.length >= 8) {
      if (p.isPlayer) toast('Слишком много кусков');
      return false;
    }
    let cell = p.cells[0];
    for (const c of p.cells) if (c.mass > cell.mass) cell = c;
    if (cell.mass < 70) {
      if (p.isPlayer) toast('Мало массы для Split');
      return false;
    }
    p.splitCd = 0.55;
    const half = cell.mass / 2;
    cell.mass = half;
    const ang = Math.atan2(target.y - cell.y, target.x - cell.x);
    const shoot = 520;
    p.cells.push({
      x: cell.x + Math.cos(ang) * massToRadius(half),
      y: cell.y + Math.sin(ang) * massToRadius(half),
      mass: half,
      vx: 0,
      vy: 0,
      boostVx: Math.cos(ang) * shoot,
      boostVy: Math.sin(ang) * shoot,
      born: 0,
    });
    if (p.isPlayer) toast('Split!');
    return true;
  }

  function doBlobEject(p, target) {
    if (!p || p.type !== 'blob' || !p.alive) return false;
    if (p.ejectCd > 0) return false;
    let ejected = false;
    for (const cell of p.cells) {
      if (cell.mass < 45) continue;
      const ang = Math.atan2(target.y - cell.y, target.x - cell.x) + rand(-0.04, 0.04);
      cell.mass -= 8;
      const rr = massToRadius(cell.mass);
      const speed = rand(560, 720);
      const maxLife = rand(0.95, 1.25);
      foods.push({
        x: cell.x + Math.cos(ang) * (rr + 14),
        y: cell.y + Math.sin(ang) * (rr + 14),
        r: 4.2,
        rStart: 3.2,
        rEnd: 7.2,
        mass: 7,
        color: pick(EJECT_COLORS),
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        life: maxLife,
        maxLife,
        grace: 0.5,
        ownerId: p.id,
        eject: true,
        big: true,
      });
      ejected = true;
    }
    if (ejected) p.ejectCd = 0.07;
    return ejected;
  }

  function doBlobPulse(p) {
    if (!p || p.type !== 'blob' || !p.alive) return false;
    if (p.pulseCd > 0) {
      if (p.isPlayer) toast(`Pulse через ${p.pulseCd.toFixed(1)}с`);
      return false;
    }
    const aura = pulseAuraOf(p);
    if (!aura) return false;
    p.pulseCd = PULSE_CD;
    p.pulseAura = PULSE_AURA_T;
    // короткая вспышка у большого куска — без «залипших» колец на 4с
    pulseFx.push(
      { x: aura.x, y: aura.y, r0: aura.r, t: 0, tmax: 0.35, kind: 'flash' },
      { x: aura.x, y: aura.y, r0: aura.r, t: 0, tmax: 0.55, kind: 'burst' },
      { x: aura.x, y: aura.y, r0: aura.r, t: 0, tmax: 0.55, kind: 'ring', delay: 0 },
      { x: aura.x, y: aura.y, r0: aura.r, t: 0, tmax: 0.65, kind: 'ring', delay: 0.08 },
    );
    for (let i = 0; i < 18; i++) {
      const ang = (Math.PI * 2 * i) / 18;
      pulseFx.push({
        x: aura.x,
        y: aura.y,
        r0: aura.r,
        t: 0,
        tmax: 0.45,
        kind: 'spark',
        ang,
        sp: 240 + (i % 3) * 40,
      });
    }
    // мгновенный выкид голов за ауру большого куска
    for (const other of players) {
      if (!other.alive || other.type !== 'worm' || isInviz(other)) continue;
      const h = other.segs[0];
      const d = dist(aura, h);
      if (d >= aura.r + 20) continue;
      const ang = d < 0.001 ? rand(0, Math.PI * 2) : Math.atan2(h.y - aura.y, h.x - aura.x);
      const outR = aura.r + 8;
      const dx = aura.x + Math.cos(ang) * outR - h.x;
      const dy = aura.y + Math.sin(ang) * outR - h.y;
      for (let i = 0; i < Math.min(10, other.segs.length); i++) {
        const k = 1 - i * 0.07;
        other.segs[i].x += dx * k;
        other.segs[i].y += dy * k;
      }
    }
    if (p.isPlayer) toast('Pulse! 4с — большой кусок');
    return true;
  }

  function updatePulseFx(dt) {
    for (const fx of pulseFx) {
      fx.t += dt;
      if (fx.kind === 'spark') {
        fx.x += Math.cos(fx.ang) * fx.sp * dt;
        fx.y += Math.sin(fx.ang) * fx.sp * dt;
        fx.sp *= Math.pow(0.05, dt);
      }
    }
    pulseFx = pulseFx.filter((fx) => fx.t < fx.tmax);
  }

  function drawPulseFx() {
    const z = cam.zoom;
    ctx.save();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    for (const fx of pulseFx) {
      const delay = fx.delay || 0;
      if (fx.t < delay) continue;
      const u = Math.min(1, (fx.t - delay) / Math.max(0.001, fx.tmax - delay));
      const s = toScreen(fx.x, fx.y);

      if (fx.kind === 'flash') {
        const rr = Math.max(120, (fx.r0 + 80 + u * 180) * z);
        ctx.globalAlpha = (1 - u) * 0.85;
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, rr);
        g.addColorStop(0, '#ff66ee');
        g.addColorStop(0.25, '#c44bff');
        g.addColorStop(0.55, 'rgba(80, 20, 120, 0.7)');
        g.addColorStop(1, 'rgba(40, 0, 60, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(s.x, s.y, rr, 0, Math.PI * 2);
        ctx.fill();
      } else if (fx.kind === 'burst') {
        const rr = Math.max(140, (fx.r0 + 90 + u * 320) * z);
        ctx.globalAlpha = (1 - u) * 0.7;
        const g = ctx.createRadialGradient(s.x, s.y, rr * 0.08, s.x, s.y, rr);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.2, '#ff7ae8');
        g.addColorStop(0.55, 'rgba(120, 40, 220, 0.55)');
        g.addColorStop(1, 'rgba(40, 0, 80, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(s.x, s.y, rr, 0, Math.PI * 2);
        ctx.fill();
      } else if (fx.kind === 'ring') {
        const rr = Math.max(50, (fx.r0 + 20 + u * 280) * z);
        ctx.globalAlpha = 1 - u;
        ctx.lineWidth = Math.max(6, (14 - u * 8) * z);
        ctx.strokeStyle = '#1a0528';
        ctx.beginPath();
        ctx.arc(s.x, s.y, rr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = Math.max(4, (10 - u * 5) * z);
        ctx.strokeStyle = '#ff2ec8';
        ctx.beginPath();
        ctx.arc(s.x, s.y, rr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = Math.max(2, 3.5 * z);
        ctx.strokeStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(s.x, s.y, rr * 0.9, 0, Math.PI * 2);
        ctx.stroke();
      } else if (fx.kind === 'spark') {
        ctx.globalAlpha = 1 - u;
        const pr = Math.max(4, (8 - u * 4) * z);
        ctx.fillStyle = '#ff2ec8';
        ctx.beginPath();
        ctx.arc(s.x, s.y, pr, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(s.x, s.y, pr * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawBlobPulseAuras() {
    const z = cam.zoom;
    for (const p of players) {
      if (!p.alive || p.type !== 'blob' || !(p.pulseAura > 0)) continue;
      const aura = pulseAuraOf(p);
      if (!aura) continue;
      const s = toScreen(aura.x, aura.y);
      const u = 1 - p.pulseAura / PULSE_AURA_T;
      const beat = 0.5 + 0.5 * Math.sin(performance.now() / 70);
      const rr = Math.max(48, (aura.r + beat * 6) * z);
      ctx.save();
      ctx.globalAlpha = (1 - u * 0.2) * 0.5;
      ctx.fillStyle = 'rgba(200, 50, 255, 0.45)';
      ctx.beginPath();
      ctx.arc(s.x, s.y, rr, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = Math.max(5, 6 * z);
      ctx.strokeStyle = '#1a0528';
      ctx.beginPath();
      ctx.arc(s.x, s.y, rr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = Math.max(3, 4 * z);
      ctx.strokeStyle = `rgba(255, 40, 220, ${0.85 + beat * 0.15})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, rr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = Math.max(2, 2.5 * z);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(16, aura.br * z), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function doWormInviz(p) {
    if (!p || p.type !== 'worm' || !p.alive) return false;
    const sc = scoreOf(p);
    if (sc < WORM_INVIZ_MIN_SCORE) {
      if (p.isPlayer) toast(`Инвиз с ${WORM_INVIZ_MIN_SCORE}+ счёта (сейчас ${sc})`);
      return false;
    }
    if (p.invizT > 0) {
      if (p.isPlayer) toast(`Инвиз ещё ${p.invizT.toFixed(1)}с`);
      return false;
    }
    if (p.invizCd > 0) {
      if (p.isPlayer) toast(`Инвиз КД: ${Math.ceil(p.invizCd)}с`);
      return false;
    }
    p.invizT = WORM_INVIZ_DURATION;
    p.invizCd = WORM_INVIZ_CD;
    if (p.isPlayer) toast('Инвиз! сквозь всё, без убийств');
    return true;
  }

  function blobSplit() {
    if (!me) return;
    doBlobSplit(me, worldPointer());
  }

  function blobEject() {
    if (!me) return;
    doBlobEject(me, worldPointer());
  }

  function blobPulse() {
    if (!me) return;
    doBlobPulse(me);
  }

  function playerBoost(on, source = 'key') {
    if (!me || me.type !== 'worm' || !me.alive) return;
    if (source === 'mouse') me.boostMouse = on;
    else me.boostKey = on;
    syncWormBoost(me);
  }

  function wormInviz() {
    if (!me) return;
    doWormInviz(me);
  }

  function isUiClickTarget(el) {
    if (!el || !el.closest) return false;
    return !!el.closest('button, a, input, select, textarea, #hud, #touch-controls, #pause-overlay, #death-overlay');
  }

  function updateFoodProjectiles(dt) {
    for (const f of foods) {
      if (f.grace != null && f.grace > 0) f.grace = Math.max(0, f.grace - dt);
      if (f.life == null) continue;
      f.life -= dt;
      f.x += (f.vx || 0) * dt;
      f.y += (f.vy || 0) * dt;
      // плавное торможение (летит далеко, потом мягко останавливается)
      const damp = Math.pow(0.12, dt);
      f.vx *= damp;
      f.vy *= damp;
      if (f.eject && f.maxLife) {
        const t = 1 - Math.max(0, f.life) / f.maxLife;
        const ease = 1 - Math.pow(1 - t, 2);
        f.r = (f.rStart || 3) + ((f.rEnd || 7) - (f.rStart || 3)) * ease;
      }
      if (f.life <= 0) {
        f.vx = 0;
        f.vy = 0;
        f.life = null;
        if (f.rEnd) f.r = f.rEnd;
      }
    }
  }

  function updateCamera(dt) {
    if (!me || !me.alive) return;
    const h = head(me);
    cam.x += (h.x - cam.x) * Math.min(1, dt * 7);
    cam.y += (h.y - cam.y) * Math.min(1, dt * 7);

    let viewR = 40;
    if (me.type === 'blob') {
      viewR = Math.max(...me.cells.map((c) => massToRadius(c.mass)));
      if (me.cells.length > 1) viewR *= 1.15;
    } else {
      viewR = 20 + me.segs.length * 0.35;
    }
    // zoom out as you grow (Agar-like)
    const targetZoom = clamp(1.15 / Math.pow(viewR / 28, 0.55), 0.28, 1.15);
    cam.zoom += (targetZoom - cam.zoom) * Math.min(1, dt * 3.5);
  }

  function endMatch(reason = 'time') {
    if (matchEnded) return;
    matchEnded = true;
    paused = true;
    const sc = me ? scoreOf(me) : 0;
    hooks.onMatchEnd?.({ score: sc, reason });
  }

  function update(dt) {
    if (!running || paused) return;
    if (matchTimed && !matchEnded && matchEndsAt && Date.now() >= matchEndsAt) {
      endMatch('time');
      return;
    }
    foodSpawnCd = Math.max(0, foodSpawnCd - dt);
    if (foodSpawnCd <= 0 && foods.length < 650) {
      spawnFood(25, 0.1);
      foodSpawnCd = 0.45;
    }

    // held eject
    if (me?.type === 'blob' && me.alive && keys.w) {
      ejectAcc += dt;
      if (ejectAcc > 0.08) {
        blobEject();
        ejectAcc = 0;
      }
    } else ejectAcc = 0;

    updateFoodProjectiles(dt);
    updatePulseFx(dt);

    for (const p of players) {
      if (!p.alive) continue;
      let target;
      if (p.isPlayer) {
        target = joystickAim || pointer.active ? worldPointer() : head(p);
      } else target = updateAI(p, dt);
      if (p.type === 'blob') updateBlob(p, dt, target);
      else updateWorm(p, dt, target);
    }

    collisions();
    updateCamera(dt);

    botSpawnCd = Math.max(0, botSpawnCd - dt);
    const aliveBots = players.filter((p) => p.alive && !p.isPlayer).length;
    // респавн ботов не чаще раза в ~1.2с — findSafeSpawn тяжёлый и дёргал миникарту
    if (botSpawnCd <= 0 && aliveBots < (state.settings.bots | 0)) {
      spawnBots(1);
      botSpawnCd = 1.2;
    }

    // prune dead
    players = players.filter((p) => p.alive || p.isPlayer);

    for (const t of toasts) t.t -= dt;
    toasts = toasts.filter((t) => t.t > 0);
    if (toastEl) {
      toastEl.textContent = toasts.length ? toasts[toasts.length - 1].msg : '';
    }

    hudAcc += dt;
    minimapAcc += dt;
    updateHud(hudAcc >= 0.25);
    if (hudAcc >= 0.25) hudAcc = 0;
  }

  function updateHud(full = true) {
    if (me && me.alive) scoreEl.textContent = String(scoreOf(me));
    const timerEl = document.getElementById('hud-timer');
    if (timerEl) {
      if (matchTimed && matchEndsAt) {
        const left = Math.max(0, matchEndsAt - Date.now());
        const m = Math.floor(left / 60000);
        const s = Math.floor((left % 60000) / 1000);
        timerEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
        timerEl.classList.toggle('urgent', left < 60000);
        timerEl.classList.remove('hidden');
      } else {
        timerEl.classList.add('hidden');
      }
    }
    if (!full) return;

    const ranked = players
      .filter((p) => p.alive)
      .sort((a, b) => scoreOf(b) - scoreOf(a));
    const myIdx = ranked.findIndex((p) => p.isPlayer);
    const myRank = myIdx >= 0 ? myIdx + 1 : 0;
    const visible = lbCollapsed ? ranked.slice(0, 3) : ranked;
    const lbTitle = document.querySelector('#leaderboard .lb-title');
    if (lbTitle) lbTitle.textContent = t('leaderboard');
    if (lbRoot) lbRoot.classList.toggle('collapsed', lbCollapsed);
    const toggle = document.getElementById('lb-toggle');
    if (toggle) toggle.textContent = lbCollapsed ? '▸' : '▾';
    if (lbList) {
      lbList.innerHTML = visible
        .map((p, i) => {
          const rank = i + 1;
          const medal = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
          return `<li class="${medal}${p.isPlayer ? ' me' : ''}">
            <span class="lb-rank">${rank}</span>
            <span class="lb-name">${p.name}</span>
            <span class="lb-score">${scoreOf(p)}</span>
          </li>`;
        })
        .join('');
    }
    if (lbYou) {
      if (me && me.alive && myRank > 0) {
        lbYou.innerHTML = `
          <span class="lb-place">#${myRank}</span>
          <span class="lb-name">${me.name}</span>
          <span class="lb-score">${scoreOf(me)}</span>`;
        lbYou.classList.remove('hidden');
      } else {
        lbYou.classList.add('hidden');
      }
    }

    if (hintEl && me) {
      hintEl.textContent =
        me.type === 'blob'
          ? t('hint_blob')
          : t('hint_worm', { n: WORM_INVIZ_MIN_SCORE });
    }
    if (invizHud) {
      if (me?.type === 'worm' && me.alive) {
        invizHud.classList.remove('hidden');
        const sc = scoreOf(me);
        if (sc < WORM_INVIZ_MIN_SCORE) {
          invizHud.textContent = t('inviz_need', { n: WORM_INVIZ_MIN_SCORE, sc });
          invizHud.classList.remove('active');
        } else if (me.invizT > 0) {
          invizHud.textContent = t('inviz_active', { t: me.invizT.toFixed(1) });
          invizHud.classList.add('active');
        } else if (me.invizCd > 0) {
          invizHud.textContent = t('inviz_cd', { t: Math.ceil(me.invizCd) });
          invizHud.classList.remove('active');
        } else {
          invizHud.textContent = t('inviz_ready');
          invizHud.classList.add('active');
        }
      } else {
        invizHud.classList.add('hidden');
      }
    }
  }

  function drawVirus(v, sx, sy, z) {
    const spikes = 14;
    const rr = v.r * z;
    ctx.fillStyle = '#6bcB3d';
    ctx.strokeStyle = '#2f7a1f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 2;
      const rad = (i % 2 === 0 ? v.r : v.r * 0.72) * z;
      const x = sx + Math.cos(a) * rad;
      const y = sy + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // inner highlight so it reads under blobs better when peeking at edge
    ctx.beginPath();
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.arc(sx, sy, rr * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }

  function draw() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const z = cam.zoom;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, w, h);

    // notebook grid in screen space following camera
    const g = GRID * z;
    const origin = toScreen(0, 0);
    const ox = ((origin.x % g) + g) % g;
    const oy = ((origin.y % g) + g) % g;
    ctx.strokeStyle = '#d7d7d7';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = ox; x < w + g; x += g) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
    }
    for (let y = oy; y < h + g; y += g) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
    }
    ctx.stroke();

    const b0 = toScreen(0, 0);
    ctx.strokeStyle = '#bbbbbb';
    ctx.lineWidth = 3;
    ctx.strokeRect(b0.x, b0.y, WORLD * z, WORLD * z);

    // foods
    for (const f of foods) {
      const s = toScreen(f.x, f.y);
      const rr = f.r * z;
      if (s.x < -20 || s.y < -20 || s.x > w + 20 || s.y > h + 20) continue;
      if (f.eject && f.life != null && f.maxLife) {
        const alpha = 0.45 + 0.55 * (f.life / f.maxLife);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = f.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, rr, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // короткий «хвост» полёта
        const spd = Math.hypot(f.vx || 0, f.vy || 0);
        if (spd > 40) {
          ctx.globalAlpha = alpha * 0.35;
          ctx.beginPath();
          ctx.arc(
            s.x - ((f.vx || 0) / spd) * rr * 1.6,
            s.y - ((f.vy || 0) / spd) * rr * 1.6,
            rr * 0.65,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = f.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, rr, 0, Math.PI * 2);
        ctx.fill();
        if (f.big) {
          ctx.strokeStyle = 'rgba(0,0,0,0.2)';
          ctx.stroke();
        }
      }
    }

    // viruses UNDER players (always behind)
    for (const v of viruses) {
      const s = toScreen(v.x, v.y);
      if (s.x < -100 || s.y < -100 || s.x > w + 100 || s.y > h + 100) continue;
      drawVirus(v, s.x, s.y, z);
    }

    // worms first (under blobs)
    for (const p of players) {
      if (!p.alive || p.type !== 'worm') continue;
      const rr = radiusOfWorm(p) * z;
      const ghost = isInviz(p);
      ctx.save();
      if (ghost) ctx.globalAlpha = p.isPlayer ? 0.38 : 0.12;
      for (let i = p.segs.length - 1; i >= 0; i--) {
        const seg = p.segs[i];
        const s = toScreen(seg.x, seg.y);
        const skin = p.isPlayer && p.skins?.length ? p.skins[i % p.skins.length] : null;
        if (skin) drawCircledImage(ctx, skin, s.x, s.y, rr);
        else {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(s.x, s.y, rr, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.2)';
          ctx.stroke();
        }
      }
      if (ghost && p.isPlayer) {
        const s = toScreen(p.segs[0].x, p.segs[0].y);
        ctx.strokeStyle = 'rgba(120, 200, 255, 0.9)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.arc(s.x, s.y, rr + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
      if (state.settings.showNames && !ghost) {
        const s = toScreen(p.segs[0].x, p.segs[0].y);
        ctx.fillStyle = '#333';
        ctx.font = `${Math.max(11, 12 * z)}px Segoe UI, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(p.name, s.x, s.y - rr - 6);
      }
    }

    // blobs sorted small -> large so bigger paint on top (covers viruses)
    const blobs = players
      .filter((p) => p.alive && p.type === 'blob')
      .flatMap((p) =>
        p.cells.map((c) => ({ p, c, mass: c.mass })),
      )
      .sort((a, b) => a.mass - b.mass);

    for (const { p, c } of blobs) {
      const r = massToRadius(c.mass) * z;
      const s = toScreen(c.x, c.y);
      if (p.isPlayer && p.skin) drawCircledImage(ctx, p.skin, s.x, s.y, r);
      else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (state.settings.showNames) {
        ctx.fillStyle = '#222';
        ctx.font = `${Math.max(11, 13 * z)}px Segoe UI, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(p.name, s.x, s.y - r - 6);
      }
    }

    drawRemotePlayers();
    drawVoiceIndicators();
    // Pulse поверх всего мира — иначе на белом фоне не видно
    drawPulseFx();
    drawBlobPulseAuras();
    drawMinimap();
  }

  /** друзья из комнаты — рисуем их аватар + скин */
  function drawRemotePlayers() {
    const z = cam.zoom;
    const now = performance.now();
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const [, rp] of voicePeers) {
      if (!rp || now - rp.t > 2500 || rp.alive === false) continue;
      if (rp.skinSrc) ensurePeerSkin(rp);

      if (rp.form === 'worm' && rp.segs?.length) {
        const rr = Math.max(8, (10 + Math.min(9, rp.segs.length * 0.12)) * z);
        ctx.save();
        ctx.globalAlpha = 0.95;
        for (let i = rp.segs.length - 1; i >= 0; i--) {
          const seg = rp.segs[i];
          const s = toScreen(seg.x, seg.y);
          if (rp.skinImg) drawCircledImage(ctx, rp.skinImg, s.x, s.y, rr);
          else {
            ctx.fillStyle = rp.color || '#118ab2';
            ctx.beginPath();
            ctx.arc(s.x, s.y, rr, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        const headS = toScreen(rp.segs[0].x, rp.segs[0].y);
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = Math.max(2, 2.5 * z);
        ctx.beginPath();
        ctx.arc(headS.x, headS.y, rr + 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#222';
        ctx.font = `${Math.max(11, 12 * z)}px Segoe UI, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(rp.name || 'Player', headS.x, headS.y - rr - 8);
        ctx.restore();
        drawPeerEdgeArrow(rp.segs[0].x, rp.segs[0].y, rp.name, w, h);
        continue;
      }
      const cells = rp.cells?.length
        ? rp.cells
        : [{ x: rp.x, y: rp.y, mass: Math.max(40, (rp.score || 80) * 0.6) }];
      const sorted = [...cells].sort((a, b) => (a.mass || 0) - (b.mass || 0));
      for (const c of sorted) {
        const r = massToRadius(c.mass || 80) * z;
        const s = toScreen(c.x, c.y);
        ctx.save();
        ctx.globalAlpha = 0.95;
        if (rp.skinImg) drawCircledImage(ctx, rp.skinImg, s.x, s.y, r);
        else {
          ctx.fillStyle = rp.color || '#9b5de5';
          ctx.beginPath();
          ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          ctx.lineWidth = Math.max(2, 2.5 * z);
          ctx.stroke();
        }
        ctx.restore();
      }
      if (sorted.length) {
        const big = sorted[sorted.length - 1];
        const r = massToRadius(big.mass || 80) * z;
        const s = toScreen(big.x, big.y);
        ctx.fillStyle = '#222';
        ctx.font = `${Math.max(11, 13 * z)}px Segoe UI, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(rp.name || 'Player', s.x, s.y - r - 8);
        drawPeerEdgeArrow(big.x, big.y, rp.name, w, h);
      }
    }
  }

  /** стрелка к другу за краем экрана */
  function drawPeerEdgeArrow(wx, wy, name, sw, sh) {
    const s = toScreen(wx, wy);
    if (s.x > 40 && s.x < sw - 40 && s.y > 40 && s.y < sh - 40) return;
    const cx = sw / 2;
    const cy = sh / 2;
    const ang = Math.atan2(s.y - cy, s.x - cx);
    const pad = 28;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    let t = 1e9;
    if (dx > 0.001) t = Math.min(t, (sw - pad - cx) / dx);
    if (dx < -0.001) t = Math.min(t, (pad - cx) / dx);
    if (dy > 0.001) t = Math.min(t, (sh - pad - cy) / dy);
    if (dy < -0.001) t = Math.min(t, (pad - cy) / dy);
    const ax = cx + dx * t;
    const ay = cy + dy * t;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(ang);
    ctx.fillStyle = '#e76f51';
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-8, 7);
    ctx.lineTo(-8, -7);
    ctx.closePath();
    ctx.fill();
    ctx.rotate(-ang);
    ctx.fillStyle = '#e76f51';
    ctx.font = 'bold 11px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(name || '?', 0, -12);
    ctx.restore();
  }

  function drawMicBadge(wx, wy, level, z) {
    const s = toScreen(wx, wy);
    const pulse = 0.55 + level * 0.9;
    const baseR = (14 + level * 18) * z;
    // кольца под голос
    if (level > 0.04) {
      for (let i = 0; i < 2; i++) {
        const rr = baseR * (1 + i * 0.45) * (0.85 + pulse * 0.2);
        ctx.save();
        ctx.globalAlpha = (0.45 - i * 0.15) * Math.min(1, level * 2.2);
        ctx.strokeStyle = '#1fa896';
        ctx.lineWidth = Math.max(1.5, 2 * z);
        ctx.beginPath();
        ctx.arc(s.x, s.y, rr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    // бейдж с микрофоном чуть сверху-справа
    const bx = s.x + 12 * z;
    const by = s.y - 18 * z;
    const br = Math.max(8, 9 * z);
    ctx.save();
    ctx.fillStyle = level > 0.08 ? '#1fa896' : 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = level > 0.08 ? '#0d7a6c' : '#888';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = level > 0.08 ? '#fff' : '#333';
    ctx.font = `${Math.max(9, 10 * z)}px Segoe UI, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎤', bx, by + 0.5);
    ctx.restore();
  }

  function drawVoiceIndicators() {
    const z = cam.zoom;
    // локальный игрок
    if (me?.alive && localMicOn) {
      const h = head(me);
      if (h) drawMicBadge(h.x, h.y, localVoiceLevel, z);
    }
    // удалённые
    const now = performance.now();
    for (const [id, vp] of voicePeers) {
      if (now - vp.t > 4000) {
        voicePeers.delete(id);
        continue;
      }
      if (!vp.micOn) continue;
      drawMicBadge(vp.x, vp.y, vp.level || 0, z);
    }
  }

  /** точка в текущем экране (FOV) камеры? */
  function inView(x, y, pad = 40) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const halfW = w / (2 * cam.zoom);
    const halfH = h / (2 * cam.zoom);
    return (
      x > cam.x - halfW - pad &&
      x < cam.x + halfW + pad &&
      y > cam.y - halfH - pad &&
      y < cam.y + halfH + pad
    );
  }

  function frame(t) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    try {
      const dt = Math.min(0.033, (t - last) / 1000 || 0.016);
      last = t;
      if (paused && !matchEnded) {
        const pauseOv = document.getElementById('pause-overlay');
        const endOv = document.getElementById('match-end-overlay');
        const deathOv = document.getElementById('death-overlay');
        const blocked =
          (pauseOv && !pauseOv.classList.contains('hidden')) ||
          (endOv && !endOv.classList.contains('hidden')) ||
          (deathOv && !deathOv.classList.contains('hidden'));
        if (!blocked) paused = false;
      }
      update(dt);
      draw();
    } catch (err) {
      console.error('game frame', err);
    }
  }

  function onPointer(e) {
    const src = e.touches ? e.touches[0] : e;
    if (!src) return;
    pointer.x = src.clientX;
    pointer.y = src.clientY;
    pointer.active = true;
  }

  function bindInput() {
    window.addEventListener('mousemove', onPointer);
    window.addEventListener('touchmove', onPointer, { passive: true });
    window.addEventListener('touchstart', (e) => {
      onPointer(e);
      if (!running || paused) return;
      if (isUiClickTarget(e.target)) return;
      if (me?.type === 'worm') playerBoost(true, 'mouse');
    }, { passive: true });
    window.addEventListener('touchend', () => playerBoost(false, 'mouse'));
    window.addEventListener('mousedown', (e) => {
      pointer.active = true;
      if (!running || paused) return;
      if (e.button !== 0) return;
      if (isUiClickTarget(e.target)) return;
      if (me?.type === 'worm') playerBoost(true, 'mouse');
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) playerBoost(false, 'mouse');
    });
    window.addEventListener('blur', () => {
      playerBoost(false, 'mouse');
      playerBoost(false, 'key');
    });
    window.addEventListener('keydown', (e) => {
      if (!running || paused) {
        if (e.code === 'Escape') hooks.onPause?.();
        return;
      }
      if (e.repeat) {
        if (e.code === 'KeyW') keys.w = true;
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        keys.space = true;
        if (me?.type === 'worm') playerBoost(true, 'key');
        else blobSplit();
      }
      if (e.code === 'KeyW') {
        keys.w = true;
        if (me?.type === 'worm') playerBoost(true, 'key');
        else blobEject();
      }
      if (e.code === 'KeyQ') {
        keys.q = true;
        if (me?.type === 'blob') blobPulse();
      }
      if (e.code === 'KeyE') {
        if (me?.type === 'worm') wormInviz();
      }
      if (e.code === 'Escape') hooks.onPause?.();
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        keys.space = false;
        playerBoost(false, 'key');
      }
      if (e.code === 'KeyW') {
        keys.w = false;
        playerBoost(false, 'key');
      }
      if (e.code === 'KeyQ') keys.q = false;
    });

    document.getElementById('btn-split')?.addEventListener('click', () => {
      if (me?.type === 'blob') blobSplit();
    });
    document.getElementById('btn-eject')?.addEventListener('click', () => {
      if (me?.type === 'blob') blobEject();
      else wormInviz();
    });
    const action = document.getElementById('btn-action');
    action?.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (me?.type === 'worm') playerBoost(true, 'key');
      else blobPulse();
    });
    action?.addEventListener('touchend', () => playerBoost(false, 'key'));
    action?.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (me?.type === 'worm') playerBoost(true, 'key');
      else blobPulse();
    });
    action?.addEventListener('mouseup', () => playerBoost(false, 'key'));
  }

  bindInput();
  window.addEventListener('resize', resize);
  document.getElementById('lb-toggle')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    lbCollapsed = !lbCollapsed;
    if (lbRoot) lbRoot.classList.toggle('collapsed', lbCollapsed);
    const toggle = document.getElementById('lb-toggle');
    if (toggle) toggle.textContent = lbCollapsed ? '▸' : '▾';
    updateHud(true);
  });

  return {
    async start(opts = {}) {
      state = loadState();
      // в мультиплеере всегда тянем FPS: качество не ниже medium
      if (opts.multiplayer && state.settings.quality === 'low') {
        state = { ...state, settings: { ...state.settings, quality: 'medium' } };
      }
      multiplayerSpawn = !!opts.multiplayer;
      localPeerId = String(opts.peerId || '');
      resize();
      blobSkinImg = await resolveBlobSkin(state);
      wormSegImgs = await resolveWormSkin(state);
      localSkinMeta = buildLocalSkinMeta();

      foods = [];
      players = [];
      me = null;
      joystickAim = null;
      pulseFx = [];
      cam = { x: WORLD / 2, y: WORLD / 2, zoom: 1 };
      toasts = [];
      botSpawnCd = 0;
      foodSpawnCd = 0;
      hudAcc = 0;
      minimapAcc = 1; // сразу нарисовать
      minimapDomReady = false;
      matchEnded = false;
      matchTimed = !!opts.timed;
      const duration = opts.matchMs || MATCH_DEFAULT_MS;
      // не принимать просроченный endsAt с сервера — иначе «матч завершён» сразу
      if (opts.endsAt && opts.endsAt > Date.now() + 5000) {
        matchEndsAt = opts.endsAt;
      } else if (matchTimed) {
        matchEndsAt = Date.now() + duration;
      } else {
        matchEndsAt = 0;
      }
      document.getElementById('match-end-overlay')?.classList.add('hidden');
      const mobile = state.device === 'mobile' || matchMedia('(pointer: coarse)').matches;
      spawnFood(mobile ? 520 : 750, 0.12);
      spawnViruses(state.settings.quality === 'low' ? 8 : mobile ? 10 : 16);
      spawnPlayer();
      if (multiplayerSpawn) toast('Друзья у центра карты — смотри оранжевые стрелки');
      const botCount = opts.bots != null ? opts.bots : state.settings.bots | 0;
      spawnBots(mobile ? Math.min(botCount, 8) : botCount);

      document.body.classList.toggle('mobile', mobile);
      document.getElementById('mobile-ui')?.classList.toggle('hidden', !mobile);
      const touch = document.getElementById('touch-controls');
      touch?.classList.toggle('hidden', mobile || !matchMedia('(pointer: coarse)').matches);
      const action = document.getElementById('btn-action');
      if (action) action.textContent = state.form === 'worm' ? 'Boost' : 'Pulse';
      const ejectBtn = document.getElementById('btn-eject');
      if (ejectBtn) ejectBtn.textContent = state.form === 'worm' ? 'Инвиз' : 'Eject';
      const splitBtn = document.getElementById('btn-split');
      if (splitBtn) splitBtn.style.display = state.form === 'blob' ? '' : 'none';

      // подписи мобильных кнопок
      const a = document.getElementById('mob-a');
      const b = document.getElementById('mob-b');
      const c = document.getElementById('mob-c');
      if (state.form === 'blob') {
        if (a) a.textContent = 'Split';
        if (b) b.textContent = 'Eject';
        if (c) {
          c.textContent = 'Pulse';
          c.classList.remove('hidden');
          c.style.display = '';
        }
      } else {
        if (a) a.textContent = 'Boost';
        if (b) b.textContent = 'Инвиз';
        // у червя нет 3-й способности (Pulse) — прячем пустую кнопку
        if (c) {
          c.textContent = '';
          c.classList.add('hidden');
          c.style.display = 'none';
        }
      }

      const joySize = state.settings.joystickSize || 120;
      const joyOp = state.settings.joystickOpacity || 0.55;
      document.documentElement.style.setProperty('--joy-size', joySize + 'px');
      document.documentElement.style.setProperty('--joy-alpha', String(0.35 * joyOp));

      document.getElementById('death-overlay')?.classList.add('hidden');
      document.getElementById('pause-overlay')?.classList.add('hidden');

      running = true;
      paused = false;
      matchEnded = false;
      last = performance.now();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    },
    pause() {
      paused = true;
    },
    resume() {
      if (matchEnded) return;
      paused = false;
      last = performance.now();
      if (running) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(frame);
      }
    },
    isPaused: () => paused,
    isRunning: () => running,
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      joystickAim = null;
      matchTimed = false;
      matchEndsAt = 0;
      matchEnded = false;
      pulseFx = [];
    },
    async respawn() {
      if (matchEnded) return;
      players = players.filter((p) => !p.isPlayer);
      spawnPlayer();
      document.getElementById('death-overlay')?.classList.add('hidden');
      paused = false;
    },
    refreshMinimapLayout() {
      state = loadState();
      minimapDomReady = false;
      applyMinimapDomPos();
      minimapDomReady = true;
    },
    setLocalVoice(micOn, level = 0) {
      localMicOn = !!micOn;
      localVoiceLevel = clamp(level, 0, 1);
    },
    upsertVoicePeer(id, data) {
      if (!id) return;
      const prev = voicePeers.get(id);
      const next = {
        x: data.x ?? prev?.x ?? 0,
        y: data.y ?? prev?.y ?? 0,
        name: data.name || prev?.name || 'Player',
        micOn: !!data.micOn,
        level: clamp(data.level || 0, 0, 1),
        form: data.form || prev?.form || 'blob',
        color: data.color || prev?.color || '#9b5de5',
        cells: Array.isArray(data.cells) ? data.cells : prev?.cells || null,
        segs: Array.isArray(data.segs) ? data.segs : prev?.segs || null,
        score: data.score ?? prev?.score ?? 0,
        alive: data.alive !== false,
        skinId: data.skinId || prev?.skinId || '',
        skinSrc: data.skinSrc || prev?.skinSrc || '',
        skinImg: prev?.skinImg || null,
        _skinKey: prev?._skinKey || '',
        t: performance.now(),
      };
      voicePeers.set(id, next);
      if (next.skinSrc && next.skinSrc !== next._skinKey) ensurePeerSkin(next);
    },
    clearVoicePeers() {
      voicePeers.clear();
    },
    /** снимок для сети — друзья видят твою форму и скин */
    getVoiceSnapshot() {
      if (!me || !me.alive) return null;
      const h = head(me);
      const snap = {
        x: h.x,
        y: h.y,
        name: me.name,
        micOn: localMicOn,
        level: localVoiceLevel,
        form: me.type,
        color: me.color,
        score: scoreOf(me),
        alive: true,
        skinId: localSkinMeta.id,
      };
      // пресеты — короткий путь; custom dataURL шлём редко (тяжело)
      if (localSkinMeta.src) {
        if (localSkinMeta.src.startsWith('data:')) {
          const now = performance.now();
          if (now - lastCustomSkinSent > 2500) {
            snap.skinSrc = localSkinMeta.src;
            lastCustomSkinSent = now;
          }
        } else {
          snap.skinSrc = localSkinMeta.src;
        }
      }
      if (me.type === 'blob') {
        snap.cells = me.cells.slice(0, 8).map((c) => ({
          x: Math.round(c.x),
          y: Math.round(c.y),
          mass: Math.round(c.mass),
        }));
      } else {
        const step = Math.max(1, Math.ceil(me.segs.length / 40));
        snap.segs = [];
        for (let i = 0; i < me.segs.length; i += step) {
          snap.segs.push({
            x: Math.round(me.segs[i].x),
            y: Math.round(me.segs[i].y),
          });
        }
        if (snap.segs.length && me.segs.length > 1) {
          const last = me.segs[me.segs.length - 1];
          const tip = snap.segs[snap.segs.length - 1];
          if (tip.x !== Math.round(last.x) || tip.y !== Math.round(last.y)) {
            snap.segs.push({ x: Math.round(last.x), y: Math.round(last.y) });
          }
        }
      }
      return snap;
    },
    /** id в зоне видимости локального игрока? */
    isWorldPointVisible(x, y) {
      return inView(x, y, 60);
    },
    getVoicePeer(id) {
      return voicePeers.get(id) || null;
    },
    getForm() {
      return state.form;
    },
    setJoystickAim(nx, ny, mag = 1) {
      if (nx == null || ny == null) {
        joystickAim = null;
        return;
      }
      const len = Math.hypot(nx, ny) || 1;
      const m = clamp(mag == null ? 1 : mag, 0, 1);
      if (m < 0.12) {
        // сохраняем прежний курс, только гасим силу — не сбрасываем в null
        if (joystickAim) joystickAim = { ...joystickAim, mag: 0 };
        return;
      }
      joystickAim = { x: nx / len, y: ny / len, mag: m };
    },
    clearJoystickAim() {
      joystickAim = null;
    },
    abilityA() {
      if (!me?.alive) return;
      if (me.type === 'blob') blobSplit();
      else playerBoost(true, 'key');
    },
    abilityAEnd() {
      playerBoost(false, 'key');
    },
    abilityB() {
      if (!me?.alive) return;
      if (me.type === 'blob') blobEject();
      else wormInviz();
    },
    abilityC() {
      if (!me?.alive) return;
      if (me.type === 'blob') blobPulse();
    },
  };
}
