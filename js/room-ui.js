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
    askBusy: false,
    chatSeen: 0,
    chatOpen: false,   /* 与 HTML 的 collapsed / aria-expanded="false" 对齐：默认收起，不挡面板 */
    timerTimer: 0,      /* 顺序提问 60s 倒计时的 setInterval 句柄 */
    seenTurn: "",       /* 已经提醒过的轮次，避免每次轮询都再响一次 */
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
    syncChatVisibility();
  }

  /* 聊天框只在「已经进房」时出现在顶栏最右侧；建房页和单人界面都藏起来 */
  function syncChatVisibility() {
    var wrap = $("#room-chat");
    if (!wrap) return;
    var slot = $("#top-chat-slot");
    if (slot && wrap.parentNode !== slot) slot.appendChild(wrap);
    var live = $("#room-live");
    var inLive = !!(live && !live.classList.contains("hidden") && R.inRoom);
    wrap.classList.toggle("hidden", !inLive);
    if (!inLive && R.chatOpen) toggleChat(false);
  }

  function showEntry() {
    R.inRoom = false;
    R.seenTurn = "";
    document.body.classList.remove("my-turn");
    /* 回到建房/进房页：停掉房间专属的左栏自动滚动 */
    stopQaScroll();
    resetRoomSigs();
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
    resetRoomSigs();
    onRoomSideEffects();
  }

  /* app.js 把 toast 挂进来，房间层不重复造轮子 */

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
    stopQaScroll();
    /* 先通知服务器把座位真的清掉，别人视角立刻看不到这个人；
       网络失败也继续清本地，避免自己被卡在旧房号里。 */
    var done = (N && N.leaveRoom) ? N.leaveRoom() : Promise.resolve();
    if (!(N && N.leaveRoom) && N && N.clearRoom) N.clearRoom();
    done.then(function () {
      showEntry();
      R.toast("已离开房间");
    }, function () {
      if (N && N.clearRoom) N.clearRoom();
      showEntry();
      R.toast("已离开房间");
    });
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

  /* 切回前台 / 从 bfcache 回来：不等下一轮定时器，立刻把漏掉的问答拉齐。
     只挂一次（会被 render 反复调到，重复挂会堆出一堆监听器）。
     注：visibilitychange / pageshow 在 net.js 里已经处理，这里只补两个它没管的：
     网络恢复、以及房间层自己的“刚回到房间”场景。 */
  var resumeWired = false;
  function wireResume() {
    if (resumeWired) return;
    resumeWired = true;
    var kick = function () {
      if (!R.inRoom) return;
      if (N && N.fetchState) {
        N.fetchState().then(function (snap) {
          if (snap && snap.exists) { R.snap = snap; render(snap); }
        }).catch(function () { /* 拉不到就交给常规轮询 */ });
      }
      if (N && N.catchUp) N.catchUp();
    };
    window.addEventListener("online", kick);
  }

  /* ---------------- 渲染 ---------------- */

  function render(s) {
    if (!s || !s.exists) return;
    /* 进房后的副作用（电影片尾滚动 / 秒恢复监听）惰性挂一次 */
    if (R.inRoom) onRoomSideEffects();
    var codeEl = $("#room-code");
    if (codeEl) codeEl.textContent = s.roomCode || "------";

    var mine = null;
    (s.players || []).forEach(function (p) {
      if (p.uid === myUid(s)) mine = p;
    });

    /* 玩家列表 */
    var isHostMe = !!(mine && mine.isHost);
    var box = $("#room-players");
    if (box) {
      box.innerHTML = (s.players || []).map(function (p) {
        var tags = [];
        if (p.isHost) tags.push('<span class="room-tag host">房主 #1</span>');
        if (mine && p.uid === mine.uid) tags.push('<span class="room-tag me">我</span>');
        if (s.phase === "playing" && s.turnUid === p.uid) tags.push('<span class="room-tag turn">' + (mine && p.uid === mine.uid ? "该你问" : "该他问") + "</span>");
        /* 房主可请离任意在座玩家；离线超过 1 分钟的单独标成死座位 */
        if (isHostMe && !p.isHost) {
          tags.push('<button type="button" class="btn ghost rp-kick" data-kick="' + p.uid + '">' +
            (p.seatRemovable ? "请离死座位" : "请离") + "</button>");
        }
        return '<div class="room-player' + (p.online ? "" : " off") + (mine && p.uid === mine.uid ? " self" : "") + '">' +
          '<span class="rp-uid">#' + p.uid + "</span>" +
          '<span class="rp-name">' + esc(p.nickname) + "</span>" +
          '<span class="rp-state ' + (p.ready ? "ready" : "wait") + '">' + (p.ready ? "已准备" : "未准备") + "</span>" +
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

    /* 本锅头部 60s 倒计时：playing 才显示，全桌可见，只展示不改时长 */
    paintTurnTimer(s);

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

    /* 实时对话流（多⑤）：中区看当下，与左栏回顾、二级面板同源 */
    renderFeed(s);

    /* 房间聊天（新①）：右下角常驻小聊天框，与问答记录互不干扰 */
    renderChat(s);

    /* 输入区状态：把「轮次」与「汤主正在想」两件事分开表达
       —— 多①的根源就是两者没区分：没轮到自己 / 汤主在忙，反馈完全不一样。
       没轮到自己时输入框仍然能打字（提前写好下一句），只锁「提问」按钮。 */
    var myTurn = s.phase === "playing" && s.turnUid === myUid(s);
    var pending = s.pendingAI || null;
    /* 上一句还没回来（服务端飞行锁 + 本地 askBusy），才锁住发送 */
    var canAsk = myTurn && !pending && !R.askBusy;
    var qi = $("#room-q-input");
    if (qi) {
      qi.disabled = false;
      qi.readOnly = false;
      qi.placeholder = pending
        ? "可以先写下轮到你时要问的话…"
        : (myTurn ? "轮到你了，向汤主提问…" : "没轮到你也可以先写好问题，轮到再发送");
    }
    noteTurn(s, myTurn);
    var ba = $("#btn-room-ask");
    if (ba) {
      ba.disabled = !canAsk;
      /* 按钮就地变文案 + 带省略号动效，点完立刻有反馈（多①） */
      ba.textContent = R.askBusy ? "汤主思考中…" : "提问";
      ba.classList.toggle("busy", !!R.askBusy);
    }

    /* 全桌可见的「思考中」横幅：不管是谁问的，所有人都能看到进度 */
    var pb = $("#room-pending");
    if (pb) {
      if (pending) {
        pb.classList.remove("hidden");
        pb.innerHTML = '<span class="pd-dot" aria-hidden="true"></span>' +
          '<b>' + esc(pending.nickname) + '</b> 问：' + esc(pending.question) +
          '<span class="pd-tip">汤主正在熬这锅…</span>';
      } else {
        pb.classList.add("hidden");
        pb.innerHTML = "";
      }
    }

    /* 准备按钮：
       lobby 自由切；playing 且自己在本锅顺序里 = 撤回准备回大堂；
       中途进来、不在本锅顺序里的人，可以先为下一锅准备，不会掀掉正在打的这锅。 */
    var rb = $("#btn-room-ready");
    if (rb) {
      var mineReady = mine && mine.ready;
      var inThisPot = !!(mine && (s.order || []).indexOf(mine.uid) !== -1);
      rb.classList.toggle("on", !!mineReady);
      if (s.phase === "playing" && inThisPot) {
        rb.textContent = "撤回准备（回大堂）";
        rb.disabled = false;
      } else if (s.phase === "playing" || s.phase === "revealed") {
        rb.textContent = mineReady ? "已为下一锅准备" : "为下一锅准备";
        rb.disabled = false;
      } else {
        rb.textContent = mineReady ? "已准备（点一下取消）" : "我准备好了";
        rb.disabled = false;
      }
    }

    /* 房主按钮（选汤 / 随机一题 / 下一锅 / AI 设置） */
    var isHost = !!(mine && mine.isHost);
    ["btn-room-choose", "btn-room-rand", "btn-room-next", "btn-room-ai"].forEach(function (id) {
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

  /* 轮到自己：整屏轻闪 + 短促轻铃，只在轮次真正换到自己时响一次 */
  function noteTurn(s, myTurn) {
    var key = (s && s.phase === "playing" && s.turnUid) ? (String(s.puzzleId || "") + ":" + s.turnUid + ":" + (s.turnDeadline || 0)) : "";
    if (key === R.seenTurn) return;
    var prev = R.seenTurn;
    R.seenTurn = key;
    document.body.classList.toggle("my-turn", !!myTurn);
    /* 第一次进房就已经轮到自己时也要响；之后只有轮次真的换到自己才再响 */
    if (!myTurn || (!prev && !R.inRoom)) return;
    var banner = $("#turn-call");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "turn-call";
      banner.className = "turn-call";
      banner.setAttribute("role", "status");
      banner.setAttribute("aria-live", "assertive");
      document.body.appendChild(banner);
    }
    banner.textContent = "轮到你提问了";
    banner.classList.remove("on");
    void banner.offsetWidth;
    banner.classList.add("on");
    if (root.SoupAudio && root.SoupAudio.sfx) root.SoupAudio.sfx("turn");
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
    /* 问答记录：渲染到全局左栏 #qa-log / #qa-count（多人房与单人共用同一块竖版栏）
       左栏常驻不折叠 + 自动慢速滚动：这是「电影片尾」式的回顾展示。 */
    var box = $("#qa-log");
    var badge = $("#qa-count");
    var log = s.qaLog || [];
    var asks = log.filter(function (x) { return x.kind === "ask"; });
    if (badge) badge.textContent = asks.length + " 问";
    if (!box) return;
    /* 只在新内容真的到了才重建 DOM，避免每 1.5s 无意义重排 */
    var sig = log.length + "|" + (log.length ? log[log.length - 1].at : 0) + "|" + (s.chatSeq || 0);
    if (box.__sig === sig) { ensureQaScroll(); return; }
    box.__sig = sig;
    if (!log.length) {
      box.innerHTML = '<p class="empty">还没有人提问。</p>';
      return;
    }
    box.innerHTML = log.map(function (x) {
      if (x.kind === "ask") {
        return '<div class="qa-item ' + esc(x.verdict || "") + '">' +
          '<div class="qa-q"><span class="qa-k">' + esc(x.nickname || ("#" + x.uid)) + "</span>" + esc(x.question) + "</div>" +
          '<div class="qa-a"><span class="qa-k verdict ' + esc(x.verdict || "") + '">' + esc(LEAD_TEXT[x.verdict] || "答") + "</span>" + esc(x.reply) + "</div>" +
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
    /* 有新内容：清掉「已经滚到底」的记号，让慢速滚动重新接管 */
    box.__atBottom = false;
    ensureQaScroll();
  }

  /* ------------------------------------------------------------
   * 左栏「电影片尾」式自动慢速滚动
   * ------------------------------------------------------------
   * 规则（主人指定）：
   *   - 恒定慢速向下滚，到底后回顶部继续，无限循环；
   *   - 禁止任何人手动拖动（触摸 / 滚轮 / 中键全部拦掉），房主服主也一样；
   *   - 内容比容器短时不滚，静止显示。
   * 用 requestAnimationFrame 做恒定像素速度：60fps 下约 0.35px/帧 ≈ 21px/s，
   * 比浏览器原生 smooth 慢很多，看着像片尾字幕。
   */

  var QA_SPEED = 0.35;      /* px / 帧 */
  var qaRaf = 0;
  var qaPaused = 0;         /* 到底后停顿的截止时间戳 */

  function qaScrollWanted() {
    /* 单人开锅、多人进房都要自动慢滚；菜单页内容不够长时 step 自己停 */
    if (R.inRoom) return true;
    var game = document.getElementById("screen-game");
    return !!(game && !game.classList.contains("hidden"));
  }

  function ensureQaScroll() {
    var box = $("#qa-log");
    if (!box) return;
    blockManualScroll(box);
    if (qaRaf) return;      /* 已经在跑 */
    var step = function () {
      var el = $("#qa-log");
      if (!el || !qaScrollWanted()) { qaRaf = 0; return; }
      var over = el.scrollHeight - el.clientHeight;
      if (over <= 4) {
        /* 内容不够长：不动，也不花帧 */
        el.scrollTop = 0;
        qaRaf = 0;
        return;
      }
      var t = Date.now();
      if (qaPaused && t < qaPaused) { qaRaf = requestAnimationFrame(step); return; }
      qaPaused = 0;
      el.scrollTop = el.scrollTop + QA_SPEED;
      /* 到底了：停 1.6s，再回顶部继续 —— 给玩家时间看完最后一条 */
      if (el.scrollTop >= over - 1) {
        el.scrollTop = over;
        qaPaused = t + 1600;
        setTimeout(function () {
          var e2 = $("#qa-log");
          if (e2 && qaScrollWanted()) e2.scrollTop = 0;
        }, 1600);
      }
      qaRaf = requestAnimationFrame(step);
    };
    qaRaf = requestAnimationFrame(step);
  }

  function stopQaScroll() {
    if (qaRaf) { cancelAnimationFrame(qaRaf); qaRaf = 0; }
    qaPaused = 0;
  }

  /* 禁止手动滚动：单人和多人房都一样，左栏只自动慢滚。 */
  function blockManualScroll(el) {
    if (!el || el.__block) return;
    el.__block = true;
    ["wheel", "touchmove", "mousedown", "pointerdown"].forEach(function (t) {
      el.addEventListener(t, function (ev) {
        if (ev.target && ev.target.closest && ev.target.closest("input,textarea,select,button,a")) return;
        ev.preventDefault();
      }, { passive: false });
    });
    el.addEventListener("keydown", function (ev) {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].indexOf(ev.key) !== -1) ev.preventDefault();
    });
    el.addEventListener("selectstart", function (ev) { ev.preventDefault(); });
  }

  /* ---------------- 实时对话流（多⑤）：中区看当下 ----------------
   * 每个人的提问 + 汤主回答按时间顺序往下叠，最新的自动滚到底。
   * 与左栏（回顾跑马灯）、二级面板（查全部）同源同序，分工不同。
   */
  function renderFeed(s) {
    var box = $("#room-feed");
    if (!box) return;
    var log = (s.qaLog || []).filter(function (x) {
      return x.kind === "ask" || x.kind === "guess" || x.kind === "sys";
    });
    var cnt = $("#room-feed-count");
    if (cnt) cnt.textContent = (s.qaLog || []).filter(function (x) { return x.kind === "ask"; }).length + " 问";

    var last = log.length ? log[log.length - 1].at : 0;
    var pending = s.pendingAI;
    var sig = log.length + "|" + last + "|" + (pending ? pending.at : 0);
    if (box.__sig === sig) return;
    box.__sig = sig;

    if (!log.length && !pending) {
      box.innerHTML = '<p class="empty">开局后，每个人的提问都会实时出现在这里。</p>';
      return;
    }
    box.innerHTML = log.map(function (x) {
      if (x.kind === "ask") {
        return '<div class="feed-row">' +
          '<span class="fb-name">' + esc(x.nickname || ("#" + x.uid)) + "</span>" +
          '<span class="fb-q">' + esc(x.question) + "</span>" +
          '<span class="fb-stamp ' + esc(x.verdict) + '">' + esc(LEAD_TEXT[x.verdict] || "答") + "</span>" +
          '<span class="fb-a">' + esc(x.reply || "") + "</span></div>";
      }
      if (x.kind === "guess") {
        return '<div class="feed-row guess">' +
          '<span class="fb-name">' + esc(x.nickname || ("#" + x.uid)) + "</span>" +
          '<span class="fb-q">推理：' + esc(x.text) + "</span>" +
          '<span class="fb-stamp ' + esc(x.level) + '">' + esc(x.level === "solved" ? "说破" : "判") + "</span>" +
          '<span class="fb-a">' + esc(x.reply || "") + "</span></div>";
      }
      return '<div class="feed-row sys"><span class="fb-a">' + esc(x.text) + "</span></div>";
    }).join("") +
      (pending ? '<div class="feed-row pending">' +
        '<span class="fb-name">' + esc(pending.nickname) + '</span>' +
        '<span class="fb-q">' + esc(pending.question) + '</span>' +
        '<span class="fb-a">汤主正在想…</span></div>' : "");
    box.scrollTop = box.scrollHeight;
  }

  /* ---------------- 房间聊天（新①：右下角常驻小聊天框） ----------------
   * 与「问答记录」分工不同：问答是游戏的正式推进，聊天只是玩家闲聊。
   * 面板常驻、可折叠（默认展开），空闲时也只占右下角一小块。
   */

  function renderChat(s) {
    var box = $("#room-chat-log");
    if (!box) return;
    var log = s.chatLog || [];
    var last = log.length ? log[log.length - 1].seq || 0 : 0;
    var badge = $("#room-chat-badge");
    /* 未读：面板收起时，把新消息数打在标题上 */
    if (badge) {
      var unread = 0;
      if (!R.chatOpen) {
        unread = log.filter(function (x) { return (x.seq || 0) > (R.chatSeen || 0); }).length;
      }
      badge.textContent = unread ? String(unread) : "";
      badge.classList.toggle("hidden", !unread);
    }
    if (box.__sig === log.length + "|" + last) { box.scrollTop = box.scrollHeight; return; }
    box.__sig = log.length + "|" + last;
    if (!log.length) {
      box.innerHTML = '<p class="empty">房间闲聊区：聊什么都可以，汤主不看这里。</p>';
    } else {
      box.innerHTML = log.map(function (x) {
        var mineCls = (x.uid === myUid(R.snap || {})) ? " me" : "";
        return '<div class="chat-item' + mineCls + '">' +
          '<span class="ci-name">' + esc(x.nickname || ("#" + x.uid)) + "</span>" +
          '<span class="ci-text">' + esc(x.text) + "</span></div>";
      }).join("");
    }
    if (R.chatOpen) box.scrollTop = box.scrollHeight;
  }

  function markChatRead(s) {
    var log = (s && s.chatLog) || (R.snap && R.snap.chatLog) || [];
    var last = log.length ? (log[log.length - 1].seq || 0) : 0;
    if (last > (R.chatSeen || 0)) R.chatSeen = last;
  }

  function toggleChat(force) {
    var wrap = $("#room-chat");
    if (!wrap) return;
    var open = typeof force === "boolean" ? force : !R.chatOpen;
    R.chatOpen = open;
    wrap.classList.toggle("collapsed", !open);
    var btn = $("#btn-room-chat-toggle");
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      markChatRead(R.snap);
      var ib = $("#room-chat-input");
      /* 移动端不自动弹键盘：只在非触屏设备上聚焦 */
      if (ib && !isTouch()) setTimeout(function () { ib.focus(); }, 40);
      var box = $("#room-chat-log");
      if (box) box.scrollTop = box.scrollHeight;
      renderChat(R.snap || {});
    }
  }

  function isTouch() {
    try {
      if (window.matchMedia && window.matchMedia("(hover: none) and (pointer: coarse)").matches) return true;
      if ("ontouchstart" in window && (navigator.maxTouchPoints || 0) > 0) return true;
    } catch (e) { /* 忽略 */ }
    return false;
  }

  function paintCooldown(s) {
    var btn = $("#btn-room-guess");
    if (!btn) return;
    if (R.cooldownTimer) { clearInterval(R.cooldownTimer); R.cooldownTimer = 0; }
    var tick = function () {
      var left = Math.ceil(((s.myGuessCooldownUntil || 0) - Date.now()) / 1000);
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

  function paintTurnTimer(s) {
    var el = $("#room-turn-timer");
    if (!el) return;
    if (R.timerTimer) { clearInterval(R.timerTimer); R.timerTimer = 0; }
    var show = !!(s && s.phase === "playing" && s.turnDeadline);
    if (!show) { el.classList.add("hidden"); el.textContent = "⏳ 60s"; return; }
    el.classList.remove("hidden");
    var tick = function () {
      var left = Math.ceil(((s.turnDeadline || 0) - Date.now()) / 1000);
      if (left < 0) left = 0;
      el.textContent = "⏳ " + left + "s";
      el.classList.toggle("warn", left <= 10);
      el.classList.toggle("urgent", left <= 5);
      if (left <= 0 && R.timerTimer) { clearInterval(R.timerTimer); R.timerTimer = 0; }
    };
    tick();
    R.timerTimer = setInterval(tick, 1000);
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

  /* 左栏「电影片尾」滚动在房间模式下才跑，离开房间要停。
     注意：这个函数被 render 每次快照调到，所以只能做幂等的事
     （重复挂监听 / 重复重置指纹都会把去重优化废掉）。 */
  function onRoomSideEffects() {
    var qaBox = $("#qa-log");
    if (qaBox && !qaBox.__noManual) {
      qaBox.__noManual = true;
      blockManualScroll(qaBox);
    }
    wireResume();
  }

  /* 刚进房 / 换房：丢掉上一次房间留下的渲染指纹，强制重绘一次 */
  function resetRoomSigs() {
    ["#qa-log", "#room-feed", "#room-chat-log"].forEach(function (sel) {
      var el = $(sel);
      if (el) el.__sig = "";
    });
  }
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
    AI_AUTH_OR_MODEL: "上游拒绝了请求（若提示「来源被拦截」，是该中转站封了机房 IP，需内网穿透或换直连服务商）；请让房主点「测试连接」核对",
    AI_UPSTREAM_5XX: "上游服务暂时出错，等一会儿再试",
    AI_GATEWAY_BLOCKED: "这个中转站的防火墙拦掉了服务器来源（已带浏览器伪装头仍被拦）。不是 key 或模型名的问题，建议换中转站或换直连服务商（DeepSeek / Kimi 官方等）",
    AI_TIMEOUT: "请求超时，稍后再试",
    AI_NETWORK: "机房连不上这个接口地址，请让房主核对地址",
    AI_REQUIRED_LIB: "这锅汤是汤库层，必须先配好 AI 汤主才能问"
  };

  function aiErrText(code, note) {
    if (note) return note;
    return AI_ERR_TEXT[code] || ("AI 汤主出错了（" + code + "）");
  }

  /* 提问（多①）：点下去立刻锁按钮 + 变文案，不让玩家以为没反应而狂点。
     真正的防重复烧额度在服务端飞行锁，这里只管手感。 */
  function doAsk() {
    var qi = $("#room-q-input");
    var v = qi ? qi.value.trim() : "";
    var ba = $("#btn-room-ask");
    /* 没轮到自己 / 汤主还在想：草稿留着，回车也不发出去 */
    if (!ba || ba.disabled) {
      if (!v) R.toast("可以先把问题写在框里，轮到你再发送");
      else R.toast("还没轮到你，问题已留在框里");
      return;
    }
    if (!v) { R.toast("先写一句问题"); return; }
    if (R.askBusy) { R.toast("汤主还在熬上一句，稍等一下下。"); return; }

    /* 立即反馈：按钮变「汤主思考中…」+ 输入框锁定 */
    R.askBusy = true;
    paintAskBusy(true);
    /* 本地立刻把「谁在问」显出来，不等下一轮轮询（尤其是提问者自己的视角） */
    var pendEl = $("#room-pending");
    if (pendEl) {
      pendEl.classList.remove("hidden");
      pendEl.innerHTML = '<span class="pd-dot" aria-hidden="true"></span>' +
        '<b>' + esc(me().nickname || "你") + '</b> 问：' + esc(v) +
        '<span class="pd-tip">汤主正在熬这锅…</span>';
    }

    act("ask", { question: v }).then(function (r) {
      R.askBusy = false;
      paintAskBusy(false);
      if (qi) qi.value = "";
      if (r && r.item && r.item.verdict) {
        R.toast("汤主：" + (LEAD_TEXT[r.item.verdict] || "") + " " + (r.item.reply || ""));
      }
      startWatch();
    }).catch(function (e) {
      R.askBusy = false;
      paintAskBusy(false);
      var m = e.message;
      if (m === "AI_BUSY") R.toast("上一句汤主还在熬，等它答完再问。");
      else if (m === "NOT_YOUR_TURN") R.toast("还没轮到你哦");
      else if (m === "EMPTY_QUESTION") R.toast("先写一句问题");
      else if (AI_ERR_TEXT[m]) R.toast(aiErrText(m, e.note));
      else R.toast("提问失败：" + m);
      /* 失败后立刻拉一次，把服务端真状态拉回来 */
      startWatch();
    });
  }

  /* 提问按钮的忙碌/空闲两态。
     空闲时不能只把 disabled 置 false（可能因此漏过「没轮到你」的情况），
     所以立刻用当前快照重算一次，把控制权交回 render。 */
  function paintAskBusy(busy) {
    var ba = $("#btn-room-ask");
    if (ba) {
      ba.textContent = busy ? "汤主思考中…" : "提问";
      ba.classList.toggle("busy", !!busy);
      ba.disabled = !!busy;
    }
    /* 思考中只锁发送，输入框留给下一句草稿 */
    if (!busy && R.snap) render(R.snap);
  }

  function doGuess() {
    openGuessModal();
  }

  /* ------------------------------------------------------------
   * 「问答记录」二级面板（多③）：随时点开、自由翻阅
   * ------------------------------------------------------------
   * 与左栏分工：左栏是「电影片尾」自动慢滚（回顾氛围），
   * 这里是可以自由拖动、随时翻的完整清单，也方便手机上读长问答。
   */
  function openQaPanel() {
    var s = R.snap || {};
    var log = s.qaLog || [];
    var asks = log.filter(function (x) { return x.kind === "ask"; });
    var host = document.createElement("div");
    host.className = "modal-wrap";
    host.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="rqa-title">' +
      '<h3 id="rqa-title">本锅问答记录</h3>' +
      '<p class="modal-sub">共 ' + asks.length + ' 问。可以随意上下翻看，这里不自动滚动。</p>' +
      '<div class="room-qa-sheet" id="rqa-body"></div>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn ghost" id="rqa-bottom">跳到最新</button>' +
      '<button type="button" class="btn primary" id="rqa-close">关闭</button>' +
      "</div></div>";
    document.body.appendChild(host);
    document.body.classList.add("modal-open");

    var body = host.querySelector("#rqa-body");
    if (!log.length) {
      body.innerHTML = '<p class="empty">还没有人提问。</p>';
    } else {
      body.innerHTML = log.map(function (x) {
        if (x.kind === "ask") {
          return '<div class="qa-item ' + esc(x.verdict || "") + '">' +
            '<div class="qa-q"><span class="qa-k">' + esc(x.nickname || ("#" + x.uid)) + "</span>" + esc(x.question) + "</div>" +
            '<div class="qa-a"><span class="qa-k verdict ' + esc(x.verdict || "") + '">' + esc(LEAD_TEXT[x.verdict] || "答") + "</span>" + esc(x.reply) + "</div>" +
            "</div>";
        }
        if (x.kind === "guess") {
          return '<div class="qa-item guess ' + esc(x.level) + '">' +
            '<div class="qa-q"><span class="qa-k">推理</span>' + esc(x.nickname || ("#" + x.uid)) + "：" + esc(x.text) + "</div>" +
            '<div class="qa-a"><span class="qa-k">汤主</span>' + esc(x.reply || "") + "</div></div>";
        }
        if (x.kind === "timeout") return '<div class="qa-item timeout"><div class="qa-a">#' + x.uid + " 超时，已跳过</div></div>";
        if (x.kind === "sys") return '<div class="qa-item sys"><div class="qa-a">' + esc(x.text) + "</div></div>";
        return "";
      }).join("");
    }
    var close = function () {
      if (host.parentNode) host.parentNode.removeChild(host);
      document.body.classList.remove("modal-open");
    };
    body.scrollTop = body.scrollHeight;
    host.querySelector("#rqa-close").addEventListener("click", close);
    host.querySelector("#rqa-bottom").addEventListener("click", function () {
      body.scrollTop = body.scrollHeight;
    });
    host.addEventListener("click", function (ev) { if (ev.target === host) close(); });
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
        if (m === "COOLDOWN") { close(); R.toast("你还在冷却，等一下再猜（别人不受影响）"); }
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

  /* 选汤：直接弹超大汤库 UI——与单人汤库同款（筛选+搜索+分页+卡片），不再是单独二级选汤界面。
     题目走本地精品层 + 汤库（和单人汤库同一份），不另做选汤页。 */
  function doChoose() {
    var E2 = window.SoupEngine;
    var LIB2 = window.SOUP_LIBRARY || [];
    var PUZ2 = window.PUZZLES || [];
    var st = { page: 1, kw: "", cat: "全部", difficulty: 0, layer: "all" };
    var PAGE = 60;
    var host = document.createElement("div");
    host.className = "modal-wrap";
    host.innerHTML =
      '<div class="modal modal-library" role="dialog" aria-modal="true">' +
      "<h3>选一锅汤 · 汤库</h3>" +
      '<p class="modal-sub">你选的这锅，全房一起喝。精品层支持关键词汤主；汤库层需要配好 AI 汤主才能问。</p>' +
      '<div class="chips" id="room-lib-layers" style="margin-bottom:10px">' +
      '<button type="button" class="chip on" data-layer="all">全部题</button>' +
      '<button type="button" class="chip" data-layer="core">精品 100</button>' +
      '<button type="button" class="chip" data-layer="lib">汤库全部</button>' +
      "</div>" +
      '<div class="chips cats" id="room-lib-cats" style="margin-bottom:8px"></div>' +
      '<div class="chips" id="room-lib-diffs" style="margin-bottom:10px"></div>' +
      '<input id="pick-kw" class="input" type="search" placeholder="搜索汤名或汤面，例如：电梯" autocomplete="off" />' +
      '<p class="ai-note" id="pick-meta">加载中…</p>' +
      '<div class="room-library" id="pick-list"></div>' +
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
    var catEl = host.querySelector("#room-lib-cats");
    var diffEl = host.querySelector("#room-lib-diffs");
    var pool = [];

    function libDiffDots2(d) {
      var n = Number(d);
      if (!isFinite(n) || n < 1 || n > 3) n = 2;
      return new Array(n + 1).join("●") + new Array(4 - n).join("○");
    }
    function libShortSrc2(s) {
      var v = String(s || "");
      if (!v) return "";
      if (v.indexOf("github:") === 0) return v.slice(7).split("/")[0] || v;
      return v;
    }
    var DIFFS2 = [
      { v: 0, label: "不限" },
      { v: 1, label: "● 清淡" },
      { v: 2, label: "●● 适中" },
      { v: 3, label: "●●● 浓郁" }
    ];

    function matchCore(p) {
      if (st.kw) {
        var k = String(st.kw).toLowerCase();
        var hay = String((p.dispTitle || p.title || "") + "\n" + (p.surface || "")).toLowerCase();
        if (hay.indexOf(k) === -1) return false;
      }
      if (st.cat && st.cat !== "全部") {
        var cs = p.cats || [];
        if (cs.indexOf(st.cat) === -1) return false;
      }
      if (st.difficulty && p.difficulty !== st.difficulty) return false;
      return true;
    }

    /* 本地候选：core 用 PUZZLES，lib 用 SOUP_LIBRARY（与单人汤库同一份）。
       layer=all 时两层都合进来，随机一题才能抽到精品以外的题。 */
    function localPool() {
      var out = [];
      if (st.layer !== "lib") {
        (PUZ2 || []).forEach(function (p) { if (matchCore(p)) out.push(p); });
      }
      if (st.layer !== "core") {
        var list = E2 ? E2.searchLibrary(LIB2, st.kw) : LIB2;
        var lib = E2 ? E2.libraryPool(list, { cat: st.cat, difficulty: st.difficulty, hasTruth: false }) : (list || []);
        out = out.concat(lib || []);
      }
      return out;
    }

    function renderCats() {
      var cats = ["全部"];
      if (st.layer === "core") {
        if (E2) cats = ["全部"].concat(E2.allCats(PUZ2));
      } else if (E2) {
        cats = ["全部"].concat(E2.libraryCats(st.layer === "lib" ? LIB2 : LIB2.concat(PUZ2)));
      }
      if (cats.indexOf(st.cat) === -1) st.cat = "全部";
      catEl.innerHTML = cats.map(function (c) {
        return '<button type="button" class="chip cat' + (c === st.cat ? " on" : "") + '" data-cat="' + esc(c) + '">' + esc(c) + "</button>";
      }).join("");
      Array.prototype.forEach.call(catEl.querySelectorAll("[data-cat]"), function (btn) {
        btn.addEventListener("click", function () {
          st.cat = btn.getAttribute("data-cat");
          st.page = 1;
          renderCats();
          load(true);
        });
      });
    }

    function renderDiffs() {
      diffEl.innerHTML = DIFFS2.map(function (d) {
        return '<button type="button" class="chip diff' + (d.v === st.difficulty ? " on" : "") + '" data-diff="' + d.v + '">' + esc(d.label) + "</button>";
      }).join("");
      Array.prototype.forEach.call(diffEl.querySelectorAll("[data-diff]"), function (btn) {
        btn.addEventListener("click", function () {
          st.difficulty = Number(btn.getAttribute("data-diff")) || 0;
          st.page = 1;
          renderDiffs();
          load(true);
        });
      });
    }

    var searchTimer = 0;

    function paint(arr, append) {
      if (!append) listEl.innerHTML = "";
      if (!arr.length && !(st.page > 1)) {
        listEl.innerHTML = '<p class="empty">没找到，换个关键词试试。</p>';
        return;
      }
      listEl.insertAdjacentHTML("beforeend", arr.map(function (p) {
        var name = esc(p.dispTitle || p.title || "无题");
        var surf = esc(String(p.surface || "").slice(0, 60)) + (p.surface && p.surface.length > 60 ? "…" : "");
        var diff = esc(libDiffDots2(p.difficulty));
        var src = esc(p.src ? libShortSrc2(p.src) : "精品");
        return '<button type="button" class="pz-card" data-id="' + esc(p.id) + '">' +
          '<div class="pz-title">' + name + "</div>" +
          '<div class="pz-surface">' + surf + "</div>" +
          '<div class="pz-meta"><span>' + diff + '</span><span>' + src + "</span></div></button>";
      }).join(""));
    }

    function load(reset) {
      if (reset) st.page = 1;
      st.kw = (kwEl.value || "").trim();
      pool = localPool();
      var shown = pool.slice(0, st.page * PAGE);
      paint(shown, false);
      var layerNote = st.layer === "lib" ? "（汤库层需 AI 汤主）" : (st.layer === "core" ? "（精品层）" : "（精品 + 汤库）");
      metaEl.textContent = "已显示 " + shown.length + " / " + pool.length + " 道" + layerNote;
      moreBtn.style.display = shown.length < pool.length ? "" : "none";
    }

    /* 切换层：全部 / 精品 / 汤库，筛选条跟着重画 */
    host.querySelectorAll(".chip[data-layer]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        host.querySelectorAll(".chip[data-layer]").forEach(function (c) { c.classList.remove("on"); });
        chip.classList.add("on");
        st.layer = chip.getAttribute("data-layer") || "all";
        st.cat = "全部";
        st.page = 1;
        renderCats();
        load(true);
      });
    });

    /* 搜索防抖 */
    kwEl.addEventListener("input", function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { load(true); }, 200);
    });

    moreBtn.addEventListener("click", function () {
      st.page += 1;
      load(false);
    });

    listEl.addEventListener("click", function (ev) {
      var b = ev.target.closest ? ev.target.closest(".pz-card") : null;
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

    renderCats();
    renderDiffs();
    load(true);
    setTimeout(function () { kwEl.focus(); }, 40);
  }

  /* 房主「随机一题」：精品 + 汤库全部可抽，抽到就直接选上，不再只在精品 100 里转 */
  function doRoomRandom() {
    var E2 = window.SoupEngine;
    var LIB2 = window.SOUP_LIBRARY || [];
    var PUZ2 = window.PUZZLES || [];
    var libAvail = (LIB2.length && E2 && E2.drawFromLibrary) ? E2.drawFromLibrary(LIB2, { hasTruth: false }) : null;
    var coreAvail = (PUZ2.length && E2 && E2.drawFrom) ? E2.drawFrom(PUZ2) : (PUZ2.length ? PUZ2[Math.floor(Math.random() * PUZ2.length)] : null);
    var libWeight = LIB2.length;
    var coreWeight = PUZ2.length ? Math.max(PUZ2.length, Math.ceil(libWeight / 5)) : 0;
    var total = libWeight + coreWeight;
    var pick = null;
    if (total <= 0) pick = coreAvail || libAvail;
    else if (Math.random() * total < libWeight) pick = libAvail || coreAvail;
    else pick = coreAvail || libAvail;
    if (!pick || !pick.id) { R.toast("题库还没加载好，稍后再试"); return; }
    var btn = $("#btn-room-rand");
    if (btn) btn.disabled = true;
    act("choose", { puzzleId: pick.id }).then(function () {
      R.toast("随机一题：" + (pick.dispTitle || pick.title || "无题"));
    }).catch(function (e) {
      R.toast("随机选汤失败：" + e.message);
    }).then(function () {
      if (btn && R.snap) {
        var mine = null;
        (R.snap.players || []).forEach(function (p) { if (p.uid === myUid(R.snap)) mine = p; });
        btn.disabled = !(mine && mine.isHost);
      } else if (btn) btn.disabled = false;
    });
  }

  function doNext() { act("next", {}).then(function () { R.toast("准备下一锅，全员重新准备"); }).catch(function (e) { R.toast("操作失败：" + e.message); }); }

  /* 聊天发送（新①）：带 clientId 做幂等，网络重试不会重复上屏 */
  function doChat() {
    var ib = $("#room-chat-input");
    var v = ib ? ib.value.trim() : "";
    if (!v) return;
    var cid = me().internalId + ":" + Date.now() + ":" + Math.floor(Math.random() * 1e6);
    if (ib) ib.value = "";
    act("say", { text: v, clientId: cid }).then(function () {
      startWatch();
    }).catch(function (e) {
      var m = e.message;
      if (m === "TOO_FAST") R.toast("说得太快了，喘口气再说。");
      else if (m === "EMPTY_TEXT") { /* 空内容：忽略 */ }
      else { R.toast("发送失败：" + m); if (ib) ib.value = v; }
    });
  }

  /* 密码看汤底：正确密码 081208。只在本机弹出汤底，不改房间阶段。 */
  var TRUTH_CODE = "081208";
  function doUnlock(solo) {
    var host = document.createElement("div");
    host.className = "modal-wrap";
    host.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="unlock-title">' +
      '<h3 id="unlock-title">密码看汤底</h3>' +
      '<p class="modal-sub">输入正确密码才会揭晓这一锅的汤底。密码只有汤主知道。</p>' +
      '<input id="unlock-code" class="input" type="password" inputmode="numeric" maxlength="12" placeholder="输入密码" autocomplete="off" />' +
      '<p class="guess-feedback" id="unlock-fb"></p>' +
      '<div class="truth-box hidden" id="unlock-truth"></div>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn ghost" id="unlock-cancel">取消</button>' +
      '<button type="button" class="btn primary" id="unlock-ok">确认</button>' +
      "</div></div>";
    document.body.appendChild(host);
    document.body.classList.add("modal-open");
    var input = host.querySelector("#unlock-code");
    var fb = host.querySelector("#unlock-fb");
    var box = host.querySelector("#unlock-truth");
    var close = function () {
      if (host.parentNode) host.parentNode.removeChild(host);
      document.body.classList.remove("modal-open");
    };
    function reveal(text) {
      box.classList.remove("hidden");
      box.innerHTML = "<p style=\"margin:0\">" + esc(text || "这一锅没有汤底。") + "</p>";
      fb.textContent = "密码正确，汤底在下面。";
      fb.className = "guess-feedback ok";
    }
    function submit() {
      var v = String(input.value || "").trim();
      if (v !== TRUTH_CODE) {
        fb.textContent = "密码不对。";
        fb.className = "guess-feedback no";
        box.classList.add("hidden");
        return;
      }
      if (solo) {
        var pid = root.SoupApp && root.SoupApp.pid ? root.SoupApp.pid() : "";
        var list = root.PUZZLES || [];
        var p = null;
        for (var i = 0; i < list.length; i++) {
          if (list[i].id === pid) { p = list[i]; break; }
        }
        reveal(p && p.truth ? p.truth : "这一锅没有汤底。");
        return;
      }
      var s = R.snap || {};
      if (s.truth) { reveal(s.truth); return; }
      var code = s.roomCode || (me().roomCode || "");
      var puzzleId = s.puzzleId || "";
      if (!code || !puzzleId || !N || !N.libTruth) {
        fb.textContent = "还没有开锅，暂时没有汤底可看。";
        fb.className = "guess-feedback no";
        return;
      }
      fb.textContent = "密码正确，正在取汤底…";
      fb.className = "guess-feedback";
      N.libTruth(code, puzzleId).then(function (t) {
        reveal(t || "这一锅没有汤底。");
      });
    }
    host.querySelector("#unlock-ok").addEventListener("click", submit);
    host.querySelector("#unlock-cancel").addEventListener("click", close);
    input.addEventListener("keydown", function (ev) { if (ev.key === "Enter") submit(); });
    setTimeout(function () { input.focus(); }, 30);
  }

  /* 房主请离死座位（多②） */
  function doKick(uid) {
    act("kick", { uid: uid }).then(function () {
      R.toast("已请离，座位空出来了");
      startWatch();
    }).catch(function (e) {
      var m = e.message;
      if (m === "PLAYER_NOT_IDLE") R.toast("他还没离线够久，再等等");
      else if (m === "CANNOT_KICK_HOST") R.toast("房主不能被请离");
      else R.toast("操作失败：" + m);
      startWatch();
    });
  }

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
        /* 服务端给的 note 是真正的原因，别只把错误码甩在用户脸上 */
        fb.textContent = "✗ 测试失败：" + ((e && e.note) ? e.note : (e && e.message) || "未知错误");
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
    var bq = $("#btn-room-qa"); if (bq) bq.addEventListener("click", openQaPanel);
    var bc = $("#btn-room-choose"); if (bc) bc.addEventListener("click", doChoose);
    var br = $("#btn-room-rand"); if (br) br.addEventListener("click", doRoomRandom);
    var bn = $("#btn-room-next"); if (bn) bn.addEventListener("click", doNext);
    var bk = $("#btn-room-kick"); if (bk) bk.addEventListener("click", doKick);
    var bu = $("#btn-room-unlock"); if (bu) bu.addEventListener("click", function () { doUnlock(false); });
    var bai = $("#btn-room-ai"); if (bai) bai.addEventListener("click", doAi);

    /* 玩家列表里的「请离死座位」是动态生成的，用事件委托接 */
    var pb = $("#room-players");
    if (pb) pb.addEventListener("click", function (ev) {
      var b = ev.target.closest ? ev.target.closest("[data-kick]") : null;
      if (!b) return;
      ev.preventDefault();
      doKick(Number(b.getAttribute("data-kick")));
    });

    /* 聊天（新①） */
    var ct = $("#btn-room-chat-toggle"); if (ct) ct.addEventListener("click", function () { toggleChat(); });
    var cs = $("#btn-room-chat-send"); if (cs) cs.addEventListener("click", doChat);
    var ci = $("#room-chat-input");
    if (ci) ci.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); doChat(); } });

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
    ensureQaScroll: ensureQaScroll,
    blockQaScroll: function () {
      var box = $("#qa-log");
      if (box) blockManualScroll(box);
    },
    doUnlock: doUnlock,
    /* 从房间界面切走（去汤库 / 随机）：停轮询、收起房间屏、摘掉 room-mode */
    leaveScreen: function () {
      stopWatch();
      stopQaScroll();
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
