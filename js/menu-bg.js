/** Фоновые шары и черви — можно лопать кликом */
export function startMenuBg(canvas) {
  const ctx = canvas.getContext('2d');
  let raf = 0;
  let running = true;
  const blobs = [];
  const worms = [];
  const particles = [];
  const rings = [];
  const colors = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#9b5de5', '#f15bb5', '#4cc9f0'];

  function resize() {
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  function burst(x, y, color, n = 18) {
    rings.push({ x, y, r: 6, max: 48 + Math.random() * 28, life: 1, color });
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.8 + Math.random() * 4;
      particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        r: 2 + Math.random() * 4,
        life: 0.5 + Math.random() * 0.4,
        color,
      });
    }
  }

  function spawnBlob() {
    const fromLeft = Math.random() < 0.5;
    blobs.push({
      x: fromLeft ? -80 : window.innerWidth + 80,
      y: 40 + Math.random() * (window.innerHeight - 80),
      r: 16 + Math.random() * 30,
      vx: (fromLeft ? 1 : -1) * (0.35 + Math.random() * 0.55),
      color: colors[(Math.random() * colors.length) | 0],
      alpha: 0.28 + Math.random() * 0.22,
    });
  }

  function spawnWorm() {
    const fromLeft = Math.random() < 0.5;
    const y = 60 + Math.random() * (window.innerHeight - 120);
    const n = 8 + ((Math.random() * 6) | 0);
    const segs = [];
    const x0 = fromLeft ? -20 : window.innerWidth + 20;
    for (let i = 0; i < n; i++) segs.push({ x: x0 + (fromLeft ? -i : i) * 12, y });
    worms.push({
      segs,
      vx: (fromLeft ? 1 : -1) * (0.55 + Math.random() * 0.7),
      color: colors[(Math.random() * colors.length) | 0],
      alpha: 0.26 + Math.random() * 0.2,
      phase: Math.random() * Math.PI * 2,
    });
  }

  function tryPop(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    for (let i = blobs.length - 1; i >= 0; i--) {
      const b = blobs[i];
      if (Math.hypot(b.x - x, b.y - y) <= b.r + 8) {
        burst(b.x, b.y, b.color, 16);
        blobs.splice(i, 1);
        return true;
      }
    }
    for (let i = worms.length - 1; i >= 0; i--) {
      const worm = worms[i];
      for (const seg of worm.segs) {
        if (Math.hypot(seg.x - x, seg.y - y) <= 14) {
          burst(seg.x, seg.y, worm.color, 18);
          worms.splice(i, 1);
          return true;
        }
      }
    }
    return false;
  }

  canvas.style.pointerEvents = 'auto';
  canvas.style.cursor = 'default';

  const onPointer = (e) => {
    if (e.button != null && e.button !== 0) return;
    const t = e.target;
    if (
      t &&
      t.closest &&
      t.closest(
        'button, a, input, select, textarea, label, .menu-card, .layout-editor, .crop-overlay, #screen-game',
      )
    ) {
      return;
    }
    if (document.getElementById('screen-game')?.classList.contains('active')) return;
    if (tryPop(e.clientX, e.clientY)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  window.addEventListener('pointerdown', onPointer, true);

  let spawnT = 0;
  function frame(t) {
    if (!running) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);

    spawnT += 1;
    if (spawnT % 160 === 0 && blobs.length < 6) spawnBlob();
    if (spawnT % 240 === 0 && worms.length < 4) spawnWorm();

    for (let i = rings.length - 1; i >= 0; i--) {
      const rg = rings[i];
      rg.r += (rg.max - rg.r) * 0.16 + 1.5;
      rg.life -= 0.05;
      ctx.globalAlpha = Math.max(0, rg.life) * 0.7;
      ctx.strokeStyle = rg.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(rg.x, rg.y, rg.r, 0, Math.PI * 2);
      ctx.stroke();
      if (rg.life <= 0) rings.splice(i, 1);
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= 0.016;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.05;
      ctx.globalAlpha = Math.max(0, p.life) * 0.9;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      if (p.life <= 0) particles.splice(i, 1);
    }
    ctx.globalAlpha = 1;

    for (let i = blobs.length - 1; i >= 0; i--) {
      const b = blobs[i];
      b.x += b.vx;
      b.y += Math.sin(t / 700 + b.x * 0.01) * 0.25;
      ctx.globalAlpha = b.alpha;
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (b.x < -120 || b.x > w + 120) blobs.splice(i, 1);
    }

    for (let i = worms.length - 1; i >= 0; i--) {
      const worm = worms[i];
      worm.phase += 0.04;
      const head = worm.segs[0];
      head.x += worm.vx;
      head.y += Math.sin(worm.phase) * 0.8;
      for (let s = 1; s < worm.segs.length; s++) {
        const prev = worm.segs[s - 1];
        const cur = worm.segs[s];
        const dx = prev.x - cur.x;
        const dy = prev.y - cur.y;
        const d = Math.hypot(dx, dy) || 1;
        const spacing = 11;
        if (d > spacing) {
          cur.x += (dx / d) * (d - spacing);
          cur.y += (dy / d) * (d - spacing);
        }
      }
      ctx.globalAlpha = worm.alpha;
      ctx.fillStyle = worm.color;
      for (let s = worm.segs.length - 1; s >= 0; s--) {
        const seg = worm.segs[s];
        ctx.beginPath();
        ctx.arc(seg.x, seg.y, 9, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (head.x < -200 || head.x > w + 200) worms.splice(i, 1);
    }

    raf = requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener('resize', resize);
  spawnBlob();
  spawnWorm();
  raf = requestAnimationFrame(frame);

  return {
    pause() {
      running = false;
      cancelAnimationFrame(raf);
      raf = 0;
    },
    resume() {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      raf = 0;
      window.removeEventListener('pointerdown', onPointer, true);
    },
  };
}
