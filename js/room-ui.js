/* ============================================================
 * 深海汤屋 · 多人房间前端（纯新增模块）
 * ------------------------------------------------------------
 * 依赖：js/net.js（window.SoupNet）
 * 挂载：<script src="js/room-ui.js" defer></script>（app.js 之后）
 *
 * 规格对齐：
 *   #6  建房 → 房号 → 进房起昵称 → 全员准备 → 随机顺序 → 开玩
 *       ⚠ 昵称框只在「进房那一刻」弹，进项目绝不弹
 *   #7  顺序提问，轮到自己才能问
 *   #8  猜底随时可猜，红/黄冷却，绿揭底
 *   #9  问答历史中区滚动
 *   #14 多人房去掉提示按钮；6 位房号；无密码
 *   #15 下一锅不散房，全员重新准备
 * ============================================================ */

(function (root) {
  "use strict";

  var N = root.SoupNet;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  var VERDICT_TEXT = { yes: "是", no: "不是", partial: "部分正确", irr: "与此无关" };
  var LEAD_TEXT = { yes: "是", no: "不是", partial: "部分正确", irr: "与此无关" };

  var R = {
    inRoom: false,
    snap: null,
    lastQa: 0,
    cooldownTimer: 0,
    toast: function (m) { if (root.SoupAppToast) root.SoupAppToast(m); }
  };

  function me() { return N && N.me ? N.me : { internalId: "", nickname: "", roomCode: "" }; }

  /* Worker 地址：优先用 net.js 里的配置，避免两处硬编码漂移 */
  function baseUrl() {
    if (N && N.baseUrl) return N.baseUrl();
    return "";
  }

  /* ---------------- 屏幕切换 ---------------- */

  function showScreen(id) {
    ["screen-intro", "screen-game", "screen-random", "screen-library", "screen-room"].forEach(function (k) {
      var el = document.getElementById(k);
      if (el) el.classList.toggle("hidden", k !== id);
    });
    if (id === "screen-room") document.body.setAttribute("data-scene", "hall");
    document.body.classList.toggle("room-mode", id === "screen-room");
  }

  function showEntry() {
    R.inRoom = false;
    var e = $("#room-entry"), l = $("#room-live");
    if (e) e.classList.remove("hidden");
    if (l) l.classList.add("hidden");
    showScreen("screen-room");
  }

  function showLive() {
    R.inRoom = true;
    var e = $("#room-entry"), l = $("#room-live");
    if (e) e.classList.add("hidden");
    if (l) l.classList.remove("hidden");
    showScreen("screen-room");
  }

  /* ---------------- 昵称框：只在进房那一刻弹 ---------------- */

  function askNickname() {
    if (!N || !N.promptNickname) return Promise.resolve(me().nickname || "汤客");
    return N.promptNickname({ title: "起个昵称，进汤屋", sub: "昵称最长 12 个字，可以重复。" });
  }

  /* ---------------- 建房 / 进房 ---------------- */

  function createRoom() {
    if (!N || !N.available()) { R.toast("联机服务还没配置好"); return; }
    askNickname().then(function (nick) {
      R.toast("正在开一间新汤屋…");
      return N.createRoom(nick);
    }).then(function (snap) {
      showLive();
      R.toast("汤屋开好了：房间号 " + (snap.roomCode || me().roomCode));
      startWatch();
    }).catch(function (e) {
      var m = String((e && e.message) || e);
      if (m !== "CANCELLED") R.toast("建房失败：" + m);
    });
  }

  function joinRoom() {
    if (!N || !N.available()) { R.toast("联机服务还没配置好"); return; }
    var codeEl = $("#room-join-code");
    var code = (codeEl ? codeEl.value : "").trim().toUpperCase();
    if (code.length < 4) { R.toast("先填 6 位房号"); return; }
    askNickname().then(function (nick) {
      R.toast("正在进房…");
      return N.joinRoom(code, nick);
    }).then(function (snap) {
      showLive();
      R.toast("已进入 " + (snap.roomCode || code));
      startWatch();
    }).catch(function (e) {
      var m = String((e && e.message) || e);
      if (m === "CANCELLED") return;
      if (m === "ROOM_FULL") R.toast("这间汤屋坐满了（最多 8 人）");
      else if (m === "NICKNAME_REQUIRED") R.toast("昵称不能为空");
      else R.toast("进房失败：" + m);
    });
  }

  function leaveRoom() {
    stopWatch();
    /* 清掉本地房号，刷新后不再自动回房 */
    if (N && N.clearRoom) N.clearRoom();
    showEntry();
    R.toast("已离开房间");
  }

  /* ---------------- 轮询 ---------------- */

  function startWatch() {
    stopWatch();
    if (!N || !N.watch) return;
    N.watch(function (snap) {
      if (snap && snap.error) { R.toast("连接中断：" + snap.error); return; }
      R.snap = snap;
      render(snap);
    });
  }

  function stopWatch() {
    if (N && N.unwatch) N.unwatch();
    if (R.cooldownTimer) { clearInterval(R.cooldownTimer); R.cooldownTimer = 0; }
  }

  /* ---------------- 渲染 ---------------- */

  function render(s) {
    if (!s || !s.exists) return;
    var codeEl = $("#room-code");
    if (codeEl) codeEl.textContent = s.roomCode || "------";

    var mine = null;
    (s.players || []).forEach(function (p) {
      if (p.uid === myUid(s)) mine = p;
    });

    /* 玩家列表 */
    var box = $("#room-players");
    if (box) {
      box.innerHTML = (s.players || []).map(function (p) {
        var tags = [];
        if (p.isHost) tags.push('<span class="room-tag host">房主 #1</span>');
        if (mine && p.uid === mine.uid) tags.push('<span class="room-tag me">我</span>');
        if (s.phase === "playing" && s.turnUid === p.uid) tags.push('<span class="room-tag turn">该他问</span>');
        return '<div class="room-player' + (p.online ? "" : " off") + (mine && p.uid === mine.uid ? " self" : "") + '">' +
          '<span class="rp-uid">#' + p.uid + "</span>" +
          '<span class="rp-name">' + esc(p.nickname) + "</span>" +
          '<span class="rp-state">' + (p.ready ? "已准备" : "未准备") + "</span>" +
          (p.online ? "" : '<span class="rp-off">离线</span>') +
          tags.join("") +
          "</div>";
      }).join("");
    }
    var cnt = $("#room-count");
    if (cnt) cnt.textContent = (s.players || []).length + "/8";

    /* 阶段提示 */
    var ph = $("#room-phase");
    if (ph) ph.textContent = phaseText(s, mine);

    /* 本锅 */
    var pz = $("#room-puzzle");
    if (pz) {
      if (s.puzzle) {
        pz.innerHTML =
          '<div class="room-pz-title">' + esc(s.puzzle.dispTitle || s.puzzle.title) + "</div>" +
          '<p class="room-pz-surface">' + esc(s.puzzle.surface || "") + "</p>" +
          '<p class="room-pz-meta">线索 ' + (s.clueTotal || 0) + " 条 · 火候 " + (s.puzzle.difficulty || "-") + "</p>";
      } else {
        pz.innerHTML = '<p class="empty">房主还没选汤。</p>';
      }
    }

    /* 轮次徽章 */
    var tb = $("#room-turn");
    if (tb) {
      if (s.phase === "playing" && s.turnUid) {
        var who = (s.players || []).filter(function (p) { return p.uid === s.turnUid; })[0];
        tb.textContent = "轮到 #" + s.turnUid + " " + (who ? who.nickname : "");
      } else if (s.phase === "revealed") {
        tb.textContent = "本锅已揭底";
      } else {
        tb.textContent = "—";
      }
    }

    /* 线索板（共享）：渲染到全局右栏 #clue-list / #clue-badge */
    var cl = $("#clue-list");
    var revealed = s.revealed || [];
    var rClues = s.revealedClues || [];
    var total = s.clueTotal || 0;
    var cc = $("#clue-badge");
    if (cc) cc.textContent = revealed.length + "/" + total;
    if (cl) {
      if (!s.puzzleId) {
        cl.innerHTML = '<p class="empty">房主还没选汤。</p>';
      } else if (!rClues.length) {
        cl.innerHTML = '<p class="empty">还没有挖到线索。<br />轮到你时多问「是 / 不是」都能答的问题。</p>';
      } else {
        cl.innerHTML = rClues.map(function (c) {
          return '<div class="room-clue-item ' + esc(c.type || "irr") + '">' +
            '<span class="rc-n">线索 ' + c.n + "</span>" +
            '<span class="rc-t">' + esc(LEAD_TEXT[c.type] || "") + "</span>" +
            '<span class="rc-x">' + esc(c.text) + "</span></div>";
        }).join("");
      }
    }

    /* 汤主的话（右栏下框）：按阶段给一句提示 */
    var tipEl = $("#tip-text");
    if (tipEl) {
      if (s.phase === "lobby") tipEl.textContent = s.puzzleId ? "汤已备好，全员点「我准备好了」就开锅。" : "等房主选一锅汤。";
      else if (s.phase === "playing") {
        var isMyTurn = s.turnUid === myUid(s);
        tipEl.textContent = isMyTurn ? "轮到你了，问一句「是 / 不是」能答的问题。" : "队友正在提问，你可以顺着问答记录想推理。";
      }
      else if (s.phase === "revealed") tipEl.textContent = "汤底已揭晓。房主可以点「下一锅」。";
    }

    /* 问答记录（共享）：渲染到全局左栏 #qa-log / #qa-count */
    renderQa(s);

    /* 输入区状态 */
    var canAsk = s.phase === "playing" && s.turnUid === myUid(s);
    var qi = $("#room-q-input");
    if (qi) {
      qi.disabled = !canAsk;
      qi.placeholder = canAsk ? "轮到你了，向汤主提问…" : "轮到你时才能提问…";
    }
    var ba = $("#btn-room-ask");
    if (ba) ba.disabled = !canAsk;

    /* 准备按钮：lobby 阶段自由切；playing 阶段点了 = 撤回准备回大堂（服务端掀桌） */
    var rb = $("#btn-room-ready");
    if (rb) {
      var mineReady = mine && mine.ready;
      rb.classList.toggle("on", !!mineReady);
      if (s.phase === "playing") {
        rb.textContent = "撤回准备（回大堂）";
        rb.disabled = false;
      } else {
        rb.textContent = mineReady ? "已准备（点一下取消）" : "我准备好了";
        rb.disabled = s.phase !== "lobby";
      }
    }

    /* 房主按钮 */
    var isHost = !!(mine && mine.isHost);
    ["btn-room-choose", "btn-room-next", "btn-room-ai"].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.disabled = !isHost;
    });

    /* 揭底 */
    if (s.phase === "revealed" && s.truth && !R.revealedShown) {
      R.revealedShown = true;
      showReveal(s);
    }
    if (s.phase !== "revealed") R.revealedShown = false;

    paintCooldown(s);
  }

  function myUid(s) {
    if (typeof s.youUid === "number" && s.youUid) return s.youUid;
    var id = me().internalId;
    var out = 0;
    (s.players || []).forEach(function (p) { if (p.internalId === id) out = p.uid; });
    if (!out) {
      var nick = me().nickname;
      var cands = (s.players || []).filter(function (p) { return p.nickname === nick; });
      if (cands.length === 1) out = cands[0].uid;
    }
    return out;
  }

  function phaseText(s, mine) {
    if (s.phase === "lobby") {
      var ready = (s.players || []).filter(function (p) { return p.ready; }).length;
      if (!s.puzzleId) return "房主还没选汤。选好后大家点「我准备好了」。";
      return "已准备 " + ready + "/" + (s.players || []).length + "，全员准备后自动开局。";
    }
    if (s.phase === "playing") {
      var who = (s.players || []).filter(function (p) { return p.uid === s.turnUid; })[0];
      var you = s.turnUid === myUid(s);
      return (you ? "轮到你提问了。" : "轮到 #" + s.turnUid + (who ? " " + who.nickname : "") + " 提问。") +
        "嫌慢可以随时猜汤底。";
    }
    if (s.phase === "revealed") {
      return "汤底已揭晓——" + (s.winnerNick ? "恭喜 " + s.winnerNick + " 说破。" : "") + "房主可以选下一锅。";
    }
    return "";
  }

  function renderQa(s) {
    /* 问答记录：渲染到全局左栏 #qa-log / #qa-count（多人房与单人共用同一块竖版栏） */
    var box = $("#qa-log");
    var badge = $("#qa-count");
    var log = s.qaLog || [];
    var asks = log.filter(function (x) { return x.kind === "ask"; });
    if (badge) badge.textContent = asks.length + " 问";
    if (!box) return;
    if (!log.length) {
      box.innerHTML = '<p class="empty">还没有人提问。</p>';
      return;
    }
    box.innerHTML = log.map(function (x) {
      if (x.kind === "ask") {
        return '<div class="qa-item">' +
          '<div class="qa-q"><span class="qa-k">' + esc(x.nickname || ("#" + x.uid)) + "</span>" + esc(x.question) + "</div>" +
          '<div class="qa-a"><span class="qa-k">' + esc(LEAD_TEXT[x.verdict] || "答") + "</span>" + esc(x.reply) + "</div>" +
          "</div>";
      }
      if (x.kind === "guess") {
        return '<div class="qa-item guess ' + esc(x.level) + '">' +
          '<div class="qa-q"><span class="qa-k">推理</span>' + esc(x.nickname || ("#" + x.uid)) + "：" + esc(x.text) + "</div>" +
          '<div class="qa-a"><span class="qa-k">汤主</span>' + esc(x.reply || "") + "</div>" +
          "</div>";
      }
      if (x.kind === "timeout") {
        return '<div class="qa-item timeout"><div class="qa-a">#' + x.uid + " 超时，已跳过</div></div>";
      }
      if (x.kind === "sys") {
        return '<div class="qa-item sys"><div class="qa-a">' + esc(x.text) + "</div></div>";
      }
      return "";
    }).join("");
    box.scrollTop = box.scrollHeight;
  }

  function paintCooldown(s) {
    var btn = $("#btn-room-guess");
    if (!btn) return;
    if (R.cooldownTimer) { clearInterval(R.cooldownTimer); R.cooldownTimer = 0; }
    var tick = function () {
      var left = Math.ceil(((s.guessCooldownUntil || 0) - Date.now()) / 1000);
      if (left > 0) {
        btn.disabled = true;
        btn.textContent = "冷却中 " + left + "s";
      } else {
        btn.disabled = false;
        btn.textContent = "我要猜汤底";
        if (R.cooldownTimer) { clearInterval(R.cooldownTimer); R.cooldownTimer = 0; }
      }
    };
    tick();
    R.cooldownTimer = setInterval(tick, 1000);
  }

  function showReveal(s) {
    var host = document.createElement("div");
    host.className = "modal-wrap";
    host.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true">' +
      "<h3>汤底揭晓</h3>" +
      '<p class="end-note">' + esc(s.winnerNick ? s.winnerNick + " 说破了汤底" : "本锅结束") + " · 共 " + ((s.qaLog || []).filter(function (x) { return x.kind === "ask"; }).length) + " 问</p>" +
      '<div class="truth-box"><p style="margin:0">' + esc(s.truth) + "</p></div>" +
      '<div class="modal-actions">' +
      '<button type="button" class="btn ghost" id="rv-close">知道了</button>' +
      "</div></div>";
    document.body.appendChild(host);
    host.querySelector("#rv-close").addEventListener("click", function () {
      if (host.parentNode) host.parentNode.removeChild(host);
      document.body.classList.remove("modal-open");
    });
    document.body.classList.add("modal-open");
  }

  /* ---------------- 动作 ---------------- */

  function act(action, body) {
    if (!N || !N.act) return Promise.reject(new Error("NO_NET"));
    return N.act(action, body).then(function (r) {
      if (r && r.error) {
        /* 把服务端给的 note / data 一并带上来，前端才能说清楚到底哪儿错了 */
        var e = new Error(r.error);
        if (r.note) e.note = r.note;
        e.data = r;
        throw e;
      }
      return r;
    }, function (e) {
      /* net.js 把整包响应挂在 data 上，note 在那一层 */
      if (e && e.data && e.data.note && !e.note) e.note = e.data.note;
      throw e;
    });
  }

  /* app.js 把 toast 挂进来，房间层不重复造轮子 */
  root.SoupAppToast = function (m) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = m;
    el.classList.add("show");
    clearTimeout(root.__roomToastTimer);
    root.__roomToastTimer = setTimeout(function () { el.classList.remove("show"); }, 2200);
  };

  /* app.js 的 toast 若先加载，直接借它的实现 */
  root.SoupToastBridge = function (fn) { if (typeof fn === "function") root.SoupAppToast = fn; };

  function doReady() {
    var mine = null;
    var s = R.snap;
    if (s) (s.players || []).forEach(function (p) { if (p.uid === myUid(s)) mine = p; });
    /* playing 阶段点按 = 撤回准备（服务端会把整桌掀回大堂） */
    var next = (s && s.phase === "playing") ? false : !(mine && mine.ready);
    act("ready", { ready: next }).then(function (snap) {
      if (snap && snap.exists) { R.snap = snap; render(snap); }
      R.toast(next ? "已准备，等其他人…" : (s && s.phase === "playing" ? "已撤回，整桌回大堂" : "已取消准备"));
    }).catch(function (e) { R.toast("操作失败：" + e.message); });
  }

  /* 前端把服务端错误码翻成人话：哪些能重试、哪些要去改配置 */
  var AI_ERR_TEXT = {
    AI_OFFLINE: "AI 汤主掉线了，请重新提问一次",
    AI_EMPTY_REPLY: "汤主这次没吐出正文（多半是回复被截断），请再问一次；若反复出现，换成不带思考链的模型",
    AI_BAD_FORMAT: "汤主这次没按格式回答，请重问一次",
    AI_LOCAL_UNREACHABLE: "房主填的是本机地址，机房访问不到；请让房主换成公网地址（cloudflared / ngrok / frp）",
    AI_AUTH_OR_MODEL: "上游拒绝了请求：接口地址 / 模型名 / Key 有问题，请让房主点「测试连接」核对",
    AI_UPSTREAM_5XX: "上游服务暂时出错，等一会儿再试",
    AI_TIMEOUT: "请求超时，稍后再试",
    AI_NETWORK: "机房连不上这个接口地址，请让房主核对地址",
    AI_REQUIRED_LIB: "这锅汤是汤库层，必须先配好 AI 汤主才能问"
  };

  function aiErrText(code, note) {
    if (note) return note;
    return AI_ERR_TEXT[code] || ("AI 汤主出错了（" + code + "）");
  }

  function doAsk() {
    var qi = $("#room-q-input");
    var v = qi ? qi.value.trim() : "";
    if (!v) { R.toast("先写一句问题"); return; }
    act("ask", { question: v }).then(function (r) {
      if (qi) qi.value = "";
      if (r && r.item && r.item.verdict) {
        R.toast("汤主：" + (LEAD_TEXT[r.item.verdict] || "") + " " + (r.item.reply || ""));
      }
      startWatch();
    }).catch(function (e) {
      var m = e.message;
      if (m === "NOT_YOUR_TURN") R.toast("还没轮到你哦");
      else if (m === "EMPTY_QUESTION") R.toast("先写一句问题");
      else if (AI_ERR_TEXT[m]) R.toast(aiErrText(m, e.note));
      else R.toast("提问失败：" + m);
    });
  }

  function doGuess() {
    openGuessModal();
  }

  function openGuessModal() {
    var host = document.createElement("div");
    host.className = "modal-wrap";
    host.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true">' +
      "<h3>说出你的推理</h3>" +
      '<p class="modal-sub">不用复述原文，把关键的那几层讲清楚就行。汤主会判断你有没有真的熬到汤底。</p>' +
      '<textarea id="rguess-input" rows="5" placeholder="我认为，他之所以……是因为……" autocapitalize="off" spellcheck="false"></textarea>' +
      '<p class="guess-feedback" id="rguess-fb"></p>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn ghost" id="rguess-cancel">再想想</button>' +
      '<button type="button" class="btn primary" id="rguess-submit">提交推理</button>' +
      "</div></div>";
    document.body.appendChild(host);
    document.body.classList.add("modal-open");
    var ta = host.querySelector("#rguess-input");
    var fb = host.querySelector("#rguess-fb");
    setTimeout(function () { if (ta) ta.focus(); }, 40);

    function close() {
      if (host.parentNode) host.parentNode.removeChild(host);
      document.body.classList.remove("modal-open");
    }
    function submit() {
      var t = (ta.value || "").trim();
      if (!t) { fb.textContent = "先写下你的推理，再交给汤主。"; fb.className = "guess-feedback no"; return; }
      fb.textContent = "汤主正在判断你的推理…";
      fb.className = "guess-feedback";
      host.querySelector("#rguess-submit").disabled = true;
      act("guess", { text: t }).then(function (r) {
        close();
        var lv = r && r.level;
        if (lv === "solved") R.toast("对了！汤底揭晓");
        else if (lv === "close") R.toast("已经很近了！60 秒后可再猜");
        else R.toast((r && r.note) || "方向还不对");
        if (r && r.snapshot) { R.snap = r.snapshot; render(r.snapshot); }
        startWatch();
      }).catch(function (e) {
        var m = e.message;
        if (m === "COOLDOWN") { close(); R.toast("还在冷却，等一下再猜"); }
        else if (AI_ERR_TEXT[m]) {
          host.querySelector("#rguess-submit").disabled = false;
          fb.textContent = aiErrText(m, e.note);
          fb.className = "guess-feedback no";
        } else {
          host.querySelector("#rguess-submit").disabled = false;
          fb.textContent = "提交失败：" + m;
          fb.className = "guess-feedback no";
        }
        startWatch();
      });
    }
    host.querySelector("#rguess-submit").addEventListener("click", submit);
    host.querySelector("#rguess-cancel").addEventListener("click", close);
    ta.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) submit();
      if (ev.key === "Escape") close();
    });
  }

  /* 选汤：镜像「汤库」—— 精品 100 + 汤库 900+ 都能选，支持搜索和分页 */
  function doChoose() {
    var host = document.createElement("div");
    host.className = "modal-wrap";
    host.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true">' +
      "<h3>选一锅汤</h3>" +
      '<p class="modal-sub">你选的这锅，全房一起喝。精品层支持关键词汤主；汤库层需要配好 AI 汤主才能问。</p>' +
      '<div class="chips" style="margin-bottom:10px">' +
      '<button type="button" class="chip on" data-layer="core">精品 100</button>' +
      '<button type="button" class="chip" data-layer="lib">汤库全部</button>' +
      "</div>" +
      '<input id="pick-kw" class="input" type="search" placeholder="搜索汤名或汤面，例如：电梯" autocomplete="off" />' +
      '<p class="ai-note" id="pick-meta">加载中…</p>' +
      '<div class="room-picker" id="pick-list"></div>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn ghost" id="pick-more">加载更多</button>' +
      '<button type="button" class="btn ghost" id="pick-cancel">取消</button>' +
      "</div></div>";
    document.body.appendChild(host);
    document.body.classList.add("modal-open");

    var listEl = host.querySelector("#pick-list");
    var kwEl = host.querySelector("#pick-kw");
    var metaEl = host.querySelector("#pick-meta");
    var moreBtn = host.querySelector("#pick-more");
    var layer = "core";
    var offset = 0;
    var total = 0;
    var loading = false;
    var LIMIT = 60;
    var searchTimer = 0;

    function paint(arr, append) {
      if (!append) listEl.innerHTML = "";
      if (!arr.length && !offset) {
        listEl.innerHTML = '<p class="empty">没找到，换个关键词试试。</p>';
        return;
      }
      listEl.insertAdjacentHTML("beforeend", arr.map(function (p) {
        return '<button type="button" class="room-pick" data-id="' + esc(p.id) + '">' +
          "<b>" + esc(p.dispTitle || p.title) + "</b>" +
          "<span>" + esc(String(p.surface || "").slice(0, 46)) + "…</span></button>";
      }).join(""));
    }

    function load(reset) {
      if (loading) return;
      loading = true;
      if (reset) { offset = 0; listEl.innerHTML = ""; }
      var q = (kwEl.value || "").trim();
      var u = baseUrl() + "/api/puzzles?layer=" + layer +
        "&offset=" + offset + "&limit=" + LIMIT +
        (q ? "&q=" + encodeURIComponent(q) : "");
      fetch(u).then(function (r) { return r.json(); }).then(function (j) {
        loading = false;
        var arr = (j && j.puzzles) || [];
        total = (j && j.total) || 0;
        paint(arr, offset > 0);
        offset += arr.length;
        metaEl.textContent = "已加载 " + offset + " / " + total + " 道" + (layer === "lib" ? "（汤库层需 AI 汤主）" : "");
        moreBtn.style.display = offset < total ? "" : "none";
      }).catch(function () {
        loading = false;
        metaEl.textContent = "题库拉取失败，检查网络再试";
      });
    }

    /* 切换层 */
    host.querySelectorAll(".chip[data-layer]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        host.querySelectorAll(".chip[data-layer]").forEach(function (c) { c.classList.remove("on"); });
        chip.classList.add("on");
        layer = chip.getAttribute("data-layer");
        load(true);
      });
    });

    /* 搜索防抖 */
    kwEl.addEventListener("input", function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { load(true); }, 300);
    });

    moreBtn.addEventListener("click", function () { load(false); });

    listEl.addEventListener("click", function (ev) {
      var b = ev.target.closest ? ev.target.closest(".room-pick") : null;
      if (!b) return;
      var id = b.getAttribute("data-id");
      act("choose", { puzzleId: id }).then(function () {
        R.toast("已选好，等全员准备");
        if (host.parentNode) host.parentNode.removeChild(host);
        document.body.classList.remove("modal-open");
      }).catch(function (e) { R.toast("选汤失败：" + e.message); });
    });
    host.querySelector("#pick-cancel").addEventListener("click", function () {
      if (host.parentNode) host.parentNode.removeChild(host);
      document.body.classList.remove("modal-open");
    });

    load(true);
    setTimeout(function () { kwEl.focus(); }, 40);
  }

  function doNext() { act("next", {}).then(function () { R.toast("准备下一锅，全员重新准备"); }).catch(function (e) { R.toast("操作失败：" + e.message); }); }

  /* 房主打开 AI 配置时，把服务端已存的 baseUrl / model 回填，
     免得“保存了但界面空着”导致重复手打。Key 永不下发，必须重填。 */
  function prefillAiModal(host) {
    var s = R.snap || {};
    var ai = s.ai || null;
    if (!ai) return;
    var b = host.querySelector("#rai-base");
    var m = host.querySelector("#rai-model");
    if (b && !b.value && ai.baseUrl) b.value = ai.baseUrl;
    if (m && !m.value && ai.model) m.value = ai.model;
    var fb = host.querySelector("#rai-fb");
    if (fb && ai.hasKey) {
      fb.textContent = "已存过配置（" + (ai.model || "?") + "）。Key 不会下发，需要重填才能保存；只想直接玩可以关掉窗口。";
      fb.className = "guess-feedback";
    }
  }

  function doAi() {
    var host = document.createElement("div");
    host.className = "modal-wrap";
    host.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true">' +
      "<h3>AI 汤主设置（房主）</h3>" +
      '<p class="modal-sub">Key 只存在服务端，不会下发给任何人。保存前建议先点「测试连接」，确认配置能用。</p>' +
      '<input id="rai-base" class="input" placeholder="接口地址，如 https://api.deepseek.com/v1" />' +
      '<input id="rai-model" class="input" placeholder="模型名，如 deepseek-chat" />' +
      '<input id="rai-key" class="input" type="password" placeholder="API Key" />' +
      '<p class="guess-feedback" id="rai-fb"></p>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn ghost" id="rai-test">测试连接</button>' +
      '<button type="button" class="btn ghost" id="rai-clear">清空</button>' +
      '<button type="button" class="btn ghost" id="rai-cancel">取消</button>' +
      '<button type="button" class="btn primary" id="rai-save">保存</button>' +
      "</div></div>";
    document.body.appendChild(host);
    document.body.classList.add("modal-open");
    var fb = host.querySelector("#rai-fb");
    var close = function () { if (host.parentNode) host.parentNode.removeChild(host); document.body.classList.remove("modal-open"); };
    prefillAiModal(host);

    function readCfg() {
      return {
        provider: "custom", kind: "openai",
        baseUrl: host.querySelector("#rai-base").value,
        model: host.querySelector("#rai-model").value,
        apiKey: host.querySelector("#rai-key").value
      };
    }

    host.querySelector("#rai-test").addEventListener("click", function () {
      var cfg = readCfg();
      if (!cfg.baseUrl || !cfg.model || !cfg.apiKey) {
        fb.textContent = "三个框都要填才能测。";
        fb.className = "guess-feedback no";
        return;
      }
      fb.textContent = "正在测试连接，模型响应可能要几秒…";
      fb.className = "guess-feedback";
      host.querySelector("#rai-test").disabled = true;
      act("ai-test", { config: cfg }).then(function (r) {
        host.querySelector("#rai-test").disabled = false;
        if (r && r.ok) {
          fb.textContent = "✓ 连接成功！模型有回应，可以保存了。";
          fb.className = "guess-feedback ok";
        } else {
          fb.textContent = "✗ 连接失败：" + ((r && r.note) || (r && r.error) || "未知错误") + "。检查地址 / 模型名 / Key。";
          fb.className = "guess-feedback no";
        }
      }).catch(function (e) {
        host.querySelector("#rai-test").disabled = false;
        fb.textContent = "✗ 测试失败：" + e.message;
        fb.className = "guess-feedback no";
      });
    });

    host.querySelector("#rai-save").addEventListener("click", function () {
      var cfg = readCfg();
      act("set-ai", { config: cfg }).then(function () { R.toast("AI 汤主已配置"); close(); })
        .catch(function (e) { R.toast("保存失败：" + e.message); });
    });
    host.querySelector("#rai-clear").addEventListener("click", function () {
      act("set-ai", { config: { clear: true } }).then(function () { R.toast("已清空 AI 配置"); close(); });
    });
    host.querySelector("#rai-cancel").addEventListener("click", close);
  }

  /* ---------------- 绑定 ---------------- */

  function bind() {
    var openBtn = $("#btn-multi");
    if (openBtn) openBtn.addEventListener("click", function () {
      if (!N || !N.available()) { R.toast("联机服务还没配置好"); return; }
      showEntry();
    });

    var c = $("#btn-room-create"); if (c) c.addEventListener("click", createRoom);
    var j = $("#btn-room-join"); if (j) j.addEventListener("click", joinRoom);
    var e = $("#btn-room-entry-back"); if (e) e.addEventListener("click", function () {
      showScreen("screen-intro");
      document.body.setAttribute("data-scene", "menu");
    });
    var l = $("#btn-room-leave"); if (l) l.addEventListener("click", leaveRoom);
    var cp = $("#btn-room-copy"); if (cp) cp.addEventListener("click", function () {
      var code = (R.snap && R.snap.roomCode) || me().roomCode || "";
      if (!code) return;
      if (navigator.clipboard) navigator.clipboard.writeText(code).then(function () { R.toast("房号已复制：" + code); });
      else R.toast("房号：" + code);
    });
    var rb = $("#btn-room-ready"); if (rb) rb.addEventListener("click", doReady);
    var ba = $("#btn-room-ask"); if (ba) ba.addEventListener("click", doAsk);
    var qi = $("#room-q-input");
    if (qi) qi.addEventListener("keydown", function (ev) { if (ev.key === "Enter") doAsk(); });
    var bg = $("#btn-room-guess"); if (bg) bg.addEventListener("click", doGuess);
    var bc = $("#btn-room-choose"); if (bc) bc.addEventListener("click", doChoose);
    var bn = $("#btn-room-next"); if (bn) bn.addEventListener("click", doNext);
    var bai = $("#btn-room-ai"); if (bai) bai.addEventListener("click", doAi);

    var jc = $("#room-join-code");
    if (jc) jc.addEventListener("keydown", function (ev) { if (ev.key === "Enter") joinRoom(); });
  }

  /* ---------------- 导出（给 app.js 用） ---------------- */

  root.SoupRoom = {
    open: function () { showEntry(); },
    bind: bind,
    render: render,
    showEntry: showEntry,
    showLive: showLive,
    startWatch: startWatch,
    inRoom: function () { return R.inRoom; },
    /* 从房间界面切走（去汤库 / 随机）：停轮询、收起房间屏、摘掉 room-mode */
    leaveScreen: function () {
      stopWatch();
      var sr = document.getElementById("screen-room");
      if (sr) sr.classList.add("hidden");
      document.body.classList.remove("room-mode");
    },
    /* 刷新页面后：本地还留着房号，且服务端房间还在 → 直接回到房内 */
    resume: function () {
      if (!N || !N.available()) return false;
      var m = me();
      if (!m.roomCode || !m.internalId) return false;
      /* 单人局的房号不能当多人房恢复：单人走本地存档恢复对局，
         否则会被拽进「多人汤屋」界面（Bug 6 的第二个根因）。 */
      if (m.solo) return false;
      N.fetchState().then(function (snap) {
        if (snap && snap.exists && snap.youUid) {
          showLive();
          R.snap = snap;
          render(snap);
          startWatch();
        }
      }).catch(function () { /* 房间没了就算了，不打扰 */ });
      return true;
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})(typeof window !== "undefined" ? window : this);
