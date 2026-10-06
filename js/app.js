/* ============================================================
 * 深海汤屋 · 主逻辑
 * ============================================================ */
"use strict";

/* 必须接收 root（= window）：文件里 root.SoupRoom / root.SoupApp 都靠它。
   之前签名漏了参数、正文却照用 root，导致 IIFE 尾部直接抛
   ReferenceError: root is not defined —— window.SoupApp 从未挂上窗口，
   点「密码看汤底」拿不到题目而无声失败，单人对局后半段渲染也整段中断。 */
(function (root) {
  var E = window.SoupEngine;
  var FX = window.SoupFx;
  var AU = window.SoupAudio;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };

  /* 图标助手（js/icons.js，2026-09-26 去 emoji）：顶栏按钮等一律用同风格线性 SVG */
  function ic(name, cls) {
    return (typeof root.SoupIcon === "function") ? root.SoupIcon(name, cls) : "";
  }
  function icRaw(name) {
    return (root.SoupIcon && root.SoupIcon.raw) ? root.SoupIcon.raw(name) : "";
  }

  /* 汤库题不在 PUZZLES 里：给查题函数包一层（引擎语义不变，PUZZLES 仍优先） */
  var ENGINE_getPuzzle = E.getPuzzle;
  E.getPuzzle = function (id) {
    return ENGINE_getPuzzle.call(E, id) || libPuzzle(id);
  };

  /* 触摸端判定：触屏设备载入题目时不自动弹软键盘（iPad 这类宽屏触控机也会中招） */
  function isTouch() {
    try {
      if (window.matchMedia && window.matchMedia("(hover: none) and (pointer: coarse)").matches) return true;
      if ("ontouchstart" in window && (navigator.maxTouchPoints || 0) > 0) return true;
    } catch (e) { /* 忽略 */ }
    return false;
  }

  var STORE_KEY = "deepsea_soup_v1";

  /* 汤库存档：独立 key，绝不碰精品层的 deepsea_soup_v1 */
  var LIB_KEY = "deepsea_soup_library_v1";
  var LIB_PAGE_SIZE = 30;

  /* 已熬出汤底：本机记录，不同步任何人。
     主人点汤卡上的小绿勾手动标记 / 取消；熬出汤底时也会自动打勾。 */
  var SOLVED_KEY = "deepsea_soup_solved_v1";

  function solvedSet() {
    try {
      var raw = localStorage.getItem(SOLVED_KEY);
      var obj = raw ? JSON.parse(raw) : null;
      if (obj && typeof obj === "object") return obj;
    } catch (e) { /* 隐私模式：忽略 */ }
    return {};
  }

  function isSolved(id) {
    return !!(id && solvedSet()[id]);
  }

  function markSolved(id, on) {
    if (!id) return;
    var obj = solvedSet();
    if (on) obj[id] = 1;
    else delete obj[id];
    try { localStorage.setItem(SOLVED_KEY, JSON.stringify(obj)); } catch (e) { /* 忽略 */ }
  }

  function toggleSolved(id) {
    var next = !isSolved(id);
    markSolved(id, next);
    return next;
  }

  /* 场景 → 背景图 / 特效场景 / 曲目 */
  var BG = {
    menu: "assets/bg-castle.webp",
    game: "assets/bg-hall.webp",
    hall: "assets/bg-hall.webp",
    win: "assets/bg-dawn.webp",
    sad: "assets/bg-gate.webp"
  };
  var TRACK_OF = { menu: "menu", game: "game", hall: "game", win: "win", sad: "sad" };

  var state = {
    pid: null,
    revealed: [],
    asked: {},
    /* hintsUsed 已随提示机制下线（报告 P3-8）：存档里若有残留字段会被忽略 */
    qCount: 0,
    done: false,
    randCat: "全部",
    randDiff: 0,
    history: [],
    aiBusy: false,
    sound: true,
    music: true,
    playing: true,
    fx: true,
    volume: 0.6,
    /* 报告 P3-6：只有玩家真拖过滑条才算「明确音量」，才允许落盘 */
    volumeTouched: false,
    /* 2026-10-04 服务端判定：单人 = Worker 上只有自己的小房间。
       detail = 服务端逐道拉来的汤面（含 surface，绝不含 truth）。 */
    roomCode: null,
    detail: null,
    aiOk: false
  };

  var NET = window.SoupNet;

  var progress = loadProgress();

  /* ---------------- 汤库（汤库层 + 精品层合并，均为纯元信息） ----------------
   * 浏览器包里的两层都只有汤名/分类/火候/来源：
   *   · 汤库层（lib_*，来自 js/library.list.js）
   *   · 精品层（项目最初那 100 道，来自 js/data.js + data-more.js）
   * 汤面逐道向 Worker GET /api/puzzle/:id 获取；判定与汤底全在服务端。 */
  var CORE_SRC = "精品汤";
  var mergedCache = null;
  var mergedSig = "";

  function coreAsLib(p) {
    return {
      id: p.id,
      dispTitle: p.title || p.id,
      cats: p.cats || [],
      difficulty: p.difficulty,
      par: p.par,
      src: CORE_SRC,
      lang: "zh",
      mode: "truth",
      hasTruth: true,          // 汤底在服务端，永远「有底」
      truthSource: p.truthSource || "original",
      layer: "core"
    };
  }

  /* 汤库列表的数据源：汤库层（懒加载） + 精品层（首屏本地包） */
  function mergedLib() {
    var core = (typeof PUZZLES !== "undefined" && PUZZLES && PUZZLES.length) ? PUZZLES : [];
    var lib = LIB_OF();
    var sig = lib.length + "|" + core.length;
    if (mergedCache && mergedSig === sig) return mergedCache;
    var out = lib.slice();
    for (var i = 0; i < core.length; i++) {
      if (core[i] && core[i].id) out.push(coreAsLib(core[i]));
    }
    mergedCache = out;
    mergedSig = sig;
    return out;
  }

  /* 汤库层元信息是懒加载的（js/library.source.js）：首屏没有，
     进汤库 / 随机模式 / 多人房选汤时才注入 window.SOUP_LIBRARY。
     一律通过 LIB_OF() 取，别把数组引用存成局部变量。 */
  function LIB_OF() { return window.SOUP_LIBRARY || []; }

  var libState = {
    page: 1,
    kw: "",
    cat: "全部",
    difficulty: 0,
    src: "全部"
  };

  function libPuzzle(id) {
    if (!id) return null;
    var lib = LIB_OF();
    for (var i = 0; i < lib.length; i++) {
      if (lib[i].id === id) return lib[i];
    }
    return null;
  }

  function isLibPid(id) {
    return typeof id === "string" && id.indexOf("lib_") === 0;
  }

  /* 库层进度：坏档回落空对象，绝不白屏 */
  function libProgress() {
    try {
      var raw = localStorage.getItem(LIB_KEY);
      var obj = raw ? JSON.parse(raw) : {};
      if (obj && typeof obj === "object") {
        if (!("session" in obj)) obj.session = null;
        return obj;
      }
    } catch (e) { /* 隐私模式等：忽略 */ }
    return { session: null };
  }

  function saveLibProgress(obj) {
    try { localStorage.setItem(LIB_KEY, JSON.stringify(obj || libProgress())); }
    catch (e) { /* 忽略 */ }
  }

  /* 两层存档各自持有「进行中的对局」快照：库层优先显示库层的 */
  function currentSession() {
    var a = progress.session;
    var b = libProgress().session;
    if (a && a.pid) return a;
    if (b && b.pid) return b;
    return null;
  }

  /* 库层没有预设线索：只有 AI 汤主能对战 */
  function setAskEnabled(on) {
    ["#q-input", "#btn-ask", "#btn-guess"].forEach(function (s) {
      var el = $(s);
      if (el) el.disabled = !on;
    });
  }

  /* ---------------- 存档 ---------------- */

  function loadProgress() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var obj = raw ? JSON.parse(raw) : {};
      if (obj && typeof obj === "object") {
        if (!("session" in obj)) obj.session = null;
        return obj;
      }
    } catch (e) { /* 隐私模式等：忽略 */ }
    return { session: null, sound: true, music: true, playing: true, fx: true, volume: 0.6 };
  }

  function saveProgress() {
    try {
      progress.sound = state.sound;
      progress.music = state.music;
      progress.playing = state.playing;
      progress.fx = state.fx;
      /* 报告 P3-6 第2条的读写护栏：音量只在「玩家明确动过」或
         「存档里本来就有合法音量」时持久化——把时序 / 自动化环境
         里可能的异常归零挡在存档之外；越界坏值顺手从档里剔除。 */
      var saved = progress.volume;
      var hasExplicit = typeof saved === "number" && isFinite(saved) && saved >= 0 && saved <= 1;
      if (hasExplicit || state.volumeTouched) {
        progress.volume = Math.max(0, Math.min(1, Number(state.volume) || 0));
      } else if ("volume" in progress) {
        delete progress.volume;
      }
      localStorage.setItem(STORE_KEY, JSON.stringify(progress));
    } catch (e) { /* 忽略 */ }
  }

  /* 进行中的对局快照：刷新 / 误关标签页 / 手机后台被杀，都能接着熬 */
  function saveSession() {
    var snap = null;
    if (state.pid && !state.done) {
      snap = {
        pid: state.pid,
        revealed: state.revealed.slice(),
        asked: state.asked,
        qCount: state.qCount,
        history: state.history.slice(-20),
        roomCode: state.roomCode || null
      };
    }
    /* 库题快照写进 LIB_KEY，精品题快照写进 deepsea_soup_v1 */
    if (isLibPid(state.pid)) {
      var lp = libProgress();
      lp.session = snap;
      saveLibProgress(lp);
      return;
    }
    progress.session = snap;
    saveProgress();
  }

  /* 首屏「继续上一锅」：有快照才显示，点一下回到那口锅 */
  function paintResume() {
    var b = $("#btn-resume");
    if (!b) return;
    var s = currentSession();
    var p = s && s.pid ? E.getPuzzle(s.pid) : null;
    b.classList.toggle("hidden", !p);
    if (p) b.textContent = "继续上一锅：" + (p.dispTitle || p.title);
  }

  function resumeSession() {
    var s = currentSession();
    var p = s && s.pid ? E.getPuzzle(s.pid) : null;
    if (!p) { toast("没有可以接着熬的锅"); paintResume(); return; }
    loadPuzzle(p.id, true);
  }

  /* ---------------- 小工具 ---------------- */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var toastTimer = null;
  function toast(msg) {
    var el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2200);
  }

  /* 房间层复用同一个 toast，避免两套提示条 */
  if (window.SoupToastBridge) window.SoupToastBridge(toast);

  var VERDICT_TEXT = { yes: "是", no: "不是", partial: "部分正确", irr: "与此无关" };

  /* ---------------- 场景切换：背景 + 特效 + 音乐 ---------------- */

  var bgTop = "a";
  var bgCurrent = "";

  function setBg(url) {
    if (!url || url === bgCurrent) return;
    bgCurrent = url;
    var next = bgTop === "a" ? "b" : "a";
    var show = document.getElementById("bg-" + next);
    var hide = document.getElementById("bg-" + bgTop);
    if (!show || !hide) return;
    show.style.backgroundImage = 'url("' + url + '")';
    show.classList.add("on");
    hide.classList.remove("on");
    bgTop = next;
  }

  function setScene(name) {
    if (FX) FX.setScene(name);
    setBg(BG[name] || BG.menu);
    if (AU) AU.start(TRACK_OF[name] || "menu");
  }

  /* 转场：黑幕盖屏 → 在全黑那一瞬换内容 → 黑幕拉开。
     按「exit / swap / enter」三段严格分开，不再一边盖黑一边换景。
     没装 GSAP 时自动退回 Web Animations；后台标签页冻结 ticker 也有兜底收幕。 */
  function sceneWipe(cb) {
    var T = root.SoupTransition;
    if (!T || (FX && FX.reduced)) {
      var f0 = $("#scene-fade");
      if (f0) { f0.classList.remove("on"); f0.style.opacity = "0"; f0.style.visibility = "hidden"; }
      cb();
      return;
    }
    T.play({ onSwap: cb });
  }

  /* ---------------- 音效 ---------------- */

  function sfx(name) {
    if (!state.sound || !AU) return;
    AU.sfx(name);
  }

  /* ---------------- 音乐台 ---------------- */

  function paintMusic() {
    var bm = $("#btn-music");
    if (bm) {
      bm.innerHTML = ic("music") + (state.music ? " 音乐" : " 静音");
      bm.setAttribute("aria-pressed", state.music ? "true" : "false");
    }
    var bp = $("#btn-play");
    if (bp) {
      bp.innerHTML = (state.playing ? icRaw("pause") : icRaw("play")) + (state.playing ? " 暂停" : " 播放");
      bp.setAttribute("aria-pressed", state.playing ? "true" : "false");
    }
    var dp = $("#dock-play");
    if (dp) {
      dp.innerHTML = state.playing ? icRaw("pause") : icRaw("play");
      dp.setAttribute("aria-pressed", state.playing ? "true" : "false");
    }
    var dm = $("#dock-mute");
    if (dm) {
      dm.innerHTML = state.music ? icRaw("volume") : icRaw("mute");
      dm.setAttribute("aria-pressed", state.music ? "true" : "false");
    }
    var v = $("#vol");
    if (v) paintVolFill();
    var dock = $("#music-dock");
    if (dock) dock.classList.toggle("dim", !state.music || !state.playing);
  }

  /* 报告 P3-6 第1条：滑轨按当前值动态填充金色进度，
     拖到 0 一眼能看出来，不再靠 12px 的小拇指判断 */
  function paintVolFill() {
    var v = $("#vol");
    if (!v) return;
    var pct = Math.round(Math.max(0, Math.min(1, state.volume)) * 100);
    if (Number(v.value) !== pct) v.value = String(pct);
    v.style.setProperty("--vol-p", pct + "%");
  }

  function applyAudioSettings() {
    if (!AU) return;
    AU.setVolume(state.volume);
    AU.setMusicOn(state.music);
    AU.setSfxOn(state.sound);
    AU.setPlaying(state.playing);
    paintMusic();
  }

  /* ---------------- 氛围特效开关 ---------------- */

  function applyFxSettings() {
    var on = !!state.fx;
    document.body.classList.toggle("fx-off", !on);
    if (FX && FX.setEnabled) FX.setEnabled(on);
    else if (FX) { if (on) FX.resume(); else FX.pause(); }
    paintFx();
  }

  function paintFx() {
    var bf = $("#btn-fx");
    if (!bf) return;
    bf.innerHTML = ic("spark") + (state.fx ? " 特效" : " 特效关");
    bf.setAttribute("aria-pressed", state.fx ? "true" : "false");
  }

  function toggleFx() {
    state.fx = !state.fx;
    applyFxSettings();
    saveProgress();
    sfx("ui");
    toast(state.fx ? "氛围特效已打开" : "氛围特效已关闭（雨幕 / 闪电 / 抖动都停了）");
  }

  function toggleMusic() {
    state.music = !state.music;
    if (AU) { AU.setMusicOn(state.music); if (state.music) AU.setPlaying(state.playing); }
    paintMusic();
    saveProgress();
    sfx("ui");
    toast(state.music ? "音乐已打开" : "音乐已静音");
  }

  function togglePlay() {
    state.playing = !state.playing;
    if (AU) AU.setPlaying(state.playing);
    paintMusic();
    saveProgress();
    sfx("ui");
    toast(state.playing ? "音乐继续" : "音乐已暂停（音效照常）");
  }

  function setVolume(v, fromUser) {
    var n = Number(v);
    if (!isFinite(n)) return;               /* 坏值直接忽略，绝不写 0 */
    state.volume = Math.max(0, Math.min(1, n));
    if (fromUser) state.volumeTouched = true; /* 玩家亲手拖的才算明确偏好 */
    if (AU) AU.setVolume(state.volume);
    paintVolFill();
    saveProgress();
  }

  /* ---------------- 文字演出 ---------------- */

  var typeTimer = null;
  function typeSurface(text) {
    var el = $("#p-surface");
    if (!el) return;
    clearInterval(typeTimer);
    if (FX && FX.reduced) { el.classList.remove("typing"); el.textContent = text; return; }
    el.classList.add("typing");
    el.textContent = "";
    var i = 0;
    typeTimer = setInterval(function () {
      i += 2;
      el.textContent = text.slice(0, i);
      if (i >= text.length) {
        clearInterval(typeTimer);
        el.textContent = text;
        el.classList.remove("typing");
      }
    }, 22);
  }

  /* ---------------- 渲染：题库分片 ---------------- */

  /* 题库分片：首屏渲染完成后把剩下的题异步拉回来，并入同一个 PUZZLES 数组 */
  function loadMorePuzzles() {
    if (window.__soupMoreLoaded) return;
    window.__soupMoreLoaded = true;
    var s = document.createElement("script");
    s.src = "js/data-more.js?v=20261006a";
    s.async = true;
    s.onload = function () {
      renderQaLog();
      renderRandom();
      paintResume();
      /* data-more.js 拉回来后，精品层从 20 → 100 道；
         得把汤库筛选器 + 汤库列表也重画一遍，不然在汤库里搜不到后面这 80 道 */
      renderLibraryFilters();
      renderLibrary();
      toast("汤架已备齐：共 " + PUZZLES.length + " 道汤");
    };
    s.onerror = function () {
      /* 分片没拉到就先用已经有的题，至少不影响玩 */
      PUZZLES_TOTAL = PUZZLES.length;
      renderQaLog();
      toast("汤库只加载了一部分，刷新页面再试试");
    };
    document.head.appendChild(s);
  }

  /* ============================================================
   * 左侧「问答记录」区
   * ------------------------------------------------------------
   * 原「汤单」列表已整体迁入汤库（screen-library）。
   * 左侧现在只做一件事：把本局的问答历史滚动展示出来。
   * 数据源就是 state.history（{q, a} 数组），与 #log 同源同序。
   * ============================================================ */

  /* 从回答开头认出四种判定，好让左栏和实时记录用同一套颜色 */
  function qaTone(text) {
    var s = String(text || "").replace(/^\s+/, "");
    if (s.indexOf("与此无关") === 0) return "irr";
    if (s.indexOf("部分正确") === 0) return "partial";
    if (s.indexOf("不是") === 0) return "no";
    if (s.indexOf("是") === 0) return "yes";
    return "";
  }

  /* 本局问答记录：state.history 里每一条 {q, a} 渲染成一组 Q/A */
  function renderQaLog() {
    var box = $("#qa-log");
    if (!box) return;
    var hist = state.history || [];
    var badge = $("#qa-count");
    if (badge) badge.textContent = hist.length + " 问";

    /* 重建 DOM 前记住玩家/自动滚动看到哪了，重建后原位接上，不再拍回顶部 */
    var keepTop = box.scrollTop;
    if (!hist.length) {
      box.innerHTML = '<p class="empty">还没有提问。<br />打开一道汤，向汤主问出第一句吧。</p>';
      return;
    }
    box.innerHTML = hist.map(function (item, idx) {
      var tone = qaTone(item.a);
      return '<div class="qa-item' + (tone ? " " + tone : "") + '">' +
        '<div class="qa-q"><span class="qa-k">Q' + (idx + 1) + "</span>" + esc(item.q) + "</div>" +
        '<div class="qa-a">' +
          (tone
            ? '<span class="qa-k verdict ' + tone + '">' + esc(VERDICT_TEXT[tone]) + "</span>"
            : '<span class="qa-k">A</span>') +
          esc(item.a) + "</div>" +
        "</div>";
    }).join("");
    box.scrollTop = keepTop;
    /* 单人局和多人房一样：自动慢滚循环，手动一碰先让位 4 秒 */
    if (root.SoupRoom && root.SoupRoom.watchQaScroll) root.SoupRoom.watchQaScroll();
    if (root.SoupRoom && root.SoupRoom.ensureQaScroll) root.SoupRoom.ensureQaScroll();
  }

  function clearQaLog() {
    var box = $("#qa-log");
    if (box) box.innerHTML = '<p class="empty">还没有提问。<br />打开一道汤，向汤主问出第一句吧。</p>';
    var badge = $("#qa-count");
    if (badge) badge.textContent = "0 问";
  }

  /* ---------------- 渲染：对局 ---------------- */

  function renderStats() {
    var p = E.getPuzzle(state.pid);
    if (!p) return;
    /* 单人局也挂上自动慢滚，和多人房同一套：自己循环滚，玩家也能手动翻 */
    if (root.SoupRoom && root.SoupRoom.ensureQaScroll) root.SoupRoom.ensureQaScroll();
    var s = state;
    /* 第⑥条：线索 / 提示 / 探索度统计已全部下线，只留提问计数 */
    set("#s-q", s.qCount);
  }

  function set(sel, val) {
    var el = $(sel);
    if (el) el.textContent = val;
  }

  /* ---- 第⑫条：判定词去重（与 room-ui.js 的 qaStrip 同一口径） ----
   * 带特效的判定标签已经提在行首，正文开头重复的那一遍判定词在渲染前剥掉；
   * 只剥独立开头的判定词+标点，不改动注入给 AI 的任何提示词。 */
  var QA_BOUND = /^[\s。.!！?？~～、，,：:;；\-—…]/;
  var QA_WORDS = ["不是", "并非", "非也", "不对", "否", "部分正确", "部分", "有些", "一半", "接近", "差不多", "擦边", "与此无关", "不相关", "没关系", "无关", "跑题", "题外", "超出范围", "是的", "是"];
  function qaStrip(label, text) {
    var t = String(text == null ? "" : text).replace(/^\s+/, "");
    var box = t.match(/^【\s*([^】]{1,10})\s*】\s*/);
    if (box) t = t.slice(box[0].length);
    var cands = [];
    var L = String(label == null ? "" : label).replace(/[。.!！]+$/, "").trim();
    if (L) cands.push(L);
    cands = cands.concat(QA_WORDS, ["推理", "汤主"]);
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (!c || t.indexOf(c) !== 0) continue;
      var after = t.slice(c.length);
      if (after && !QA_BOUND.test(after)) continue;
      return after.replace(/^[\s。.!！?？~～、，,：:;；\-—…]+/, "");
    }
    return t;
  }

  function addLine(side, tone, html, meta) {
    var log = $("#log");
    if (!log) return null;
    var wrap = document.createElement("div");
    wrap.className = "line " + side + (tone ? " " + tone : "");
    wrap.innerHTML = '<span class="say">' + html + "</span>" +
      (meta ? '<span class="tone">' + esc(meta) + "</span>" : "");
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
    return wrap;
  }

  function clearLog() {
    var log = $("#log");
    if (log) log.innerHTML = "";
  }

  function sysLine(text) {
    addLine("host", "sys", esc(text));
  }

  /* ---------------- 单人服务端会话（2026-10-04 定档） ----------------
   * 汤面逐道向 Worker 取；开锅 = 建一间只有自己的服务端小房间。
   * 判定 / 汤底全在服务端：浏览器从此拿不到任何一道汤的 truth。 */

  function soloErrText(e) {
    var m = String((e && e.message) || e || "");
    var MAP = {
      RATE_LIMITED: ((e && e.data && e.data.note) || "今天点开的汤太多啦，歇一会儿再来。"),
      NO_SUCH_PUZZLE: "这一道汤不存在",
      NO_BASE: "联机服务还没配置好",
      NO_ROOM: "当前没有开着的锅",
      NO_NET: "联机模块没加载"
    };
    return MAP[m] || m;
  }

  function aiConfigForServer() {
    if (!AI || !AI.isReady()) return null;
    var cfg = AI.config();
    var pre = AI.providerOf(cfg.provider) || {};
    return {
      provider: cfg.provider,
      kind: pre.kind === "anthropic" ? "anthropic" : "openai",
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      apiKey: cfg.apiKey
    };
  }

  /* 开一锅：拿汤面 → 建单人房 → 有 AI 配置就当场把配置交给这一锅的服务端汤主。
     Key 只存在你自己这一间 DO 房间里（规格 #11），不进任何公开存储。 */
  function enterSoloRoom(id) {
    if (!NET || !NET.puzzleDetail || !NET.soloNew) return Promise.reject(new Error("NO_NET"));
    return NET.puzzleDetail(id).then(function (detail) {
      if (!detail) throw new Error("NO_SUCH_PUZZLE");
      return NET.soloNew(id).then(function (r) {
        state.roomCode = r.roomCode;
        state.detail = detail;
        var cfg = aiConfigForServer();
        if (!cfg) { state.aiOk = false; return detail; }
        return NET.soloAct("set-ai", { config: cfg }, state.roomCode).then(function () {
          state.aiOk = true;
          return detail;
        }, function () {
          state.aiOk = false;   // 配置没递上去：照样能进锅，问的时候服务端会明说
          return detail;
        });
      });
    });
  }

  /* 连点不同汤时的竞态守卫：只有最后一次点开的那道能上屏 */
  var loadSeq = 0;

  function loadPuzzle(id, restore) {
    var meta = E.getPuzzle(id) || libPuzzle(id);
    if (!meta) return;
    var lib = isLibPid(id);
    var seq = ++loadSeq;
    toast("这锅正在点火…");
    enterSoloRoom(id).then(function (detail) {
      if (seq !== loadSeq) return;          // 手快点了两道：旧的这一路直接丢弃
      sceneWipe(function () { renderGame(meta, detail, lib, restore); });
    }).catch(function (e) {
      if (seq !== loadSeq) return;
      toast("这锅点不着火：" + soloErrText(e));
    });
  }

  function renderGame(meta, detail, lib, restore) {
    var isLibLayer = lib || detail.layer === "lib";
    leaveRoomScreen();
    /* 两层各自持有「进行中的对局」：库题只认 LIB_KEY，绝不串档 */
    var snap = restore ? (lib ? libProgress().session : progress.session) : null;
    if (snap && snap.pid !== meta.id) snap = null;
    state.pid = meta.id;
    state.revealed = [];
    state.asked = snap && snap.asked ? snap.asked : {};
    state.qCount = snap ? (snap.qCount || 0) : 0;
    state.done = false;
    state.history = snap && snap.history ? snap.history.slice() : [];
    state.aiBusy = false;

    $("#screen-intro").classList.add("hidden");
    var rs = $("#screen-random");
    if (rs) rs.classList.add("hidden");
    var sl = $("#screen-library");
    if (sl) sl.classList.add("hidden");
    var gs = $("#screen-game");
    gs.classList.remove("hidden");
    gs.style.animation = "none";
    gs.style.opacity = "1";
    gs.style.visibility = "visible";
    setScene("game");
    /* 第⑪条：进单人对局后刷新右栏备忘录显隐 */
    if (window.SoupRoom && window.SoupRoom.syncChat) window.SoupRoom.syncChat();

    if (isLibLayer) {
      /* 库层：标题用 dispTitle（永远非空）；题材走展示视图，
         翻译状态与原始来源降级成小字（报告 P2-3 / P2-4） */
      set("#p-title", detail.dispTitle || detail.title || "无题");
      var lvcats = E.catsView(detail);
      var lxl = E.xlateOf(detail);
      var ltag = $("#p-tag");
      if (ltag) {
        ltag.textContent = lxl || "";
        ltag.classList.toggle("hidden", !lxl);
      }
      var lcats = $("#p-cats");
      if (lcats) {
        lcats.innerHTML = lvcats.map(function (c) {
          return '<span class="pz-cat">' + esc(c) + "</span>";
        }).join("");
        lcats.classList.toggle("hidden", !lvcats.length);
      }
      set("#p-diff", libDiffDots(detail.difficulty) + " 难度");
      var lorig = $("#p-orig");
      if (lorig) lorig.classList.add("hidden");
    } else {
      set("#p-title", detail.title || detail.dispTitle);
      var ptag = $("#p-tag");
      if (ptag) { ptag.textContent = ""; ptag.classList.add("hidden"); }
      var pcats = $("#p-cats");
      if (pcats) { pcats.innerHTML = ""; pcats.classList.add("hidden"); }
      var d = Number(detail.difficulty) || 1;
      set("#p-diff", new Array(d + 1).join("●") + new Array(3 - d + 1).join("○") + " 难度");
    }
    typeSurface(detail.surface || "");

    clearLog();
    if (isLibLayer) {
      var rawSrc = String(detail.src || meta.src || "汤库");
      sysLine("（这一锅来自「" + E.srcGroupOf(rawSrc) + "」，原始来源 " + rawSrc + "）");
      if (detail.truthSource === "ai") {
        sysLine("（注意：这一锅的汤底是 AI 根据汤面编的，不是原题答案）");
      }
    }
    setAskEnabled(true);
    sysLine(snap
      ? "（你回到灶台前，锅里还温着）接着上一锅继续。"
      : "（锅盖揭开，热气涌上来）汤主问你：这一锅，你看出了什么？");
    sysLine(aiOn()
      ? "（AI 汤主在服务端守着这一锅的真相，用你自己的话问就好）"
      : "（这一锅由服务端 AI 汤主守着——点上方「AI 汤主」配好模型才能问）");
    renderClues();
    renderStats();
    renderQaLog();
    paintAiBar();

    var input = $("#q-input");
    if (input) {
      input.value = "";
      if (!isTouch() && window.innerWidth > 860) input.focus();
    }
    saveSession();
    paintResume();
    sfx("page");
  }

  function renderTip() {
    /* 第⑦条：「汤主的话」独立框已下线，文案并入对话流；保留空壳防旧调用 */
  }

  function renderClues() {
    /* 2026-10-04：线索板随本地判定一起下线——线索只在服务端，
       得靠 AI 汤主一句句问出来。面板保留，内容统一说明。 */
    var box = $("#clue-list");
    if (!box) return;
    box.innerHTML = '<p class="empty">线索都藏在服务端的那口锅里——<br />向汤主一句句问，真相自己会浮上来。</p>';
    var lbadge = $("#clue-badge");
    if (lbadge) lbadge.textContent = "—";
  }

  /* ---------------- 提问（全走服务端） ----------------
   * 问题原文发进你自己的单人房；服务端 AI 汤主持底回答，
   * 回来的只有「是 / 不是 / 部分正确 / 与此无关 + 一句答话」。
   * 合规闸门（要答案 / 开放式 / 超长 / 辱骂）也全在服务端判。 */

  function submitQuestion() {
    var input = $("#q-input");
    if (!input) return;
    var raw = input.value.trim();
    if (!raw) { toast("先写点什么，汤主才听得见呀"); return; }
    if (state.done) { toast("这一锅已经端上桌了，先去熬下一锅吧"); return; }
    if (!state.roomCode) { toast("这锅的火还没点上——先重进这道汤"); return; }

    /* 2026-10-04：关键词汤主已下线——所有汤都必须 AI 才能问（服务端同样会拦） */
    if (!aiOn()) {
      toast("这一锅要 AI 汤主才能问——点上方「AI 汤主」配好模型");
      return;
    }

    var key = E.normalize(raw);

    addLine("me", "", esc(raw), "你的提问");
    sfx("paper");

    if (state.asked[key]) {
      addLine("host", "sys", esc("这个问题刚才问过了，汤主不重复回答。"));
      input.value = "";
      return;
    }
    if (state.aiBusy) {
      addLine("host", "sys", esc("汤主还在想上一句，稍等一下下。"));
      return;
    }
    state.qCount++;
    state.asked[key] = 1;
    input.value = "";
    renderStats();
    saveSession();
    serverAsk(raw, key);
  }

  function serverAsk(raw, key) {
    state.aiBusy = true;
    var pid = state.pid;   // 回包时可能已经换了锅：只认发起时那一口
    var line = addLine("host", "pending", '<b class="verdict irr">…</b> 汤主正在熬这句话', "AI 汤主");
    NET.soloAct("ask", { question: raw }, state.roomCode).then(function (r) {
      state.aiBusy = false;
      if (line && line.parentNode) line.parentNode.removeChild(line);
      if (state.pid !== pid) return;
      var item = r && r.item;
      if (!item) return;
      state.history.push({ q: raw, a: item.reply });
      renderQaLog();
      var tone = item.verdict;
      var el = addLine("host", tone,
        '<b class="verdict ' + esc(tone) + '">' + esc(VERDICT_TEXT[tone] || "答") + "</b> " + esc(qaStrip(VERDICT_TEXT[tone], E.stripLead(item.reply))),
        item.viaAi ? "AI 汤主" : "汤主");
      sfx(tone === "partial" ? "partial" : tone);
      if (FX && el) {
        FX.burstAt(el, {
          count: tone === "yes" ? 26 : 14,
          colors: tone === "yes" ? ["#68cf9a", "#a8ecc6", "#f6cf90"]
            : tone === "no" ? ["#e0705e", "#ffb3a3", "#e2a44f"]
              : ["#e8c45c", "#ffe9c4", "#e2a44f"]
        });
      }
      paintAiBar();
      saveSession();
    }, function (e) {
      state.aiBusy = false;
      if (line && line.parentNode) line.parentNode.removeChild(line);
      /* 这句没被受理：回滚记账与次数，玩家可以原样重问 */
      delete state.asked[key];
      state.qCount = Math.max(0, state.qCount - 1);
      var m = String((e && e.message) || e);
      if (m === "MULTI_QUESTION") {
        /* 一问一答：AI 检出多个问题 —— 不计警告不扣次数，挑一个重问就行 */
        addLine("host", "sys", esc((e.data && e.data.note) || "检测到您的发问中存在多个问题，请挑一个问，每次提问只允许问一个问题。"));
      } else if (m === "QUESTION_INVALID") {
        var d = (e && e.data) || {};
        addLine("host", "sys", esc(d.warn || d.why || "发问不符合游戏规则，这一句没有受理。"));
        if (d.strikes) toast("不合规警告 " + d.strikes + " 次了，提问只能用「是 / 不是 / 部分正确 / 与此无关」能回答的是非问句");
      } else if (m === "AI_REQUIRED_LIB" || m === "AI_REQUIRED") {
        addLine("host", "sys", esc("这一锅的真相只在服务端，必须由 AI 汤主持底回答——先配好模型再问。"));
        openAiModal();
      } else if (m === "NOT_PLAYING") {
        addLine("host", "sys", esc("这一锅已经结束了，换一锅再问吧。"));
      } else {
        paintAiBar("汤主没接上（" + soloErrText(e) + "）。", "ai-warn");
        addLine("host", "sys", esc("汤主掉线了，请重新提问一次。"));
      }
      sfx("irr");
      renderStats();
      saveSession();
    });
  }

  /* ---------------- AI 汤主（配置在本机，判定在服务端） ----------------
   * 浏览器不再直连任何 AI：填好的服务商/模型/Key 只随开锅递进
   * 你自己的单人房（DO 房间），由 Worker 持底回答。 */

  var AI = window.SoupAI;

  function aiOn() {
    return !!(AI && AI.isReady());
  }

  function paintAiBar(note, tone) {
    var bar = $("#ai-bar");
    var txt = $("#ai-bar-text");
    var link = $("#btn-ai-bar");
    var btn = $("#btn-ai");
    if (!bar || !txt) return;
    var on = aiOn();
    bar.classList.toggle("on", on && state.aiOk);
    /* 警示与「是否启用」是两件事：配置没递到服务端也要提醒 */
    bar.classList.toggle("warn", !!note && /warn/.test(String(tone || "")));
    if (note) txt.textContent = note;
    else if (on && state.aiOk) txt.textContent = "AI 汤主在值班（服务端） · " + AI.config().model;
    else if (on) txt.textContent = "AI 配置还没递进这一锅——重进汤或重存配置";
    else txt.textContent = "汤主还没上岗——点上方「AI 汤主」配好模型才能开问";
    txt.className = note && tone ? tone : "";
    if (link) link.textContent = on ? "调整 AI 设置" : "配 AI 汤主";
    if (btn) {
      btn.innerHTML = ic("robot") + (on ? " AI 汤主 · 开" : " AI 汤主");
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  /* ---------------- AI 设置面板 ---------------- */

  function paintAiModal(status, tone) {
    if (!AI) return;
    fillProviderOptions();
    var cfg = AI.config();
    var sel = $("#ai-provider");
    if (sel && !sel.options.length) {
      sel.innerHTML = AI.PROVIDERS.map(function (p) {
        return '<option value="' + esc(p.id) + '">' + esc(p.label) + "</option>";
      }).join("");
    }
    if (sel) sel.value = cfg.provider;
    var pre = AI.providerOf(cfg.provider);
    var note = $("#ai-provider-note");
    if (note) {
      note.textContent = pre.note || "";
      /* 「需本地运行」这类预设必须显眼：公网访客选了必然连不上 */
      note.className = "ai-note" + (pre.local ? " ai-warn" : "");
    }
    var bu = $("#ai-baseurl");
    if (bu && document.activeElement !== bu) bu.value = cfg.baseUrl;
    var md = $("#ai-model");
    if (md && document.activeElement !== md) md.value = cfg.model;
    var kk = $("#ai-key");
    if (kk && document.activeElement !== kk) kk.value = cfg.apiKey;
    var en = $("#ai-enabled");
    if (en) {
      en.classList.toggle("on", cfg.enabled);
      en.setAttribute("aria-pressed", cfg.enabled ? "true" : "false");
      en.textContent = cfg.enabled ? "已启用 AI 汤主" : "启用 AI 汤主";
    }
    /* 报告改善④：「记住 Key」开关——默认记本机；关掉后 Key 只活在本次会话 */
    var rm = $("#ai-remember");
    if (rm) {
      var remember = cfg.rememberKey !== false;
      rm.classList.toggle("on", remember);
      rm.setAttribute("aria-pressed", remember ? "true" : "false");
      rm.textContent = remember ? "记住 Key 到本机" : "Key 只记本次会话";
    }
    var st = $("#ai-status");
    if (st) {
      st.className = "ai-note" + (tone ? " " + tone : "");
      st.textContent = status || (AI.isReady(cfg)
        ? "已就绪 · " + pre.label + " / " + cfg.model + " · Key " + AI.maskKey(cfg.apiKey) +
          (cfg.rememberKey === false ? "（不落盘：关标签页就忘）" : "")
        : "还没填全（需要接口地址、模型和 Key 三样）。");
    }
  }

  /* 服务商下拉：一进页面就填好，不用等打开面板 */
  function fillProviderOptions() {
    var sel = $("#ai-provider");
    if (!sel || !AI || sel.options.length) return;
    sel.innerHTML = AI.PROVIDERS.map(function (p) {
      return '<option value="' + esc(p.id) + '">' + esc(p.label) + "</option>";
    }).join("");
  }

  function openAiModal() {
    paintAiModal();
    var warn = $("#ai-warn");
    if (warn) warn.textContent = "";
    openModal("#modal-ai", "#ai-provider");
    sfx("ui");
  }

  function readAiForm() {
    var sel = $("#ai-provider");
    var bu = $("#ai-baseurl");
    var md = $("#ai-model");
    var kk = $("#ai-key");
    var rm = $("#ai-remember");
    var rememberKey = rm
      ? rm.getAttribute("aria-pressed") !== "false"
      : (!AI || AI.config().rememberKey !== false);
    return {
      provider: sel ? sel.value : "deepseek",
      baseUrl: bu ? bu.value.trim() : "",
      model: md ? md.value.trim() : "",
      apiKey: kk ? kk.value.trim() : "",
      rememberKey: rememberKey
    };
  }

  function saveAiForm(forceOn) {
    var patch = readAiForm();
    if (typeof forceOn === "boolean") patch.enabled = forceOn;
    var cfg = AI.setConfig(patch);
    pushAiToRoom(cfg);
    paintAiModal();
    paintAiBar();
    return cfg;
  }

  /* 把本地配置递进当前单人房（服务端判定用这份配置；Key 只留在你自己的房间） */
  function pushAiToRoom() {
    if (!state.roomCode || !NET || !NET.soloAct) return Promise.resolve(false);
    var cfg = aiConfigForServer();
    if (!cfg) {
      return NET.soloAct("set-ai", { config: { clear: true } }, state.roomCode).then(function () {
        state.aiOk = false; paintAiBar(); return true;
      }, function () { return false; });
    }
    return NET.soloAct("set-ai", { config: cfg }, state.roomCode).then(function () {
      state.aiOk = true; paintAiBar(); return true;
    }, function () { state.aiOk = false; paintAiBar(); return false; });
  }

  function testAi() {
    var st = $("#ai-status");
    var cfg = aiConfigForServer();
    if (!cfg) {
      paintAiModal("还差一点：接口地址、模型、Key 都要填。", "ai-bad");
      return;
    }
    if (!state.roomCode) {
      paintAiModal("先随便点开一道汤（服务端要凭你自己的房间试连线），再回来点测试。", "");
      return;
    }
    if (st) { st.className = "ai-note"; st.textContent = "正在让服务端的汤主连接 " + cfg.model + " …"; }
    NET.soloAct("ai-test", { config: cfg }, state.roomCode).then(function (r) {
      state.aiOk = true;
      paintAiModal(r && r.ok ? ("连上了（" + cfg.model + "）：" + ((r.sample || "").slice(0, 40))) : ("测试失败：" + ((r && r.note) || (r && r.error) || "未知错误")), r && r.ok ? "ai-ok" : "ai-bad");
      paintAiBar();
      if (r && r.ok) sfx("yes"); else sfx("lose");
    }, function (e) {
      paintAiModal("测试失败：" + soloErrText(e), "ai-bad");
      paintAiBar("AI 没接上（" + soloErrText(e) + "）。", "ai-warn");
      sfx("lose");
    });
  }

  function clearAi() {
    AI.save(AI.defaults());
    pushAiToRoom();
    paintAiModal("配置已清空。判定仍在服务端——汤库的锅要重新配 AI 才能问。", "");
    paintAiBar();
    toast("AI 配置已清空");
  }

  function bindAiModal() {
    if (!AI) return;

    /* 配置一变（含外部直接 save）就刷新状态条，避免界面和实际不一致 */
    AI.onChange(function () {
      paintAiBar();
    });
    fillProviderOptions();

    var sel = $("#ai-provider");
    if (sel) sel.addEventListener("change", function () {
      var pre = AI.providerOf(sel.value);
      var bu = $("#ai-baseurl");
      var md = $("#ai-model");
      if (bu) bu.value = pre.baseUrl;
      if (md) md.value = pre.model;
      /* 立刻落盘，否则后面的回填会把刚切好的地址又改回旧服务商 */
      AI.setConfig({ provider: sel.value, baseUrl: pre.baseUrl, model: pre.model });
      paintAiModal("已切到 " + pre.label + "，地址和模型已自动填好。", "");
      sfx("ui");
    });

    var en = $("#ai-enabled");
    if (en) en.addEventListener("click", function () {
      var on = en.getAttribute("aria-pressed") !== "true";
      saveAiForm(on);
      paintAiModal(on ? "已启用。记得填全三样再保存。" : "已关闭——不配 AI 汤主，一锅都问不了。", "");
      sfx("ui");
    });

    var rev = $("#ai-reveal");
    if (rev) rev.addEventListener("click", function () {
      var kk = $("#ai-key");
      var show = rev.getAttribute("aria-pressed") !== "true";
      if (kk) kk.type = show ? "text" : "password";
      rev.setAttribute("aria-pressed", show ? "true" : "false");
      rev.classList.toggle("on", show);
      rev.textContent = show ? "隐藏 Key" : "显示 Key";
      sfx("ui");
    });

    var rmv = $("#ai-remember");
    if (rmv) rmv.addEventListener("click", function () {
      var cur = AI.config();
      var nextRemember = cur.rememberKey === false;
      var patch = readAiForm();
      patch.rememberKey = nextRemember;
      AI.setConfig(patch);
      paintAiModal(nextRemember
        ? "好，Key 会记在这台浏览器里（localStorage），下次直接能用。"
        : "好，Key 不再落盘：只活在本次会话里，关掉标签页就忘——共享电脑推荐这样。", nextRemember ? "" : "ai-ok");
      paintAiBar();
      sfx("ui");
    });

    var testBtn = $("#btn-ai-test");
    if (testBtn) testBtn.addEventListener("click", testAi);

    var clearBtn = $("#btn-ai-clear");
    if (clearBtn) clearBtn.addEventListener("click", clearAi);

    var cancel = $("#btn-ai-cancel");
    if (cancel) cancel.addEventListener("click", function () { closeModal("#modal-ai"); });

    var saveBtn = $("#btn-ai-save");
    if (saveBtn) saveBtn.addEventListener("click", function () {
      var cfg = saveAiForm(true);
      if (!AI.isReady(cfg)) {
        paintAiModal("还差一点：接口地址、模型、Key 都要填。", "ai-bad");
        sfx("lose");
        return;
      }
      paintAiModal("已保存并启用 · " + cfg.model, "ai-ok");
      paintAiBar();
      sfx("yes");
      toast("AI 汤主已上线");
      closeModal("#modal-ai");
    });

    var entry = $("#btn-ai");
    if (entry) entry.addEventListener("click", openAiModal);

    var barLink = $("#btn-ai-bar");
    if (barLink) barLink.addEventListener("click", openAiModal);

    var quick = $("#btn-ai-quick");
    void quick;   /* 第⑥条：「问问 AI」已随提示机制下线 */
  }

  /* 第⑪条：单人右栏备忘录——尺寸/位置完全沿用房间聊天框，只是换了个名字。
     内容存在 localStorage，刷新不丢；进多人房时由 room-ui 藏起来让位给聊天框。 */
  function initSoloMemo() {
    var box = $("#solo-memo");
    var ta = $("#solo-memo-text");
    if (!box || !ta) return;
    var tg = $("#btn-solo-memo-toggle");
    /* 报告 P1-1：≤860px 视口里它是压在页面中部的 fixed 悬浮窗，
       窄屏（含桌面窄窗口）默认收起、与 CSS 注释口径一致；宽屏维持默认展开。
       本会话玩家手动开关过就不再替他做主。 */
    var userToggled = false;
    var mqNarrow = null;
    try { mqNarrow = window.matchMedia("(max-width: 860px)"); } catch (e) { /* 老浏览器 */ }
    function setMemoOpen(open) {
      box.classList.toggle("collapsed", !open);
      if (tg) tg.setAttribute("aria-expanded", open ? "true" : "false");
    }
    function syncByWidth() {
      if (userToggled) return;
      var touch = false;
      try { touch = isTouch(); } catch (e) { /* 忽略 */ }
      setMemoOpen(!(mqNarrow ? mqNarrow.matches : false) && !touch);
    }
    syncByWidth();
    if (mqNarrow) {
      if (mqNarrow.addEventListener) mqNarrow.addEventListener("change", syncByWidth);
      else if (mqNarrow.addListener) mqNarrow.addListener(syncByWidth);
    }
    var KEY = "soup.memo.v1";
    try {
      var saved = localStorage.getItem(KEY);
      if (saved) ta.value = saved;
    } catch (e) { /* 隐私模式 */ }
    var tm = 0;
    ta.addEventListener("input", function () {
      clearTimeout(tm);
      tm = setTimeout(function () {
        try { localStorage.setItem(KEY, ta.value); } catch (e) { /* 忽略 */ }
      }, 400);
    });
    if (tg) tg.addEventListener("click", function () {
      var open = !box.classList.contains("collapsed");
      userToggled = true;
      setMemoOpen(!open);
    });
  }

  /* 报告改善③：窄屏（≤860px）下左栏「问答记录」默认收成一条头栏，
     只留「N 问」徽章可点，点开才展开——两处重复记录不再抢窄屏的滚动空间 */
  function initQaCollapse() {
    var panel = document.querySelector(".col-qa .qa-panel");
    var head = $("#btn-qa-collapse");
    if (!panel || !head) return;
    var userToggled = false;
    var mqNarrow = null;
    try { mqNarrow = window.matchMedia("(max-width: 860px)"); } catch (e) { /* 老浏览器 */ }
    function setOpen(open) {
      panel.classList.toggle("qa-collapsed", !open);
      head.setAttribute("aria-expanded", open ? "true" : "false");
    }
    function syncByWidth() {
      if (userToggled) return;
      setOpen(!(mqNarrow && mqNarrow.matches));
    }
    syncByWidth();
    if (mqNarrow) {
      if (mqNarrow.addEventListener) mqNarrow.addEventListener("change", syncByWidth);
      else if (mqNarrow.addListener) mqNarrow.addListener(syncByWidth);
    }
    head.addEventListener("click", function () {
      var wasCollapsed = panel.classList.contains("qa-collapsed");
      userToggled = true;
      setOpen(wasCollapsed);
      sfx("ui");
    });
  }

  /* ---------------- 猜汤底 ---------------- */

  var lastFocus = null;

  /* 双端适配：弹窗打开时收起浮动音乐台，小屏才不会被挡住 */
  function syncModalClass() {
    var open = $$(".modal-wrap").filter(function (m) { return !m.classList.contains("hidden"); });
    document.body.classList.toggle("modal-open", open.length > 0);
  }

  function openModal(sel, focusSel) {
    lastFocus = document.activeElement;
    var m = $(sel);
    if (!m) return;
    m.classList.remove("hidden");
    syncModalClass();
    var f = focusSel ? $(focusSel) : null;
    if (f) setTimeout(function () { f.focus(); }, 30);
  }

  function closeModal(sel) {
    var m = $(sel);
    if (m) m.classList.add("hidden");
    syncModalClass();
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) { } }
  }

  function openGuess() {
    if (!state.pid || state.done) return;
    var fb = $("#guess-feedback");
    if (fb) { fb.textContent = ""; fb.className = "guess-feedback"; }
    var gi = $("#guess-input");
    if (gi) gi.value = "";
    openModal("#modal-guess", "#guess-input");
    sfx("ui");
  }

  /* ---------------- 猜汤底（判定在服务端） ----------------
   * 推理原文发进单人房；服务端 AI 汤主持底判定。
   * 只有判定「解出」的那一刻，汤底才随响应回给解出者本人。 */

  function submitGuess() {
    var p = E.getPuzzle(state.pid) || libPuzzle(state.pid);
    var gi = $("#guess-input");
    var fb = $("#guess-feedback");
    if (!p || !gi || !fb) return;
    var text = gi.value.trim();
    if (!text) { fb.textContent = "先写下你的推理，再交给汤主。"; fb.className = "guess-feedback no"; return; }
    if (!state.roomCode) { fb.textContent = "这锅的火还没点上——先重进这道汤。"; fb.className = "guess-feedback no"; return; }

    if (!aiOn()) {
      fb.textContent = "这一锅的汤底只在服务端，得先配好 AI 汤主才能判。";
      fb.className = "guess-feedback no";
      return;
    }

    addLine("me", "", esc(text), "我的推理");
    sfx("paper");
    state.qCount++;

    fb.textContent = "AI 汤主（服务端）正在判断你的推理…";
    fb.className = "guess-feedback";
    var pend = addLine("host", "pending", '<b class="verdict irr">…</b> AI 汤主正在判断你的推理', "AI");

    NET.soloAct("guess", { text: text }, state.roomCode).then(function (r) {
      if (pend && pend.parentNode) pend.parentNode.removeChild(pend);
      if (state.pid !== p.id || state.done) return;
      var lvl = (r && r.level) || "no";
      var note = (r && r.note) || "方向还不对。";
      fb.textContent = note;
      fb.className = "guess-feedback " + (lvl === "solved" ? "ok" : (lvl === "close" || lvl === "vague") ? "close" : "no");
      state.history.push({ q: "【推理】" + text, a: note });
      renderQaLog();
      if (lvl === "solved") {
        var ln = addLine("host", "yes", '<b class="verdict yes">对了</b> ' + esc(qaStrip("对了", note)), "AI 判定");
        sfx("win");
        if (FX) {
          if (ln) FX.burstFrontAt(ln, { count: 90, power: 1.4, colors: ["#ffd166", "#f6cf90", "#68cf9a", "#ffe9c4", "#ff8f6e"] });
          FX.burstFront(window.innerWidth / 2, window.innerHeight * 0.34, { count: 150, power: 1.8 });
        }
        setTimeout(function () { finish(r.truth); }, 520);
      } else {
        addLine("host", lvl === "close" ? "partial" : "irr", esc(qaStrip(lvl === "close" ? "部分正确" : "", note)), "AI 判定");
        sfx(lvl === "close" ? "partial" : "lose");
        renderStats();
        saveSession();
      }
      paintAiBar();
    }, function (e) {
      if (pend && pend.parentNode) pend.parentNode.removeChild(pend);
      if (state.pid !== p.id || state.done) return;
      state.qCount = Math.max(0, state.qCount - 1);
      var m = String((e && e.message) || e);
      if (m === "COOLDOWN") {
        /* 冷却不是故障：把还剩几秒说清楚，别误导成「判定没送达」 */
        var until = (e.data && e.data.until) || 0;
        var sec = Math.max(1, Math.ceil((until - Date.now()) / 1000));
        fb.textContent = "你还在猜底冷却中，" + sec + " 秒后再猜（冷却只算在你自己身上）。";
        fb.className = "guess-feedback no";
      } else if (m === "AI_REQUIRED_LIB" || m === "AI_REQUIRED") {
        fb.textContent = "这一锅必须由 AI 汤主判定——先配好模型。";
        openAiModal();
      } else if (m === "NOT_PLAYING") {
        fb.textContent = "这一锅已经结束了。";
      } else {
        fb.textContent = "判定没送达（" + soloErrText(e) + "），请重新提交推理。";
        paintAiBar("汤主没接上（" + soloErrText(e) + "）。", "ai-warn");
      }
      fb.className = "guess-feedback no";
      renderStats();
    });
  }

  /* 解出者的汤底：只来自服务端响应的那一份（r.truth）。
     除此之外，浏览器在任何路径上都不可能拿到汤底。 */
  function finish(solvedTruth) {
    var p = E.getPuzzle(state.pid) || libPuzzle(state.pid);
    if (!p) return;
    var lib = isLibPid(state.pid);
    state.done = true;
    /* 熬出汤底（不管星级）：本地打上「已熬出汤底」绿勾 */
    markSolved(p.id, true);
    /* 两层快照各清各的，绝不互删 */
    if (lib) {
      var lp = libProgress();
      lp.session = null;
      saveLibProgress(lp);
    } else {
      progress.session = null;
    }
    closeModal("#modal-guess");

    /* 星级：按服务端下发的 par 当场结算，不写回任何存档 */
    var parP = state.detail || p;
    var st = E.stars(parP, state.qCount);

    /* 1 星（熬太久）走「汤凉了」的灰调场景 */
    setScene(st <= 1 ? "sad" : "win");
    sfx("reveal");
    if (FX) {
      FX.surge(5);
      FX.burstFront(window.innerWidth / 2, window.innerHeight * 0.3, { count: 160, power: 1.8 });
    }

    set("#end-stars", new Array(st + 1).join("★") + new Array(4 - st).join("☆"));
    set("#end-note", "提问 " + state.qCount + " 次 · " + E.starNote(st));

    var truth = String(solvedTruth || "").trim();
    var meta =
      '<p style="margin:0;color:#a97b38;font-size:12.5px;letter-spacing:.1em;">汤底（真相）' +
      (p.truthSource === "recovered" ? " · 已补底" : "") +
      "</p>";
    var body = truth
      ? meta + '<p style="margin:0">' + esc(truth) + "</p>"
      : meta + '<p style="margin:0;color:#8a8a8a">（判定已送达但汤底没随响应回来——在本房间再猜一次「解出」就能看到）</p>';
    $("#end-truth").innerHTML = body;

    openModal("#modal-end", "#btn-next");
    renderStats();
    renderQaLog();
    paintResume();
    renderTip("这锅熬完了。换一道汤，试试不同的味道？");
  }

  function nextPuzzle() {
    /* 库题继续从库里抽，精品题继续从精品层抽 */
    var lib = isLibPid(state.pid);
    var nxt = lib
      ? E.drawFromLibrary(LIB_OF(), {})
      : E.drawFrom(PUZZLES);
    closeModal("#modal-end");
    if (nxt) { loadPuzzle(nxt.id); return; }
    if (lib && window.SoupLibSource && !SoupLibSource.ready()) {
      /* 极小概率：首访 2 秒内就熬完一道库题，汤架还没取回来 */
      toast("正在从汤架取菜单，稍等…");
      SoupLibSource.ensure().then(function () {
        var n2 = E.drawFromLibrary(LIB_OF(), {});
        if (n2) loadPuzzle(n2.id);
      }).catch(function () { toast("汤架没取到，先回首页换一锅吧"); });
      return;
    }
    toast("下一锅没抽上，回首页换一锅吧");
  }

  /* ---------------- 放弃（不揭底，2026-10-04 定档） ----------------
   * 放弃 = 只结束本锅。汤底永远只在「被服务端 AI 汤主判定解出」的那份
   * 响应里出现；放弃、刷新、任何接口都拿不到。 */

  function soloGiveup() {
    if (!state.pid) { toast("当前没有开着的锅"); return; }
    if (state.done) { toast("这一锅已经结束了"); return; }
    if (!state.roomCode) { toast("这锅的火还没点上，不用放弃——直接换一锅吧"); return; }
    var host = document.createElement("div");
    host.className = "modal-wrap";
    host.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true">' +
      '<h3>' + ic("flag") + " 放弃这一锅？</h3>" +
      '<p class="modal-sub">被卡住了不丢人。放弃会当场结束这一锅——' +
      "<b>但不揭晓汤底</b>：这一锅的真相只在服务端守着，" +
      "只有被 AI 汤主判定「解出」的那一刻，才会端给解出的人看。</p>" +
      '<div class="modal-actions">' +
      '<button type="button" class="btn ghost" id="gs-no">再想想</button>' +
      '<button type="button" class="btn giveup-btn" id="gs-yes"><span class="giveup-glyph">放弃，结束本锅</span></button>' +
      "</div></div>";
    document.body.appendChild(host);
    document.body.classList.add("modal-open");
    var close = function () {
      if (host.parentNode) host.parentNode.removeChild(host);
      document.body.classList.remove("modal-open");
    };
    host.querySelector("#gs-no").addEventListener("click", close);
    host.querySelector("#gs-yes").addEventListener("click", function () {
      close();
      NET.soloAct("giveup", {}, state.roomCode).then(function () {
        state.done = true;
        var lib = isLibPid(state.pid);
        if (lib) { var lp = libProgress(); lp.session = null; saveLibProgress(lp); }
        else { progress.session = null; saveProgress(); }
        paintResume();
        var rv = document.createElement("div");
        rv.className = "modal-wrap";
        rv.innerHTML =
          '<div class="modal" role="dialog" aria-modal="true">' +
          "<h3>本锅结束</h3>" +
          '<div class="truth-box"><p style="margin:0;color:#8a8a8a">你未揭晓本汤汤底。</p></div>' +
          '<p class="modal-sub">想喝到这一锅的真相，唯一的办法是重新开一锅、' +
          "把推理说到 AI 汤主点头为止。</p>" +
          '<div class="modal-actions">' +
          '<button type="button" class="btn ghost" id="gs-close">知道了</button>' +
          '<button type="button" class="btn primary" id="gs-again">再熬这一锅</button>' +
          "</div></div>";
        document.body.appendChild(rv);
        document.body.classList.add("modal-open");
        rv.querySelector("#gs-close").addEventListener("click", function () {
          if (rv.parentNode) rv.parentNode.removeChild(rv);
          document.body.classList.remove("modal-open");
        });
        rv.querySelector("#gs-again").addEventListener("click", function () {
          var pid = state.pid;
          if (rv.parentNode) rv.parentNode.removeChild(rv);
          document.body.classList.remove("modal-open");
          loadPuzzle(pid);
        });
      }, function (e) {
        toast("放弃没成功：" + soloErrText(e));
      });
    });
    host.addEventListener("click", function (ev) { if (ev.target === host) close(); });
  }

  function backToList() {
    closeModal("#modal-end");
    if (root.SoupRoom && root.SoupRoom.stopQaScroll) root.SoupRoom.stopQaScroll();
    sceneWipe(function () {
      $("#screen-game").classList.add("hidden");
      $("#screen-random").classList.add("hidden");
      var sl = $("#screen-library");
      if (sl) sl.classList.add("hidden");
      $("#screen-intro").classList.remove("hidden");
      state.pid = null;
      setScene("menu");
      renderQaLog();
      paintResume();
      var l = $("#btn-start");
      if (l) l.focus();
    });
  }

  /* ---------------- 随机模式 ---------------- */

  var RAND_DIFFS = [
    { v: 0, label: "不限" },
    { v: 1, label: "● 清淡" },
    { v: 2, label: "●● 适中" },
    { v: 3, label: "●●● 浓郁" }
  ];

  function randOpts() {
    return {
      cat: state.randCat,
      difficulty: state.randDiff
    };
  }

  /* 随机池（2026-10-04）：精品层 + 全部汤库一起抽。
     浏览器端只剩元信息：池子里的每一道，服务端都 guaranteed 有底
     （构建时已剔除无底题），抽到就能开锅。 */
  function randPool(opts) {
    var o = opts || {};
    return mergedLib().filter(function (p) {
      if (!p || !p.id) return false;
      if (o.cat && o.cat !== "全部" && !E.hasCatView(p, o.cat)) return false;
      if (o.difficulty && p.difficulty !== o.difficulty) return false;
      return true;
    });
  }

  function pickOne(arr) { return arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null; }

  /* 精品题少但打磨过，给它稳占约 1/5 的机会；其余按汤库体量平分。 */
  function randDraw(opts) {
    var all = randPool(opts);
    if (!all.length) return null;
    var core = all.filter(function (p) { return p.layer === "core"; });
    var lib = all.filter(function (p) { return p.layer !== "core"; });
    if (!core.length) return pickOne(lib);
    if (!lib.length) return pickOne(core);
    var cw = Math.max(core.length, Math.ceil(lib.length / 4));
    return Math.random() * (cw + lib.length) < cw ? pickOne(core) : pickOne(lib);
  }

  /* 阶段 1：跨局「最近抽过」记录已砍，随机抽题不再排除历史 */

  function renderRandom() {
    var dbox = $("#rand-diff");
    if (dbox) {
      dbox.innerHTML = RAND_DIFFS.map(function (d) {
        return '<button type="button" class="chip diff' + (d.v === state.randDiff ? " on" : "") +
          '" data-diff="' + d.v + '" aria-pressed="' + (d.v === state.randDiff ? "true" : "false") + '">' + esc(d.label) + "</button>";
      }).join("");
      $$(".chip", dbox).forEach(function (btn) {
        btn.addEventListener("click", function () {
          state.randDiff = Number(btn.dataset.diff) || 0;
          sfx("ui");
          renderRandom();
        });
      });
    }

    var cbox = $("#rand-cats");
    if (cbox) {
      /* 题材词表与汤库页同一套展示视图（剔翻译标签 + 「其他」补分类），
         两边筛出来的结果才对得上（报告 P2-4） */
      var cats = ["全部"].concat(E.catFacet(mergedLib()));
      cbox.innerHTML = cats.map(function (c) {
        return '<button type="button" class="chip cat' + (c === state.randCat ? " on" : "") +
          '" data-cat="' + esc(c) + '">' + esc(c) + "</button>";
      }).join("");
      $$(".chip", cbox).forEach(function (btn) {
        btn.addEventListener("click", function () {
          state.randCat = btn.dataset.cat;
          sfx("ui");
          renderRandom();
        });
      });
    }

    /* 可选数量按「精品 + 汤库」合并池统计；汤库元信息懒加载中先按精品口径报 */
    var total = randPool({ cat: state.randCat, difficulty: state.randDiff }).length;
    var poolEl = $("#rand-pool");
    if (poolEl) {
      var loadingLib = window.SoupLibSource && !SoupLibSource.ready();
      poolEl.textContent = total === 0
        ? (loadingLib ? "正在从汤架取菜单…" : "这个条件下暂时没有汤，换个题材或火候试试")
        : total + " 道可选" + (loadingLib ? "（汤架取完还会更多）" : "");
    }
    var go = $("#btn-rand-go");
    if (go) go.disabled = total === 0 && !(window.SoupLibSource && !SoupLibSource.ready());
  }

  /* 从「多人汤屋」切走时：收起房间面板 + 停掉房间轮询 + 藏右下角聊天，
     免得房间界面 / 聊天框和汤库、随机模式、单人对局叠在一起 */
  function leaveRoomScreen() {
    var sr = $("#screen-room");
    if (sr && !sr.classList.contains("hidden")) {
      if (window.SoupRoom && window.SoupRoom.leaveScreen) window.SoupRoom.leaveScreen();
      else sr.classList.add("hidden");
    }
    document.body.classList.remove("room-mode");
    if (window.SoupRoom && window.SoupRoom.syncChat) window.SoupRoom.syncChat();
    /* 汤主的话跟看回来：回到右栏线索板下面 */
    if (window.SoupRoom && window.SoupRoom.syncTip) window.SoupRoom.syncTip();
  }

  function openRandom() {
    setScene("menu");
    leaveRoomScreen();
    $("#screen-intro").classList.add("hidden");
    $("#screen-game").classList.add("hidden");
    $("#screen-random").classList.remove("hidden");
    renderRandom();
    /* 汤库元信息没到位就先去取：到位后重画，把「2500 道可选」补齐 */
    if (window.SoupLibSource && !SoupLibSource.ready()) {
      SoupLibSource.ensure().then(function () {
        if ($("#screen-random") && !$("#screen-random").classList.contains("hidden")) renderRandom();
      }).catch(function () { /* 保底：精品层照抽不误 */ });
    }
    sfx("ui");
  }

  function backFromRandom() {
    $("#screen-random").classList.add("hidden");
    $("#screen-intro").classList.remove("hidden");
    setScene("menu");
    renderQaLog();
    sfx("ui");
  }

  function drawRandom() {
    if (window.SoupLibSource && !SoupLibSource.ready()) {
      toast("汤架还在路上，稍等一下再抽");
      SoupLibSource.ensure().catch(function () { });
      return;
    }
    var p = randDraw(randOpts());
    if (!p) { toast("这个条件下暂时没有可抽的汤，放宽一点试试"); return; }
    toast("抽到：" + (p.dispTitle || p.title));
    loadPuzzle(p.id);
  }

  /* 首页/顶栏「随机一题」：与随机模式同一个池、同一套权重（精品 + 全量汤库）。
     首访头两秒汤架可能还没取回来：先抽精品层垫上，绝不让人干等。 */
  function randomAnywhere() {
    if (window.SoupLibSource && !SoupLibSource.ready() && SoupLibSource.count() === 0) return null;
    return randDraw({});
  }

  function randomAnywhereWithToast(prefix) {
    var r = randomAnywhere();
    if (r) {
      loadPuzzle(r.id);
      if (prefix) toast(prefix + "：" + (r.dispTitle || r.title));
      return;
    }
    var core = E.drawFrom(PUZZLES);
    if (core) {
      toast("汤架还在路上，先来一锅精品汤");
      loadPuzzle(core.id);
    }
  }

  /* ---------------- 汤库模式 ---------------- */

  var LIB_DIFFS = [
    { v: 0, label: "不限" },
    { v: 1, label: "● 清淡" },
    { v: 2, label: "●● 适中" },
    { v: 3, label: "●●● 浓郁" }
  ];

  /* 库层难度：只有 1/2/3，没有 par */
  function libDiffDots(d) {
    var n = Number(d);
    if (!isFinite(n) || n < 1 || n > 3) n = 2;
    return new Array(n + 1).join("●") + new Array(4 - n).join("○");
  }

  /* 来源短名：github:owner/repo → owner（详情页小字用，不再进筛选条） */
  function libShortSrc(s) {
    var v = String(s || "");
    if (!v) return "未知";
    if (v.indexOf("github:") === 0) return v.slice(7).split("/")[0] || v;
    return v;
  }

  /* 筛选走展示视图（E.catsView / E.srcGroupOf）：翻译状态不占题材位，
     27 个原始来源归并成几组可读标签（报告 P2-3 / P2-4） */
  function libraryFiltered() {
    var list = E.searchLibrary(mergedLib(), libState.kw);
    return list.filter(function (p) {
      if (!p) return false;
      if (libState.cat && libState.cat !== "全部" && !E.hasCatView(p, libState.cat)) return false;
      if (libState.difficulty && p.difficulty !== libState.difficulty) return false;
      if (libState.src && libState.src !== "全部" && !E.hasSrcGroup(p, libState.src)) return false;
      return true;
    });
  }

  /* 元信息还没懒加载好：列表区先挂「取汤架」占位 */
  function libLoadingHint(target) {
    if (target) target.innerHTML = '<p class="pz-empty">正在从汤架取新菜单…<br />第一次稍等一两秒，之后离线也秒开。</p>';
    var badge = $("#lib-count");
    if (badge) badge.textContent = "…";
    var more = $("#btn-lib-more");
    if (more) more.classList.add("hidden");
  }

  function renderLibraryFilters() {
    var cbox = $("#lib-cat");
    if (cbox) {
      var cats = ["全部"].concat(E.catFacet(mergedLib()));
      cbox.innerHTML = cats.map(function (c) {
        return '<button type="button" class="chip cat' + (c === libState.cat ? " on" : "") +
          '" data-cat="' + esc(c) + '">' + esc(c) + "</button>";
      }).join("");
      $$(".chip", cbox).forEach(function (btn) {
        btn.addEventListener("click", function () {
          libState.cat = btn.dataset.cat;
          libState.page = 1;
          sfx("ui");
          renderLibrary();
        });
      });
    }

    var dbox = $("#lib-diff");
    if (dbox) {
      dbox.innerHTML = LIB_DIFFS.map(function (d) {
        return '<button type="button" class="chip diff' + (d.v === libState.difficulty ? " on" : "") +
          '" data-diff="' + d.v + '" aria-pressed="' + (d.v === libState.difficulty ? "true" : "false") + '">' +
          esc(d.label) + "</button>";
      }).join("");
      $$(".chip", dbox).forEach(function (btn) {
        btn.addEventListener("click", function () {
          libState.difficulty = Number(btn.dataset.diff) || 0;
          libState.page = 1;
          sfx("ui");
          renderLibrary();
        });
      });
    }

    var sbox = $("#lib-src");
    if (sbox) {
      var srcs = ["全部"].concat(E.srcFacet(mergedLib()));
      sbox.innerHTML = srcs.map(function (s) {
        return '<button type="button" class="chip' + (s === libState.src ? " on" : "") +
          '" data-src="' + esc(s) + '" title="' + esc(s) + '">' + esc(s) + "</button>";
      }).join("");
      $$(".chip", sbox).forEach(function (btn) {
        btn.addEventListener("click", function () {
          libState.src = btn.dataset.src;
          libState.page = 1;
          sfx("ui");
          renderLibrary();
        });
      });
    }
  }

  /* 分页渲染：2400 条全量 innerHTML 会把移动端拖卡，必须切片 */
  function renderLibrary() {
    var box = $("#lib-list");
    if (!box) return;
    if (!window.SoupLibSource || !SoupLibSource.ready()) {
      renderLibraryFilters();
      libLoadingHint(box);
      return;
    }
    var list = libraryFiltered();
    var show = list.slice(0, libState.page * LIB_PAGE_SIZE);

    if (!list.length) {
      box.innerHTML = '<p class="pz-empty">这个组合下暂时没有汤。<br />换个题材或来源试试。</p>';
    } else {
      box.innerHTML = show.map(function (p) {
        var solv = isSolved(p.id);
        var xl = E.xlateOf(p);
        return '<button type="button" role="listitem" class="pz-card lib-card' + (solv ? " solved" : "") +
          '" data-lib-id="' + esc(p.id) +
          '" aria-label="' + esc(p.dispTitle) + '，难度' + p.difficulty + '">' +
          /* 绿勾：点一下把这个汤标成「已熬出汤底」/ 再点取消；不影响进汤 */
          '<span class="pz-check' + (solv ? " on" : "") + '" data-check="' + esc(p.id) + '" role="checkbox" ' +
          'aria-checked="' + (solv ? "true" : "false") + '" title="标记为已熬出汤底">' + (solv ? ic("check") : "") + "</span>" +
          '<div class="pz-title">' + esc(p.dispTitle) + "</div>" +
          '<div class="pz-meta"><span class="pz-diff" aria-hidden="true">' + libDiffDots(p.difficulty) + "</span>" +
          "<span>" + esc(E.srcGroupOf(p.src)) + "</span>" +
          (xl ? '<span class="lib-xlate">' + esc(xl) + "</span>" : "") +
          (p.truthSource === "recovered" ? '<span class="lib-notruth">已补底</span>' : "") +
          "</div>" +
          '<div class="pz-cats">' + E.catsView(p).map(function (c) {
            return '<span class="pz-cat">' + esc(c) + "</span>";
          }).join("") + "</div>" +
          "</button>";
      }).join("");
      /* 小绿勾：拦截冒泡，只做标记，不进汤 */
      $$(".pz-check", box).forEach(function (ck) {
        ck.addEventListener("click", function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          var id = ck.getAttribute("data-check");
          var on = toggleSolved(id);
          ck.classList.toggle("on", on);
          ck.innerHTML = on ? ic("check") : "";
          ck.setAttribute("aria-checked", on ? "true" : "false");
          var card = ck.closest ? ck.closest(".pz-card") : null;
          if (card) card.classList.toggle("solved", on);
          sfx(on ? "ui" : "ui");
          toast(on ? "已标记：这道汤你熬出过汤底" : "已取消标记");
        });
      });
      $$(".pz-card", box).forEach(function (card) {
        card.addEventListener("click", function () { loadPuzzle(card.dataset.libId); });
      });
    }

    var badge = $("#lib-count");
    if (badge) badge.textContent = show.length + " / " + list.length;
    var more = $("#btn-lib-more");
    if (more) more.classList.toggle("hidden", show.length >= list.length);
  }

  /* 懒加载就绪后的统一善后：重画当前打开的列表页 + 服务端口径校准 */
  function onLibReady() {
    var libOpen = $("#screen-library") && !$("#screen-library").classList.contains("hidden");
    var randOpen = $("#screen-random") && !$("#screen-random").classList.contains("hidden");
    if (libOpen) { renderLibraryFilters(); renderLibrary(); }
    if (randOpen) renderRandom();
    /* 服务端口径：/api/puzzle-stats 与本地清单对不上就提示刷新取新 */
    var sc = window.SoupLibSource && SoupLibSource.serverCounts && SoupLibSource.serverCounts();
    if (libOpen && sc && typeof sc.lib === "number" && sc.lib !== SoupLibSource.count()) {
      toast("服务端汤架有更新（现共 " + sc.total + " 道），刷新页面可取最新");
    }
  }

  function openLibrary() {
    setScene("menu");
    leaveRoomScreen();
    $("#screen-intro").classList.add("hidden");
    $("#screen-game").classList.add("hidden");
    var r = $("#screen-random");
    if (r) r.classList.add("hidden");
    $("#screen-library").classList.remove("hidden");
    /* 首屏不带汤库元信息：此刻才取（SW 缓存命中时近乎无感） */
    if (window.SoupLibSource && !SoupLibSource.ready()) {
      renderLibraryFilters();
      libLoadingHint($("#lib-list"));
      SoupLibSource.ensure().catch(function () {
        var box = $("#lib-list");
        if (box) box.innerHTML = '<p class="pz-empty">汤架暂时取不到，检查网络后重试。<br />（精品 100 道不受影响，可先随便来一锅）</p>';
      });
    }
    renderLibraryFilters();
    renderLibrary();
    if (window.SoupLibSource) SoupLibSource.probeServer();
    sfx("ui");
  }

  function backFromLibrary() {
    $("#screen-library").classList.add("hidden");
    $("#screen-intro").classList.remove("hidden");
    setScene("menu");
    renderQaLog();
    sfx("ui");
  }

  /* ---------------- 事件绑定 ---------------- */

  function bind() {
    var startBtn = $("#btn-start");
    if (startBtn) startBtn.addEventListener("click", function () {
      loadPuzzle(PUZZLES[0].id);
    });

    var resumeBtn = $("#btn-resume");
    if (resumeBtn) resumeBtn.addEventListener("click", resumeSession);

    var randBtn = $("#btn-start-random");
    if (randBtn) randBtn.addEventListener("click", function () { randomAnywhereWithToast(); });

    var topRand = $("#btn-random");
    if (topRand) topRand.addEventListener("click", function () {
      randomAnywhereWithToast("随机一锅");
    });

    /* 随机模式：按题材 / 火候 / 是否熬过 抽题 */
    var rmBtn = $("#btn-random-mode");
    if (rmBtn) rmBtn.addEventListener("click", openRandom);

    var rGo = $("#btn-rand-go");
    if (rGo) rGo.addEventListener("click", drawRandom);

    var rBack = $("#btn-rand-back");
    if (rBack) rBack.addEventListener("click", backFromRandom);

    /* 汤库模式：浏览 / 搜索 / 筛选 / 分页 */
    var libBtn = $("#btn-library");
    if (libBtn) libBtn.addEventListener("click", openLibrary);

    /* 中区问答记录：清空本局记录（汤库入口由顶栏「汤库」统一提供） */
    var qaClear = $("#btn-qa-clear");
    if (qaClear) qaClear.addEventListener("click", function () {
      state.history = [];
      clearQaLog();
      sfx("ui");
      toast("本局问答记录已清空");
    });

    var libBack = $("#btn-lib-back");
    if (libBack) libBack.addEventListener("click", backFromLibrary);

    var libMore = $("#btn-lib-more");
    if (libMore) libMore.addEventListener("click", function () {
      libState.page++;
      sfx("ui");
      renderLibrary();
    });

    /* 搜索防抖 200ms：1521 条逐键全量过滤会卡手 */
    var libSearch = $("#lib-search");
    if (libSearch) {
      var libTimer = null;
      libSearch.addEventListener("input", function () {
        clearTimeout(libTimer);
        libTimer = setTimeout(function () {
          libState.kw = libSearch.value.trim();
          libState.page = 1;
          renderLibrary();
        }, 200);
      });
    }

    /* 音效开关 */
    var snd = $("#btn-sound");
    if (snd) {
      var paintSnd = function () {
        snd.innerHTML = (state.sound ? ic("volume") : ic("mute")) + (state.sound ? " 音效" : " 静音");
        snd.setAttribute("aria-pressed", state.sound ? "true" : "false");
      };
      paintSnd();
      snd.addEventListener("click", function () {
        state.sound = !state.sound;
        if (AU) AU.setSfxOn(state.sound);
        paintSnd(); saveProgress();
        if (state.sound) sfx("pick");
      });
    }

    /* 音乐开 / 关 */
    var bm = $("#btn-music");
    if (bm) bm.addEventListener("click", toggleMusic);
    var dm = $("#dock-mute");
    if (dm) dm.addEventListener("click", toggleMusic);

    /* 氛围特效开 / 关 */
    var bfx = $("#btn-fx");
    if (bfx) bfx.addEventListener("click", toggleFx);

    /* 播放 / 暂停 */
    var bp = $("#btn-play");
    if (bp) bp.addEventListener("click", togglePlay);
    var dp = $("#dock-play");
    if (dp) dp.addEventListener("click", togglePlay);

    /* 音量（玩家拖动 = 明确偏好，允许持久化） */
    var vol = $("#vol");
    if (vol) vol.addEventListener("input", function () { setVolume(Number(vol.value) / 100, true); });

    /* 报告改善③：窄屏下左栏「问答记录」默认收成一条头栏（N 问徽章仍可点） */
    initQaCollapse();

    /* 懒加载就绪：重画当前开着的汤库 / 随机面板 + 服务端口径校准 */
    root.addEventListener("soup:libready", onLibReady);

    /* 快捷键：M 静音音乐 / 空格在非输入状态暂停音乐 */
    document.addEventListener("keydown", function (ev) {
      var t = ev.target;
      var typing = t && t.closest && t.closest("input,textarea,select,[contenteditable]");
      if (typing) return;
      if (ev.key === "m" || ev.key === "M") { ev.preventDefault(); toggleMusic(); }
      else if (ev.key === " " || ev.key === "Spacebar") { ev.preventDefault(); togglePlay(); }
    });

    var wipe = $("#btn-wipe");
    if (wipe) wipe.addEventListener("click", function () {
      if (!window.confirm("清空本局进度与音量偏好？这一步不可撤销。")) return;
      progress = { session: null, sound: state.sound, music: state.music, playing: state.playing, fx: state.fx, volume: state.volume };
      state.history = [];
      saveProgress();
      clearQaLog();
      renderStats();
      sfx("lose");
      toast("存档已清空，重新开锅");
    });

    var askBtn = $("#btn-ask");
    if (askBtn) askBtn.addEventListener("click", submitQuestion);

    var input = $("#q-input");
    if (input) input.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); submitQuestion(); }
    });

    /* 第⑥条：提示 / 问问 AI 已下线；第⑪条：右栏换成单人备忘录 */
    initSoloMemo();

    bindAiModal();

    var guessBtn = $("#btn-guess");
    if (guessBtn) guessBtn.addEventListener("click", openGuess);

    var unlockBtn = $("#btn-unlock");
    if (unlockBtn) unlockBtn.addEventListener("click", soloGiveup);

    var gCancel = $("#btn-guess-cancel");
    if (gCancel) gCancel.addEventListener("click", function () { closeModal("#modal-guess"); });

    var gSubmit = $("#btn-guess-submit");
    if (gSubmit) gSubmit.addEventListener("click", submitGuess);

    var gi = $("#guess-input");
    if (gi) gi.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); submitGuess(); }
    });

    var replay = $("#btn-replay");
    if (replay) replay.addEventListener("click", function () { closeModal("#modal-end"); loadPuzzle(state.pid); });

    var next = $("#btn-next");
    if (next) next.addEventListener("click", nextPuzzle);

    var back = $("#btn-back");
    if (back) back.addEventListener("click", backToList);

    $$(".modal-wrap").forEach(function (wrap) {
      wrap.addEventListener("click", function (ev) {
        if (ev.target === wrap) {
          if (wrap.id === "modal-guess") closeModal("#modal-guess");
          else if (wrap.id === "modal-end") closeModal("#modal-end");
          else if (wrap.id === "modal-ai") closeModal("#modal-ai");
        }
      });
    });

    function openModals() {
      return $$(".modal-wrap").filter(function (m) { return !m.classList.contains("hidden"); });
    }

    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape") return;
      var open = openModals();
      if (open.length) {
        var last = open[open.length - 1];
        if (last.id === "modal-guess") closeModal("#modal-guess");
        else if (last.id === "modal-end") closeModal("#modal-end");
        else if (last.id === "modal-ai") closeModal("#modal-ai");
      }
    });

    /* 弹窗内 Tab 焦点陷阱，避免焦点跑到背后的页面上 */
    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "Tab") return;
      var open = openModals();
      if (!open.length) return;
      var focusables = $$("button, textarea, input, select, a[href]", open[open.length - 1]).filter(function (el) {
        return !el.disabled && el.tabIndex !== -1;
      });
      if (!focusables.length) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    });

    /* 首次交互解锁音频上下文 */
    var unlock = function () {
      if (AU) AU.unlock();
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
    };
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);

    /* 双端适配：手机软键盘弹出时，收起浮动音乐台、给对话区让位
       判定要严：只在「宽度没变 + 焦点在输入框 + 高度院降」时才算键盘，
       否则换屏 / 旋转 / 拖窗口都会被误判（横屏手机最容易中招） */
    (function watchKeyboard() {
      var vv = window.visualViewport;
      var baseW = window.innerWidth;
      var baseH = window.innerHeight;
      var editable = function () {
        var a = document.activeElement;
        return !!(a && a.closest && a.closest("input,textarea,select,[contenteditable]"));
      };
      var apply = function () {
        var w = window.innerWidth;
        var h = vv ? vv.height : window.innerHeight;
        /* 宽度变了 = 旋转 / 换屏，不是键盘：重置基准，不弹 kb-open */
        if (Math.abs(w - baseW) > 24) { baseW = w; baseH = h; }
        else if (h > baseH) { baseH = h; }
        var open = editable() && (baseH - h) > 140;
        document.body.classList.toggle("kb-open", open);
        /* 第①条：把软键盘高度写进 --kbh，聊天框打字时整体抬到键盘上方，
           而不是被 .kb-open 规则连输入框一起藏掉（旧版失焦死循环的根源） */
        try {
          document.documentElement.style.setProperty("--kbh", (open ? Math.max(0, Math.round(baseH - h)) : 0) + "px");
        } catch (e) { /* 忽略 */ }
        if (open) {
          var log = $("#log");
          if (log) log.scrollTop = log.scrollHeight;
        }
      };
      window.addEventListener("resize", apply);
      window.addEventListener("orientationchange", function () {
        /* 旋转后基准完全重算，避免拿旧高度去比 */
        baseW = window.innerWidth;
        baseH = vv ? vv.height : window.innerHeight;
        apply();
      });
      document.addEventListener("focusin", apply);
      document.addEventListener("focusout", function () { setTimeout(apply, 60); });
      if (vv) {
        vv.addEventListener("resize", apply);
        vv.addEventListener("scroll", apply);
      }
      apply();
    })();

    /* 打雷时轻微震动，增强临场感（关掉「特效」时不动） */
    window.addEventListener("soup:lightning", function () {
      if (!state.fx) return;
      if (FX && FX.reduced) return;
      var lay = document.querySelector(".layout");
      if (!lay) return;
      lay.classList.remove("thunder-shake");
      void lay.offsetWidth;
      lay.classList.add("thunder-shake");
      setTimeout(function () { lay.classList.remove("thunder-shake"); }, 480);
    });

    /* 曲目名同步到音乐台 */
    window.addEventListener("soup:track", function (ev) {
      var el = $("#dock-track");
      if (el && ev.detail && ev.detail.label) el.textContent = ev.detail.label;
    });

    window.addEventListener("pagehide", saveProgress);
    document.addEventListener("visibilitychange", function () { if (document.hidden) saveProgress(); });
  }

  /* ---------------- 启动 ---------------- */

  function boot() {
    if (!E || !PUZZLES.length) {
      toast("题库加载失败，请刷新页面");
      return;
    }

    state.sound = progress.sound !== false;
    state.music = progress.music !== false;
    state.playing = progress.playing !== false;
    state.fx = progress.fx !== false;
    /* 手机端省电档（2026-09-27）：新访客没存过偏好时，触屏设备默认关氛围特效。
       老玩家的既有选择（开或关）一律保留，不替主人做主。 */
    if (progress.fx === undefined) {
      try {
        var mqcFx = window.matchMedia && window.matchMedia("(pointer: coarse)");
        if (mqcFx && mqcFx.matches) state.fx = false;
      } catch (e) { /* 忽略 */ }
    }
    /* 音量读数校验（报告 P3-6）：越界 / NaN / 字符串坏值一律回默认 0.6，
       且不当作「明确偏好」——等玩家亲手碰滑条才回写存档 */
    var pv = progress.volume;
    var volValid = typeof pv === "number" && isFinite(pv) && pv >= 0 && pv <= 1;
    state.volume = volValid ? pv : 0.6;
    state.volumeTouched = volValid;
    if (!volValid && progress && "volume" in progress) {
      delete progress.volume;
      saveProgress();   /* 存档里的坏值当场自愈，不留到下次才洗 */
    }

    if (FX) FX.init();
    applyAudioSettings();
    applyFxSettings();

    renderQaLog();
    renderRandom();
    paintAiBar();
    paintResume();
    bind();
    setScene("menu");

    /* 预热：只拉首屏要用的两张背景，其余等切场景时按需加载（少下 600KB+） */
    ["menu", "game"].forEach(function (k) {
      var im = new Image();
      im.src = BG[k];
    });
    if (AU) AU.preload(["menu", "game"]);

    loadMorePuzzles();

    /* 刷新后如果还在房间里，直接接回去（房间层负责判断，找不到就静默放弃） */
    if (window.SoupRoom && window.SoupRoom.resume) window.SoupRoom.resume();

    /* 离线缓存：二次访问秒开。只在 https 下注册，本地调试不吃旧文件 */
    if ("serviceWorker" in navigator && location.protocol === "https:") {
      navigator.serviceWorker.register("sw.js").catch(function () { /* 注册失败不影响玩 */ });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  root.SoupApp = {
    pid: function () { return state.pid; },
    /* 退房后由 room-ui 调：左栏问答记录交回单人侧按本地历史重画 */
    renderQaLog: renderQaLog,
    /* 「已熬出汤底」标记：供多人选汤面板复用同一份本地记录 */
    isSolved: isSolved,
    toggleSolved: toggleSolved,
    /* 多人房揭底 / 说破那一刻也走这一个入口，别再让主人回汤库手动补钩 */
    markSolved: markSolved
  };
})(window);
