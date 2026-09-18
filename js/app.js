/* ============================================================
 * 深海汤屋 · 主逻辑
 * ============================================================ */
"use strict";

(function () {
  var E = window.SoupEngine;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };

  var STORE_KEY = "deepsea_soup_v1";

  var state = {
    pid: null,
    revealed: [],
    asked: {},
    hintsUsed: 0,
    qCount: 0,
    done: false,
    filter: "全部",
    sound: true
  };

  var progress = loadProgress();

  /* ---------------- 存档 ---------------- */

  function loadProgress() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var obj = raw ? JSON.parse(raw) : {};
      if (obj && typeof obj === "object" && obj.puzzles) return obj;
    } catch (e) { /* 隐私模式等：忽略 */ }
    return { puzzles: {}, sound: true };
  }

  function saveProgress() {
    try {
      progress.sound = state.sound;
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

  /* ---------------- 音效 ---------------- */

  var audioCtx = null;
  function beep(freq, dur, type) {
    if (!state.sound) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      var o = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      o.type = type || "sine";
      o.frequency.value = freq;
      g.gain.value = 0.05;
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
      o.connect(g).connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + dur);
    } catch (e) { /* 忽略 */ }
  }
  var SFX = {
    yes: function () { beep(660, 0.16); },
    no: function () { beep(200, 0.2, "triangle"); },
    partial: function () { beep(440, 0.16); },
    irr: function () { beep(150, 0.14, "triangle"); },
    win: function () { beep(523, 0.14); setTimeout(function () { beep(659, 0.14); }, 130); setTimeout(function () { beep(784, 0.22); }, 260); },
    pick: function () { beep(320, 0.08); }
  };

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
        renderFilters();
        renderList();
      });
    });
  }

  function renderList() {
    var box = $("#puzzle-list");
    if (!box) return;
    var list = PUZZLES.filter(function (p) { return state.filter === "全部" || p.tag === state.filter; });
    box.innerHTML = list.map(function (p) {
      var rec = progress.puzzles[p.id];
      var diff = new Array(p.difficulty + 1).join("●") + new Array(3 - p.difficulty + 1).join("○");
      var starTxt = rec && rec.solved
        ? new Array(rec.stars + 1).join("★") + new Array(4 - rec.stars).join("☆")
        : "未解";
      return '<button type="button" role="listitem" class="pz-card' +
        (p.id === state.pid ? " active" : "") +
        (rec && rec.solved ? " solved" : "") +
        '" data-id="' + esc(p.id) + '" aria-label="' + esc(p.title) + '，难度' + p.difficulty + '，' + (rec && rec.solved ? "已破解" : "未破解") + '">' +
        '<div class="pz-title">' + esc(p.title) + "</div>" +
        '<div class="pz-meta"><span class="pz-diff" aria-hidden="true">' + diff + "</span>" +
        "<span>" + esc(p.tag) + "</span>" +
        "<span>" + (rec && rec.solved ? '<span class="pz-stars">' + starTxt + "</span>" : "<span>未解</span>") + "</span>" +
        (rec && rec.solved && rec.bestQ ? '<span class="pz-best">最少 ' + rec.bestQ + " 问 / " + (rec.bestHints || 0) + " 提示</span>" : "") +
        "</div></button>";
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
    if (!log) return;
    var wrap = document.createElement("div");
    wrap.className = "line " + side + (tone ? " " + tone : "");
    wrap.innerHTML = '<span class="say">' + html + "</span>" +
      (meta ? '<span class="tone">' + esc(meta) + "</span>" : "");
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
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
    state.pid = id;
    state.revealed = [];
    state.asked = {};
    state.hintsUsed = 0;
    state.qCount = 0;
    state.done = false;

    $("#screen-intro").classList.add("hidden");
    $("#screen-game").classList.remove("hidden");
    set("#p-title", p.title);
    set("#p-tag", p.tag);
    set("#p-diff", new Array(p.difficulty + 1).join("●") + new Array(3 - p.difficulty + 1).join("○") + " 难度");
    $("#p-surface").textContent = p.surface;

    clearLog();
    sysLine("（锅盖揭开，热气涌上来）汤主问你：这一锅，你看出了什么？");
    renderClues();
    renderStats();
    renderList();
    renderTip("随便问点什么吧。关键词越准，汤主掀开的那一层越厚。");

    var input = $("#q-input");
    if (input) { input.value = ""; if (window.innerWidth > 860) input.focus(); }
    SFX.pick();
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

    if (state.asked[key]) {
      addLine("host", "sys", esc("这个问题刚才问过了，汤主不重复回答。"));
      input.value = "";
      return;
    }
    state.asked[key] = 1;
    state.qCount++;

    var res = E.ask(p, raw, state.revealed);

    if (res.kind === "clue") {
      state.revealed.push(res.index);
      var tone = res.verdict;
      addLine("host", tone,
        (res.flavor ? esc(res.flavor) + "<br />" : "") +
        '<b class="verdict ' + esc(tone) + '">' + esc(VERDICT_TEXT[tone] || "线索") + "</b> " + esc(res.reply),
        "线索 " + (res.index + 1) + " +1");
      SFX[tone] ? SFX[tone]() : SFX.yes();
      renderClues();
      toast("挖到新线索：" + (E.stripLead(res.clue.text).slice(0, 14)) + "…");
    } else if (res.kind === "again") {
      addLine("host", "sys", esc("这条线索你已经挖到过了：") + esc(res.reply));    } else if (res.kind === "meta") {
      addLine("host", "sys", esc(res.reply));
      SFX.irr();
    } else {
      addLine("host", "irr",
        (res.flavor ? esc(res.flavor) + "<br />" : "") +
        '<b class="verdict irr">与此无关</b> ' + esc(res.reply));
      SFX.irr();
    }

    input.value = "";
    renderStats();
    renderTip("汤主的小提醒：把「为什么」「是不是有人」「那是什么」串起来问，比只问一个词有效得多。");
  }

  function useHint() {
    var p = E.getPuzzle(state.pid);
    if (!p || state.done) return;
    if (state.hintsUsed >= p.hints.length) { toast("提示已经全给你了，接下来靠自己啦"); return; }
    var text = p.hints[state.hintsUsed];
    state.hintsUsed++;
    addLine("host", "hint", "<b>提示 " + state.hintsUsed + "</b> · " + esc(text), "提示 -1 星");
    renderStats();
    SFX.partial();
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
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  }

  function openGuess() {
    if (!state.pid || state.done) return;
    var fb = $("#guess-feedback");
    if (fb) { fb.textContent = ""; fb.className = "guess-feedback"; }
    var gi = $("#guess-input");
    if (gi) gi.value = "";
    openModal("#modal-guess", "#guess-input");
  }

  function submitGuess() {
    var p = E.getPuzzle(state.pid);
    var gi = $("#guess-input");
    var fb = $("#guess-feedback");
    if (!p || !gi || !fb) return;
    var text = gi.value.trim();
    if (!text) { fb.textContent = "先写下你的推理，再交给汤主。"; fb.className = "guess-feedback no"; return; }

    addLine("me", "", esc(text), "我的推理");
    state.qCount++;

    var j = E.judgeGuess(p, text);
    fb.textContent = j.note;
    fb.className = "guess-feedback " + (j.level === "solved" ? "ok" : j.level === "close" ? "close" : "no");

    if (j.level === "solved") {
      addLine("host", "yes", '<b class="verdict yes">对了</b> ' + esc(j.note));
      SFX.win();
      setTimeout(finish, 380);
    } else {
      addLine("host", j.level === "close" ? "partial" : "irr", esc(j.note));
      SFX[j.level === "close" ? "partial" : "irr"]();
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

    set("#end-stars", new Array(st + 1).join("★") + new Array(4 - st).join("☆"));
    set("#end-note", "提问 " + state.qCount + " 次 · 提示 " + state.hintsUsed + " 次 —— " + E.starNote(st));
    $("#end-truth").innerHTML =
      '<p style="margin:0 0 8px;color:#a97b38;font-size:12.5px;letter-spacing:.1em;">汤底（真相）</p>' +
      "<p style=\"margin:0\">" + esc(p.truth) + "</p>";

    openModal("#modal-end", "#btn-next");
    renderStats();
    renderList();
    renderTip("这锅熬完了。换一道汤，试试不同的味道？");
  }

  function nextPuzzle() {
    var nxt = E.randomPuzzle(state.pid);
    closeModal("#modal-end");
    if (nxt) loadPuzzle(nxt.id);
  }

  function backToList() {
    closeModal("#modal-end");
    $("#screen-game").classList.add("hidden");
    $("#screen-intro").classList.remove("hidden");
    state.pid = null;
    renderList();
    var l = $("#btn-start");
    if (l) l.focus();
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
    if (topRand) topRand.addEventListener("click", function () { var r = E.randomPuzzle(state.pid); if (r) { loadPuzzle(r.id); toast("随机一锅：" + r.title); } });

    var snd = $("#btn-sound");
    if (snd) {
      state.sound = progress.sound !== false;
      var paint = function () {
        snd.textContent = state.sound ? "🔊 音效" : "🔇 静音";
        snd.setAttribute("aria-pressed", state.sound ? "true" : "false");
      };
      paint();
      snd.addEventListener("click", function () { state.sound = !state.sound; paint(); saveProgress(); if (state.sound) SFX.pick(); });
    }

    var wipe = $("#btn-wipe");
    if (wipe) wipe.addEventListener("click", function () {
      if (!window.confirm("清空所有破解记录和星级？这一步不可撤销。")) return;
      progress = { puzzles: {}, sound: state.sound };
      saveProgress();
      renderList();
      renderStats();
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

    window.addEventListener("pagehide", saveProgress);
    document.addEventListener("visibilitychange", function () { if (document.hidden) saveProgress(); });
  }

  /* ---------------- 启动 ---------------- */

  function boot() {
    if (!E || !PUZZLES.length) {
      toast("题库加载失败，请刷新页面");
      return;
    }
    renderFilters();
    renderList();
    bind();
    var badge = $("#count-solved");
    if (badge) badge.textContent = solvedCount() + "/" + PUZZLES.length;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
