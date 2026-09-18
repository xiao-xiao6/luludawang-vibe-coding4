/* ============================================================
 * 深海汤屋 · 音频引擎（纯 Web Audio 现场合成，零外部音频文件）
 * ------------------------------------------------------------
 * BGM：4 首按“场景”切换的氛围曲，用 OfflineAudioContext 现场合成后无缝循环
 *      menu 雨夜古堡（汤单/首页） · game 盘问时刻（对局） ·
 *      win 破晓微光（熬出汤底） · sad 汤凉了（失败/重熬）
 * SFX：判定 / 提示 / 落笔 / 揭晓 / 雷声 等短音效
 * 控制：音量、静音、音乐暂停/继续（暂停音乐不影响音效）、状态自动存档
 * ============================================================ */
(function (root) {
  "use strict";

  var AC = root.AudioContext || root.webkitAudioContext;
  var OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
  var SR = 32000;            // 合成采样率（够用又省内存）
  var XFADE = 1.1;           // 切曲交叉淡入淡出秒数

  var S = {
    ctx: null,
    master: null,
    comp: null,
    bgmGain: null,
    sfxGain: null,
    buffers: {},
    built: {},
    building: {},
    track: null,       // 当前曲名
    srcNode: null,
    token: 0,
    volume: 0.6,
    musicOn: true,
    sfxOn: true,
    playing: true,
    pending: null,
    supported: !!(AC && OAC)
  };

  /* ---------------- 基础工具 ---------------- */

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /* 感知音量曲线：滑块 60% ≈ 听觉一半 */
  function curve(v) { return Math.pow(clamp01(v), 1.7); }

  /* 可复现的伪随机（保证每次合成的曲子完全一样） */
  function rng(seed) {
    var s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  function envGain(ctx, t, peak, atk, dec) {
    var g = ctx.createGain();
    var p = Math.max(peak, 0.0002);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(p, t + Math.max(atk, 0.002));
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(atk, 0.002) + Math.max(dec, 0.02));
    return g;
  }

  function osc(ctx, type, freq, t, dur) {
    var o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  /* 钟/钢琴质感的音：基频 + 两个衰减更快的泛音 */
  function bell(ctx, out, t, freq, dur, gain, lp) {
    var parts = [[1, 1], [2.01, 0.34], [3.02, 0.13], [4.97, 0.05]];
    for (var i = 0; i < parts.length; i++) {
      var f = freq * parts[i][0];
      var o = osc(ctx, i === 0 ? "triangle" : "sine", f, t, dur);
      var g = envGain(ctx, t, gain * parts[i][1], 0.006, dur * (1 - i * 0.12));
      var node = o;
      if (lp) {
        var flp = ctx.createBiquadFilter();
        flp.type = "lowpass";
        flp.frequency.setValueAtTime(lp, t);
        flp.frequency.exponentialRampToValueAtTime(Math.max(lp * 0.35, 320), t + dur);
        o.connect(flp); node = flp;
      }
      node.connect(g); g.connect(out);
    }
  }

  /* 弦乐/氛围垫：两个失谐锯齿 + 低通，慢起慢落 */
  function pad(ctx, out, t, freq, dur, gain, cut) {
    var g = envGain(ctx, t, gain, dur * 0.35, dur * 0.75);
    var flp = ctx.createBiquadFilter();
    flp.type = "lowpass";
    flp.frequency.setValueAtTime(cut || 820, t);
    flp.Q.value = 0.7;
    [-0.12, 0.1].forEach(function (d) {
      var o = osc(ctx, "sawtooth", freq * (1 + d / 100), t, dur + 0.4);
      o.connect(flp);
    });
    var sub = osc(ctx, "sine", freq / 2, t, dur + 0.4);
    var sg = envGain(ctx, t, gain * 0.5, dur * 0.4, dur * 0.7);
    sub.connect(sg); sg.connect(out);
    flp.connect(g); g.connect(out);
  }

  /* 低频轰鸣（远雷 / 心跳低频） */
  function rumble(ctx, out, t, dur, gain, lpFrom, lpTo) {
    var o = osc(ctx, "sine", 46, t, dur);
    o.frequency.setValueAtTime(58, t);
    o.frequency.exponentialRampToValueAtTime(31, t + dur);
    var flp = ctx.createBiquadFilter();
    flp.type = "lowpass";
    flp.frequency.setValueAtTime(lpFrom || 180, t);
    flp.frequency.exponentialRampToValueAtTime(lpTo || 70, t + dur);
    var g = envGain(ctx, t, gain, dur * 0.14, dur * 0.9);
    o.connect(flp); flp.connect(g); g.connect(out);
  }

  function noiseSource(ctx, t, dur, seed) {
    var len = Math.max(1, Math.ceil(dur * SR));
    var buf = ctx.createBuffer(1, len, SR);
    var d = buf.getChannelData(0);
    var r = rng(seed || 7);
    for (var i = 0; i < len; i++) d[i] = r() * 2 - 1;
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.start(t);
    src.stop(t + dur + 0.05);
    return src;
  }

  /* 雨声 / 风声：带通噪声 */
  function hiss(ctx, out, t, dur, gain, hp, lp, seed) {
    var src = noiseSource(ctx, t, dur, seed);
    var f1 = ctx.createBiquadFilter();
    f1.type = "highpass"; f1.frequency.value = hp;
    var f2 = ctx.createBiquadFilter();
    f2.type = "lowpass"; f2.frequency.value = lp;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.8);
    g.gain.setValueAtTime(gain, t + Math.max(dur - 0.8, 0.9));
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    src.connect(f1); f1.connect(f2); f2.connect(g); g.connect(out);
  }

  /* 滴答 / 落笔：极短噪声 */
  function tickNoise(ctx, out, t, gain, hp, dur, seed) {
    var src = noiseSource(ctx, t, dur, seed);
    var f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = hp;
    f.Q.value = 1.4;
    var g = envGain(ctx, t, gain, 0.002, dur);
    src.connect(f); f.connect(g); g.connect(out);
  }

  /* ---------------- 四首氛围曲 ---------------- */

  var TRACKS = {
    /* 汤单 / 首页：雨夜古堡，最慢最空 */
    menu: {
      label: "雨夜古堡",
      dur: 32,
      build: function (ctx, out, dur) {
        var r = rng(20260918);
        hiss(ctx, out, 0, dur, 0.055, 700, 7200, 11);          // 雨
        hiss(ctx, out, 0, dur, 0.03, 90, 420, 23);             // 风
        rumble(ctx, out, 0, 6, 0.0, 0, 0);                     // 占位（保持时长对齐）
        // 低音铺底：Am → F → C → G
        var prog = [110, 87.31, 130.81, 98];
        for (var i = 0; i < 4; i++) {
          pad(ctx, out, i * 8, prog[i], 8.6, 0.085, 640);
          pad(ctx, out, i * 8, prog[i] * 1.5, 8.6, 0.028, 900);
        }
        // 远雷 ×2
        rumble(ctx, out, 5.5, 3.2, 0.16, 220, 60);
        rumble(ctx, out, 21.0, 3.6, 0.14, 200, 55);
        // 稀疏钟声旋律
        var notes = [440, 523.25, 659.25, 587.33, 523.25, 440, 392, 440,
          349.23, 440, 523.25, 440, 392, 329.63, 349.23, 392];
        for (var n = 0; n < notes.length; n++) {
          var t = 1.6 + n * 1.9 + r() * 0.12;
          if (t > dur - 2) break;
          bell(ctx, out, t, notes[n], 3.4, 0.075, 2400);
        }
      }
    },

    /* 对局 / 盘问：心跳 + 滴答，紧张 */
    game: {
      label: "盘问时刻",
      dur: 24,
      build: function (ctx, out, dur) {
        var r = rng(777);
        hiss(ctx, out, 0, dur, 0.04, 800, 7000, 31);
        pad(ctx, out, 0, 73.42, dur, 0.07, 520);              // D 低音铺底
        pad(ctx, out, 0, 110, dur, 0.035, 700);
        // 心跳：每 2 秒“咚—咚”
        for (var b = 0; b < dur / 2; b++) {
          var t0 = b * 2 + 0.1;
          rumble(ctx, out, t0, 0.42, 0.2, 150, 60);
          rumble(ctx, out, t0 + 0.34, 0.34, 0.14, 140, 55);
        }
        // 秒针滴答
        for (var k = 0; k < dur * 2; k++) {
          tickNoise(ctx, out, k * 0.5 + 0.05, k % 2 ? 0.016 : 0.028, 3400, 0.05, 5 + k);
        }
        // 零散不安定的高音
        var spook = [659.25, 622.25, 698.46, 587.33, 739.99, 622.25];
        for (var s = 0; s < spook.length; s++) {
          var ts = 2.4 + s * 3.6 + r() * 0.3;
          if (ts > dur - 2) break;
          bell(ctx, out, ts, spook[s], 2.6, 0.05, 3000);
        }
      }
    },

    /* 熬出汤底：破晓，暖一点 */
    win: {
      label: "破晓微光",
      dur: 18,
      build: function (ctx, out, dur) {
        var base = [130.81, 196.0, 261.63, 329.63];
        for (var i = 0; i < base.length; i++) pad(ctx, out, 0, base[i], dur, 0.05, 1100 - i * 120);
        hiss(ctx, out, 0, dur, 0.02, 500, 5200, 61);
        var mel = [523.25, 659.25, 783.99, 1046.5, 880, 783.99, 659.25, 523.25, 587.33, 659.25];
        for (var m = 0; m < mel.length; m++) {
          bell(ctx, out, 0.6 + m * 1.7, mel[m], 3.2, 0.085, 3600);
        }
        rumble(ctx, out, 12.5, 2.4, 0.05, 160, 60);
      }
    },

    /* 汤凉了：忧郁下行 */
    sad: {
      label: "汤凉了",
      dur: 18,
      build: function (ctx, out, dur) {
        pad(ctx, out, 0, 98, dur, 0.075, 500);
        pad(ctx, out, 0, 116.54, dur, 0.04, 620);
        hiss(ctx, out, 0, dur, 0.035, 400, 4200, 91);
        var mel = [440, 415.3, 392, 349.23, 329.63, 293.66, 261.63, 246.94];
        for (var m = 0; m < mel.length; m++) {
          bell(ctx, out, 0.5 + m * 2.05, mel[m], 3.6, 0.08, 2000);
        }
      }
    }
  };

  /* ---------------- 合成 + 播放 ---------------- */

  function buildTrack(name, cb) {
    var def = TRACKS[name];
    if (!def || !OAC) { cb(null); return; }
    if (S.buffers[name]) { cb(S.buffers[name]); return; }
    if (S.building[name]) { S.building[name].push(cb); return; }
    S.building[name] = [cb];
    var flush = function (buf) {
      S.buffers[name] = buf;
      var q = S.building[name] || [];
      delete S.building[name];
      q.forEach(function (f) { try { f(buf); } catch (e) { } });
    };
    try {
      var oac = new OAC(2, Math.ceil(SR * def.dur), SR);
      var out = oac.createGain();
      out.gain.value = 1;
      out.connect(oac.destination);
      def.build(oac, out, def.dur);
      oac.startRendering().then(function (buf) {
        flush(buf);
      }).catch(function () { flush(null); });
    } catch (e) {
      flush(null);
    }
  }

  function ensure() {
    if (!AC) return null;
    try {
      if (!S.ctx) {
        S.ctx = new AC();
        S.comp = S.ctx.createDynamicsCompressor();
        S.comp.threshold.value = -12;
        S.comp.ratio.value = 6;
        S.master = S.ctx.createGain();
        S.master.gain.value = curve(S.volume);
        S.bgmGain = S.ctx.createGain();
        S.bgmGain.gain.value = 0;
        S.sfxGain = S.ctx.createGain();
        S.sfxGain.gain.value = S.sfxOn ? 1 : 0;
        S.bgmGain.connect(S.master);
        S.sfxGain.connect(S.master);
        S.master.connect(S.comp);
        S.comp.connect(S.ctx.destination);
      }
      if (S.ctx.state === "suspended") { S.ctx.resume().catch(function () { }); }
    } catch (e) { }
    return S.ctx;
  }

  function bgmTarget() { return S.musicOn && S.playing ? 1 : 0; }

  function fadeBgm(to, sec) {
    var ctx = ensure();
    if (!ctx) return;
    var t = ctx.currentTime;
    try {
      S.bgmGain.gain.cancelScheduledValues(t);
      S.bgmGain.gain.setValueAtTime(Math.max(S.bgmGain.gain.value, 0.0001), t);
      S.bgmGain.gain.linearRampToValueAtTime(Math.max(to, 0.0001), t + sec);
    } catch (e) { }
  }

  function play(name) {
    var ctx = ensure();
    if (!ctx || !S.buffers[name]) return;
    var myToken = ++S.token;
    try { if (S.srcNode) { S.srcNode.stop(ctx.currentTime + XFADE + 0.05); } } catch (e) { }
    var src = ctx.createBufferSource();
    src.buffer = S.buffers[name];
    src.loop = true;
    var g = ctx.createGain();
    g.gain.value = 0.0001;
    src.connect(g); g.connect(S.bgmGain);
    src.start(ctx.currentTime);
    try {
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.linearRampToValueAtTime(1, ctx.currentTime + XFADE);
    } catch (e) { }
    S.srcNode = src;
    S.track = name;
    S.myToken = myToken;
    fadeBgm(bgmTarget(), 0.35);
    if (root.dispatchEvent) {
      try {
        root.dispatchEvent(new CustomEvent("soup:track", { detail: { name: name, label: TRACKS[name].label } }));
      } catch (e) { }
    }
  }

  /* ---------------- 音效 ---------------- */

  function sfx(name) {
    if (!S.sfxOn) return;
    var ctx = ensure();
    if (!ctx) return;
    var out = S.sfxGain;
    var t = ctx.currentTime + 0.005;
    try {
      switch (name) {
        case "yes":
          bell(ctx, out, t, 659.25, 1.1, 0.18, 4200);
          bell(ctx, out, t + 0.11, 987.77, 1.3, 0.15, 4600);
          break;
        case "no":
          bell(ctx, out, t, 174.61, 0.9, 0.2, 900);
          tickNoise(ctx, out, t + 0.03, 0.1, 1400, 0.09, 3);
          break;
        case "partial":
          bell(ctx, out, t, 523.25, 1.0, 0.16, 3600);
          bell(ctx, out, t + 0.09, 698.46, 1.0, 0.12, 3800);
          break;
        case "irr":
          bell(ctx, out, t, 155.56, 0.7, 0.16, 800);
          break;
        case "hint":
          bell(ctx, out, t, 880, 1.4, 0.13, 5200);
          bell(ctx, out, t + 0.16, 1174.66, 1.2, 0.09, 5400);
          break;
        case "pick":
          bell(ctx, out, t, 392, 0.4, 0.11, 3000);
          break;
        case "ui":
          tickNoise(ctx, out, t, 0.06, 2600, 0.035, 9);
          break;
        case "paper":
          tickNoise(ctx, out, t, 0.09, 2400, 0.14, 17);
          tickNoise(ctx, out, t + 0.05, 0.06, 3600, 0.1, 19);
          break;
        case "reveal":
          tickNoise(ctx, out, t, 0.07, 4600, 0.5, 29);
          bell(ctx, out, t, 1567.98, 1.6, 0.08, 6000);
          break;
        case "thunder":
          rumble(ctx, out, t, 2.6, 0.5, 300, 45);
          hiss(ctx, out, t, 1.4, 0.16, 200, 2400, 37);
          break;
        case "win":
          [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) {
            bell(ctx, out, t + i * 0.13, f, 1.8, 0.16, 5200);
          });
          break;
        case "lose":
          [392, 349.23, 293.66, 220].forEach(function (f, i) {
            bell(ctx, out, t + i * 0.16, f, 1.6, 0.14, 1800);
          });
          break;
        case "page":
          hiss(ctx, out, t, 0.5, 0.12, 400, 3600, 43);
          break;
        default:
          bell(ctx, out, t, 440, 0.5, 0.1, 3000);
      }
    } catch (e) { }
  }

  /* ---------------- 对外接口 ---------------- */

  var api = {
    supported: S.supported,
    /* 首次用户手势时调用，解锁音频上下文 */
    unlock: function () { ensure(); },
    /* 切场景：渲染（若无缓存）+ 交叉淡入 */
    start: function (name) {
      if (!TRACKS[name]) return;
      if (S.track === name && S.srcNode) { fadeBgm(bgmTarget(), 0.4); return; }
      S.pending = name;
      buildTrack(name, function (buf) {
        if (!buf) { S.track = name; return; }
        if (S.pending !== name) return;
        play(name);
      });
    },
    stop: function () {
      S.pending = null;
      fadeBgm(0, 0.6);
      S.track = null;
    },
    setVolume: function (v) {
      S.volume = clamp01(Number(v) || 0);
      var ctx = ensure();
      if (!ctx) return;
      try {
        var t = ctx.currentTime;
        S.master.gain.cancelScheduledValues(t);
        S.master.gain.setValueAtTime(Math.max(S.master.gain.value, 0.0001), t);
        S.master.gain.linearRampToValueAtTime(Math.max(curve(S.volume), 0.0001), t + 0.12);
      } catch (e) { }
    },
    getVolume: function () { return S.volume; },
    setMusicOn: function (b) {
      S.musicOn = !!b;
      ensure();
      fadeBgm(bgmTarget(), 0.5);
    },
    isMusicOn: function () { return S.musicOn; },
    setSfxOn: function (b) {
      S.sfxOn = !!b;
      var ctx = ensure();
      if (ctx) { try { S.sfxGain.gain.value = b ? 1 : 0; } catch (e) { } }
    },
    isSfxOn: function () { return S.sfxOn; },
    /* 暂停/继续音乐（音效照常） */
    setPlaying: function (b) {
      S.playing = !!b;
      ensure();
      fadeBgm(bgmTarget(), 0.45);
    },
    isPlaying: function () { return S.playing; },
    current: function () { return S.track; },
    label: function (n) { return TRACKS[n] ? TRACKS[n].label : ""; },
    labels: function () {
      var o = {};
      Object.keys(TRACKS).forEach(function (k) { o[k] = TRACKS[k].label; });
      return o;
    },
    /* 预热：提前合成，切场景时不卡 */
    preload: function (names) {
      (names || ["menu"]).forEach(function (n) { buildTrack(n, function () { }); });
    },
    sfx: sfx
  };

  root.SoupAudio = api;
})(typeof window !== "undefined" ? window : this);
