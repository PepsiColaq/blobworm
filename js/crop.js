/** Круглый кроп фото для шара / сегмента червя */
export function createCropModal() {
  const overlay = document.getElementById('crop-overlay');
  const canvas = document.getElementById('crop-canvas');
  const ctx = canvas.getContext('2d');
  const zoomEl = document.getElementById('crop-zoom');
  const titleEl = document.getElementById('crop-title');
  let img = null;
  let offsetX = 0;
  let offsetY = 0;
  let scale = 1;
  let dragging = false;
  let last = null;
  let resolveFn = null;
  const outSize = 256;

  function draw() {
    if (!img) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, w, h);

    const iw = img.width * scale;
    const ih = img.height * scale;
    const x = w / 2 + offsetX - iw / 2;
    const y = h / 2 + offsetY - ih / 2;
    ctx.drawImage(img, x, y, iw, ih);

    // dim outside circle
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.42, 0, Math.PI * 2);
    ctx.stroke();
  }

  function fit() {
    if (!img) return;
    const w = canvas.width;
    const h = canvas.height;
    const circle = Math.min(w, h) * 0.84;
    scale = Math.max(circle / img.width, circle / img.height) * (Number(zoomEl.value) / 100);
    offsetX = 0;
    offsetY = 0;
    draw();
  }

  zoomEl.addEventListener('input', () => {
    if (!img) return;
    const w = canvas.width;
    const h = canvas.height;
    const circle = Math.min(w, h) * 0.84;
    scale = Math.max(circle / img.width, circle / img.height) * (Number(zoomEl.value) / 100);
    draw();
  });

  const pos = (e) => {
    const src = e.touches ? e.touches[0] : e;
    return { x: src.clientX, y: src.clientY };
  };
  canvas.addEventListener('mousedown', (e) => {
    dragging = true;
    last = pos(e);
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging || !last) return;
    const p = pos(e);
    offsetX += p.x - last.x;
    offsetY += p.y - last.y;
    last = p;
    draw();
  });
  window.addEventListener('mouseup', () => {
    dragging = false;
    last = null;
  });
  canvas.addEventListener('touchstart', (e) => {
    dragging = true;
    last = pos(e);
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    if (!dragging || !last) return;
    const p = pos(e);
    offsetX += p.x - last.x;
    offsetY += p.y - last.y;
    last = p;
    draw();
  }, { passive: true });
  canvas.addEventListener('touchend', () => {
    dragging = false;
    last = null;
  });

  function exportCircle() {
    const out = document.createElement('canvas');
    out.width = outSize;
    out.height = outSize;
    const octx = out.getContext('2d');
    const r = outSize / 2;
    const w = canvas.width;
    const h = canvas.height;
    const dispR = Math.min(w, h) * 0.42;
    const iw = img.width * scale;
    const ih = img.height * scale;
    const k = outSize / (dispR * 2);
    const dx = (w / 2 + offsetX - iw / 2 - (w / 2 - dispR)) * k;
    const dy = (h / 2 + offsetY - ih / 2 - (h / 2 - dispR)) * k;
    octx.beginPath();
    octx.arc(r, r, r, 0, Math.PI * 2);
    octx.clip();
    octx.drawImage(img, dx, dy, iw * k, ih * k);
    return out.toDataURL('image/png');
  }

  document.getElementById('crop-cancel').onclick = () => {
    overlay.classList.add('hidden');
    resolveFn?.(null);
    resolveFn = null;
  };
  document.getElementById('crop-apply').onclick = () => {
    const dataUrl = exportCircle();
    overlay.classList.add('hidden');
    resolveFn?.(dataUrl);
    resolveFn = null;
  };

  return {
    open(fileOrUrl, title = 'Кадрирование') {
      return new Promise((resolve) => {
        resolveFn = resolve;
        titleEl.textContent = title;
        zoomEl.value = 100;
        const load = (src) => {
          img = new Image();
          img.onload = () => {
            canvas.width = 360;
            canvas.height = 360;
            fit();
            overlay.classList.remove('hidden');
          };
          img.src = src;
        };
        if (typeof fileOrUrl === 'string') load(fileOrUrl);
        else {
          const reader = new FileReader();
          reader.onload = () => load(reader.result);
          reader.readAsDataURL(fileOrUrl);
        }
      });
    },
  };
}
