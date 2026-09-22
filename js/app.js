/* ============================================================
 * 深海汤屋 · 主逻辑
 * ============================================================ */
"use strict";

(function () {
  var E = window.SoupEngine;
  var FX = window.SoupFx;
  var AU = window.SoupAudio;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };

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
    hintsUsed: 0,
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
    volume: 0.6
  };

  var progress = loadProgress();

  /* ---------------- 汤库（与精品层完全隔离） ---------------- */

  var LIB = window.SOUP_LIBRARY || [];

  var libState = {
    page: 1,
    kw: "",
    cat: "全部",
    difficulty: 0,
    src: "全部",
    hasTruth: false,
    en: false
  };

  function libPuzzle(id) {
    if (!id) return null;
    for (var i = 0; i < LIB.length; i++) {
      if (LIB[i].id === id) return LIB[i];
    }
    return null;
  }

  function isLibPid(id) {
    return typeof id === "string" && id.indexOf("lib_") === 0;
  }

  function isLib(p) {
    return !!(p && isLibPid(p.id));
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
    ["#q-input", "#btn-ask", "#btn-hint", "#btn-ai-quick", "#btn-guess"].forEach(function (s) {
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
      progress.volume = state.volume;
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
        hintsUsed: state.hintsUsed,
        qCount: state.qCount,
        history: state.history.slice(-20)
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

  /* 转场：先瞬间盖上遮罩，立刻换内容，再淡出 —— 有转场感，但点击不延迟 */
  function sceneWipe(cb) {
    var f = $("#scene-fade");
    if (!f || (FX && FX.reduced)) { cb(); return; }
    f.style.transition = "none";
    f.classList.add("on");
    void f.offsetWidth;
    cb();
    f.style.transition = "";
    setTimeout(function () { f.classList.remove("on"); }, 60);
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
      bm.textContent = state.music ? "🎵 音乐" : "🎵 静音";
      bm.setAttribute("aria-pressed", state.music ? "true" : "false");
    }
    var bp = $("#btn-play");
    if (bp) {
      bp.textContent = state.playing ? "⏸ 暂停" : "▶ 播放";
      bp.setAttribute("aria-pressed", state.playing ? "true" : "false");
    }
    var dp = $("#dock-play");
    if (dp) {
      dp.textContent = state.playing ? "⏸" : "▶";
      dp.setAttribute("aria-pressed", state.playing ? "true" : "false");
    }
    var dm = $("#dock-mute");
    if (dm) {
      dm.textContent = state.music ? "🔊" : "🔇";
      dm.setAttribute("aria-pressed", state.music ? "true" : "false");
    }
    var v = $("#vol");
    if (v && Number(v.value) !== Math.round(state.volume * 100)) v.value = String(Math.round(state.volume * 100));
    var dock = $("#music-dock");
    if (dock) dock.classList.toggle("dim", !state.music || !state.playing);
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
    bf.textContent = state.fx ? "✨ 特效" : "✨ 特效关";
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

  function setVolume(v) {
    state.volume = Math.max(0, Math.min(1, v));
    if (AU) AU.setVolume(state.volume);
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
    s.src = "js/data-more.js";
    s.async = true;
    s.onload = function () {
      renderQaLog();
      renderRandom();
      paintResume();
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
   * 原「汤单」列表已整体迁入 📚 汤库（screen-library）。
   * 左侧现在只做一件事：把本局的问答历史滚动展示出来。
   * 数据源就是 state.history（{q, a} 数组），与 #log 同源同序。
   * ============================================================ */

  /* 本局问答记录：state.history 里每一条 {q, a} 渲染成一组 Q/A */
  function renderQaLog() {
    var box = $("#qa-log");
    if (!box) return;
    var hist = state.history || [];
    var badge = $("#qa-count");
    if (badge) badge.textContent = hist.length + " 问";

    if (!hist.length) {
      box.innerHTML = '<p class="empty">还没有提问。<br />打开一道汤，向汤主问出第一句吧。</p>';
      return;
    }
    box.innerHTML = hist.map(function (item, idx) {
      return '<div class="qa-item">' +
        '<div class="qa-q"><span class="qa-k">Q' + (idx + 1) + "</span>" + esc(item.q) + "</div>" +
        '<div class="qa-a"><span class="qa-k">A</span>' + esc(item.a) + "</div>" +
        "</div>";
    }).join("");
    box.scrollTop = box.scrollHeight;
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
    var s = state;
    if (isLib(p)) {
      /* 库层没有预设线索板：只统计提问数与提示数 */
      set("#s-q", s.qCount);
      set("#s-clue", "—");
      set("#s-hint", s.hintsUsed);
      set("#s-pct", "—");
      var lb = $("#s-bar");
      if (lb) lb.style.width = "0%";
      var lbd = $("#clue-badge");
      if (lbd) lbd.textContent = "—";
      return;
    }
    set("#s-q", s.qCount);
    set("#s-clue", s.revealed.length + "/" + p.clues.length);
    set("#s-hint", s.hintsUsed);
    var pct = E.exploration(p, s.revealed.length);
    set("#s-pct", pct + "%");
    var bar = $("#s-bar");
    if (bar) bar.style.width = pct + "%";
    var badge = $("#clue-badge");
    if (badge) badge.textContent = s.revealed.length + "/" + p.clues.length;
  }

  function set(sel, val) {
    var el = $(sel);
    if (el) el.textContent = val;
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

  function loadPuzzle(id, restore) {
    var p = E.getPuzzle(id);
    if (!p) return;
    var lib = isLib(p);
    sceneWipe(function () {
      leaveRoomScreen();
      /* 两层各自持有「进行中的对局」：库题只认 LIB_KEY，绝不串档 */
      var snap = restore ? (lib ? libProgress().session : progress.session) : null;
      if (snap && snap.pid !== id) snap = null;
      state.pid = id;
      state.revealed = snap && snap.revealed ? snap.revealed.slice() : [];
      state.asked = snap && snap.asked ? snap.asked : {};
      state.hintsUsed = snap ? (snap.hintsUsed || 0) : 0;
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
      /* 重放入场动画，让切题更“有戏” */
      gs.style.animation = "none";
      void gs.offsetWidth;
      gs.style.animation = "";
      setScene("game");

      if (lib) {
        /* 库层：标题用 dispTitle（永远非空），来源代替大类标签 */
        set("#p-title", p.dispTitle || p.title || "无题");
        set("#p-tag", p.src);
        var lcats = $("#p-cats");
        if (lcats) {
          var lcs = p.cats || [];
          lcats.innerHTML = lcs.map(function (c) { return '<span class="pz-cat">' + esc(c) + "</span>"; }).join("");
          lcats.classList.toggle("hidden", !lcs.length);
        }
        set("#p-diff", libDiffDots(p.difficulty) + " 难度");
        var lorig = $("#p-orig");
        if (lorig) lorig.classList.add("hidden");
      } else {
        set("#p-title", p.title);
        set("#p-tag", p.tag);
        var pcats = $("#p-cats");
        if (pcats) {
          var cs = E.catsOf(p);
          pcats.innerHTML = cs.map(function (c) { return '<span class="pz-cat">' + esc(c) + "</span>"; }).join("");
          pcats.classList.toggle("hidden", !cs.length);
        }
        set("#p-diff", new Array(p.difficulty + 1).join("●") + new Array(3 - p.difficulty + 1).join("○") + " 难度");
        var orig = $("#p-orig");
        if (orig) orig.classList.toggle("hidden", !p.original);
      }
      typeSurface(p.surface);

      clearLog();
      if (lib) {
        sysLine("（这一锅来自「" + p.src + "」）");
        if (p.mode === "surface") {
          /* 只有汤面：五个交互按钮全禁用，明确告知，绝不让 AI 瞎编 */
          setAskEnabled(false);
          sysLine("这锅只有汤面，汤底还在熬。");
          renderTip("这锅只有汤面，汤底还在熬——先看看就好。");
        } else {
          setAskEnabled(true);
          if (p.truthSource === "ai") {
            sysLine("（注意：这一锅的汤底是 AI 根据汤面编的，不是原题答案）");
          }
          sysLine(snap
            ? "（你回到灶台前，锅里还温着）接着上一锅继续。"
            : "（锅盖揭开，热气涌上来）汤主问你：这一锅，你看出了什么？");
          renderTip(aiOn()
            ? "AI 汤主已经读过这一锅的汤面汤底，用你自己的话问就好。"
            : "这一锅要 AI 汤主才能问——点上方 🤖 AI 汤主 配好模型。");
        }
      } else {
        setAskEnabled(true);
        sysLine(snap
          ? "（你回到灶台前，锅里还温着）接着上一锅继续。"
          : "（锅盖揭开，热气涌上来）汤主问你：这一锅，你看出了什么？");
        renderTip(aiOn()
          ? "AI 汤主已经读过这一锅的汤面汤底，用你自己的话问就好。"
          : "随便问点什么吧。关键词越准，汤主掀开的那一层越厚。");
      }
      renderClues();
      renderStats();
      renderQaLog();
      paintAiBar();

      var input = $("#q-input");
      if (input) {
        input.value = "";
        if (!lib || p.mode === "truth") {
          if (!isTouch() && window.innerWidth > 860) input.focus();
        }
      }
      saveSession();
      paintResume();
      sfx("page");
    });
  }

  function renderTip(text) {
    var el = $("#tip-text");
    if (el) el.textContent = text;
  }

  function renderClues() {
    var box = $("#clue-list");
    var p = E.getPuzzle(state.pid);
    if (!box || !p) return;
    if (isLib(p)) {
      box.innerHTML = '<p class="empty">汤库这一锅没有预设线索板——线索得靠 AI 汤主一句句问出来。</p>';
      var lbadge = $("#clue-badge");
      if (lbadge) lbadge.textContent = "—";
      return;
    }
    if (!state.revealed.length) {
      box.innerHTML = '<p class="empty">还没有挖到线索。<br />先问几个「是 / 不是」都能答的问题吧。</p>';
      return;
    }
    var items = state.revealed.slice().sort(function (a, b) { return a - b; }).map(function (i) {
      var c = p.clues[i];
      var label = VERDICT_TEXT[c.type] || "线索";
      return '<div class="clue ' + esc(c.type) + '">' +
        '<span class="clue-k">线索 ' + (i + 1) + " · " + esc(label) + "</span>" +
        esc(E.stripLead(c.text)) + "</div>";
    });
    var left = p.clues.length - state.revealed.length;
    if (left > 0) {
      items.push('<div class="clue empty-card">还有 ' + left + " 条线索还藏在锅里，继续挖。</div>");
    }
    box.innerHTML = items.join("");
  }

  /* ---------------- 提问 ---------------- */

  function submitQuestion() {
    var input = $("#q-input");
    if (!input) return;
    var raw = input.value.trim();
    if (!raw) { toast("先写点什么，汤主才听得见呀"); return; }
    if (state.done) { toast("这一锅已经端上桌了，先去揭汤底吧"); return; }

    var p = E.getPuzzle(state.pid);
    if (!p) return;

    /* 汤库层没有关键词汤主：必须走 AI，否则不给问 */
    if (isLib(p) && !aiOn()) {
      toast("汤库这一锅要 AI 汤主才能问——点上方 🤖 AI 汤主 配好模型");
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
    state.qCount++;

    /* 库题没有预设线索：跳过关键词匹配，直接交给 AI 汤主理解 */
    var res = isLib(p) ? { kind: "none" } : E.ask(p, raw, state.revealed);

    if (aiOn() && res.kind !== "meta") {
      /* AI 模式：认领哪条线索由模型理解后决定（用自己的话也能挖到线索）；
         它认不出来时才退回关键词的判定，保证进度不会白费。
         ⚠ 记账必须等 AI 真正答上才算数：掉线时这一笔要回滚，玩家可以重问 */
      askAi(p, raw, res, key);
    } else if (aiOn()) {
      /* meta（寒暄/超范围）也走 AI，不再外显关键词硬回复 */
      state.asked[key] = 1;
      askAi(p, raw, res, null);
    } else {
      /* 没接 AI：本项目只走 AI，绝不外显死板关键词回复 */
      state.qCount--;
      addLine("host", "sys", esc("AI 汤主掉线了，请重新提问一次。"));
      sfx("irr");
      input.value = "";
      renderStats();
      return;
    }

    state.asked[key] = 1;
    input.value = "";
    renderStats();
    saveSession();
    renderTip(aiOn()
      ? "AI 汤主的小提醒：不用凑关键词，把「为什么」「是不是有人」「那是什么」串成一句人话问它。"
      : "汤主的小提醒：把「为什么」「是不是有人」「那是什么」串起来问，比只问一个词有效得多。");
  }

  /* 线索板记账：AI 模式下提前记，关键词模式由 renderKeywordAnswer 顺手记 */
  function pushReveal(res) {
    if (res.kind === "clue" && state.revealed.indexOf(res.index) === -1) state.revealed.push(res.index);
  }

  /* 关键词汤主的原始答话：没配 AI 时走这里，AI 掉线时也回退到这里 */
  function renderKeywordAnswer(res, alreadyBooked) {
    if (res.kind === "clue") {
      var tone = res.verdict;
      var line = addLine("host", tone,
        (res.flavor ? esc(res.flavor) + "<br />" : "") +
        '<b class="verdict ' + esc(tone) + '">' + esc(VERDICT_TEXT[tone] || "线索") + "</b> " + esc(res.reply),
        "线索 " + (res.index + 1) + " +1");
      sfx(tone === "partial" ? "partial" : tone);
      if (FX && line) {
        FX.burstAt(line, {
          count: tone === "yes" ? 26 : 18,
          colors: tone === "yes" ? ["#68cf9a", "#a8ecc6", "#f6cf90"]
            : tone === "no" ? ["#e0705e", "#ffb3a3", "#e2a44f"]
              : ["#e8c45c", "#ffe9c4", "#e2a44f"]
        });
      }
      if (!alreadyBooked) {
        renderClues();
        toast("挖到新线索：" + (E.stripLead(res.clue.text).slice(0, 14)) + "…");
      }
    } else if (res.kind === "again") {
      addLine("host", "sys", esc("这条线索你已经挖到过了：") + esc(res.reply));
    } else if (res.kind === "meta") {
      addLine("host", "sys", esc(res.reply));
      sfx("irr");
    } else if (res.kind === "none") {
      /* 汤库题不走关键词汤主：能走到这里，只可能是 AI 没接上 */
      addLine("host", "sys", esc(res.reply || "汤主这一句没接上，再问一次试试。"));
      sfx("irr");
    } else {
      var l2 = addLine("host", "irr",
        (res.flavor ? esc(res.flavor) + "<br />" : "") +
        '<b class="verdict irr">与此无关</b> ' + esc(E.stripLead(res.reply)));
      sfx("irr");
      if (FX && l2) FX.burstAt(l2, { count: 8, power: 0.5, colors: ["#8b8177", "#6f6459"] });
    }
  }

  /* ---------------- AI 汤主 ---------------- */

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
    bar.classList.toggle("on", on);
    /* 警示与「是否启用」是两件事：AI 开着但这一句掉线了，也要提醒 */
    bar.classList.toggle("warn", !!note && /warn/.test(String(tone || "")));
    if (note) txt.textContent = note;
    else txt.textContent = on ? ("AI 汤主在值班 · " + AI.config().model) : "关键词汤主在值班";
    txt.className = note && tone ? tone : "";
    if (link) link.textContent = on ? "调整 AI 设置" : "换成 AI 汤主";
    if (btn) {
      btn.textContent = on ? "🤖 AI 汤主 · 开" : "🤖 AI 汤主";
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  /* 把已挖到的线索原文整理给模型，避免它和线索板打架 */
  function revealedTexts(p) {
    if (!p || !p.clues || !p.clues.length) return [];
    return state.revealed.slice().sort(function (a, b) { return a - b; }).map(function (i) {
      return (i + 1) + ". " + E.stripLead(p.clues[i].text);
    });
  }

  /* AI 认领线索 → 入账（返回是否真的新增了一条） */
  function claimClue(p, n) {
    /* 库层没有线索表：AI 认领编号一律忽略（AI 那边也已被要求只填 0） */
    if (!p || !p.clues || !p.clues.length) return false;
    var idx = parseInt(n, 10);
    if (!isFinite(idx) || idx <= 0 || idx > p.clues.length) return false;
    idx -= 1;
    if (state.revealed.indexOf(idx) !== -1) return false;
    state.revealed.push(idx);
    renderClues();
    renderStats();
    saveSession();
    toast("挖到新线索：" + E.stripLead(p.clues[idx].text).slice(0, 14) + "…");
    return true;
  }

  function askAi(p, raw, res, bookKey) {
    if (state.aiBusy) {
      addLine("host", "sys", esc("汤主还在想上一句，稍等一下下。"));
      if (bookKey) delete state.asked[bookKey];
      return;
    }
    state.aiBusy = true;
    var booked = false;
    var commit = function () {
      if (bookKey && !booked) { state.asked[bookKey] = 1; booked = true; }
    };

    var line = addLine("host", "pending", '<b class="verdict irr">…</b> 汤主正在琢磨这句话', "AI");
    var ctx = {
      revealed: revealedTexts(p),
      taken: state.revealed.map(function (i) { return i + 1; }),
      history: state.history.slice(-6)
    };
    if (res.kind === "clue") ctx.hintClue = { n: res.index + 1, type: res.verdict, text: E.stripLead(res.clue.text) };
    else if (res.kind === "again") ctx.hintClue = { n: res.index + 1, type: res.verdict, text: E.stripLead(res.reply) };

    var asked = raw;
    var fallback = res;

    AI.ask(p, asked, ctx).then(function (out) {
      state.aiBusy = false;
      if (line && line.parentNode) line.parentNode.removeChild(line);
      if (state.pid !== p.id || state.done) return;
      state.history.push({ q: asked, a: out.reply });
      var tone = out.verdict;
      var got = claimClue(p, out.clue);
      /* 模型没认领（clue=0）、且判定与关键词一致时，用关键词结果保底入账 */
      if (!got && out.clue === 0 && res.kind === "clue" && tone === res.verdict && state.revealed.indexOf(res.index) === -1) {
        pushReveal(res);
        renderClues();
        renderStats();
        toast("挖到新线索：" + E.stripLead(res.clue.text).slice(0, 14) + "…");
      }
      var el = addLine("host", tone,
        '<b class="verdict ' + esc(tone) + '">' + esc(VERDICT_TEXT[tone] || "线索") + "</b> " + esc(E.stripLead(out.reply)),
        "AI · " + esc(out.model || ""));
      sfx(tone === "partial" ? "partial" : tone);
      if (FX && el) {
        FX.burstAt(el, {
          count: tone === "yes" ? 26 : 14,
          colors: tone === "yes" ? ["#68cf9a", "#a8ecc6", "#f6cf90"]
            : tone === "no" ? ["#e0705e", "#ffb3a3", "#e2a44f"]
              : ["#e8c45c", "#ffe9c4", "#e2a44f"]
        });
      }
      /* 线索板与 AI 判定不一致时，以题库为准，并且不把新线索算给玩家 */
      if (res.kind === "clue" && tone !== res.verdict && state.revealed.indexOf(res.index) !== -1 && out.clue === 0) {
        state.revealed = state.revealed.filter(function (x) { return x !== res.index; });
        renderClues();
        renderStats();
      }
      paintAiBar();
    }, function (err) {
      state.aiBusy = false;
      if (line && line.parentNode) line.parentNode.removeChild(line);
      if (state.pid !== p.id) return;
      var why = AI.describeError(err);
      /* 掉线：本项目不接关键词汤主，绝不外显死板回复。
         这一笔记账要回滚、这一问不消耗次数，玩家可以原样重问 */
      if (bookKey) delete state.asked[bookKey];
      state.qCount = Math.max(0, state.qCount - 1);
      paintAiBar("AI 没接上（" + why + "）。", "ai-warn");
      addLine("host", "sys", esc("AI 汤主掉线了，请重新提问一次。"));
      sfx("irr");
      renderStats();
      toast("AI 掉线了：" + why);
    });
  }

  /* 「问问 AI」：让模型基于已挖线索补一句方向 */
  function askAiHint() {
    var p = E.getPuzzle(state.pid);
    if (!p || state.done) return;
    if (!aiOn()) { toast("先点上方的 🤖 AI 汤主 配好模型，才能问它"); openAiModal(); return; }
    /* 提示记账只留一处：先走题库提示，再补一句 AI 方向，避免两套逻辑漂移 */
    var before = state.hintsUsed;
    useHint();
    if (state.hintsUsed === before) return;   /* 提示已经给完了 */
    AI.ask(p, "我有点卡住了，能不能给我一点方向？只要一句，别告诉我答案。", {
      revealed: revealedTexts(p),
      history: state.history.slice(-6)
    }).then(function (out) {
      addLine("host", "hint", '<b>AI 汤主</b> · ' + esc(E.stripLead(out.reply)), "AI · 方向");
      sfx("hint");
    }, function () { /* 掉线就只用题库提示，不打扰玩家 */ });
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
    var st = $("#ai-status");
    if (st) {
      st.className = "ai-note" + (tone ? " " + tone : "");
      st.textContent = status || (AI.isReady(cfg)
        ? "已就绪 · " + pre.label + " / " + cfg.model + " · Key " + AI.maskKey(cfg.apiKey)
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
    return {
      provider: sel ? sel.value : "deepseek",
      baseUrl: bu ? bu.value.trim() : "",
      model: md ? md.value.trim() : "",
      apiKey: kk ? kk.value.trim() : ""
    };
  }

  function saveAiForm(forceOn) {
    var patch = readAiForm();
    if (typeof forceOn === "boolean") patch.enabled = forceOn;
    var cfg = AI.setConfig(patch);
    paintAiModal();
    paintAiBar();
    return cfg;
  }

  function testAi() {
    var st = $("#ai-status");
    var patch = readAiForm();
    patch.enabled = true;
    AI.setConfig(patch);
    if (st) { st.className = "ai-note"; st.textContent = "正在连接 " + patch.model + " …"; }
    AI.test().then(function (r) {
      paintAiModal(r.message, r.ok ? "ai-ok" : "ai-bad");
      paintAiBar();
      if (r.ok) sfx("yes"); else sfx("lose");
    });
  }

  function clearAi() {
    AI.save(AI.defaults());
    paintAiModal("配置已清空，回到关键词汤主。", "");
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
      paintAiModal(on ? "已启用。记得填全三样再保存。" : "已关闭，回到关键词汤主。", "");
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
    if (quick) quick.addEventListener("click", askAiHint);
  }

  function useHint() {
    var p = E.getPuzzle(state.pid);
    if (!p || state.done) return;
    if (isLib(p)) { toast("汤库这一锅没有预设提示，问问 AI 汤主吧"); return; }
    if (state.hintsUsed >= p.hints.length) { toast("提示已经全给你了，接下来靠自己啦"); return; }
    var text = p.hints[state.hintsUsed];
    state.hintsUsed++;
    addLine("host", "hint", "<b>提示 " + state.hintsUsed + "</b> · " + esc(text), "提示 -1 星");
    renderStats();
    saveSession();
    sfx("hint");
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

  function submitGuess() {
    var p = E.getPuzzle(state.pid);
    var gi = $("#guess-input");
    var fb = $("#guess-feedback");
    if (!p || !gi || !fb) return;
    var text = gi.value.trim();
    if (!text) { fb.textContent = "先写下你的推理，再交给汤主。"; fb.className = "guess-feedback no"; return; }

    /* 库层没有预设答案词，只能让 AI 汤主来判定 */
    if (isLib(p) && !aiOn()) {
      fb.textContent = "汤库这一锅没有预设答案词，得先配好 🤖 AI 汤主。";
      fb.className = "guess-feedback no";
      return;
    }

    addLine("me", "", esc(text), "我的推理");
    sfx("paper");
    state.qCount++;

    /* 关键词判定只做内部兜底，绝不上屏：本项目只走 AI，判定由 AI 汤主负责 */
    var j = E.judgeGuess(p, text);

    if (aiOn()) {
      /* 只显示「正在判断」，不让同步的关键词结果抢跑误导玩家 */
      fb.textContent = "AI 汤主正在判断你的推理…";
      fb.className = "guess-feedback";
      var pend = addLine("host", "pending", '<b class="verdict irr">…</b> AI 汤主正在判断你的推理', "AI");
      var book = function (lvl, note) {
        fb.textContent = note;
        fb.className = "guess-feedback " + (lvl === "solved" ? "ok" : (lvl === "close" || lvl === "vague") ? "close" : "no");
      };

      AI.judgeGuess(p, text).then(function (out) {
        if (pend && pend.parentNode) pend.parentNode.removeChild(pend);
        if (state.pid !== p.id || state.done) return;
        book(out.level, out.note);
        state.history.push({ q: "【推理】" + text, a: out.note });
        if (out.level === "solved") {
          var ln = addLine("host", "yes", '<b class="verdict yes">对了</b> ' + esc(out.note), "AI 判定");
          sfx("win");
          if (FX) {
            if (ln) FX.burstAt(ln, { count: 40, power: 1.3, colors: ["#e2a44f", "#f6cf90", "#68cf9a", "#ffe9c4"] });
            FX.burst(window.innerWidth / 2, window.innerHeight * 0.34, { count: 70, power: 1.7 });
          }
          setTimeout(function () { finish(); }, 520);
        } else {
          addLine("host", out.level === "close" ? "partial" : "irr", esc(out.note), "AI 判定");
          sfx(out.level === "close" ? "partial" : "lose");
          renderStats();
        }
        paintAiBar();
      }, function (err) {
        if (pend && pend.parentNode) pend.parentNode.removeChild(pend);
        if (state.pid !== p.id || state.done) return;
        var why = AI.describeError(err);
        /* 掉线：不显示任何关键词判定，只提示重试，也不计入历史 */
        state.qCount = Math.max(0, state.qCount - 1);
        fb.textContent = "AI 汤主掉线了，请重新提交推理。";
        fb.className = "guess-feedback no";
        paintAiBar("AI 没接上（" + why + "）。", "ai-warn");
        toast("AI 掉线了：" + why);
        renderStats();
      });
      return;
    }

    /* 没接 AI：本项目不接关键词汤主，拒绝受理而不是外显死板回复 */
    state.qCount = Math.max(0, state.qCount - 1);
    fb.textContent = "AI 汤主掉线了，请重新提交推理。";
    fb.className = "guess-feedback no";
    renderStats();
  }

  function finish(fallbackStars) {
    var p = E.getPuzzle(state.pid);
    if (!p) return;
    var lib = isLib(p);
    state.done = true;
    /* 两层快照各清各的，绝不互删 */
    if (lib) {
      var lp = libProgress();
      lp.session = null;
      saveLibProgress(lp);
    } else {
      progress.session = null;
    }
    closeModal("#modal-guess");

    /* 阶段 1：跨局存档已砍。星级只做本锅的当场结算，不写回任何存档 */
    var st = typeof fallbackStars === "number" ? fallbackStars : E.stars(p, state.qCount, state.hintsUsed);

    /* 1 星（提示用光 / 熬太久）走「汤凉了」的灰调场景：sad 与 bg-gate 不再是死资源 */
    setScene(st <= 1 ? "sad" : "win");
    sfx("reveal");
    if (FX) {
      FX.surge(5);
      FX.burst(window.innerWidth / 2, window.innerHeight * 0.3, { count: 80, power: 1.6 });
    }

    set("#end-stars", new Array(st + 1).join("★") + new Array(4 - st).join("☆"));
    set("#end-note", "提问 " + state.qCount + " 次 · 提示 " + state.hintsUsed + " 次 —— " + E.starNote(st));

    /* 汤底：库层的汤底只在服务端，凭「已揭晓的房号」取；精品层仍走本地。
       取不到（掉线 / 未揭晓 / 这一锅本来就无底）就老实说不显示，绝不瞎编。 */
    var meta =
      '<p style="margin:0;color:#a97b38;font-size:12.5px;letter-spacing:.1em;">汤底（真相）' +
      (p.original ? " · AI原创汤面和汤底" : "") +
      (p.truthSource === "ai" ? " · AI根据汤面编汤底" : "") +
      (p.truthSource === "recovered" ? " · 已补底" : "") +
      "</p>";
    var body = p.truth
      ? meta + '<p style="margin:0">' + esc(p.truth) + "</p>"
      : meta + '<p style="margin:0;color:#8a8a8a">（这一锅的汤底还在熬…）</p>';
    $("#end-truth").innerHTML = body;

    /* 库题：异步向服务端要汤底，拿到再补上 */
    if (isLib(p)) fetchLibTruth(p).then(function (t) {
      if (!t || state.pid !== p.id) return;
      var el = $("#end-truth");
      if (el) el.innerHTML = meta + '<p style="margin:0">' + esc(t) + "</p>";
    });

    openModal("#modal-end", "#btn-next");
    renderStats();
    renderQaLog();
    paintResume();
    renderTip("这锅熬完了。换一道汤，试试不同的味道？");
  }

  /* 汤底只在服务端：库题向 Worker 要，要不到就返回空串（不报错、不瞎编） */
  function fetchLibTruth(p) {
    if (!p || !isLib(p)) return Promise.resolve("");
    var net = window.SoupNet;
    if (!net || !net.libTruth) return Promise.resolve("");
    /* 先试库层自己的单人房；没有就试多人房号（多人房里熬完也算揭晓） */
    var codes = [];
    try {
      var ls = localStorage.getItem(LIB_KEY);
      var o = ls ? JSON.parse(ls) : null;
      if (o && o.roomCode) codes.push(o.roomCode);
    } catch (e) { /* 忽略 */ }
    if (state.roomCode) codes.push(state.roomCode);
    if (net.me && net.me.roomCode) codes.push(net.me.roomCode);
    if (!codes.length) return Promise.resolve("");

    var i = 0;
    function attempt() {
      if (i >= codes.length) return Promise.resolve("");
      var c = codes[i++];
      return net.libTruth(c, p.id).then(function (t) {
        return t ? t : attempt();
      });
    }
    return attempt().catch(function () { return ""; });
  }

  function nextPuzzle() {
    /* 库题继续从库里抽，精品题继续从精品层抽 */
    var lib = isLibPid(state.pid);
    var nxt = lib
      ? E.drawFromLibrary(LIB, { hasTruth: true })
      : E.drawFrom(PUZZLES);
    closeModal("#modal-end");
    if (nxt) loadPuzzle(nxt.id);
  }

  function backToList() {
    closeModal("#modal-end");
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
      var cats = ["全部"].concat(E.allCats(PUZZLES));
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

    var total = E.poolSize({ cat: state.randCat, difficulty: state.randDiff });
    var poolEl = $("#rand-pool");
    if (poolEl) {
      poolEl.textContent = total === 0
        ? "这个条件下暂时没有汤，换个题材或火候试试"
        : total + " 道可选";
    }
    var go = $("#btn-rand-go");
    if (go) go.disabled = total === 0;
  }

  /* 从「多人汤屋」切走时：收起房间面板 + 停掉房间轮询，
     免得房间界面和汤库 / 随机模式叠在一起 */
  function leaveRoomScreen() {
    var sr = $("#screen-room");
    if (sr && !sr.classList.contains("hidden")) {
      if (window.SoupRoom && window.SoupRoom.leaveScreen) window.SoupRoom.leaveScreen();
      else sr.classList.add("hidden");
    }
    document.body.classList.remove("room-mode");
  }

  function openRandom() {
    setScene("menu");
    leaveRoomScreen();
    $("#screen-intro").classList.add("hidden");
    $("#screen-game").classList.add("hidden");
    $("#screen-random").classList.remove("hidden");
    renderRandom();
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
    var p = E.randomFrom(randOpts());
    if (!p) { toast("这个条件下暂时没有可抽的汤，放宽一点试试"); return; }
    toast("抽到：" + p.title);
    loadPuzzle(p.id);
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

  /* 来源短名：github:owner/repo → owner，免得筛选条被长串撑爆 */
  function libShortSrc(s) {
    var v = String(s || "");
    if (!v) return "未知";
    if (v.indexOf("github:") === 0) return v.slice(7).split("/")[0] || v;
    return v;
  }

  function libraryFiltered() {
    var list = E.searchLibrary(LIB, libState.kw);
    return E.libraryPool(list, {
      cat: libState.cat,
      difficulty: libState.difficulty,
      src: libState.src,
      hasTruth: libState.hasTruth,
      lang: libState.en ? "en" : ""
    });
  }

  function libSrcList() {
    var seen = {}, out = [];
    LIB.forEach(function (p) {
      if (p && p.src && !seen[p.src]) { seen[p.src] = 1; out.push(p.src); }
    });
    out.sort();
    return out;
  }

  function renderLibraryFilters() {
    var cbox = $("#lib-cat");
    if (cbox) {
      var cats = ["全部"].concat(E.libraryCats(LIB));
      cbox.innerHTML = cats.map(function (c) {
        return '<button type="button" class="chip cat' + (c === libState.cat ? " on" : "") +
          '" data-cat="' + esc(c) + '">' + esc(c) + "</button>";
      }).join("");
      $$(".chip", cbox).forEach(function (btn) {
        btn.addEventListener("click", function () {
          libState.cat = btn.dataset.cat;
          libState.page = 1;
          sfx("ui");
          renderLibraryFilters();
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
          renderLibraryFilters();
          renderLibrary();
        });
      });
    }

    var sbox = $("#lib-src");
    if (sbox) {
      var srcs = ["全部"].concat(libSrcList());
      sbox.innerHTML = srcs.map(function (s) {
        return '<button type="button" class="chip' + (s === libState.src ? " on" : "") +
          '" data-src="' + esc(s) + '" title="' + esc(s) + '">' + esc(libShortSrc(s)) + "</button>";
      }).join("");
      $$(".chip", sbox).forEach(function (btn) {
        btn.addEventListener("click", function () {
          libState.src = btn.dataset.src;
          libState.page = 1;
          sfx("ui");
          renderLibraryFilters();
          renderLibrary();
        });
      });
    }
  }

  /* 分页渲染：1374 条全量 innerHTML 会把移动端拖卡，必须切片 */
  function renderLibrary() {
    var box = $("#lib-list");
    if (!box) return;
    var list = libraryFiltered();
    var show = list.slice(0, libState.page * LIB_PAGE_SIZE);

    if (!list.length) {
      box.innerHTML = '<p class="pz-empty">这个组合下暂时没有汤。<br />换个题材或来源试试。</p>';
    } else {
      box.innerHTML = show.map(function (p) {
        return '<button type="button" role="listitem" class="pz-card lib-card" data-lib-id="' + esc(p.id) +
          '" aria-label="' + esc(p.dispTitle) + '，难度' + p.difficulty + '">' +
          '<div class="pz-title">' + esc(p.dispTitle) + "</div>" +
          '<div class="pz-meta"><span class="pz-diff" aria-hidden="true">' + libDiffDots(p.difficulty) + "</span>" +
          "<span>" + esc(libShortSrc(p.src)) + "</span>" +
          (p.mode === "surface" ? '<span class="lib-notruth">无汤底</span>' : "") +
          (p.truthSource === "ai" ? '<span class="lib-notruth">AI编底</span>' : "") +
          (p.truthSource === "recovered" ? '<span class="lib-notruth">已补底</span>' : "") +
          "</div>" +
          '<div class="pz-cats">' + (p.cats || []).map(function (c) {
            return '<span class="pz-cat">' + esc(c) + "</span>";
          }).join("") + "</div>" +
          "</button>";
      }).join("");
      $$(".pz-card", box).forEach(function (card) {
        card.addEventListener("click", function () { loadPuzzle(card.dataset.libId); });
      });
    }

    var badge = $("#lib-count");
    if (badge) badge.textContent = show.length + " / " + list.length;
    var more = $("#btn-lib-more");
    if (more) more.classList.toggle("hidden", show.length >= list.length);
  }

  function openLibrary() {
    setScene("menu");
    leaveRoomScreen();
    $("#screen-intro").classList.add("hidden");
    $("#screen-game").classList.add("hidden");
    var r = $("#screen-random");
    if (r) r.classList.add("hidden");
    $("#screen-library").classList.remove("hidden");
    renderLibraryFilters();
    renderLibrary();
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
    if (randBtn) randBtn.addEventListener("click", function () { var r = E.randomPuzzle(null); if (r) loadPuzzle(r.id); });

    var topRand = $("#btn-random");
    if (topRand) topRand.addEventListener("click", function () {
      var r = E.drawFrom(PUZZLES);
      if (r) { loadPuzzle(r.id); toast("随机一锅：" + r.title); }
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

    /* 中区问答记录：清空本局记录（汤库入口由顶栏 📚 汤库 统一提供） */
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

    /* 搜索防抖 200ms：1361 条逐键全量过滤会卡手 */
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

    var libTruth = $("#lib-truth-only");
    if (libTruth) libTruth.addEventListener("click", function () {
      libState.hasTruth = !libState.hasTruth;
      libState.page = 1;
      libTruth.classList.toggle("on", libState.hasTruth);
      libTruth.setAttribute("aria-pressed", libState.hasTruth ? "true" : "false");
      sfx("ui");
      renderLibrary();
    });

    var libEn = $("#lib-en");
    if (libEn) libEn.addEventListener("click", function () {
      libState.en = !libState.en;
      libState.page = 1;
      libEn.classList.toggle("on", libState.en);
      libEn.setAttribute("aria-pressed", libState.en ? "true" : "false");
      sfx("ui");
      renderLibrary();
    });

    /* 音效开关 */
    var snd = $("#btn-sound");
    if (snd) {
      var paintSnd = function () {
        snd.textContent = state.sound ? "🔊 音效" : "🔇 静音";
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

    /* 音量 */
    var vol = $("#vol");
    if (vol) vol.addEventListener("input", function () { setVolume(Number(vol.value) / 100); });

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

    var hintBtn = $("#btn-hint");
    if (hintBtn) hintBtn.addEventListener("click", useHint);

    bindAiModal();

    var guessBtn = $("#btn-guess");
    if (guessBtn) guessBtn.addEventListener("click", openGuess);

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
    state.volume = typeof progress.volume === "number" ? progress.volume : 0.6;

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
})();
