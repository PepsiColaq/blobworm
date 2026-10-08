import { loadState, patchState } from './storage.js';
import {
  BLOB_PRESETS,
  WORM_PRESETS,
  WORM_SEGMENTS,
  defaultCustomBlob,
  defaultCustomWorm,
  dataUrlFromCanvas,
} from './skins.js';

function bindPaint(canvas, getColor, getSize) {
  const ctx = canvas.getContext('2d');
  let drawing = false;

  const pos = (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const src = e.touches ? e.touches[0] : e;
    return {
      x: (src.clientX - rect.left) * scaleX,
      y: (src.clientY - rect.top) * scaleY,
    };
  };

  const paint = (e) => {
    if (!drawing) return;
    e.preventDefault();
    const { x, y } = pos(e);
    ctx.fillStyle = getColor();
    ctx.beginPath();
    ctx.arc(x, y, getSize() / 2, 0, Math.PI * 2);
    ctx.fill();
  };

  const start = (e) => {
    drawing = true;
    paint(e);
  };
  const end = () => { drawing = false; };

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', paint);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', paint, { passive: false });
  canvas.addEventListener('touchend', end);
}

function fillCircle(canvas, color) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, Math.PI * 2);
  ctx.fill();
}

function loadDataUrlToCanvas(canvas, dataUrl) {
  return new Promise((resolve) => {
    if (!dataUrl) {
      resolve();
      return;
    }
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.beginPath();
      ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.restore();
      resolve();
    };
    img.onerror = () => resolve();
    img.src = dataUrl;
  });
}

export function initBlobEditor(cropModal) {
  const canvas = document.getElementById('blob-paint');
  const presetsEl = document.getElementById('blob-presets');
  const color = document.getElementById('blob-color');
  const size = document.getElementById('blob-size');
  const base = document.getElementById('blob-base');
  let state = loadState();

  const renderPresets = () => {
    state = loadState();
    presetsEl.innerHTML = '';
    BLOB_PRESETS.forEach((p) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preset' + (state.blobSkinId === p.id ? ' selected' : '');
      if (p.src) {
        btn.innerHTML = `<img src="${p.src}" alt="${p.name}" /><div>${p.name}</div>`;
      } else {
        const thumb = state.customBlob?.dataUrl
          ? `<img src="${state.customBlob.dataUrl}" alt="custom" />`
          : `<canvas width="72" height="72"></canvas>`;
        btn.innerHTML = `${thumb}<div>${p.name}</div>`;
      }
      btn.addEventListener('click', async () => {
        if (p.id === 'custom') {
          const custom = state.customBlob || defaultCustomBlob();
          patchState({ blobSkinId: 'custom', customBlob: custom });
          await loadDataUrlToCanvas(canvas, custom.dataUrl);
          if (custom.baseColor) base.value = custom.baseColor;
        } else {
          patchState({ blobSkinId: p.id });
          await loadDataUrlToCanvas(canvas, p.src);
        }
        renderPresets();
      });
      presetsEl.appendChild(btn);
    });
  };

  bindPaint(canvas, () => color.value, () => Number(size.value));

  document.getElementById('blob-clear').onclick = () => fillCircle(canvas, base.value);
  document.getElementById('blob-fill').onclick = () => fillCircle(canvas, color.value);
  document.getElementById('blob-save').onclick = () => {
    const dataUrl = dataUrlFromCanvas(canvas);
    patchState({
      blobSkinId: 'custom',
      customBlob: { dataUrl, baseColor: base.value },
    });
    renderPresets();
    alert('Скин шара сохранён');
  };

  document.getElementById('blob-photo').onchange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !cropModal) return;
    const cropped = await cropModal.open(file, 'Фото на шар');
    if (!cropped) return;
    await loadDataUrlToCanvas(canvas, cropped);
    patchState({
      blobSkinId: 'custom',
      customBlob: { dataUrl: cropped, baseColor: base.value },
    });
    renderPresets();
  };

  base.addEventListener('change', () => fillCircle(canvas, base.value));

  return {
    async open() {
      state = loadState();
      renderPresets();
      if (state.blobSkinId === 'custom' && state.customBlob?.dataUrl) {
        await loadDataUrlToCanvas(canvas, state.customBlob.dataUrl);
      } else {
        const preset = BLOB_PRESETS.find((p) => p.id === state.blobSkinId) || BLOB_PRESETS[1];
        if (preset.src) await loadDataUrlToCanvas(canvas, preset.src);
        else fillCircle(canvas, base.value);
      }
    },
  };
}

