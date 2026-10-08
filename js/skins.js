export const BLOB_PRESETS = [
  { id: 'trollface', name: 'Troll', src: 'assets/skins/blobs/trollface.jpg' },
  { id: 'doge', name: 'Doge', src: 'assets/skins/blobs/doge.jpg' },
  { id: 'pepe', name: 'Pepe', src: 'assets/skins/blobs/pepe.jpg' },
  { id: 'amogus', name: 'Amogus', src: 'assets/skins/blobs/amogus.jpg' },
  { id: 'gigachad', name: 'Gigachad', src: 'assets/skins/blobs/gigachad.jpg' },
  { id: 'custom', name: 'Свой', src: null },
];

export const WORM_PRESETS = [
  { id: 'cat', name: 'Cats', src: 'assets/skins/worms/cat.jpg' },
  { id: 'sigma', name: 'Sigma', src: 'assets/skins/worms/sigma.jpg' },
  { id: 'banana', name: 'Banana', src: 'assets/skins/worms/banana.jpg' },
  { id: 'skull', name: 'Skull', src: 'assets/skins/worms/skull.jpg' },
  { id: 'nyan', name: 'Nyan', src: 'assets/skins/worms/nyan.jpg' },
  { id: 'custom', name: 'Свой', src: null },
];

export const WORM_SEGMENTS = 8;

const imageCache = new Map();

export function loadImage(src) {
  if (!src) return Promise.resolve(null);
  if (imageCache.has(src)) return imageCache.get(src);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
  imageCache.set(src, p);
  return p;
}

export function dataUrlFromCanvas(canvas) {
  return canvas.toDataURL('image/png');
}

export function makeBlankSegment(color = '#4cc9f0') {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(64, 64, 64, 0, Math.PI * 2);
  ctx.fill();
  return c.toDataURL('image/png');
}

export function defaultCustomWorm() {
  const colors = ['#ff6b6b', '#feca57', '#48dbfb', '#1dd1a1', '#5f27cd', '#ff9ff3', '#54a0ff', '#00d2d3'];
  return {
    segments: colors.map((c) => makeBlankSegment(c)),
  };
}

export function defaultCustomBlob() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#4cc9f0';
  ctx.beginPath();
  ctx.arc(128, 128, 128, 0, Math.PI * 2);
  ctx.fill();
  return { dataUrl: c.toDataURL('image/png'), baseColor: '#4cc9f0' };
}

/** Resolve drawable for blob skin */
export async function resolveBlobSkin(state) {
  if (state.blobSkinId === 'custom' && state.customBlob?.dataUrl) {
    return loadImage(state.customBlob.dataUrl);
  }
  const preset = BLOB_PRESETS.find((p) => p.id === state.blobSkinId) || BLOB_PRESETS[1];
  if (preset.src) return loadImage(preset.src);
  if (state.customBlob?.dataUrl) return loadImage(state.customBlob.dataUrl);
  return null;
}

/** Resolve array of images for worm segments */
export async function resolveWormSkin(state) {
  if (state.wormSkinId === 'custom' && state.customWorm?.segments?.length) {
    return Promise.all(state.customWorm.segments.map((s) => loadImage(s)));
  }
  const preset = WORM_PRESETS.find((p) => p.id === state.wormSkinId) || WORM_PRESETS[4];
  if (preset.src) {
    const img = await loadImage(preset.src);
    return Array.from({ length: WORM_SEGMENTS }, () => img);
  }
  const custom = state.customWorm || defaultCustomWorm();
  return Promise.all(custom.segments.map((s) => loadImage(s)));
}

export function drawCircledImage(ctx, img, x, y, r) {
  if (!img) {
    ctx.fillStyle = '#4cc9f0';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}
