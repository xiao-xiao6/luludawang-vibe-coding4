/* ============================================================
 * 深海汤屋 · 特效引擎（Canvas：雨幕 / 闪电 / 雾气 / 粒子 / 尘埃）
 * ------------------------------------------------------------
 * 纯 2D Canvas + requestAnimationFrame，无外部依赖。
 * 自动适配 devicePixelRatio、窗口尺寸、页面不可见时暂停，
 * 并尊重 prefers-reduced-motion（降级为静态柔和背景）。
 * ============================================================ */
(function (root) {
  "use strict";

  var doc = root.document;
  if (!doc) return;

  var REDUCE = false;
  try {
    var mq = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)");
    REDUCE = !!(mq && mq.matches);
  } catch (e) { }

  var STATE = {
    canvas: null,
    ctx: null,
    w: 0,
    h: 0,
    dpr: 1,
    running: false,
    rafId: 0,
    last: 0,
    time: 0,
    scene: "menu",
    enabled: true,       // 氛围特效总开关（关掉后雨幕 / 闪电 / 粒子全停）
    gust: 1,             // 风向强度系数
    gustPhase: 0,
    drops: [],
    splashes: [],
    motes: [],
    sparks: [],
    bolt: null,
    boltTimer: 6,
    crows: [],
    crowTimer: 14,
    flash: 0,
    sceneCfg: {},
    fps: 0,
    _acc: 0,
    _frames: 0
  };

  /* 每个场景的雨的“性格” */
  var SCENES = {
    menu: { count: 1.0, speed: 1.0, slant: 1.0, splash: 0.9, bolts: [7, 17], mote: 26, tint: "150,170,190", wind: 1.0 },
    game: { count: 0.8, speed: 1.25, slant: 0.8, splash: 0.7, bolts: [9, 22], mote: 18, tint: "140,160,185", wind: 0.8 },
    hall: { count: 0.35, speed: 0.75, slant: 0.6, splash: 0.4, bolts: [16, 34], mote: 34, tint: "170,150,120", wind: 0.5 },
    win: { count: 0.45, speed: 0.7, slant: 0.7, splash: 0.6, bolts: [20, 40], mote: 30, tint: "200,190,150", wind: 0.6 },
    sad: { count: 1.15, speed: 0.85, slant: 1.15, splash: 1.0, bolts: [12, 26], mote: 14, tint: "130,135,150", wind: 1.15 },
    none: { count: 0, speed: 1, slant: 1, splash: 0, bolts: [999, 999], mote: 0, tint: "150,170,190", wind: 0 }
  };

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ---------------- 尺寸 ---------------- */

  function resize() {
    var c = STATE.canvas;
    if (!c) return;
    var w = root.innerWidth || doc.documentElement.clientWidth || 800;
    var h = root.innerHeight || doc.documentElement.clientHeight || 600;
    STATE.dpr = clamp(root.devicePixelRatio || 1, 1, 2);
    STATE.w = w;
    STATE.h = h;
    c.width = Math.floor(w * STATE.dpr);
    c.height = Math.floor(h * STATE.dpr);
    /* 不写内联宽高：交给 CSS 的 inset:0 撑满视口，避免视口切换瞬间旧尺寸溢出 */
    if (STATE.ctx) STATE.ctx.setTransform(STATE.dpr, 0, 0, STATE.dpr, 0, 0);
    seedDrops();
    seedMotes();
  }

  /* ---------------- 粒子初始化 ---------------- */

  function dropTotal() {
    var cfg = STATE.sceneCfg;
    var area = (STATE.w * STATE.h) / (1920 * 1080);
    var base = 220 * clamp(area, 0.35, 1.6);
    return Math.round(base * cfg.count);
  }

  function makeDrop(spread) {
    var cfg = STATE.sceneCfg;
    var speed = rand(9, 17) * cfg.speed * 60;   // px/s
    return {
      x: rand(-STATE.w * 0.25, STATE.w * 1.05),
      y: spread ? rand(-STATE.h, STATE.h) : rand(-STATE.h * 0.4, -10),
      len: rand(10, 30) * cfg.speed,
      w: rand(0.6, 1.6),
      vy: speed,
      a: rand(0.14, 0.5),
      depth: Math.random()
    };
  }

  function seedDrops() {
    var n = dropTotal();
    STATE.drops = [];
    for (var i = 0; i < n; i++) STATE.drops.push(makeDrop(true));
  }

  function seedMotes() {
    var n = STATE.sceneCfg.mote;
    STATE.motes = [];
    for (var i = 0; i < n; i++) {
      STATE.motes.push({
        x: rand(0, STATE.w),
        y: rand(0, STATE.h),
        r: rand(0.6, 2.1),
        vx: rand(-6, 6),
        vy: rand(-14, -3),
        a: rand(0.05, 0.22),
        ph: rand(0, 6.28)
      });
    }
  }

  /* ---------------- 闪电 ---------------- */

  function scheduleBolt() {
    var cfg = STATE.sceneCfg;
    var lo = cfg.bolts[0], hi = cfg.bolts[1];
    STATE.boltTimer = rand(lo, hi);
  }

  function makeBoltPath() {
    // 从上方随机位置劈下，带随机折线分叉
    var x = rand(STATE.w * 0.06, STATE.w * 0.94);
    var y = rand(-40, STATE.h * 0.12);
    var pts = [{ x: x, y: y }];
    var segs = 12;
    var stepY = (STATE.h * rand(0.42, 0.72)) / segs;
    var cur = x;
    for (var i = 0; i < segs; i++) {
      cur += rand(-38, 38);
      y += stepY;
      pts.push({ x: cur, y: y });
    }
    var branches = [];
    for (var b = 0; b < 3; b++) {
      var idx = Math.floor(rand(3, pts.length - 2));
      var bp = [pts[idx]];
      var bx = pts[idx].x, by = pts[idx].y;
      var bs = Math.floor(rand(3, 6));
      for (var k = 0; k < bs; k++) {
        bx += rand(-52, 52);
        by += rand(14, 40);
        bp.push({ x: bx, y: by });
      }
      branches.push(bp);
    }
    return { main: pts, branches: branches, life: 1 };
  }

  function strike() {
    if (!STATE.enabled) return;
    STATE.bolt = makeBoltPath();
    STATE.flash = 1;
    if (root.SoupAudio && root.SoupAudio.sfx) root.SoupAudio.sfx("thunder");
    if (root.dispatchEvent) {
      try { root.dispatchEvent(new CustomEvent("soup:lightning")); } catch (e) { }
    }
  }

  /* ---------------- 乌鸦剪影 ---------------- */

  function spawnCrows() {
    var dir = Math.random() < 0.5 ? 1 : -1;
    var n = 2 + Math.floor(Math.random() * 3);
    var y0 = rand(STATE.h * 0.1, STATE.h * 0.42);
    for (var i = 0; i < n; i++) {
      STATE.crows.push({
        x: dir > 0 ? -60 - i * 48 : STATE.w + 60 + i * 48,
        y: y0 + rand(-28, 28),
        vx: dir * rand(54, 92),
        flap: rand(0, 6.28),
        s: rand(0.7, 1.3)
      });
    }
  }

  function drawCrows(dt) {
    var ctx = STATE.ctx;
    for (var i = STATE.crows.length - 1; i >= 0; i--) {
      var b = STATE.crows[i];
      b.x += b.vx * dt;
      b.y += Math.sin(b.flap * 0.6) * 7 * dt;
      b.flap += dt * 9;
      if (b.x < -140 || b.x > STATE.w + 140) { STATE.crows.splice(i, 1); continue; }
      var w = 11 * b.s;
      var lift = Math.sin(b.flap) * 7 * b.s;
      ctx.strokeStyle = "rgba(11,9,8,.72)";
      ctx.lineWidth = 2.1 * b.s;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(b.x - w, b.y + lift);
      ctx.quadraticCurveTo(b.x, b.y - 2.4 * b.s, b.x, b.y);
      ctx.quadraticCurveTo(b.x, b.y - 2.4 * b.s, b.x + w, b.y + lift);
      ctx.stroke();
    }
  }

  /* ---------------- 绘制 ---------------- */

  function drawRain(dt) {
    var ctx = STATE.ctx, cfg = STATE.sceneCfg;
    var slant = 0.22 * cfg.slant * STATE.gust;
    var tint = cfg.tint;
    for (var i = 0; i < STATE.drops.length; i++) {
      var d = STATE.drops[i];
      var vx = d.vy * slant;
      d.x += vx * dt;
      d.y += d.vy * dt;
      if (d.y > STATE.h + 20) {
        if (cfg.splash > 0 && Math.random() < 0.28 * cfg.splash) {
          STATE.splashes.push({ x: d.x, y: STATE.h - rand(0, 8), r: 1, a: 0.34 * cfg.splash, dr: rand(16, 34) });
        }
        var nd = makeDrop(false);
        nd.y = rand(-STATE.h * 0.5, -8);
        STATE.drops[i] = nd;
        continue;
      }
      if (d.x < -STATE.w * 0.35 || d.x > STATE.w * 1.2) {
        STATE.drops[i] = makeDrop(false);
        continue;
      }
      ctx.strokeStyle = "rgba(" + tint + "," + (d.a * (0.5 + d.depth * 0.5)) + ")";
      ctx.lineWidth = d.w;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - d.len * slant, d.y - d.len);
      ctx.stroke();
    }
  }

  function drawSplashes(dt) {
    var ctx = STATE.ctx;
    for (var i = STATE.splashes.length - 1; i >= 0; i--) {
      var s = STATE.splashes[i];
      s.r += s.dr * dt;
      s.a -= dt * 1.5;
      if (s.a <= 0 || s.r > 34) { STATE.splashes.splice(i, 1); continue; }
      ctx.strokeStyle = "rgba(190,205,225," + Math.max(s.a, 0) + ")";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, s.r, s.r * 0.32, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (STATE.splashes.length > 90) STATE.splashes.splice(0, STATE.splashes.length - 90);
  }

  function drawMotes(dt) {
    var ctx = STATE.ctx;
    for (var i = 0; i < STATE.motes.length; i++) {
      var m = STATE.motes[i];
      m.ph += dt * 1.4;
      m.x += (m.vx + Math.sin(m.ph) * 8) * dt;
      m.y += m.vy * dt;
      if (m.y < -12) { m.y = STATE.h + 8; m.x = rand(0, STATE.w); }
      if (m.x < -12) m.x = STATE.w + 8;
      if (m.x > STATE.w + 12) m.x = -8;
      ctx.fillStyle = "rgba(226,196,150," + m.a + ")";
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawSparks(dt) {
    var ctx = STATE.ctx;
    for (var i = STATE.sparks.length - 1; i >= 0; i--) {
      var p = STATE.sparks[i];
      p.life -= dt;
      if (p.life <= 0) { STATE.sparks.splice(i, 1); continue; }
      p.vy += 320 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      var k = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = k;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (0.4 + k * 0.8), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawBolt() {
    var b = STATE.bolt;
    if (!b) return;
    var ctx = STATE.ctx;
    var a = clamp(b.life, 0, 1);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.shadowColor = "rgba(190,215,255,.95)";
    ctx.shadowBlur = 22;
    ctx.strokeStyle = "rgba(236,244,255,.95)";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(b.main[0].x, b.main[0].y);
    for (var i = 1; i < b.main.length; i++) ctx.lineTo(b.main[i].x, b.main[i].y);
    ctx.stroke();
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = "rgba(190,215,255,.6)";
    for (var j = 0; j < b.branches.length; j++) {
      var bp = b.branches[j];
      ctx.beginPath();
      ctx.moveTo(bp[0].x, bp[0].y);
      for (var k = 1; k < bp.length; k++) ctx.lineTo(bp[k].x, bp[k].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function applyFlash() {
    var el = doc.getElementById("fx-flash");
    if (!el) return;
    var f = STATE.flash;
    if (f <= 0.001) {
      if (el.style.opacity !== "0") el.style.opacity = "0";
      return;
    }
    el.style.opacity = String(Math.min(f, 1) * 0.55);
  }

  /* ---------------- 庆祝前景层（2026-09-25） ----------------
   * 揭底弹窗 .modal-wrap 自带 backdrop-filter: blur + 深色遮罩，
   * 而氛围 canvas 在 z-index 3、躲在遮罩底下 —— 礼炮 / 烟花被遮罩
   * 连图带亮一起糊掉（主人反馈「特效都是糊的」的根因）。
   * 现在庆祝粒子画到独立的 #fx-front 前景 canvas（z-index 120，
   * 盖过弹窗），叠加发光 + 拖尾光条 + 彩纸，不再受背景模糊影响。 */
  var FRONT = { canvas: null, ctx: null, parts: [], raf: 0, last: 0, w: 0, h: 0, dpr: 1 };
  var CELE_COLORS = ["#ffd166", "#ffe9c4", "#68cf9a", "#ff8f6e", "#8fd3ff", "#ff6e9e", "#f6cf90", "#fff3d6"];

  function frontResize() {
    var c = FRONT.canvas;
    if (!c) return;
    var w = root.innerWidth || doc.documentElement.clientWidth || 800;
    var h = root.innerHeight || doc.documentElement.clientHeight || 600;
    var dpr = clamp(root.devicePixelRatio || 1, 1, 2);
    FRONT.w = w; FRONT.h = h; FRONT.dpr = dpr;
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
    FRONT.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function frontEnsure() {
    if (FRONT.canvas) return true;
    if (!doc.createElement("canvas").getContext) return false;
    var c = doc.createElement("canvas");
    c.id = "fx-front";
    c.setAttribute("aria-hidden", "true");
    c.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:120;pointer-events:none;display:block;";
    (doc.body || doc.documentElement).appendChild(c);
    var ctx = c.getContext("2d");
    if (!ctx) return false;
    FRONT.canvas = c;
    FRONT.ctx = ctx;
    frontResize();
    root.addEventListener("resize", frontResize);
    return true;
  }

  function frontKick() {
    if (FRONT.raf || !FRONT.ctx) return;
    FRONT.last = 0;
    FRONT.raf = root.requestAnimationFrame(frontFrame);
  }

  function frontBoom(x, y, opt) {
    opt = opt || {};
    var n = opt.count || 80;
    var colors = opt.colors || CELE_COLORS;
    var pow = opt.power || 280;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2 + rand(-0.09, 0.09);
      var s = pow * rand(0.35, 1.05);
      FRONT.parts.push({
        kind: "spark", x: x, y: y, px: x, py: y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        r: rand(1.8, 3.8), life: rand(0.9, 1.8), max: 1.8,
        g: 150, drag: 1.15,
        color: colors[Math.floor(Math.random() * colors.length)], hi: "#fffbe8"
      });
    }
    /* 炸完再补一把白色小星屑，让烟花有「余爆」的层次 */
    for (var j = 0; j < (n / 3) | 0; j++) {
      var a2 = rand(0, Math.PI * 2);
      var s2 = pow * rand(0.1, 0.55);
      FRONT.parts.push({
        kind: "spark", x: x, y: y, px: x, py: y,
        vx: Math.cos(a2) * s2, vy: Math.sin(a2) * s2,
        r: rand(0.8, 1.6), life: rand(0.35, 0.8), max: 0.8,
        g: 60, drag: 2.2, color: "#fff7e0", hi: "#ffffff"
      });
    }
    if (STATE.enabled && root.SoupAudio && root.SoupAudio.sfx) root.SoupAudio.sfx("pop");
  }

  function frontFrame(ts) {
    var ctx = FRONT.ctx;
    if (!ctx) { FRONT.raf = 0; return; }
    if (!FRONT.last) FRONT.last = ts;
    var dt = Math.min((ts - FRONT.last) / 1000, 0.05);
    FRONT.last = ts;
    ctx.clearRect(0, 0, FRONT.w, FRONT.h);
    var parts = FRONT.parts;
    FRONT.parts = [];
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        if (p.kind === "rocket") frontBoom(p.x, p.y, p.opt);
        continue;
      }
      if (p.kind === "rocket") {
        /* 升空弹：匀速直线，寿命到点炸开 */
        p.px = p.x; p.py = p.y;
        p.x += p.vx * dt; p.y += p.vy * dt;
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = "#ffd9a0";
        ctx.lineWidth = 2.2;
        ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.fillStyle = "#fff3d6";
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.2, 0, 6.283); ctx.fill();
        FRONT.parts.push(p);
        continue;
      }
      p.vy += (p.g == null ? 340 : p.g) * dt;
      var k = 1 - (p.drag || 0.6) * dt;
      if (k < 0) k = 0;
      p.vx *= k; p.vy *= k;
      p.px = p.x; p.py = p.y;
      p.x += p.vx * dt; p.y += p.vy * dt;
      var kk = clamp(p.life / p.max, 0, 1);
      if (p.kind === "confetti") {
        p.rot += p.spin * dt;
        ctx.globalAlpha = Math.min(1, kk * 2);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w2, -p.h2, p.w2 * 2, p.h2 * 2 * Math.abs(Math.cos(p.rot * 0.7)) + 1);
        ctx.restore();
        FRONT.parts.push(p);
        continue;
      }
      /* 火花：头尾拖一条光条 + 亮芯，叠加发光在深色遮罩上特别跳 */
      ctx.globalAlpha = Math.min(1, kk * 1.7) * 0.9;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.r * 0.95;
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.globalAlpha = Math.min(1, kk * 2);
      ctx.fillStyle = p.hi || "#fff";
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.55, 0, 6.283); ctx.fill();
      FRONT.parts.push(p);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    if (FRONT.parts.length) {
      FRONT.raf = root.requestAnimationFrame(frontFrame);
    } else {
      FRONT.raf = 0;
      ctx.clearRect(0, 0, FRONT.w, FRONT.h);
    }
  }

  /* 礼炮齐射：朝 ang 方向喷一大束火花 + 一把彩纸 */
  function frontSalvo(x, y, ang) {
    var colors = CELE_COLORS;
    for (var i = 0; i < 58; i++) {
      var a = ang + rand(-0.3, 0.3);
      var sp = rand(520, 1180);
      FRONT.parts.push({
        kind: "spark", x: x + rand(-8, 8), y: y + rand(-6, 6), px: x, py: y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        r: rand(1.8, 3.8), life: rand(0.8, 1.6), max: 1.6,
        g: 430, drag: 0.5,
        color: colors[Math.floor(Math.random() * colors.length)], hi: "#ffffff"
      });
    }
    for (var j = 0; j < 26; j++) {
      var a2 = ang + rand(-0.44, 0.44);
      var sp2 = rand(360, 920);
      FRONT.parts.push({
        kind: "confetti", x: x, y: y,
        vx: Math.cos(a2) * sp2, vy: Math.sin(a2) * sp2,
        w2: rand(2, 4), h2: rand(3.5, 7), rot: rand(0, 6.28), spin: rand(-9, 9),
        life: rand(1.1, 2.2), max: 2.2, g: 520, drag: 0.35,
        color: colors[Math.floor(Math.random() * colors.length)]
      });
    }
    frontKick();
  }

  /* 烟花升空弹：从屏幕底边射到 (tx,ty) 后炸开 */
  function frontRocket(tx, ty) {
    var sx = clamp(tx + rand(-46, 46), 10, FRONT.w - 10);
    var sy = FRONT.h - 8;
    var dur = clamp(Math.abs(ty - sy) / 950, 0.5, 1.05);
    FRONT.parts.push({
      kind: "rocket", x: sx, y: sy, px: sx, py: sy,
      vx: (tx - sx) / dur, vy: (ty - sy) / dur,
      life: dur, max: dur, color: "#ffd9a0",
      opt: { count: 70 + Math.floor(rand(0, 40)), power: rand(230, 340) }
    });
    frontKick();
  }

  /* ---------------- 主循环 ---------------- */

  function frame(ts) {
    if (!STATE.running) return;
    STATE.rafId = root.requestAnimationFrame(frame);
    if (!STATE.last) STATE.last = ts;
    var dt = (ts - STATE.last) / 1000;
    STATE.last = ts;
    if (dt > 0.1) dt = 0.1;
    if (dt <= 0) return;
    STATE.time += dt;

    STATE._acc += dt; STATE._frames++;
    if (STATE._acc >= 0.5) { STATE.fps = Math.round(STATE._frames / STATE._acc); STATE._acc = 0; STATE._frames = 0; }

    // 风：正弦起伏，偶发阵风
    STATE.gustPhase += dt * 0.32;
    STATE.gust = 1 + Math.sin(STATE.gustPhase) * 0.5 + Math.sin(STATE.gustPhase * 2.7) * 0.22;

    // 乌鸦：偶发掠过
    STATE.crowTimer -= dt;
    if (STATE.crowTimer <= 0) { spawnCrows(); STATE.crowTimer = rand(22, 58); }

    // 闪电计时
    STATE.boltTimer -= dt;
    if (STATE.boltTimer <= 0) { strike(); scheduleBolt(); }
    if (STATE.bolt) {
      STATE.bolt.life -= dt * 3.6;
      if (STATE.bolt.life <= 0) STATE.bolt = null;
    }
    if (STATE.flash > 0) {
      STATE.flash -= dt * (STATE.flash > 0.7 ? 1.6 : 2.6);
      if (STATE.flash < 0) STATE.flash = 0;
    }
    applyFlash();

    var ctx = STATE.ctx;
    ctx.clearRect(0, 0, STATE.w, STATE.h);
    if (STATE.sceneCfg.count > 0) drawRain(dt);
    drawSplashes(dt);
    drawMotes(dt);
    drawCrows(dt);
    drawSparks(dt);
    drawBolt();
  }

  /* ---------------- 对外接口 ---------------- */

  var api = {
    reduced: REDUCE,
    supported: !!doc.createElement("canvas").getContext,

    init: function () {
      var c = doc.getElementById("fx-canvas");
      if (!c || !api.supported) return;
      STATE.canvas = c;
      STATE.ctx = c.getContext("2d");
      STATE.sceneCfg = SCENES.menu;
      resize();
      scheduleBolt();
      root.addEventListener("resize", function () {
        clearTimeout(api._rt);
        api._rt = setTimeout(resize, 160);
      });
      doc.addEventListener("visibilitychange", function () {
        if (doc.hidden) api.pause(); else api.resume();
      });
      if (REDUCE) { api.pause(); return; }
      api.resume();
      return api;
    },

    setScene: function (name) {
      var cfg = SCENES[name] || SCENES.menu;
      if (STATE.sceneCfg === cfg && STATE.scene === name) return;
      STATE.sceneCfg = cfg;
      STATE.scene = name;
      seedDrops();
      seedMotes();
      scheduleBolt();
      var body = doc.body;
      if (body) body.setAttribute("data-scene", name);
    },

    resume: function () {
      if (REDUCE || !STATE.enabled || STATE.running || !STATE.canvas) return;
      STATE.running = true;
      STATE.last = 0;
      STATE.rafId = root.requestAnimationFrame(frame);
    },

    pause: function () {
      STATE.running = false;
      if (STATE.rafId) root.cancelAnimationFrame(STATE.rafId);
      STATE.rafId = 0;
    },

    /* 氛围特效总开关：关掉立刻停雨、停闪电、清掉闪光，画面只留静态背景 */
    setEnabled: function (b) {
      STATE.enabled = !!b;
      if (!STATE.enabled) {
        api.pause();
        STATE.bolt = null;
        STATE.flash = 0;
        STATE.sparks.length = 0;
        STATE.crows.length = 0;
        applyFlash();
        /* 前景庆祝层一并清场 */
        FRONT.parts.length = 0;
        if (FRONT.ctx) FRONT.ctx.clearRect(0, 0, FRONT.w, FRONT.h);
      } else {
        api.resume();
      }
      return STATE.enabled;
    },

    isEnabled: function () { return STATE.enabled; },

    /* 手动打雷 */
    bolt: strike,

    /* 粒子爆发（判定反馈 / 通关礼花 / 点击） */
    burst: function (x, y, opt) {
      opt = opt || {};
      if (REDUCE || !STATE.enabled) return;
      var n = opt.count || 22;
      var colors = opt.colors || ["#e2a44f", "#f6cf90", "#ffe9c4", "#68cf9a"];
      for (var i = 0; i < n; i++) {
        var ang = rand(0, Math.PI * 2);
        var sp = rand(60, 320) * (opt.power || 1);
        STATE.sparks.push({
          x: x, y: y,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp - rand(20, 120),
          r: rand(1.2, 3.4),
          life: rand(0.5, 1.25),
          max: 1.25,
          color: colors[Math.floor(Math.random() * colors.length)]
        });
      }
      if (STATE.sparks.length > 700) STATE.sparks.splice(0, STATE.sparks.length - 700);
    },

    /* 在元素中心爆发 */
    burstAt: function (el, opt) {
      if (!el || !el.getBoundingClientRect) return;
      var r = el.getBoundingClientRect();
      api.burst(r.left + r.width / 2, r.top + r.height / 2, opt);
    },

    /* 全屏雨幕加强（通关仪式感） */
    surge: function (sec) {
      if (!STATE.enabled) return;
      var old = STATE.sceneCfg;
      STATE.sceneCfg = Object.assign({}, old, { count: old.count + 0.9, speed: old.speed * 1.5 });
      seedDrops();
      setTimeout(function () { STATE.sceneCfg = old; seedDrops(); }, (sec || 4) * 1000);
    },

    /* 第⑦条（2026-09-25 重做）：说破汤底的庆祝 —— 全部画在前景层上，
     * 盖过揭底弹窗的模糊遮罩；礼炮 4 轮齐射 ×2 门，烟花 9 发升空爆，
     * 配套爆响与号角音效。 */
    celebrate: function () {
      if (REDUCE || !STATE.enabled) return;
      if (!frontEnsure()) return;
      var w = FRONT.w, h = FRONT.h;
      /* 礼炮：左下角朝右上、右下角朝左上，各 4 轮齐射，两门错开半拍 */
      var cannons = [[w * 0.04, h - 6, -1.02], [w * 0.96, h - 6, -2.12]];
      cannons.forEach(function (c, ci) {
        for (var k = 0; k < 4; k++) {
          (function (x, y, ang, delay) {
            setTimeout(function () {
              if (!STATE.enabled) return;
              frontSalvo(x, y, ang);
            }, delay);
          })(c[0], c[1], c[2], k * 260 + ci * 130);
        }
      });
      /* 烟花：上半屏连放 9 发升空弹，每发炸完自带余爆星屑 */
      for (var f = 0; f < 9; f++) {
        (function (delay) {
          setTimeout(function () {
            if (!STATE.enabled) return;
            frontRocket(rand(w * 0.12, w * 0.88), rand(h * 0.08, h * 0.42));
          }, delay);
        })(280 + f * 340);
      }
      if (root.SoupAudio && root.SoupAudio.sfx) root.SoupAudio.sfx("fanfare");
    },

    /* 前景层粒子爆发：给单人说破 / 结算用，不受弹窗遮罩模糊影响 */
    burstFront: function (x, y, opt) {
      if (REDUCE || !STATE.enabled) return;
      if (!frontEnsure()) return;
      opt = opt || {};
      var n = opt.count || 60;
      var colors = opt.colors || CELE_COLORS;
      var pow = opt.power || 1;
      for (var i = 0; i < n; i++) {
        var a = rand(0, Math.PI * 2);
        var sp = rand(70, 420) * pow;
        FRONT.parts.push({
          kind: "spark", x: x, y: y, px: x, py: y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - rand(20, 140) * pow,
          r: rand(1.6, 3.6), life: rand(0.7, 1.5), max: 1.5,
          g: 300, drag: 0.8,
          color: colors[Math.floor(Math.random() * colors.length)], hi: "#fffbe8"
        });
      }
      frontKick();
    },

    burstFrontAt: function (el, opt) {
      if (!el || !el.getBoundingClientRect) return;
      var r = el.getBoundingClientRect();
      api.burstFront(r.left + r.width / 2, r.top + r.height / 2, opt);
    },

    stats: function () {
      return {
        running: STATE.running,
        scene: STATE.scene,
        drops: STATE.drops.length,
        motes: STATE.motes.length,
        sparks: STATE.sparks.length,
        crows: STATE.crows.length,
        fps: STATE.fps,
        reduce: REDUCE
      };
    }
  };

  root.SoupFx = api;
})(typeof window !== "undefined" ? window : this);