export function initWormEditor(cropModal) {
  const canvas = document.getElementById('worm-paint');
  const preview = document.getElementById('worm-preview');
  const tabsEl = document.getElementById('worm-seg-tabs');
  const presetsEl = document.getElementById('worm-presets');
  const color = document.getElementById('worm-color');
  const size = document.getElementById('worm-size');
  let activeSeg = 0;
  let segments = defaultCustomWorm().segments;
  let state = loadState();

  const syncFromState = () => {
    state = loadState();
    if (state.customWorm?.segments?.length === WORM_SEGMENTS) {
      segments = [...state.customWorm.segments];
    } else {
      segments = defaultCustomWorm().segments;
    }
  };

  const paintPreview = async () => {
    const ctx = preview.getContext('2d');
    ctx.clearRect(0, 0, preview.width, preview.height);
    const r = 28;
    for (let i = 0; i < WORM_SEGMENTS; i++) {
      const x = 30 + i * 36;
      const y = 32;
      await new Promise((res) => {
        const img = new Image();
        img.onload = () => {
          ctx.save();
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
          ctx.restore();
          res();
        };
        img.onerror = res;
        img.src = segments[i];
      });
    }
  };

  const renderTabs = () => {
    tabsEl.innerHTML = '';
    segments.forEach((dataUrl, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'seg-tab' + (i === activeSeg ? ' selected' : '');
      const c = document.createElement('canvas');
      c.width = 40;
      c.height = 40;
      btn.appendChild(c);
      const img = new Image();
      img.onload = () => {
        const ctx = c.getContext('2d');
        ctx.beginPath();
        ctx.arc(20, 20, 20, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, 0, 0, 40, 40);
      };
      img.src = dataUrl;
      btn.addEventListener('click', async () => {
        segments[activeSeg] = dataUrlFromCanvas(canvas);
        activeSeg = i;
        await loadDataUrlToCanvas(canvas, segments[activeSeg]);
        renderTabs();
        paintPreview();
      });
      tabsEl.appendChild(btn);
    });
  };

  const renderPresets = () => {
    state = loadState();
    presetsEl.innerHTML = '';
    WORM_PRESETS.forEach((p) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preset worm' + (state.wormSkinId === p.id ? ' selected' : '');
      if (p.src) {
        btn.innerHTML = `<img src="${p.src}" alt="${p.name}" /><div>${p.name}</div>`;
      } else {
        btn.innerHTML = `<div style="height:56px;display:flex;align-items:center;justify-content:center;background:#eee;border-radius:12px;">✏️</div><div>${p.name}</div>`;
      }
      btn.addEventListener('click', async () => {
        if (p.id === 'custom') {
          syncFromState();
          patchState({ wormSkinId: 'custom', customWorm: { segments: [...segments] } });
          await loadDataUrlToCanvas(canvas, segments[activeSeg]);
        } else {
          const applied = Array.from({ length: WORM_SEGMENTS }, () => p.src);
          const urls = await Promise.all(
            applied.map(
              (src) =>
                new Promise((resolve) => {
                  const img = new Image();
                  img.onload = () => {
                    const c = document.createElement('canvas');
                    c.width = 128;
                    c.height = 128;
                    c.getContext('2d').drawImage(img, 0, 0, 128, 128);
                    resolve(c.toDataURL('image/png'));
                  };
                  img.onerror = () => resolve(defaultCustomWorm().segments[0]);
                  img.src = src;
                }),
            ),
          );
          segments = urls;
          patchState({ wormSkinId: p.id, customWorm: { segments: [...segments] } });
          await loadDataUrlToCanvas(canvas, segments[activeSeg]);
        }
        renderPresets();
        renderTabs();
        paintPreview();
      });
      presetsEl.appendChild(btn);
    });
  };

  bindPaint(canvas, () => color.value, () => Number(size.value));

  const commitSeg = () => {
    segments[activeSeg] = dataUrlFromCanvas(canvas);
    renderTabs();
    paintPreview();
  };
  canvas.addEventListener('mouseup', commitSeg);
  canvas.addEventListener('touchend', commitSeg);

  document.getElementById('worm-clear-seg').onclick = () => {
    fillCircle(canvas, color.value);
    commitSeg();
  };
  document.getElementById('worm-copy-all').onclick = () => {
    const cur = dataUrlFromCanvas(canvas);
    segments = segments.map(() => cur);
    renderTabs();
    paintPreview();
  };
  document.getElementById('worm-save').onclick = () => {
    segments[activeSeg] = dataUrlFromCanvas(canvas);
    patchState({
      wormSkinId: 'custom',
      customWorm: { segments: [...segments] },
    });
    renderPresets();
    alert('Скин червя сохранён (все сегменты)');
  };

  document.getElementById('worm-photo').onchange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !cropModal) return;
    const cropped = await cropModal.open(file, `Фото на сегмент ${activeSeg + 1}`);
    if (!cropped) return;
    await loadDataUrlToCanvas(canvas, cropped);
    segments[activeSeg] = cropped;
    patchState({
      wormSkinId: 'custom',
      customWorm: { segments: [...segments] },
    });
    renderPresets();
    renderTabs();
    paintPreview();
  };

  return {
    async open() {
      syncFromState();
      activeSeg = 0;
      renderPresets();
      renderTabs();
      await loadDataUrlToCanvas(canvas, segments[0]);
      paintPreview();
    },
  };
}
