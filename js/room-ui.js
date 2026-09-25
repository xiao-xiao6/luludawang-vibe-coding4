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

  /* ---- 第⑫条：判定词去重 ----
   * 展示时判定词已被提前做成带特效的标签，这里把正文开头重复的那一遍剥掉。
   * AI 提示词一个字不改，纯渲染层处理；只剥独立开头的判定词+标点，
   * 「是不是……」这种连着的句子不会被误伤。 */
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
      if (after && !QA_BOUND.test(after)) continue;   /* 连着下一个词：不剥 */
      return after.replace(/^[\s。.!！?？~～、，,：:;；\-—…]+/, "");
    }
    return t;
  }

  /* ---- 第⑩条：展示编号一律用 seat（从上往下数第几个就是 #几），uid 只做内部身份 ---- */
  function seatOf(s, uid) {
    var ps = (s && s.players) || [];
    for (var i = 0; i < ps.length; i++) { if (ps[i].uid === uid) return ps[i].seat || (i + 1); }
    return uid;
  }

  var R = {
    inRoom: false,
    snap: null,
    lastQa: 0,
    cooldownTimer: 0,
    askBusy: false,
    chatSeen: 0,
    chatOpen: true,    /* 默认展开在右下角；点标题才收起 */
    timerTimer: 0,      /* 顺序提问 90s 倒计时的 setInterval 句柄 */
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

  /* 汤主的话（#tip-card）默认留在右栏线索板下面（单人 / 汤库 / 随机模式）；
     只有真正进多人房（room-live 可见）时，才把整张卡片挪进房间状态行
     #room-tip-slot —— 腾出右下角给房间聊天框。 */
  function syncTipPlacement() {
    var card = document.getElementById("tip-card");
    if (!card) return;
    var col = document.getElementById("col-clue");
    var slot = document.getElementById("room-tip-slot");
    var live = document.getElementById("room-live");
    var inLive = !!(live && !live.classList.contains("hidden") && R.inRoom);
    if (inLive && slot) {
      if (card.parentNode !== slot) slot.appendChild(card);
    } else if (col && card.parentNode !== col) {
      col.appendChild(card);
    }
  }

  /* 宽屏（≥1181px）时，房间聊天框不再悬浮在屏幕右下角，而是搬进右栏，
     排在线索板下面 —— 两块各自固定高度，谁也不挤谁。 */
  function wantDockInClue() {
    try {
      return !!(window.matchMedia && window.matchMedia("(min-width: 1181px)").matches);
    } catch (e) { return false; }
  }

  /* 第⑪条：单人局右栏备忘录的显隐 —— 进多人房就藏起来让位给聊天框；
     只在单人对局屏（screen-game 可见）时挂出来。 */
  function syncMemoVisibility() {
    var memo = document.getElementById("solo-memo");
    if (!memo) return;
    var live = $("#room-live");
    var inLive = !!(live && !live.classList.contains("hidden") && R.inRoom);
    var game = document.getElementById("screen-game");
    var wantMemo = !inLive && !!(game && !game.classList.contains("hidden"));
    memo.classList.toggle("hidden", !wantMemo);
    document.body.classList.toggle("solo-memo-mode", wantMemo);
  }

  /* 聊天框只在「正在房间内」时出现；建房页、单人界面、汤库、随机模式一律藏起来。
     宽屏进房 → 归位到右栏线索板下面（固定尺寸竖排栈）；
     其余情况 → 回到 body，由 CSS 钉在屏幕右下角。 */
  function syncChatVisibility() {
    var wrap = $("#room-chat");
    if (!wrap) return;
    var live = $("#room-live");
    var inLive = !!(live && !live.classList.contains("hidden") && R.inRoom);
    var col = document.getElementById("col-clue");
    var host = (inLive && col && wantDockInClue()) ? col : document.body;
    if (wrap.parentNode !== host) host.appendChild(wrap);
    wrap.classList.toggle("hidden", !inLive);
    if (!inLive && R.chatOpen) toggleChat(false);
    syncTipPlacement();
    syncMemoVisibility();
  }

  /* 窗口跨越断点时，聊天框在「右栏内」与「右下角悬浮」之间换位 */
  var mqWide = null;
  function watchBreakpoint() {
    try {
      if (!window.matchMedia) return;
      mqWide = window.matchMedia("(min-width: 1181px)");
      var on = function () { syncChatVisibility(); };
      if (mqWide.addEventListener) mqWide.addEventListener("change", on);
      else if (mqWide.addListener) mqWide.addListener(on);
    } catch (e) { /* 忽略 */ }
  }

  function showEntry() {
    R.inRoom = false;
    R.seenTurn = "";
    document.body.classList.remove("my-turn");
    /* 回到建房/进房页：停掉房间专属的左栏自动滚动 */
    stopQaScroll();
    paintVote(null);
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
    /* 房间聊天默认展开在右下（主人手动收起后本次会话保持收起） */
    toggleChat(true);
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
      if (m === "ROOM_FULL") R.toast("这间汤屋坐满了（最多 15 人）");
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
        /* 第⑩条：展示编号用 seat（从上往下数第几个），uid 只当内部身份 */
        var seat = p.seat || p.uid;
        var tags = [];
        if (p.isHost) tags.push('<span class="room-tag host">房主</span>');
        if (mine && p.uid === mine.uid) tags.push('<span class="room-tag me">我</span>');
        if (s.phase === "playing" && s.turnUid === p.uid) tags.push('<span class="room-tag turn">' + (mine && p.uid === mine.uid ? "该你问" : "该他问") + "</span>");
        /* 房主可请离 / 转让任意在座玩家；离线超过 1 分钟的单独标成死座位 */
        if (isHostMe && !p.isHost) {
          tags.push('<button type="button" class="btn ghost rp-kick" data-kick="' + p.uid + '">' +
            (p.seatRemovable ? "请离死座位" : "请离") + "</button>");
          tags.push('<button type="button" class="btn ghost rp-transfer" data-transfer="' + p.uid + '">转让房主</button>');
        }
        return '<div class="room-player' + (p.online ? "" : " off") + (mine && p.uid === mine.uid ? " self" : "") + '">' +
          '<span class="rp-uid">#' + seat + "</span>" +
          '<span class="rp-name">' + esc(p.nickname) + "</span>" +
          '<span class="rp-state ' + (p.ready ? "ready" : "wait") + '">' + (p.ready ? "已准备" : "未准备") + "</span>" +
          (p.online ? "" : '<span class="rp-off">离线</span>') +
          tags.join("") +
          "</div>";
      }).join("");
    }
    var cnt = $("#room-count");
    if (cnt) cnt.textContent = (s.players || []).length + "/15";

    /* 阶段提示 */
    var ph = $("#room-phase");
    if (ph) ph.textContent = phaseText(s, mine);

    /* 本锅 */
    var pz = $("#room-puzzle");
    if (pz) {
      if (s.puzzle) {
        var pzCats = (s.puzzle.cats || []).map(function (c) {
          return '<span class="pz-cat">' + esc(c) + "</span>";
        }).join("");
        pz.innerHTML =
          '<div class="room-pz-title">' + esc(s.puzzle.dispTitle || s.puzzle.title) + "</div>" +
          '<p class="room-pz-surface">' + esc(s.puzzle.surface || "") + "</p>" +
          (pzCats ? '<div class="pz-cats">' + pzCats + "</div>" : "") +
          '<p class="room-pz-meta">火候 ' + (s.puzzle.difficulty || "-") + "</p>";
      } else {
        pz.innerHTML = '<p class="empty">房主还没选汤。</p>';
      }
    }

    /* 轮次徽章 */
    var tb = $("#room-turn");
    if (tb) {
      if (s.phase === "playing" && s.turnUid) {
        var who = (s.players || []).filter(function (p) { return p.uid === s.turnUid; })[0];
        tb.textContent = "轮到 #" + (s.turnSeat || seatOf(s, s.turnUid)) + " " + (who ? who.nickname : "");
      } else if (s.phase === "revealed") {
        tb.textContent = "本锅已揭底";
      } else {
        tb.textContent = "—";
      }
    }

    /* 本锅头部 90s 倒计时：playing 才显示，全桌可见，只展示不改时长 */
    paintTurnTimer(s);

    /* 第⑥条：线索板已整体下线；第⑦条：「汤主的话」不再独立成框，
     文案全部并入上方阶段提示 #room-phase（见 phaseText）。 */

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
      var inThisPot = !!(mine && (s.potUids || s.order || []).indexOf(mine.uid) !== -1);
      rb.classList.toggle("on", !!mineReady);
      if (s.phase === "playing" && inThisPot) {
        rb.textContent = "撤回准备（回大堂）";
        rb.disabled = false;
      } else if (s.phase === "playing") {
        /* 第④条：中途进来 / 退出重进的人，点一下 = 准备并排进本锅队尾，
           不影响任何人；已排上的人再点才是退出队列（文案说清楚，防手滑）。 */
        rb.textContent = (mine && mine.ready) ? "已排进本锅，等轮到你（点一下退出）" : "🙋 准备，参与本锅提问";
        rb.disabled = false;
      } else if (s.phase === "revealed") {
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
    /* 第⑥条：放弃投票卡（有投票才出现） */
    paintVote(s);
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
      if (!s.puzzleId) return "等房主选一锅汤。选好后大家点「我准备好了」。";
      return "汤已备好，已准备 " + ready + "/" + (s.players || []).length + "，全员准备后自动开锅。";
    }
    if (s.phase === "playing") {
      var who = (s.players || []).filter(function (p) { return p.uid === s.turnUid; })[0];
      var you = s.turnUid === myUid(s);
      /* 第⑦条：原「汤主的话」文案已合并进这里 */
      return (you ? "轮到你提问了，问一句「是 / 不是」能答的问题。" : "轮到 #" + (s.turnSeat || seatOf(s, s.turnUid)) + (who ? " " + who.nickname : "") + " 提问，你可以顺着问答记录想推理。") +
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
    /* 第④条：问答记录只留真正的「问 / 答 / 推理」，
       离开 / 撤回 / 超时 / 转让这类系统事件全部只进「实时对话」 */
    var qaOnly = log.filter(function (x) { return x.kind === "ask" || x.kind === "guess"; });
    /* 只在新内容真的到了才重建 DOM，避免每 1.5s 无意义重排。
       第③条修复：旧签名混入了 chatSeq —— 别人发一句房间聊天就把问答记录
       整栏重建，滚动位置被拍回 0，看起来就是「永远卡在开头十条」。 */
    var sig = qaOnly.length + "|" + (qaOnly.length ? qaOnly[qaOnly.length - 1].at : 0);
    if (box.__sig === sig) { ensureQaScroll(); return; }
    box.__sig = sig;
    if (!qaOnly.length) {
      box.innerHTML = '<p class="empty">还没有人提问。</p>';
      return;
    }
    box.innerHTML = qaOnly.map(function (x) {
      if (x.kind === "ask") {
        var lead1 = LEAD_TEXT[x.verdict] || "答";
        return '<div class="qa-item ' + esc(x.verdict || "") + '">' +
          '<div class="qa-q"><span class="qa-k">' + esc(x.nickname || ("#" + x.uid)) + "</span>" + esc(x.question) + "</div>" +
          '<div class="qa-a"><span class="qa-k verdict ' + esc(x.verdict || "") + '">' + esc(lead1) + "</span>" + esc(qaStrip(lead1, x.reply)) + "</div>" +
          "</div>";
      }
      if (x.kind === "guess") {
        return '<div class="qa-item guess ' + esc(x.level) + '">' +
          '<div class="qa-q"><span class="qa-k">推理</span>' + esc(x.nickname || ("#" + x.uid)) + "：" + esc(x.text) + "</div>" +
          '<div class="qa-a"><span class="qa-k">汤主</span>' + esc(qaStrip("", x.reply)) + "</div>" +
          "</div>";
      }
      return "";
    }).join("");
    /* 有新内容：清掉「已经滚到底」的记号，让慢速滚动重新接管 */
    box.__atBottom = false;
    ensureQaScroll();
  }

  /* ------------------------------------------------------------
   * 左栏「电影片尾」式自动慢速滚动（2026-09-25 重写）
   * ------------------------------------------------------------
   * 规则（主人指定）：
   *   - 电脑端与手机端都要自动慢滚：向下逐条展示，滚到底停一下，
   *     再回顶部继续循环；
   *   - 电脑端禁止手动拖动（滚轮 / 拖动 / 键盘全部拦掉）；
   *   - 手机端允许手动滑翻，但手一碰，自动滚动先让位 4 秒再接管；
   *   - 内容比容器短时不滚，静止显示。
   * 实现要点：
   *   - 按 dt 计速（24px/s），60Hz / 120Hz 屏一个速度；
   *   - 心跳看门狗：万一某帧抛异常把循环弄死，下一次 render 会自动重启，
   *     不会再出现「整栏卡死不动」；
   *   - 重建问答记录 DOM 不再被聊天消息触发（旧 sig 混入 chatSeq，
   *     别人每发一句聊天就把滚动拍回顶部）。
   */

  var QA_SPEED = 24;          /* px / 秒 */
  var QA_HOLD_MS = 4000;      /* 移动端手动滑动后的让位时长 */
  var qaRaf = 0;
  var qaPaused = 0;           /* 到底后停顿的截止时间戳 */
  var qaUserHold = 0;         /* 移动端手动接管：自动滚动暂停到此时刻 */
  var qaLastBeat = 0;         /* 循环心跳：看门狗用它判断循环是否假死 */
  var qaLastTs = 0;

  function qaScrollWanted() {
    /* 双端都自动滚：房间模式或单人对局屏可见即可（不再排除触屏 / 窄屏） */
    if (R.inRoom) return true;
    var game = document.getElementById("screen-game");
    return !!(game && !game.classList.contains("hidden"));
  }

  function ensureQaScroll() {
    var box = $("#qa-log");
    if (!box) return;
    blockManualScroll(box);
    /* 看门狗：循环自称在跑却 3 秒没心跳 → 判死，重启 */
    if (qaRaf && Date.now() - qaLastBeat > 3000) {
      cancelAnimationFrame(qaRaf);
      qaRaf = 0;
    }
    if (qaRaf) return;      /* 已经在跑 */
    qaLastTs = 0;
    var step = function (ts) {
      try {
        qaLastBeat = Date.now();
        var el = $("#qa-log");
        if (!el || !qaScrollWanted()) { qaRaf = 0; return; }
        var dt = qaLastTs ? Math.min((ts - qaLastTs) / 1000, 0.25) : 0.016;
        qaLastTs = ts;
        var over = el.scrollHeight - el.clientHeight;
        if (over <= 4) {
          /* 内容不够长：不动，也不花帧 */
          if (el.scrollTop !== 0) el.scrollTop = 0;
          qaRaf = 0;
          return;
        }
        var t = Date.now();
        if (t < qaUserHold || (qaPaused && t < qaPaused)) {
          qaRaf = requestAnimationFrame(step);
          return;
        }
        qaPaused = 0;
        el.scrollTop = el.scrollTop + QA_SPEED * dt;
        /* 到底了：停 1.6s，再回顶部继续 —— 给玩家时间看完最后一条 */
        if (el.scrollTop >= over - 1) {
          el.scrollTop = over;
          qaPaused = t + 1600;
          setTimeout(function () {
            var e2 = $("#qa-log");
            if (e2 && qaScrollWanted() && Date.now() >= qaUserHold) e2.scrollTop = 0;
          }, 1600);
        }
        qaRaf = requestAnimationFrame(step);
      } catch (e) {
        /* 任何异常都不许把循环弄死：交还句柄，等下一次 ensureQaScroll 重启 */
        qaRaf = 0;
      }
    };
    qaRaf = requestAnimationFrame(step);
  }

  function stopQaScroll() {
    if (qaRaf) { cancelAnimationFrame(qaRaf); qaRaf = 0; }
    qaPaused = 0;
    qaUserHold = 0;
  }

  function isCoarsePointer() {
    try {
      return !!(window.matchMedia && window.matchMedia("(pointer: coarse), (max-width: 860px)").matches);
    } catch (e) { return false; }
  }

  /* 手动滚动策略：
     - 桌面（fine pointer / 宽屏）：彻底锁死手动滚动，只留自动循环；
     - 触屏 / 窄屏：允许手指翻，但 touchstart / wheel 会把自动滚动按住 4 秒。 */
  function blockManualScroll(el) {
    if (!el || el.__block) return;
    if (isCoarsePointer()) {
      el.__block = true;
      ["touchstart", "wheel"].forEach(function (t) {
        el.addEventListener(t, function () {
          qaUserHold = Date.now() + QA_HOLD_MS;
        }, { passive: true });
      });
      return;
    }
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
      /* 第④条：实时对话才是系统事件与超时的家，这里 ask/guess/sys/timeout 全要 */
      return x.kind === "ask" || x.kind === "guess" || x.kind === "sys" || x.kind === "timeout";
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
          '<span class="fb-a">' + esc(qaStrip(LEAD_TEXT[x.verdict] || "答", x.reply)) + "</span></div>";
      }
      if (x.kind === "guess") {
        return '<div class="feed-row guess">' +
          '<span class="fb-name">' + esc(x.nickname || ("#" + x.uid)) + "</span>" +
          '<span class="fb-q">推理：' + esc(x.text) + "</span>" +
          '<span class="fb-stamp ' + esc(x.level) + '">' + esc(x.level === "solved" ? "说破" : "判") + "</span>" +
          '<span class="fb-a">' + esc(qaStrip(x.level === "solved" ? "说破" : "", x.reply)) + "</span></div>";
      }
      if (x.kind === "timeout") {
        return '<div class="feed-row timeout sys"><span class="fb-a">' +
          esc(x.reply || ((x.nickname || ("#" + x.uid)) + " 超时，已跳过")) + "</span></div>";
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
    if (!show) { el.classList.add("hidden"); el.textContent = "⏳ 90s"; return; }
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
    var byVote = !!s.giveUp;
    /* 第⑦条：猜出者的昵称挂在汤底框正上方，流光 + 弹跳小特效 */
    var winnerLine = s.winnerNick
      ? '<div class="winner-tag">' +
        '<span class="wt-spark" aria-hidden="true">✦</span>' +
        '<span class="wt-name">' + esc(s.winnerNick) + "</span>" +
        '<span class="wt-spark" aria-hidden="true">✦</span>' +
        "</div>"
      : "";
    host.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true">' +
      "<h3>汤底揭晓</h3>" +
      '<p class="end-note">' + (byVote ? "🏳️ 全房投票放弃，直接上汤底" : (s.winnerNick ? "🎉 " + esc(s.winnerNick) + " 说破了汤底" : "本锅结束")) + " · 共 " + ((s.qaLog || []).filter(function (x) { return x.kind === "ask"; }).length) + " 问</p>" +
      winnerLine +
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
    /* 第⑦条：说破汤底 = 礼炮 + 烟花 + 音效三连（celebrate 内部自带乐音）；
       投票放弃只放轻一点的揭底音 */
    if (s.winnerNick && !byVote) {
      if (root.SoupFx && root.SoupFx.celebrate) { try { root.SoupFx.celebrate(); } catch (e) { /* 忽略 */ } }
    } else if (root.SoupAudio && root.SoupAudio.sfx) {
      root.SoupAudio.sfx("reveal");
    }
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
    /* 第④条修复：playing 阶段只有「本锅首发」撤回才会整桌掀回大堂；
       中途加入 / 退出重进的人（不在 potUids 里）点按钮 = 准备排进本锅队尾，
       必须发 ready:true —— 旧代码在 playing 一律发 false，
       才会出现「点加入本锅反而退出队列」的死循环 bug。 */
    var inThisPot = !!(mine && (s.potUids || s.order || []).indexOf(mine.uid) !== -1);
    var withdraw = !!(s && s.phase === "playing" && inThisPot);
    var next = withdraw ? false : !(mine && mine.ready);
    act("ready", { ready: next }).then(function (snap) {
      if (snap && snap.exists) { R.snap = snap; render(snap); }
      R.toast(next
        ? (s && s.phase === "playing" ? "已准备，排进本锅提问队列，等轮到你" : "已准备，等其他人…")
        : (withdraw ? "已撤回，整桌回大堂" : "已退出本锅提问队列"));
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
        /* 第⑤条：正文开头往往自带一遍判定词（「是。死法正是…」），
           弹字前面又拼了标签，会出现「是 是。…」——这里同样走 qaStrip 去重。 */
        var leadT = LEAD_TEXT[r.item.verdict] || "";
        var bodyT = qaStrip(leadT, r.item.reply || "");
        R.toast("汤主：" + leadT + (bodyT ? " " + bodyT : ""));
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
          var lead2 = LEAD_TEXT[x.verdict] || "答";
          return '<div class="qa-item ' + esc(x.verdict || "") + '">' +
            '<div class="qa-q"><span class="qa-k">' + esc(x.nickname || ("#" + x.uid)) + "</span>" + esc(x.question) + "</div>" +
            '<div class="qa-a"><span class="qa-k verdict ' + esc(x.verdict || "") + '">' + esc(lead2) + "</span>" + esc(qaStrip(lead2, x.reply)) + "</div>" +
            "</div>";
        }
        if (x.kind === "guess") {
          return '<div class="qa-item guess ' + esc(x.level) + '">' +
            '<div class="qa-q"><span class="qa-k">推理</span>' + esc(x.nickname || ("#" + x.uid)) + "：" + esc(x.text) + "</div>" +
            '<div class="qa-a"><span class="qa-k">汤主</span>' + esc(qaStrip("", x.reply)) + "</div></div>";
        }
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
      var SA = window.SoupApp;
      listEl.insertAdjacentHTML("beforeend", arr.map(function (p) {
        var name = esc(p.dispTitle || p.title || "无题");
        var surf = esc(String(p.surface || "").slice(0, 60)) + (p.surface && p.surface.length > 60 ? "…" : "");
        var diff = esc(libDiffDots2(p.difficulty));
        var src = esc(p.src ? libShortSrc2(p.src) : "精品");
        /* tag 标签：和单人汤库同款胶囊，选汤时就能看到脑洞 / 悬疑 / 都市 等题材 */
        var cats = (p.cats || []).map(function (c) {
          return '<span class="pz-cat">' + esc(c) + "</span>";
        }).join("");
        /* 绿勾：与单人汤库共享同一份本地记录，谁玩过哪个汤都不一样 */
        var solv = !!(SA && SA.isSolved && SA.isSolved(p.id));
        return '<button type="button" class="pz-card' + (solv ? " solved" : "") + '" data-id="' + esc(p.id) + '">' +
          '<span class="pz-check' + (solv ? " on" : "") + '" data-check="' + esc(p.id) + '" role="checkbox" ' +
          'aria-checked="' + (solv ? "true" : "false") + '" title="标记为已熬出汤底">' + (solv ? "✓" : "") + "</span>" +
          '<div class="pz-title">' + name + "</div>" +
          '<div class="pz-surface">' + surf + "</div>" +
          '<div class="pz-meta"><span>' + diff + '</span><span>' + src + "</span></div>" +
          (cats ? '<div class="pz-cats">' + cats + "</div>" : "") +
          "</button>";
      }).join(""));
      /* 绿勾拦截：只标记，不进房选汤 */
      Array.prototype.forEach.call(listEl.querySelectorAll(".pz-check"), function (ck) {
        ck.addEventListener("click", function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          var SA2 = window.SoupApp;
          if (!SA2 || !SA2.toggleSolved) return;
          var id = ck.getAttribute("data-check");
          var on = SA2.toggleSolved(id);
          ck.classList.toggle("on", on);
          ck.textContent = on ? "✓" : "";
          ck.setAttribute("aria-checked", on ? "true" : "false");
          var card = ck.closest ? ck.closest(".pz-card") : null;
          if (card) card.classList.toggle("solved", on);
          R.toast(on ? "已标记：这道汤你熬出过汤底" : "已取消标记");
        });
      });
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
      R.toast("随机一锅：" + (pick.dispTitle || pick.title || "无题"));
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

  /* 密码看汤底（权区）：正确密码 608521。只在本机弹出汤底，不改房间阶段。
     这是「噜噜大王」的专属后门，文案走搞怪风；按钮独立放在别的区域，不跟提问 / 猜底挤一起。 */
  var TRUTH_CODE = "608521";
  function doUnlock(solo) {
    var host = document.createElement("div");
    host.className = "modal-wrap";
    host.innerHTML =
      '<div class="modal modal-unlock" role="dialog" aria-modal="true" aria-labelledby="unlock-title">' +
      '<h3 id="unlock-title" class="unlock-head">🔑 密码看汤底（权区）</h3>' +
      '<p class="modal-sub unlock-sub">此密码只有勤奋迷人善良可爱纯洁的本项目主——噜噜大王！才知晓，闲杂人等速速退去！耶嘿嘿嘿！！！</p>' +
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

    /* 本地找汤底：精品层在 PUZZLES，汤库层在 SOUP_LIBRARY / LIB。
       【策略】汤底明文公开（js/library.public.js 含 truth），所以单人 / 多人
       都能直接查，不必等房号进 revealed 阶段 —— 这正是「密码看汤底」的意义。 */
    function localTruth(pid) {
      if (!pid) return "";
      var pools = [root.PUZZLES, root.SOUP_LIBRARY, root.LIB];
      for (var k = 0; k < pools.length; k++) {
        var list = pools[k];
        if (!list || !list.length) continue;
        for (var i = 0; i < list.length; i++) {
          if (list[i] && list[i].id === pid) {
            if (list[i].truth) return String(list[i].truth);
            break;   /* 同一 id 只在一层，找到就够 */
          }
        }
      }
      /* 引擎索引也会命中核心层：再退一步问它 */
      var E2 = root.SoupEngine;
      var p = E2 && E2.getPuzzle ? E2.getPuzzle(pid) : null;
      return (p && p.truth) ? String(p.truth) : "";
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
        var pid0 = root.SoupApp && root.SoupApp.pid ? root.SoupApp.pid() : "";
        reveal(localTruth(pid0) || "这一锅没有汤底。");
        return;
      }
      /* 多人房：先看本地汤库（含真底），拿不到再向服务端要。
         服务端只在 phase=revealed 才给底，所以以前没开锅时
         密码输了也会回一句「这一锅没有汤底」—— 现在本地兜住。 */
      var s = R.snap || {};
      var puzzleId = s.puzzleId || "";
      var mine = localTruth(puzzleId);
      if (mine) { reveal(mine); return; }
      if (s.truth) { reveal(s.truth); return; }
      var code = s.roomCode || (me().roomCode || "");
      if (!code || !puzzleId || !N || !N.libTruth) {
        fb.textContent = "还没有开锅，暂时没有汤底可看。";
        fb.className = "guess-feedback no";
        return;
      }
      fb.textContent = "密码正确，正在取汤底…";
      fb.className = "guess-feedback";
      N.libTruth(code, puzzleId).then(function (t) {
        reveal(t || localTruth(puzzleId) || "这一锅没有汤底。");
      });
    }
    host.querySelector("#unlock-ok").addEventListener("click", submit);
    host.querySelector("#unlock-cancel").addEventListener("click", close);
    input.addEventListener("keydown", function (ev) { if (ev.key === "Enter") submit(); });
    setTimeout(function () { input.focus(); }, 30);
  }

  /* ------------------------------------------------------------
   * 第⑥条（重做）：「放弃」投票 —— 替代旧「权」密码按钮
   * 任何人游戏途中随时点；全房弹投票卡（同意 / 拒绝）；
   * 同意人数 ≥ 房间人数 - 1 → 服务端直接揭本锅汤底。
   * ------------------------------------------------------------ */
  var voteTick = 0;

  function doGiveup() {
    act("giveup", {}).then(function (r) {
      R.toast("🏳️ 已发起「放弃看汤底」投票，全房 60 秒内表态");
      if (r && r.snapshot && r.snapshot.exists) { R.snap = r.snapshot; render(r.snapshot); }
      startWatch();
    }).catch(function (e) {
      var m = e.message;
      if (m === "NOT_PLAYING") R.toast("这锅还没在打，不用放弃");
      else if (m === "VOTE_RUNNING") R.toast(e.note || "已有放弃投票进行中，先投完这一轮");
      else R.toast("发起投票失败：" + m);
    });
  }

  function castVote(yes) {
    act("vote", { agree: !!yes, yes: !!yes }).then(function (r) {
      if (r && r.passed) R.toast("🏳️ 放弃投票通过，上汤底！");
      else if (r && r.passed === false) R.toast("放弃被否决，继续熬");
      if (r && r.snapshot && r.snapshot.exists) { R.snap = r.snapshot; render(r.snapshot); }
      startWatch();
    }).catch(function (e) {
      var m = e.message;
      if (m === "NO_VOTE") R.toast("这一轮投票已经结束了");
      else R.toast(e.note || ("投票失败：" + m));
      startWatch();
    });
  }

  function voteSubText(v, left) {
    var you = v.youYes ? "你：同意" : (v.youNo ? "你：拒绝" : "你：未投");
    return "同意 " + v.yes + " / 需 " + v.need + "（共 " + v.total + " 人） · 拒绝 " + v.no +
      " · " + you + " · 剩 " + left + "s";
  }

  function paintVote(s) {
    var v = s && s.vote;
    var card = $("#vote-card");
    if (!v || s.phase !== "playing") {
      if (card) card.classList.add("hidden");
      if (voteTick) { clearInterval(voteTick); voteTick = 0; }
      return;
    }
    if (!card) {
      card = document.createElement("div");
      card.id = "vote-card";
      card.className = "vote-card";
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-label", "放弃投票");
      card.innerHTML =
        '<div class="vc-title" id="vc-title"></div>' +
        '<div class="vc-sub" id="vc-sub"></div>' +
        '<div class="vc-actions">' +
        '<button type="button" class="btn vc-yes" id="vc-agree">👍 同意</button>' +
        '<button type="button" class="btn vc-no" id="vc-reject">👎 拒绝</button>' +
        "</div>";
      document.body.appendChild(card);
      card.querySelector("#vc-agree").addEventListener("click", function () { castVote(true); });
      card.querySelector("#vc-reject").addEventListener("click", function () { castVote(false); });
    }
    card.classList.remove("hidden");
    var t = $("#vc-title", card);
    if (t) t.textContent = "🏳️ " + (v.byNick || "有玩家") + " 想放弃本锅，直接看汤底";
    var left = Math.max(0, Math.ceil((v.until - Date.now()) / 1000));
    var sub = $("#vc-sub", card);
    if (sub) sub.textContent = voteSubText(v, left);
    var ya = $("#vc-agree", card), yn = $("#vc-reject", card);
    if (ya) ya.classList.toggle("on", !!v.youYes);
    if (yn) yn.classList.toggle("on", !!v.youNo);
    /* 本地秒表：不用等下一轮轮询，倒计时数字也在走 */
    if (!voteTick) {
      voteTick = setInterval(function () {
        var snap = R.snap || {};
        var vv = snap.vote;
        var c = $("#vote-card");
        if (!c || !vv || snap.phase !== "playing") {
          if (c) c.classList.add("hidden");
          clearInterval(voteTick); voteTick = 0;
          return;
        }
        var l2 = Math.max(0, Math.ceil((vv.until - Date.now()) / 1000));
        var s2 = $("#vc-sub", c);
        if (s2) s2.textContent = voteSubText(vv, l2);
      }, 1000);
    }
  }

  /* 第⑨条：房主转让。两段式确认，防手滑点错人 */
  var pendingTransfer = "";
  function doTransfer(uid) {
    var s = R.snap || {};
    var target = (s.players || []).filter(function (p) { return p.uid === uid; })[0];
    if (!target) return;
    var key = String(uid);
    if (pendingTransfer !== key) {
      pendingTransfer = key;
      R.toast("再点一次「转让房主」，把房主交给 " + target.nickname);
      setTimeout(function () { if (pendingTransfer === key) pendingTransfer = ""; }, 4000);
      return;
    }
    pendingTransfer = "";
    act("transfer", { uid: uid }).then(function () {
      R.toast("房主已转让给 " + target.nickname);
      startWatch();
    }).catch(function (e) {
      var m = e.message;
      if (m === "ONLY_HOST") R.toast("只有房主能转让");
      else if (m === "ALREADY_HOST") R.toast("TA 已经是房主了");
      else R.toast("转让失败：" + m);
    });
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
    var bu = $("#btn-room-giveup"); if (bu) bu.addEventListener("click", doGiveup);
    var bai = $("#btn-room-ai"); if (bai) bai.addEventListener("click", doAi);

    /* 玩家列表里的「请离死座位」是动态生成的，用事件委托接 */
    var pb = $("#room-players");
    if (pb) pb.addEventListener("click", function (ev) {
      var b = ev.target.closest ? ev.target.closest("[data-kick],[data-transfer]") : null;
      if (!b) return;
      ev.preventDefault();
      if (b.hasAttribute("data-transfer")) { doTransfer(Number(b.getAttribute("data-transfer"))); return; }
      doKick(Number(b.getAttribute("data-kick")));
    });

    /* 聊天（新①） */
    var ct = $("#btn-room-chat-toggle"); if (ct) ct.addEventListener("click", function () { toggleChat(); });
    var cs = $("#btn-room-chat-send"); if (cs) cs.addEventListener("click", doChat);
    var ci = $("#room-chat-input");
    if (ci) ci.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); doChat(); } });

    /* 第①条修复（移动端打字）：键盘弹起时旧 CSS 会把整个聊天框 display:none，
       输入框一被藏起来就失焦 → 键盘秒开秒收，永远打不了字。
       现在焦点在聊天框里就给 body 挂 .chat-kb：CSS 据此改为
       「把聊天框整体抬到键盘上方」，而不是收掉它。 */
    if (ci) {
      ci.addEventListener("focus", function () { document.body.classList.add("chat-kb"); });
      ci.addEventListener("blur", function () {
        setTimeout(function () {
          var a = document.activeElement;
          if (a && a.closest && a.closest("#room-chat")) return;   /* 焦点还在框内（比如发送键） */
          document.body.classList.remove("chat-kb");
        }, 120);
      });
    }

    var jc = $("#room-join-code");
    if (jc) jc.addEventListener("keydown", function (ev) { if (ev.key === "Enter") joinRoom(); });

    /* 断点监听：窗口从宽屏变窄（或反过来）时，让聊天框在右栏与右下角之间正确归位 */
    watchBreakpoint();
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
    stopQaScroll: stopQaScroll,
    blockQaScroll: function () {
      var box = $("#qa-log");
      if (box) blockManualScroll(box);
    },
    doUnlock: doUnlock,
    /* 从房间界面切走（去汤库 / 随机 / 单人对局）：停轮询、收起房间屏、摘掉 room-mode，
       并把右下角聊天框藏起来 —— 它只属于「正在多人房间内」的状态 */
    leaveScreen: function () {
      stopWatch();
      stopQaScroll();
      paintVote(null);
      R.inRoom = false;
      var sr = document.getElementById("screen-room");
      if (sr) sr.classList.add("hidden");
      document.body.classList.remove("room-mode");
      syncChatVisibility();
    },
    /* 让单人侧（app.js）在切屏 / 进汤时也能同步聊天框显隐与「汤主的话」归位 */
    syncChat: syncChatVisibility,
    syncTip: syncTipPlacement,
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
