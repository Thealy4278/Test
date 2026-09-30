/* Math Quest – celebrations: confetti, fireworks, and pop-up banners.
 * Animations are skipped for people who turn on "reduce motion" in their system settings.
 */
(function () {
  'use strict';

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const COLORS = ['#e5484d', '#f76b15', '#ffc53d', '#46a758', '#12a594', '#0090ff', '#6e56cf', '#d6409f'];
  const SPARK_COLORS = ['#ff6b6b', '#ffd43b', '#69db7c', '#4dabf7', '#b197fc', '#f783ac', '#ffa94d', '#ffffff'];

  const rand = (a, b) => a + Math.random() * (b - a);
  const pickFrom = (arr) => arr[Math.floor(Math.random() * arr.length)];

  let canvas, ctx, W = 0, H = 0;
  let confetti = [], sparks = [], rockets = [];
  let pendingLaunches = 0, nightUntil = 0, night = 0;
  let running = false, lastTime = 0;

  function ensureCanvas() {
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'celebrate-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      document.body.appendChild(canvas);
      ctx = canvas.getContext('2d');
      window.addEventListener('resize', resize);
    }
    resize();
  }

  function resize() {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---------- confetti ----------
  function throwConfetti(amount = 150) {
    if (reduceMotion) return;
    ensureCanvas();
    for (let i = 0; i < amount; i++) {
      const left = i % 2 === 0;
      confetti.push({
        x: left ? -10 : W + 10,
        y: H * rand(0.45, 0.8),
        vx: (left ? 1 : -1) * rand(4, 13),
        vy: -rand(8, 17),
        w: rand(6, 11), h: rand(9, 16),
        rot: rand(0, Math.PI * 2), spin: rand(-0.25, 0.25),
        flip: rand(0, Math.PI * 2), flipSpeed: rand(0.08, 0.2),
        color: pickFrom(COLORS),
        life: 1, decay: rand(0.003, 0.006),
      });
    }
    start();
  }

  // ---------- fireworks ----------
  function fireworks(duration = 4500) {
    if (reduceMotion) return;
    ensureCanvas();
    const shots = Math.max(4, Math.round(duration / 380));
    nightUntil = Math.max(nightUntil, performance.now() + duration + 1200);
    for (let i = 0; i < shots; i++) {
      pendingLaunches++;
      setTimeout(() => { pendingLaunches--; launch(); }, i * (duration / shots) + rand(0, 180));
    }
    start();
  }

  function launch() {
    const targetY = H * rand(0.12, 0.42);
    const gravity = 0.12;
    rockets.push({
      x: rand(W * 0.12, W * 0.88), y: H + 5,
      vx: rand(-1, 1), vy: -Math.sqrt(2 * gravity * (H - targetY)),
      trail: [], color: pickFrom(SPARK_COLORS),
    });
    start();
  }

  function explode(r) {
    const count = Math.round(rand(60, 90));
    const second = pickFrom(SPARK_COLORS);
    const ring = Math.random() < 0.3;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + rand(-0.05, 0.05);
      const speed = ring ? 4.2 : rand(1.2, 5.5);
      sparks.push({
        x: r.x, y: r.y,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        color: Math.random() < 0.75 ? r.color : second,
        life: 1, decay: rand(0.011, 0.019),
        trail: [], twinkle: Math.random() < 0.3,
      });
    }
    sparks.push({ flash: true, x: r.x, y: r.y, life: 1, decay: 0.08, color: r.color });
  }

  // ---------- animation loop ----------
  function start() {
    if (running) return;
    running = true;
    lastTime = performance.now();
    requestAnimationFrame(frame);
  }

  function drawTrail(trail, x, y, color, alpha, width) {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(trail.length ? trail[0][0] : x, trail.length ? trail[0][1] : y);
    for (const [tx, ty] of trail) ctx.lineTo(tx, ty);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function frame(now) {
    const dt = Math.min(2.5, (now - lastTime) / 16.67);
    lastTime = now;
    ctx.clearRect(0, 0, W, H);

    // Dim the page into a night sky while fireworks are going.
    const nightTarget = now < nightUntil ? 0.6 : 0;
    night += (nightTarget - night) * Math.min(1, 0.05 * dt);
    if (night > 0.005) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = `rgba(16, 12, 44, ${night})`;
      ctx.fillRect(0, 0, W, H);
    }

    // Rockets and sparks glow on top of the sky.
    ctx.globalCompositeOperation = 'lighter';
    rockets = rockets.filter((r) => {
      r.trail.push([r.x, r.y]);
      if (r.trail.length > 8) r.trail.shift();
      r.vy += 0.12 * dt;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      if (r.vy >= -0.8) { explode(r); return false; }
      drawTrail(r.trail, r.x, r.y, '#ffe8a3', 0.9, 3);
      return true;
    });

    sparks = sparks.filter((s) => {
      s.life -= s.decay * dt;
      if (s.life <= 0) return false;
      if (s.flash) {
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, 70);
        g.addColorStop(0, s.color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = s.life * 0.6;
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(s.x, s.y, 70, 0, Math.PI * 2); ctx.fill();
        return true;
      }
      s.trail.push([s.x, s.y]);
      if (s.trail.length > 5) s.trail.shift();
      s.vx *= Math.pow(0.965, dt);
      s.vy = s.vy * Math.pow(0.965, dt) + 0.06 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const alpha = s.twinkle ? s.life * rand(0.3, 1) : s.life;
      drawTrail(s.trail, s.x, s.y, s.color, alpha, 2.2);
      return true;
    });
    ctx.globalCompositeOperation = 'source-over';

    // Confetti falls in front of everything.
    confetti = confetti.filter((c) => {
      c.vx *= Math.pow(0.985, dt);
      c.vy = c.vy * Math.pow(0.985, dt) + 0.28 * dt;
      if (c.vy > 4.5) c.vy = 4.5;
      c.x += (c.vx + Math.sin(c.flip) * 0.6) * dt;
      c.y += c.vy * dt;
      c.rot += c.spin * dt;
      c.flip += c.flipSpeed * dt;
      c.life -= c.decay * dt;
      if (c.life <= 0 || c.y > H + 30) return false;
      ctx.save();
      ctx.globalAlpha = Math.min(1, c.life * 2);
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.scale(1, Math.cos(c.flip));
      ctx.fillStyle = c.color;
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      ctx.restore();
      return true;
    });
    ctx.globalAlpha = 1;

    const busy = confetti.length || sparks.length || rockets.length || pendingLaunches || night > 0.005;
    if (busy) requestAnimationFrame(frame);
    else { ctx.clearRect(0, 0, W, H); running = false; }
  }

  // ---------- banners ----------
  let bannerQueue = Promise.resolve();

  // Shows a big pop-up message. Banners wait their turn so they never overlap.
  function banner(title, subtitle, tone = '', ms = 3200) {
    bannerQueue = bannerQueue.then(() => new Promise((done) => {
      const el = document.createElement('div');
      el.className = `celebrate-banner ${tone}`;
      el.setAttribute('role', 'status');
      const t = document.createElement('div');
      t.className = 'cb-title';
      t.textContent = title;
      el.appendChild(t);
      if (subtitle) {
        const s = document.createElement('div');
        s.className = 'cb-sub';
        s.textContent = subtitle;
        el.appendChild(s);
      }
      document.body.appendChild(el);
      setTimeout(() => el.classList.add('out'), ms);
      setTimeout(() => { el.remove(); done(); }, ms + 450);
    }));
    return bannerQueue;
  }

  window.Celebrate = { confetti: throwConfetti, fireworks, banner, reduceMotion };
})();
