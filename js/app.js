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

  var STORE_KEY = "deepsea_soup_v1";

  /* 场景 → 背景图 / 特效场景 / 曲目 */
  var BG = {
    menu: "assets/bg-castle.jpg",
    game: "assets/bg-hall.jpg",
    hall: "assets/bg-hall.jpg",
    win: "assets/bg-dawn.jpg",
    sad: "assets/bg-gate.jpg"
  };
  var TRACK_OF = { menu: "menu", game: "game", hall: "game", win: "win", sad: "sad" };

  var state = {
    pid: null,
    revealed: [],
    asked: {},
    hintsUsed: 0,
    qCount: 0,
    done: false,
    filter: "全部",
    cat: "全部",
    randCat: "全部",
    randDiff: 0,
    randUnsolved: true,
    recent: [],
    history: [],
    aiBusy: false,
    history: [],
    aiBusy: false,
    sound: true,
    music: true,
    playing: true,
    volume: 0.6
  };

  var progress = loadProgress();

  /* ---------------- 存档 ---------------- */

  function loadProgress() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var obj = raw ? JSON.parse(raw) : {};
      if (obj && typeof obj === "object" && obj.puzzles) return obj;
    } catch (e) { /* 隐私模式等：忽略 */ }
    return { puzzles: {}, sound: true, music: true, playing: true, volume: 0.6 };
  }

  function saveProgress() {
    try {
      progress.sound = state.sound;
      progress.music = state.music;
      progress.playing = state.playing;
      progress.volume = state.volume;
      localStorage.setItem(STORE_KEY, JSON.stringify(progress));
    } catch (e) { /* 忽略 */ }
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

  /* ---------------- 渲染：汤单 ---------------- */

  function solvedCount() {
    var n = 0;
    Object.keys(progress.puzzles).forEach(function (k) { if (progress.puzzles[k].solved) n++; });
    return n;
  }

  function renderFilters() {
    var box = $("#filters");
    if (!box) return;
    var tags = ["全部"];
    PUZZLES.forEach(function (p) { if (tags.indexOf(p.tag) === -1) tags.push(p.tag); });
    box.innerHTML = tags.map(function (t) {
      return '<button type="button" class="chip' + (t === state.filter ? " on" : "") + '" data-tag="' + esc(t) + '">' + esc(t) + "</button>";
    }).join("");
    $$(".chip", box).forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.filter = btn.dataset.tag;
        sfx("ui");
        renderFilters();
        renderList();
      });
    });
  }

  /* 题材（细分类）筛选条 */
  function renderCatFilters() {
    var box = $("#cat-filters");
    if (!box) return;
    var cats = ["全部"].concat(E.allCats(PUZZLES));
    box.innerHTML = cats.map(function (c) {
      return '<button type="button" class="chip cat' + (c === state.cat ? " on" : "") + '" data-cat="' + esc(c) + '">' + esc(c) + "</button>";
    }).join("");
    $$(".chip", box).forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.cat = btn.dataset.cat;
        sfx("ui");
        renderCatFilters();
        renderList();
      });
    });
  }

  /* 汤单当前的筛选结果（大类标签 + 题材标签） */
  function listFiltered() {
    return PUZZLES.filter(function (p) {
      return (state.filter === "全部" || p.tag === state.filter) && E.hasCat(p, state.cat);
    });
  }

  function renderList() {
    var box = $("#puzzle-list");
    if (!box) return;
    var list = listFiltered();
    if (!list.length) {
      box.innerHTML = '<p class="pz-empty">这个组合下暂时没有汤。<br />换个大类或题材试试。</p>';
      var b0 = $("#count-solved");
      if (b0) b0.textContent = solvedCount() + "/" + PUZZLES.length;
      return;
    }
    box.innerHTML = list.map(function (p) {
      var rec = progress.puzzles[p.id];
      var diff = new Array(p.difficulty + 1).join("●") + new Array(3 - p.difficulty + 1).join("○");
      var starTxt = rec && rec.solved
        ? new Array(rec.stars + 1).join("★") + new Array(4 - rec.stars).join("☆")
        : "未解";
      return '<button type="button" role="listitem" class="pz-card' +
        (p.id === state.pid ? " active" : "") +
        (p.original ? " original" : "") +
        (rec && rec.solved ? " solved" : "") +
        '" data-id="' + esc(p.id) + '" aria-label="' + esc(p.title) + '，难度' + p.difficulty + '，' + (rec && rec.solved ? "已破解" : "未破解") + '">' +
        '<div class="pz-title">' + esc(p.title) + "</div>" +
        '<div class="pz-meta"><span class="pz-diff" aria-hidden="true">' + diff + "</span>" +
        "<span>" + esc(p.tag) + "</span>" +
        "<span>" + (rec && rec.solved ? '<span class="pz-stars">' + starTxt + "</span>" : "<span>未解</span>") + "</span>" +
        (p.original ? '<span class="pz-orig">翔太原创</span>' : "") +
        (rec && rec.solved && rec.bestQ ? '<span class="pz-best">最少 ' + rec.bestQ + " 问 / " + (rec.bestHints || 0) + " 提示</span>" : "") +
        "</div>" +
        '<div class="pz-cats">' + E.catsOf(p).map(function (c) { return '<span class="pz-cat">' + esc(c) + "</span>"; }).join("") + "</div>" +
        "</button>";
    }).join("");
    $$(".pz-card", box).forEach(function (card) {
      card.addEventListener("click", function () { loadPuzzle(card.dataset.id); });
    });
    var badge = $("#count-solved");
    if (badge) badge.textContent = solvedCount() + "/" + PUZZLES.length;
  }

  /* ---------------- 渲染：对局 ---------------- */

  function renderStats() {
    var p = E.getPuzzle(state.pid);
    if (!p) return;
    var s = state;
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

  function loadPuzzle(id) {
    var p = E.getPuzzle(id);
    if (!p) return;
    sceneWipe(function () {
      state.pid = id;
      state.revealed = [];
      state.asked = {};
      state.hintsUsed = 0;
      state.qCount = 0;
      state.done = false;
      state.history = [];
      state.aiBusy = false;

      $("#screen-intro").classList.add("hidden");
      var rs = $("#screen-random");
      if (rs) rs.classList.add("hidden");
      var gs = $("#screen-game");
      gs.classList.remove("hidden");
      /* 重放入场动画，让切题更“有戏” */
      gs.style.animation = "none";
      void gs.offsetWidth;
      gs.style.animation = "";
      setScene("game");

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
      typeSurface(p.surface);

      clearLog();
      sysLine("（锅盖揭开，热气涌上来）汤主问你：这一锅，你看出了什么？");
      renderClues();
      renderStats();
      renderList();
      renderTip(aiOn()
        ? "AI 汤主已经读过这一锅的汤面汤底，用你自己的话问就好。"
        : "随便问点什么吧。关键词越准，汤主掀开的那一层越厚。");
      paintAiBar();

      var input = $("#q-input");
      if (input) { input.value = ""; if (window.innerWidth > 860) input.focus(); }
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

    var key = E.normalize(raw);

    addLine("me", "", esc(raw), "你的提问");
    sfx("paper");

    if (state.asked[key]) {
      addLine("host", "sys", esc("这个问题刚才问过了，汤主不重复回答。"));
      input.value = "";
      return;
    }
    state.asked[key] = 1;
    state.qCount++;

    var res = E.ask(p, raw, state.revealed);

    if (aiOn() && res.kind !== "meta") {
      /* AI 模式：认领哪条线索由模型理解后决定（用自己的话也能挖到线索）；
         它认不出来时才退回关键词的判定，保证进度不会白费 */
      askAi(p, raw, res);
    } else {
      pushReveal(res);
      renderKeywordAnswer(res);
    }

    input.value = "";
    renderStats();
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
    } else {
      var l2 = addLine("host", "irr",
        (res.flavor ? esc(res.flavor) + "<br />" : "") +
        '<b class="verdict irr">与此无关</b> ' + esc(res.reply));
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
    return state.revealed.slice().sort(function (a, b) { return a - b; }).map(function (i) {
      return (i + 1) + ". " + E.stripLead(p.clues[i].text);
    });
  }

  /* AI 认领线索 → 入账（返回是否真的新增了一条） */
  function claimClue(p, n) {
    var idx = parseInt(n, 10);
    if (!isFinite(idx) || idx <= 0 || idx > p.clues.length) return false;
    idx -= 1;
    if (state.revealed.indexOf(idx) !== -1) return false;
    state.revealed.push(idx);
    renderClues();
    renderStats();
    toast("挖到新线索：" + E.stripLead(p.clues[idx].text).slice(0, 14) + "…");
    return true;
  }

  function askAi(p, raw, res) {
    if (state.aiBusy) { addLine("host", "sys", esc("汤主还在想上一句，稍等一下下。")); return; }
    state.aiBusy = true;

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
      paintAiBar("AI 没接上（" + why + "），这一句由关键词汤主来答。", "ai-warn");
      var had = res.kind === "clue" && state.revealed.indexOf(res.index) === -1;
      pushReveal(fallback);
      renderKeywordAnswer(fallback, true);
      if (had) renderClues();
      renderStats();
      toast("AI 掉线了：" + why);
    });
  }

  /* 「问问 AI」：让模型基于已挖线索补一句方向 */
  function askAiHint() {
    var p = E.getPuzzle(state.pid);
    if (!p || state.done) return;
    if (!aiOn()) { toast("先点上方的 🤖 AI 汤主 配好模型，才能问它"); openAiModal(); return; }
    if (state.hintsUsed >= p.hints.length) { toast("提示已经全给你了，接下来靠自己啦"); return; }
    var text = p.hints[state.hintsUsed];
    state.hintsUsed++;
    addLine("host", "hint", "<b>提示 " + state.hintsUsed + "</b> · " + esc(text), "提示 -1 星");
    renderStats();
    sfx("hint");
    if (!aiOn()) return;
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
    if (note) note.textContent = pre.note || "";
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
    if (state.hintsUsed >= p.hints.length) { toast("提示已经全给你了，接下来靠自己啦"); return; }
    var text = p.hints[state.hintsUsed];
    state.hintsUsed++;
    addLine("host", "hint", "<b>提示 " + state.hintsUsed + "</b> · " + esc(text), "提示 -1 星");
    renderStats();
    sfx("hint");
  }

  /* ---------------- 猜汤底 ---------------- */

  var lastFocus = null;

  function openModal(sel, focusSel) {
    lastFocus = document.activeElement;
    var m = $(sel);
    if (!m) return;
    m.classList.remove("hidden");
    var f = focusSel ? $(focusSel) : null;
    if (f) setTimeout(function () { f.focus(); }, 30);
  }

  function closeModal(sel) {
    var m = $(sel);
    if (m) m.classList.add("hidden");
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

    addLine("me", "", esc(text), "我的推理");
    sfx("paper");
    state.qCount++;

    var j = E.judgeGuess(p, text);

    if (aiOn()) {
      /* 关键词判定先给个底线，AI 回来后再用更准的结论覆盖 */
      var pend = addLine("host", "pending", '<b class="verdict irr">…</b> 汤主正在读你的推理', "AI");
      var first = true;
      var book = function (lvl, note) {
        fb.textContent = note;
        fb.className = "guess-feedback " + (lvl === "solved" ? "ok" : (lvl === "close" || lvl === "vague") ? "close" : "no");
      };
      book(j.level, j.note);

      AI.judgeGuess(p, text).then(function (out) {
        if (pend && pend.parentNode) pend.parentNode.removeChild(pend);
        if (state.pid !== p.id || state.done) return;
        first = false;
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
        paintAiBar("AI 没接上（" + why + "），这一回由关键词汤主判定。", "ai-warn");
        toast("AI 掉线了：" + why);
        if (first) {
          /* 上面的底线已经写过反馈了，这里只需要补一行对话 */
          if (j.level === "solved") { addLine("host", "yes", '<b class="verdict yes">对了</b> ' + esc(j.note)); sfx("win"); setTimeout(function () { finish(); }, 520); }
          else { addLine("host", j.level === "close" ? "partial" : "irr", esc(j.note)); sfx(j.level === "close" ? "partial" : "lose"); renderStats(); }
        }
      });
      return;
    }

    fb.textContent = j.note;
    fb.className = "guess-feedback " + (j.level === "solved" ? "ok" : j.level === "close" ? "close" : "no");

    if (j.level === "solved") {
      var line = addLine("host", "yes", '<b class="verdict yes">对了</b> ' + esc(j.note));
      sfx("win");
      if (FX) {
        if (line) FX.burstAt(line, { count: 40, power: 1.3, colors: ["#e2a44f", "#f6cf90", "#68cf9a", "#ffe9c4"] });
        FX.burst(window.innerWidth / 2, window.innerHeight * 0.34, { count: 70, power: 1.7 });
      }
      setTimeout(function () { finish(); }, 520);
    } else {
      addLine("host", j.level === "close" ? "partial" : "irr", esc(j.note));
      sfx(j.level === "close" ? "partial" : "lose");
      renderStats();
    }
  }

  function finish(fallbackStars) {
    var p = E.getPuzzle(state.pid);
    if (!p) return;
    state.done = true;
    closeModal("#modal-guess");

    var st = typeof fallbackStars === "number" ? fallbackStars : E.stars(p, state.qCount, state.hintsUsed);
    var rec = progress.puzzles[p.id] || { solved: false, stars: 0 };
    /* 成绩更好才覆盖：先看星级，再看提问数，最后看提示数 */
    var better = !rec.solved ||
      st > rec.stars ||
      (st === rec.stars && state.qCount < (rec.bestQ || Infinity)) ||
      (st === rec.stars && state.qCount === rec.bestQ && state.hintsUsed < (rec.bestHints == null ? Infinity : rec.bestHints));
    if (better) {
      progress.puzzles[p.id] = {
        solved: true,
        stars: st,
        bestQ: state.qCount,
        bestHints: state.hintsUsed
      };
    }
    saveProgress();

    setScene("win");
    sfx("reveal");
    if (FX) {
      FX.surge(5);
      FX.burst(window.innerWidth / 2, window.innerHeight * 0.3, { count: 80, power: 1.6 });
    }

    set("#end-stars", new Array(st + 1).join("★") + new Array(4 - st).join("☆"));
    set("#end-note", "提问 " + state.qCount + " 次 · 提示 " + state.hintsUsed + " 次 —— " + E.starNote(st));
    $("#end-truth").innerHTML =
      '<p style="margin:0 0 8px;color:#a97b38;font-size:12.5px;letter-spacing:.1em;">汤底（真相）' +
      (p.original ? " · 翔太原创" : "") + "</p>" +
      "<p style=\"margin:0\">" + esc(p.truth) + "</p>";

    openModal("#modal-end", "#btn-next");
    renderStats();
    renderList();
    renderTip("这锅熬完了。换一道汤，试试不同的味道？");
  }

  function nextPuzzle() {
    var ex = state.recent ? state.recent.slice() : [];
    if (state.pid) ex.push(state.pid);
    var nxt = E.drawFrom(PUZZLES, ex);
    closeModal("#modal-end");
    if (nxt) { rememberRecent(nxt.id); loadPuzzle(nxt.id); }
  }

  function backToList() {
    closeModal("#modal-end");
    sceneWipe(function () {
      $("#screen-game").classList.add("hidden");
      $("#screen-random").classList.add("hidden");
      $("#screen-intro").classList.remove("hidden");
      state.pid = null;
      setScene("menu");
      renderList();
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
      difficulty: state.randDiff,
      unsolvedOnly: state.randUnsolved,
      solvedMap: progress.puzzles
    };
  }

  function rememberRecent(id) {
    if (!state.recent) state.recent = [];
    state.recent = state.recent.filter(function (x) { return x !== id; });
    state.recent.push(id);
    var cap = Math.min(10, Math.max(1, PUZZLES.length - 1));
    while (state.recent.length > cap) state.recent.shift();
  }

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

    var un = $("#rand-unsolved");
    if (un) {
      un.classList.toggle("on", state.randUnsolved);
      un.setAttribute("aria-pressed", state.randUnsolved ? "true" : "false");
      un.textContent = state.randUnsolved ? "只抽还没熬过的" : "已熬过的也可以抽";
    }

    var left = E.poolSize(randOpts());
    var total = E.poolSize({ cat: state.randCat, difficulty: state.randDiff });
    var poolEl = $("#rand-pool");
    if (poolEl) {
      poolEl.textContent = total === 0
        ? "这个条件下暂时没有汤，换个题材或火候试试"
        : left === 0
          ? "同条件的 " + total + " 道都熬完了，抽的时候会随机重温一道"
          : left + " 道可选" + (left < total ? "（同条件共 " + total + " 道）" : "");
    }
    var go = $("#btn-rand-go");
    if (go) go.disabled = total === 0;
  }

  function openRandom() {
    setScene("menu");
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
    renderList();
    sfx("ui");
  }

  function drawRandom() {
    var p = E.randomFrom(randOpts(), state.recent);
    if (!p) { toast("这个条件下暂时没有可抽的汤，放宽一点试试"); return; }
    rememberRecent(p.id);
    toast("抽到：" + p.title);
    loadPuzzle(p.id);
  }

  /* ---------------- 事件绑定 ---------------- */

  function bind() {
    var startBtn = $("#btn-start");
    if (startBtn) startBtn.addEventListener("click", function () {
      var first = PUZZLES.filter(function (p) { return !(progress.puzzles[p.id] && progress.puzzles[p.id].solved); })[0] || PUZZLES[0];
      loadPuzzle(first.id);
    });

    var randBtn = $("#btn-start-random");
    if (randBtn) randBtn.addEventListener("click", function () { var r = E.randomPuzzle(null); if (r) loadPuzzle(r.id); });

    var dailyBtn = $("#btn-daily");
    if (dailyBtn) dailyBtn.addEventListener("click", function () {
      var d = E.dailyPuzzle(new Date());
      if (d) { loadPuzzle(d.id); toast("今日汤：" + d.title); }
    });

    var topRand = $("#btn-random");
    if (topRand) topRand.addEventListener("click", function () {
      var r = E.drawFrom(PUZZLES, state.recent);
      if (r) { rememberRecent(r.id); loadPuzzle(r.id); toast("随机一锅：" + r.title); }
    });

    /* 随机模式：按题材 / 火候 / 是否熬过 抽题 */
    var rmBtn = $("#btn-random-mode");
    if (rmBtn) rmBtn.addEventListener("click", openRandom);

    var rGo = $("#btn-rand-go");
    if (rGo) rGo.addEventListener("click", drawRandom);

    var rBack = $("#btn-rand-back");
    if (rBack) rBack.addEventListener("click", backFromRandom);

    var rUn = $("#rand-unsolved");
    if (rUn) rUn.addEventListener("click", function () {
      state.randUnsolved = !state.randUnsolved;
      sfx("ui");
      renderRandom();
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
    });

    var wipe = $("#btn-wipe");
    if (wipe) wipe.addEventListener("click", function () {
      if (!window.confirm("清空所有破解记录和星级？这一步不可撤销。")) return;
      progress = { puzzles: {}, sound: state.sound, music: state.music, playing: state.playing, volume: state.volume };
      saveProgress();
      renderList();
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

    /* 打雷时轻微震动，增强临场感 */
    window.addEventListener("soup:lightning", function () {
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
    state.volume = typeof progress.volume === "number" ? progress.volume : 0.6;

    if (FX) FX.init();
    applyAudioSettings();

    renderFilters();
    renderCatFilters();
    renderList();
    renderRandom();
    paintAiBar();
    bind();
    setScene("menu");

    /* 预热：背景图 + 曲目，切换时不卡顿 */
    Object.keys(BG).forEach(function (k) {
      var im = new Image();
      im.src = BG[k];
    });
    if (AU) AU.preload(["menu", "game"]);

    var badge = $("#count-solved");
    if (badge) badge.textContent = solvedCount() + "/" + PUZZLES.length;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
