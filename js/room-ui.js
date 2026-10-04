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

  /* ---- 在场标签（2026-10-03 重做）----
   * 在线 = 对方屏幕里看得见本项目；离线 = 看不见。绿字带时长「在线 2 分」，
   * 红字带时长「离线 40 秒」，谁在谁不在一眼分明。时长由本地秒表自己走，
   * 不用等下一轮快照（房间安静时快照是 unchanged 的）。 */
  function durShort(ms) {
    var sec = Math.max(0, Math.floor(ms / 1000));
    if (sec < 60) return sec + "秒";
    var m = Math.floor(sec / 60);
    if (m < 60) return m + "分" + (sec % 60 >= 10 ? sec % 60 : (sec % 60 ? "0" + (sec % 60) : ""));
    var h = Math.floor(m / 60);
    return h + "小时" + (m % 60 < 10 ? "0" : "") + (m % 60) + "分";
  }
  function presenceText(on, since) {
    var base = Number(since) || 0;
    var dur = base ? durShort(Date.now() - base) : "";
    return (on ? "在线" : "离线") + (dur ? " " + dur : "");
  }
  function presenceTag(p) {
    var on = !!p.online;
    var since = p.stateSince || p.lastSeen || 0;
    return '<span class="rp-pres ' + (on ? "on" : "off") + '" data-on="' + (on ? 1 : 0) +
      '" data-since="' + since + '">' + presenceText(on, since) + "</span>";
  }
  var presTick = 0;
  function startPresenceTicker() {
    if (presTick) return;
    presTick = setInterval(function () {
      if (!R.inRoom) return;
      var nodes = document.querySelectorAll(".rp-pres");
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        el.textContent = presenceText(el.getAttribute("data-on") === "1", el.getAttribute("data-since"));
      }
    }, 1000);
  }

  /* ---- 图标与战况数据小工具（2026-09-26）----
     界面里的 emoji 全部换成 js/icons.js 的同风格线性 SVG；
     没挂上图标库时降级成空字符串，绝不把半成品贴到屏幕上。 */
  function ic(name, cls) {
    return (typeof root.SoupIcon === "function") ? root.SoupIcon(name, cls) : "";
  }
  /* 用时→人话：48秒 / 5分12秒 / 1小时02分 */
  function fmtDur(ms) {
    if (!isFinite(ms) || ms <= 0) return "—";
    var sec = Math.round(ms / 1000);
    if (sec < 60) return sec + "秒";
    var m = Math.floor(sec / 60), s2 = sec % 60;
    if (m < 60) return m + "分" + (s2 ? s2 + "秒" : "");
    var h = Math.floor(m / 60);
    return h + "小时" + (m % 60 ? (m % 60 < 10 ? "0" : "") + (m % 60) + "分" : "");
  }
  /* 三个战况数据小格：个人提问数 / 全桌总提问数 / 从开锅算起的用时 */
  function statBoxesHtml(st, cls) {
    if (!st) return "";
    return '<div class="guess-stats' + (cls ? " " + cls : "") + '">' +
      '<div class="gs"><i>个人提问</i><b>' + (st.askMine || 0) + " 次</b></div>" +
      '<div class="gs"><i>全桌提问</i><b>' + (st.askTotal || 0) + " 次</b></div>" +
      '<div class="gs"><i>用时</i><b>' + fmtDur(st.ms) + "</b></div>" +
      "</div>";
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
    turnUid: null,      /* 上一拍观测到的「该谁」，用来判定是不是真换手 */
    /* ---- 多人「私有猜底」大改（2026-09-25）---- */
    mySolvedShown: false, /* 个人说破弹窗（含刷新恢复）每次进锅只弹一次 */
    personalOpen: false,  /* 个人说破弹窗当前开着：全员揭底等它关完再弹，不叠罗汉 */
    cgSeenSeq: 0,         /* 已响过音效的汤主报喜 seq，防止每次重绘都叮 */
    atRung: 0,            /* 已经响过 @ 提示音的水位（运行时，不落盘） */
    atSeeded: false,      /* 进房第一拍是否已把历史里的 @ 记成已读 */
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

  /* 第⑪条（改）：右栏备忘录常驻 —— 首页 / 汤库 / 随机 / 单人对局 / 汤屋建房页都挂着，
     只有真正在房内时让位给「房间聊天」（聊天框要占同一个右栏位置）。 */
  function syncMemoVisibility() {
    var memo = document.getElementById("solo-memo");
    if (!memo) return;
    var live = $("#room-live");
    var wantMemo = !(live && !live.classList.contains("hidden") && R.inRoom);
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
    R.turnUid = null;
    R.atRung = 0;
    R.atSeeded = false;
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
    R.atSeeded = false;
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
    return N.promptNickname({ title: "起个昵称，进汤屋", sub: "昵称最长 12 个字，不能和屋里其他人重名——同名会分不清谁是谁。" });
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
    tryJoin(code, 0);
  }

  /* 撞名当场再问一次（最多三轮）；如果撞上的那个同名座位其实已经离线很久，
     就说明很可能是「你自己的旧座位」，直接给一次「认领」的机会。 */
  function tryJoin(code, tries) {
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
      else if (m === "NICKNAME_TAKEN") {
        var d = (e && e.data) || {};
        if (d.reclaimAvailable) {
          askConfirm({
            title: "认领你的旧座位？",
            desc: "屋里有一个同名的座位已经离开 " + Math.max(1, Math.round((d.idleMs || 0) / 60000)) + " 分钟。" +
              "如果那就是你自己（换设备 / 清过缓存后重新进来），点认领坐回原来那把椅子；" +
              "如果不是你，请换一个昵称，别把别人顶掉。",
            yes: "是我，认领",
            danger: true
          }, function () { claimSeat(code); });
          return;
        }
        R.toast((e && e.note) || "这个昵称屋里已经有人用了，换一个");
        if (tries < 2) { tryJoin(code, tries + 1); return; }
      } else R.toast("进房失败：" + m);
    });
  }

  function claimSeat(code) {
    var nick = me().nickname;
    R.toast("正在认领旧座位…");
    N.joinRoom(code, nick, { reclaim: true }).then(function (snap) {
      showLive();
      R.toast("已坐回 " + (snap.roomCode || code) + " 的老位置");
      startWatch();
    }).catch(function (e) {
      var m = String((e && e.message) || e);
      if (m === "NICKNAME_TAKEN") R.toast("那个座位已经有人坐上了，换个昵称再进");
      else if (m !== "CANCELLED") R.toast("认领失败：" + m);
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

    /* 孤儿座位兜底：画面还停在房间里，但服务端名单里已经没有「我」了 ——
       要么被房主请离、要么身份被换过。与其让所有按钮默默报错，不如说清楚并退回门口。 */
    if (R.inRoom && s.exists && !s.youUid) {
      R.toast("你已经不在这个房间里了（座位被请离或身份失效），请重新用房号进房。");
      showEntry();
      return;
    }
    startPresenceTicker();

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
        /* 私有猜底大改：说破的人挂金徽章（聊天里汤主已报喜，不算剧透） */
        if (p.solved) tags.push('<span class="room-tag solved">' + ic("trophy") + " 说破</span>");
        if (s.phase === "playing" && s.turnUid === p.uid) tags.push('<span class="room-tag turn">' + (mine && p.uid === mine.uid ? "该你问" : "该他问") + "</span>");
        /* 房主可请离 / 转让任意在座玩家；离线超过 1 分钟的单独标成死座位 */
        if (isHostMe && !p.isHost) {
          tags.push('<button type="button" class="btn ghost rp-kick" data-kick="' + p.uid + '">' +
            (p.seatRemovable ? "请离死座位" : "请离") + "</button>");
          tags.push('<button type="button" class="btn ghost rp-transfer" data-transfer="' + p.uid + '">转让房主</button>');
        }
        return '<div class="room-player' + (p.online ? "" : " off") + (mine && p.uid === mine.uid ? " self" : "") + '">' +
          '<span class="rp-uid">#' + seat + "</span>" +
          '<span class="rp-name" data-at="' + p.uid + '" data-at-nick="' + esc(p.nickname) + '" title="点一下：在聊天框里 @ 这个人">' + esc(p.nickname) + "</span>" +
          '<span class="rp-state ' + (p.ready ? "ready" : "wait") + '">' + (p.ready ? "已准备" : "未准备") + "</span>" +
          presenceTag(p) +
          tags.join("") +
          "</div>";
      }).join("");
    }
    var cnt = $("#room-count");
    if (cnt) cnt.textContent = (s.players || []).length + "/15";

    /* 阶段提示 */
    var ph = $("#room-phase");
    if (ph) ph.innerHTML = phaseText(s, mine);

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
    /* 发言顺序条：按编号轮转，看得见「还差几棒轮到自己」 */
    paintQueue(s);

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
       没轮到自己时输入框仍然能打字（提前写好下一句），只锁「提问」按钮。
       私有猜底大改：已说破的人从此刻起只旁观：锁提问，聊天框照常可以递提示。 */
    var iSolved = !!(s.mySolved || (mine && mine.solved));
    var myTurn = !iSolved && s.phase === "playing" && s.turnUid === myUid(s);
    var pending = s.pendingAI || null;
    /* 上一句还没回来（服务端飞行锁 + 本地 askBusy），才锁住发送 */
    var canAsk = myTurn && !pending && !R.askBusy;
    var qi = $("#room-q-input");
    if (qi) {
      qi.disabled = iSolved && s.phase === "playing";
      qi.readOnly = qi.disabled;
      qi.placeholder = iSolved && s.phase === "playing"
        ? "你已说破汤底 —— 安静看大家一问一答，想递话去右下角聊天框…"
        : (pending
          ? "可以先写下轮到你时要问的话…"
          : (myTurn ? "轮到你了，向汤主提问…" : "没轮到你也可以先写好问题，轮到再发送"));
    }
    noteTurn(s, myTurn);
    var ba = $("#btn-room-ask");
    if (ba) {
      ba.disabled = !canAsk;
      /* 按钮就地变文案 + 带省略号动效，点完立刻有反馈（多①） */
      ba.textContent = R.askBusy ? "汤主思考中…" : (iSolved && s.phase === "playing" ? "旁观中" : "提问");
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
      if (s.phase === "playing" && iSolved) {
        /* 已说破：不再撤回也不再排队，本锅只剩旁观 */
        rb.innerHTML = ic("trophy") + " 已说破 · 旁观本锅";
        rb.disabled = true;
      } else if (s.phase === "playing" && inThisPot) {
        /* 2026-10-03：撤回只影响自己，不再掀全桌的桌子 */
        rb.textContent = "退出本锅（只停自己，不打断别人）";
        rb.disabled = false;
      } else if (s.phase === "playing") {
        /* 第④条：中途进来 / 退出重进的人，点一下 = 准备并插进本锅的编号序列，
           不影响任何人；已排上的人再点才是退出队列（文案说清楚，防手滑）。 */
        rb.innerHTML = (mine && mine.ready) ? "已排进本锅，等轮到你（点一下退出）" : ic("hand") + " 准备以加入本锅提问";
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
    /* 多人私有猜底（个人揭底）：猜对那一刻只弹猜对者自己的屏幕——
       POST 当场由 submit 直接弹；刷新 / 断线重进凭快照 myTruth 在这里补弹。 */
    if (s.phase === "playing" && iSolved && s.myTruth && !R.mySolvedShown) {
      R.mySolvedShown = true;
      /* 刷新 / 断线重进也要带上战况三格：从排行榜名单里拿冻结好的 stats */
      var myEntry = (s.solveOrder || []).filter(function (o) { return o.rank === s.myRank; })[0];
      showMySolvedPopup({ truth: s.myTruth, rank: s.myRank, total: s.potCount, stats: myEntry && myEntry.stats });
    }
    if (s.phase !== "playing" || !iSolved) R.mySolvedShown = false;
    /* 揭底（全员说破 / 投票放弃才走到这里；单人说破同一条通道） */
    if (s.phase === "revealed" && s.truth && !R.revealedShown && !R.personalOpen) {
      R.revealedShown = true;
      showReveal(s);
    }
    if (s.phase !== "revealed") R.revealedShown = false;

    paintCooldown(s);
    /* 第⑥条：放弃投票卡（有投票才出现） */
    paintVote(s);
  }

  /* 轮到自己：整屏轻闪 + 横幅。铃只在「上一棒是别人、这一棒交给我」的真换手时响一次。 */
  function noteTurn(s, myTurn) {
    var uid = (s && s.phase === "playing" && s.turnUid) ? s.turnUid : null;
    var key = uid ? (String(s.puzzleId || "") + ":" + uid + ":" + (s.turnDeadline || 0)) : "";
    if (key === R.seenTurn) return;
    var prevUid = R.turnUid;    /* 上一拍真正观测到的「该谁」；null = 刚进房 / 刚刷新 */
    R.seenTurn = key;
    R.turnUid = uid;
    document.body.classList.toggle("my-turn", !!myTurn);
    if (!myTurn) return;
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
    /* 异响的根源就写在旧条件里：只要快照换了 key 就响，于是刚进房、刚刷新、
       切回前台补拉那几拍，都可能凭空炸出一串比雷声还响的三连铃。
       现在只认真换手，且后台标签页一律不响。 */
    if (prevUid === null || prevUid === uid) return;
    if (document.hidden) return;
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
    var iSolved = !!(s.mySolved || (mine && mine.solved));
    if (s.phase === "lobby") {
      var ready = (s.players || []).filter(function (p) { return p.ready; }).length;
      if (!s.puzzleId) return "等房主选一锅汤。选好后大家点「我准备好了」。";
      return "汤已备好，已准备 " + ready + "/" + (s.players || []).length + "，全员准备后自动开锅。";
    }
    if (s.phase === "playing") {
      var solvedN = (s.solveOrder || []).length;
      var totalN = s.potCount || (s.players || []).length;
      if (iSolved) {
        return ic("trophy") + " 你已说破汤底：一问一答对你停了，安静看大家熬；想递话可以去聊天框打字。"
          + (solvedN >= totalN ? "" : "还在熬的只剩 " + (totalN - solvedN) + " 位，全员说破才统一揭底。");
      }
      var who = (s.players || []).filter(function (p) { return p.uid === s.turnUid; })[0];
      var you = s.turnUid === myUid(s);
      var wait = s.turnsUntilMe;
      var head = you
        ? "轮到你提问了，问一句「是 / 不是」能答的问题。"
        : (who
          ? "轮到 #" + (s.turnSeat || seatOf(s, s.turnUid)) + " " + who.nickname + " 提问" +
            (typeof wait === "number" && wait > 0 ? "，再过 " + wait + " 棒就轮到你（按编号 #" + (s.youSeat || "?") + " 往后顺）" : "") +
            "，你可以顺着问答记录想推理。"
          : "都在等你这一句——问吧。");
      if (solvedN > 0) head += "本锅已有 " + solvedN + "/" + totalN + " 人说破"
        + (totalN - solvedN === 1 && solvedN > 0 ? "，只剩你一个，加油！" : "。");
      return head + "嫌慢可以随时猜汤底——你猜了什么、汤主怎么判，全桌只有你自己看得到。";
    }
    if (s.phase === "revealed") {
      if (s.allSolved) {
        return ic("party") + " 全员说破，本锅圆满收官！汤底与排行榜已统一展示，房主可以选下一锅。";
      }
      var sn = (s.solveOrder || []).length;
      return "汤底已揭晓——" + (s.giveUp ? ic("flag") + " 全房投票放弃。" : (s.winnerNick ? "恭喜 " + esc(s.winnerNick) + " 说破。" : ""))
        + (sn ? "本锅共 " + sn + " 人抢先说破。" : "") + "房主可以选下一锅。";
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
    /* 第④条：问答记录只留真正的「问 / 答」；私有猜底大改（2026-09-25）：
       猜汤底的内容与判定彻底退出问答记录与实时对话，只活在猜的人自己手里 */
    var qaOnly = log.filter(function (x) { return x.kind === "ask"; });
    /* 只在新内容真的到了才重建 DOM，避免每 1.5s 无意义重排。
       第③条修复：旧签名混入了 chatSeq —— 别人发一句房间聊天就把问答记录
       整栏重建，滚动位置被拍回 0，看起来就是「永远卡在开头十条」。 */
    var sig = qaOnly.length + "|" + (qaOnly.length ? qaOnly[qaOnly.length - 1].at : 0);
    if (box.__sig === sig) { ensureQaScroll(); return; }
    box.__sig = sig;
    /* 重建前记住看到哪了：新内容到了不该把玩家正读的位置拍回顶部 */
    var keepTop = box.scrollTop;
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
    box.scrollTop = keepTop;
    /* 有新内容：清掉「已经滚到底」的记号，让慢速滚动重新接管 */
    box.__atBottom = false;
    ensureQaScroll();
  }

  /* ------------------------------------------------------------
   * 左栏「电影片尾」式自动慢速滚动（2026-09-25 第二次彻查重写）
   * ------------------------------------------------------------
   * 规则（主人指定）：
   *   - 双端都自动慢滚：向下逐条展示，滚到底停一下，再回顶部继续循环；
   *   - 双端也都允许手动翻（滚轮 / 触屏 / 滚动条 / 键盘）：
   *     手一碰，自动滚动先让位 4 秒，再从玩家停下的位置接着滚。
   *
   * PC 端卡死的真正根因（本次 CDP 实测定位）：
   *   桌面浏览器的 scrollTop 会被取整——24px/秒 ÷ 60帧 = 每帧 0.4px，
   *   「el.scrollTop = el.scrollTop + 0.4」在取整浏览器里被四舍五入吞掉，
   *   读回来永远是原值，滚动位置原地踏步；移动端浏览器支持小数滚动偏移，
   *   所以「手机好好的、电脑一动不动」。上一版还顺手用 overflow:hidden +
   *   preventDefault 把 PC 手动滚动也锁死了，两头都不动。
   * 本次修法：
   *   - 浮点累加器 qaPos：小数部分攒在 JS 里，scrollTop 只接受赋值，
   *     取整浏览器约 42ms 走 1px，小数浏览器连续平滑，两端都成立；
   *   - 每帧比对实际位置，差超过 1.5px（玩家翻了 / DOM 重建）就顺势跟随，
   *     不再跟用户抢方向盘；
   *   - 彻底移除桌面端的手动滚动封锁与 overflow:hidden。
   */

  var QA_SPEED = 24;          /* px / 秒 */
  var QA_HOLD_MS = 4000;      /* 手动滑动后自动滚动的让位时长 */
  var qaRaf = 0;
  var qaPaused = 0;           /* 到底后停顿的截止时间戳 */
  var qaUserHold = 0;         /* 手动接管：自动滚动暂停到此时刻 */
  var qaLastBeat = 0;         /* 循环心跳：看门狗用它判断循环是否假死 */
  var qaLastTs = 0;
  var qaAcc = 0;              /* 节流累加器：约 30fps 才写一次 scrollTop */
  var qaPos = 0;              /* 浮点滚动累加器（根因修复的核心） */

  function qaScrollWanted() {
    /* 双端都自动滚：房间模式或单人对局屏可见即可（不再排除触屏 / 窄屏） */
    if (R.inRoom) return true;
    var game = document.getElementById("screen-game");
    return !!(game && !game.classList.contains("hidden"));
  }

  function ensureQaScroll() {
    var box = $("#qa-log");
    if (!box) return;
    watchManualScroll(box);
    /* 看门狗：循环自称在跑却 3 秒没心跳 → 判死，重启 */
    if (qaRaf && Date.now() - qaLastBeat > 3000) {
      cancelAnimationFrame(qaRaf);
      qaRaf = 0;
    }
    if (qaRaf) return;      /* 已经在跑 */
    qaLastTs = 0;
    qaAcc = 0;
    var step = function (ts) {
      try {
        qaLastBeat = Date.now();
        var el = $("#qa-log");
        if (!el || !qaScrollWanted()) { qaRaf = 0; return; }
        var frameDt = qaLastTs ? Math.min((ts - qaLastTs) / 1000, 0.25) : 0.016;
        qaLastTs = ts;
        /* 省电（2026-09-27）：每帧写 scrollTop 会逼浏览器重排重绘这个盒子，
           120Hz ProMotion 屏上等于每秒 120 次。滚动速度只有 ~12px/s，
           按 33ms 节流完全看不出差别，重绘直接省掉 3/4。 */
        qaAcc += frameDt;
        if (qaAcc < 0.033) {
          qaRaf = requestAnimationFrame(step);
          return;
        }
        var dt = qaAcc;
        qaAcc = 0;
        var over = el.scrollHeight - el.clientHeight;
        if (over <= 4) {
          /* 内容不够长：不动，也不花帧 */
          if (el.scrollTop !== 0) el.scrollTop = 0;
          qaPos = 0;
          qaRaf = 0;
          return;
        }
        var t = Date.now();
        if (t < qaUserHold || (qaPaused && t < qaPaused)) {
          /* 玩家正在翻 / 到底停顿中：跟随实际位置，松手不抢方向盘 */
          qaPos = el.scrollTop;
          qaRaf = requestAnimationFrame(step);
          return;
        }
        qaPaused = 0;
        /* 位置对不上号（玩家翻了 / DOM 重建 / 外部归零）：先跟随再继续 */
        if (Math.abs(el.scrollTop - qaPos) > 1.5) qaPos = el.scrollTop;
        qaPos += QA_SPEED * dt;
        if (qaPos >= over) {
          /* 到底了：停 1.6s，再回顶部继续 —— 给玩家时间看完最后一条 */
          qaPos = over;
          el.scrollTop = over;
          qaPaused = t + 1600;
          setTimeout(function () {
            var e2 = $("#qa-log");
            if (e2 && qaScrollWanted() && Date.now() >= qaUserHold) {
              e2.scrollTop = 0;
              qaPos = 0;
            }
          }, 1600);
        } else {
          el.scrollTop = qaPos;
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
    qaPos = 0;
  }

  /* 手动滚动交互（2026-09-25 彻查后改版）：
     双端一律允许滚轮 / 触屏 / 滚动条 / 键盘翻页，不再 preventDefault 拦人；
     手一碰就把自动滚动按住 QA_HOLD_MS 毫秒，让位结束后从当前位置继续。 */
  function watchManualScroll(el) {
    if (!el || el.__block) return;
    el.__block = true;
    function hold() { qaUserHold = Date.now() + QA_HOLD_MS; }
    ["wheel", "touchstart", "mousedown"].forEach(function (t) {
      el.addEventListener(t, hold, { passive: true });
    });
    el.addEventListener("keydown", function (ev) {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].indexOf(ev.key) !== -1) hold();
    });
  }

  /* ---------------- 实时对话流（多⑤）：中区看当下 ----------------
   * 每个人的提问 + 汤主回答按时间顺序往下叠，最新的自动滚到底。
   * 与左栏（回顾跑马灯）、二级面板（查全部）同源同序，分工不同。
   */
  function renderFeed(s) {
    var box = $("#room-feed");
    if (!box) return;
    var log = (s.qaLog || []).filter(function (x) {
      /* 第④条：实时对话才是系统事件与超时的家；猜底条目一律不上（只留 ask/sys/timeout） */
      if (x.kind !== "ask" && x.kind !== "sys" && x.kind !== "timeout") return false;
      /* 在场翻转的流水账：服务端已不再产生，这里再把旧房遗留的那几条滤掉，
         免得人一多整屏都是「回到了屏幕前 / 先记为离线」，正事反而看不见。 */
      if (x.kind === "sys" && /回到了屏幕前|先记为离线|离开了屏幕/.test(x.text || "")) return false;
      return true;
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

  /* ---- @点名（2026-10-03）----
   * 被 @ 的人：独特短音 + 聊天标题上的红点 + 那一条整块黄色高亮（类 Discord），
   * 点开聊天框才清红点。水印按「房号 + 自己 uid」存本机，刷新不会把历史重放一遍。 */
  function atKey(s) {
    var snap = s || R.snap || {};
    return "soup.at." + (snap.roomCode || me().roomCode || "?") + "." + (snap.youUid || myUid(snap) || "?");
  }
  function atSeen(s) {
    try {
      var v = Number(localStorage.getItem(atKey(s)));
      if (isFinite(v) && v > 0) return v;
      /* 第一次进房：把已有历史算作看过，别一进来就被旧消息炸一串 */
      var log = (s && s.chatLog) || [];
      var lastSeq = log.length ? (log[log.length - 1].seq || 0) : 0;
      if (lastSeq) { try { localStorage.setItem(atKey(s), String(lastSeq)); } catch (e) { } }
      return lastSeq;
    } catch (e) { return 0; }
  }
  function atMarkSeen(s, seq) {
    try { localStorage.setItem(atKey(s), String(seq)); } catch (e) { }
  }
  function mentionsMe(x, myU) {
    return !!(x && x.mentions && myU && x.mentions.indexOf(myU) !== -1);
  }
  /* 把 @昵称 包成高亮片段：先转义再按昵称精确替换，昵称里带正则特殊字符也不怕 */
  function chatHtml(text, players, myU) {
    var html = esc(text);
    (players || []).forEach(function (p) {
      var nm = esc(p.nickname || "");
      if (!nm) return;
      var needle = "@" + nm;
      if (html.indexOf(needle) === -1) return;
      var cls = (p.uid === myU) ? "at at-me" : "at";
      html = html.split(needle).join('<b class="' + cls + '">' + needle + "</b>");
    });
    return html;
  }

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
    /* @红点 + 提示音：两条独立的水位线
       —— 响铃用运行时计数（每条 @ 只响一次，刷新不重放历史）；
       —— 红点看本机「已读水位」，只有点开聊天框才推进，面板收起时也不会自己消失。 */
    var myU = myUid(s);
    var seen = atSeen(s);
    /* 进房 / 刷新后的第一拍：把已经躺在历史里的 @ 全部算作看过，绝不让旧消息重放一串提示音 */
    if (!R.atSeeded) {
      R.atSeeded = true;
      R.atRung = last;
      if (last > seen) { atMarkSeen(s, last); seen = last; }
    }
    if (!isFinite(R.atRung) || R.atRung < seen) R.atRung = seen;
    var freshAt = log.filter(function (x) { return mentionsMe(x, myU) && (x.seq || 0) > R.atRung; });
    var unreadAt = log.filter(function (x) { return mentionsMe(x, myU) && (x.seq || 0) > seen; });
    var dot = $("#room-chat-at-dot");
    if (freshAt.length) {
      if (root.SoupAudio && root.SoupAudio.sfx) root.SoupAudio.sfx("mention");
      R.toast("「" + (freshAt[0].nickname || "有人") + "」在聊天里 @ 了你");
      R.atRung = freshAt[freshAt.length - 1].seq || R.atRung;
      /* 面板正开着 = 他已经看见了，直接算读过，不再挂红点 */
      if (R.chatOpen) atMarkSeen(s, last);
    }
    if (dot) {
      var showDot = !R.chatOpen && unreadAt.length > 0;
      dot.classList.toggle("hidden", !showDot);
      dot.textContent = "@" + (unreadAt.length > 1 ? unreadAt.length : "");
    }
    if (box.__sig === log.length + "|" + last) { box.scrollTop = box.scrollHeight; return; }
    box.__sig = log.length + "|" + last;
    /* 汤主报喜（私有猜底大改）：新到一条 congrats 就先「叮」一声再上屏 */
    if (R.cgSeenSeq && last > R.cgSeenSeq) {
      var fresh = log.filter(function (x) { return x.type === "congrats" && (x.seq || 0) > R.cgSeenSeq; });
      if (fresh.length && root.SoupAudio && root.SoupAudio.sfx) root.SoupAudio.sfx("pop");
    }
    R.cgSeenSeq = last;
    if (!log.length) {
      box.innerHTML = '<p class="empty">房间闲聊区：聊什么都可以，汤主不看这里。</p>';
    } else {
      box.innerHTML = log.map(function (x) {
        /* 汤主报喜：炫彩华丽花哨特效框，只报名次与人名，绝不带汤底 */
        if (x.type === "congrats") {
          return '<div class="chat-item congrats">' +
            '<div class="cg-frame"><span class="cg-shine" aria-hidden="true"></span>' +
            '<div class="cg-head"><span class="cg-bell" aria-hidden="true">' + ic("bell") + "</span>" +
            '<b class="cg-title">汤主报喜</b><span class="cg-bell" aria-hidden="true">' + ic("bell") + "</span></div>" +
            '<div class="cg-text">' + esc(x.text) + "</div>" +
            /* 本锅战况三小格：TA 个人提问数 / 全桌总提问数 / 从开锅到说破的用时 */
            statBoxesHtml(x.stats, "cg-stats") +
            '<div class="cg-foot">' + ic("trophy") + " 当前 " + (x.rank || "?") + "/" + (x.total || "?") + " 人已说破 · 猜底内容与判定全桌保密</div>" +
            "</div></div>";
        }
        var mineCls = (x.uid === myUid(R.snap || {})) ? " me" : "";
        var atCls = mentionsMe(x, myUid(R.snap || {})) ? " mention-me" : "";
        return '<div class="chat-item' + mineCls + atCls + '">' +
          '<span class="ci-name">' + esc(x.nickname || ("#" + x.uid)) + "</span>" +
          '<span class="ci-text">' + chatHtml(x.text, (R.snap || {}).players, myUid(R.snap || {})) + "</span></div>";
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
      /* 打开面板就算「看见了 @」：清红点、推水印 */
      var lg = (R.snap && R.snap.chatLog) || [];
      var lastSeq = lg.length ? (lg[lg.length - 1].seq || 0) : 0;
      if (lastSeq) atMarkSeen(R.snap, lastSeq);
      var dot0 = $("#room-chat-at-dot");
      if (dot0) { dot0.classList.add("hidden"); dot0.textContent = "@"; }
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
    /* 私有猜底大改：已说破的人不再能猜（也没必要），按钮变金章 */
    if (s && (s.mySolved || (function () {
      var ps = (s.players || []);
      for (var i = 0; i < ps.length; i++) { if (ps[i].uid === myUid(s)) return !!ps[i].solved; }
      return false;
    })())) {
      btn.disabled = true;
      btn.innerHTML = ic("trophy") + " 已说破";
      var bg = $("#btn-room-giveup");
      if (bg && s.phase === "playing") {
        bg.disabled = true;
        bg.textContent = "放弃";
        bg.title = "你已说破本锅——这一放不放弃，由还没猜出来的人自己定";
      }
      return;
    }
    var tier = s.cooldownTier || {};
    var next = s.myNextCooldown || { no: 90000, close: 45000 };
    var cdTitle = "随时可猜。🔴 完全错误 " + Math.round(next.no / 1000) + " 秒、🟡 部分正确 " +
      Math.round(next.close / 1000) + " 秒冷却，只算在你自己身上。" +
      (tier.solved ? "本锅已有 " + tier.solved + " 人说破，每多一人再减 " + (tier.step / 1000) + " 秒（🟡 最低 10 秒、🔴 最低 55 秒）。" : "");
    btn.title = cdTitle;

    /* 放弃按钮：冷却中 / 投票进行中 / 旁观中都不许再点 */
    var bg2 = $("#btn-room-giveup");
    if (bg2) paintGiveupBtn(bg2, s);

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

  /* 「放弃」按钮的三种沉默：已说破（旁观）/ 投票在跑 / 60 秒发起冷却 */
  function paintGiveupBtn(bg2, s) {
    if (s.phase !== "playing") { bg2.disabled = false; bg2.textContent = "放弃"; bg2.title = "开局后可发起「放弃本锅看汤底」投票"; return; }
    if (s.vote) {
      bg2.disabled = true;
      bg2.textContent = "投票中…";
      bg2.title = "这一轮放弃投票还在收票，先去上面的卡片表态";
      return;
    }
    var left = Math.ceil((s.giveupCooldownLeft || 0) / 1000);
    if (left > 0) {
      bg2.disabled = true;
      bg2.textContent = "放弃 " + left + "s";
      bg2.title = "刚投过一轮，" + left + " 秒后才能再发起";
      return;
    }
    bg2.disabled = false;
    bg2.textContent = "放弃";
    bg2.title = "卡住了？发起放弃投票：要所有还没猜出来的人全部同意才揭底，一人拒绝就作罢";
  }

  /* 发言顺序条（2026-09-29）：#1 → #2 → #3 → #1 真顺序轮转，
     中途进房的人只要看自己的编号和「正在问」的那一位，就知道还差几棒轮到自己。 */
  function paintQueue(s) {
    var el = $("#room-queue");
    if (!el) return;
    var q = s.turnQueue || [];
    if (s.phase !== "playing" || q.length < 2) {
      el.classList.add("hidden");
      el.innerHTML = "";
      el.__qsig = "";
      return;
    }
    var my = myUid(s);
    var sig = q.map(function (x) { return x.uid + ":" + x.offset; }).join(",");
    if (el.__qsig !== sig) {
      el.__qsig = sig;
      var chips = q.map(function (x, i) {
        var cls = x.offset === 0 ? " now" : (x.uid === my ? " me" : "");
        return (i ? '<span class="rq-arrow" aria-hidden="true">→</span>' : "") +
          '<span class="rq' + cls + '">' + (x.uid === my ? "我" : "#" + x.seat + " " + esc(x.nickname)) +
          (x.offset === 0 ? "<i>正在问</i>" : "") + "</span>";
      }).join("");
      el.innerHTML = '<span class="rq-head">' + ic("hand") + " 发言顺序</span>" + chips;
    }
    el.classList.remove("hidden");
  }

  function paintTurnTimer(s) {
    var el = $("#room-turn-timer");
    if (!el) return;
    if (R.timerTimer) { clearInterval(R.timerTimer); R.timerTimer = 0; }
    var show = !!(s && s.phase === "playing" && s.turnDeadline);
    if (!show) { el.classList.add("hidden"); el.innerHTML = ic("hourglass") + " 90s"; return; }
    el.classList.remove("hidden");
    var tick = function () {
      var left = Math.ceil(((s.turnDeadline || 0) - Date.now()) / 1000);
      if (left < 0) left = 0;
      el.innerHTML = ic("hourglass") + " " + left + "s";
      el.classList.toggle("warn", left <= 10);
      el.classList.toggle("urgent", left <= 5);
      if (left <= 0 && R.timerTimer) { clearInterval(R.timerTimer); R.timerTimer = 0; }
    };
    tick();
    R.timerTimer = setInterval(tick, 1000);
  }

  /* 说破排行榜（全员揭底 / 投票放弃时同屏展示）：金銀銅牌 + 未说破灰条，逐行华丽入场；
     每人一行后面摆三个战况小格：个人提问 / 全桌提问 / 用时；还没说破的人也有格。 */
  function rankBoardHtml(s) {
    var order = s.solveOrder || [];
    var players = s.players || [];
    var askStats = s.askStats || { total: 0, byUid: {} };
    var rows = order.map(function (o) {
      var medal = ic("medal" + Math.min(o.rank, 3));
      var delay = ((o.rank - 1) * 0.16).toFixed(2);
      return '<div class="rk rk' + Math.min(o.rank, 4) + '" style="animation-delay:' + delay + 's">' +
        '<span class="rk-medal m' + Math.min(o.rank, 4) + '">' + medal + "</span>" +
        '<span class="rk-name">' + esc(o.nickname) + "</span>" +
        '<span class="rk-tag">第 ' + o.rank + " 个说破</span>" +
        statBoxesHtml(o.stats || { askMine: 0, askTotal: 0, ms: 0 }, "rk-stats") +
        "</div>";
    });
    var extra = 0;
    players.forEach(function (p) {
      var got = false;
      for (var i = 0; i < order.length; i++) { if (order[i].uid === p.uid) { got = true; break; } }
      if (got) return;
      extra++;
      rows.push('<div class="rk rk-none" style="animation-delay:' + ((order.length + extra - 1) * 0.12).toFixed(2) + 's">' +
        '<span class="rk-medal m0">' + ic("bowl") + "</span>" +
        '<span class="rk-name">' + esc(p.nickname) + "</span>" +
        '<span class="rk-tag">这锅没熬出来</span>' +
        '<div class="guess-stats rk-stats"><div class="gs"><i>个人提问</i><b>' +
        ((askStats.byUid || {})[p.uid] || 0) + " 次</b></div>" +
        '<div class="gs"><i>全桌提问</i><b>' + (askStats.total || 0) + " 次</b></div>" +
        '<div class="gs"><i>用时</i><b>未说破</b></div></div>' +
        "</div>");
    });
    if (!rows.length) return "";
    return '<div class="rank-board">' +
      '<div class="rb-head"><span class="rb-spark" aria-hidden="true">' + ic("spark4") + "</span>" +
      "<b>本锅说破排行榜</b>" +
      '<span class="rb-spark" aria-hidden="true">' + ic("spark4") + "</span></div>" +
      rows.join("") + "</div>";
  }

  /* 「这锅我熬过了」的本机打钩：与单人局共用 app.js 那一份记录（只存本机）。
     注意别替「还没看到汤底的人」打钩 —— 所以只在本人亲眼见到 truth 时才调。 */
  function markPotSolved(pid) {
    if (!pid) return;
    try { if (root.SoupApp && root.SoupApp.markSolved) root.SoupApp.markSolved(pid, true); } catch (e) { /* 忽略 */ }
  }

  function showReveal(s) {
    /* 揭底即算「本机熬过这锅」：以前只有单人局自动打钩，多人房要回汤库手点 */
    markPotSolved(s && s.puzzleId);
    var host = document.createElement("div");
    var allSolved = !!s.allSolved;
    host.className = "modal-wrap reveal-final" + (allSolved ? " all-solved" : "");
    var byVote = !!s.giveUp;
    /* 第⑦条：猜出者的昵称挂在汤底框正上方，流光 + 弹跳小特效（全员说破时交给排行榜展示） */
    var winnerLine = (!allSolved && s.winnerNick)
      ? '<div class="winner-tag">' +
        '<span class="wt-spark" aria-hidden="true">' + ic("spark4") + "</span>" +
        '<span class="wt-name">' + esc(s.winnerNick) + "</span>" +
        '<span class="wt-spark" aria-hidden="true">' + ic("spark4") + "</span>" +
        "</div>"
      : "";
    var note = byVote
      ? ic("flag") + " 全房投票放弃，直接上汤底"
      : (allSolved
        ? ic("party") + " 全员说破！猜对的人各自庆功，汤底此刻统一上桌"
        : (s.winnerNick ? ic("popper") + " " + esc(s.winnerNick) + " 说破了汤底" : "本锅结束"));
    host.innerHTML =
      '<div class="modal modal-reveal" role="dialog" aria-modal="true">' +
      "<h3>" + (allSolved ? "全员说破 · 统一揭底 &amp; 排行榜" : "汤底揭晓") + "</h3>" +
      '<p class="end-note">' + note + " · 共 " + ((s.qaLog || []).filter(function (x) { return x.kind === "ask"; }).length) + " 问</p>" +
      winnerLine +
      '<div class="truth-box"><p style="margin:0">' + esc(s.truth) + "</p></div>" +
      rankBoardHtml(s) +
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
       全员说破更是大团圆，照放不误；投票放弃只放轻一点的揭底音 */
    if (!byVote) {
      if (root.SoupFx && root.SoupFx.celebrate) { try { root.SoupFx.celebrate(); } catch (e) { /* 忽略 */ } }
    } else if (root.SoupAudio && root.SoupAudio.sfx) {
      root.SoupAudio.sfx("reveal");
    }
  }

  /* ------------------------------------------------------------
   * 个人说破弹窗（私有猜底大改 2026-09-25）
   * 猜对汤底只弹在猜对者自己的屏幕上：汤底明文 + 炫彩昵称 +
   * 左下右下礼炮 / 上方礼花烟花 + 号角音效（SoupFx.celebrate 自带）。
   * ------------------------------------------------------------ */
  function showMySolvedPopup(o) {
    o = o || {};
    if (!document.getElementById("qa-log")) return;
    /* 自己说破的那一刻就该打钩，不用等全锅结束（也没人能替没看过答案的人打钩） */
    markPotSolved((R.snap && R.snap.puzzleId) || o.puzzleId);
    var host = document.createElement("div");
    host.className = "modal-wrap me-solved-wrap";
    var rest = Math.max(0, (o.total || 0) - (o.rank || 1));
    host.innerHTML =
      '<div class="modal me-solved" role="dialog" aria-modal="true">' +
      '<div class="ms-crown" aria-hidden="true">' + ic("trophy") + "</div>" +
      "<h3 class=\"ms-h\">说破啦！</h3>" +
      '<div class="winner-tag">' +
      '<span class="wt-spark" aria-hidden="true">' + ic("spark4") + "</span>" +
      '<span class="wt-name ms-name">' + esc(me().nickname || "你") + "</span>" +
      '<span class="wt-spark" aria-hidden="true">' + ic("spark4") + "</span></div>" +
      '<p class="ms-rank">你是本锅 <b>第 ' + (o.rank || 1) + " 个</b> 猜对汤底的人" +
      (rest > 0 ? " · 还有 " + rest + " 位在熬" : " · 本锅就此收官") + "</p>" +
      /* 战况三小格：个人提问数 / 全桌总提问数 / 从开锅到自己说破的用时 */
      statBoxesHtml(o.stats, "ms-stats") +
      '<div class="truth-box ms-truth"><p class="ms-truth-k">汤底（此刻只有你看得见）</p><p style="margin:0">' + esc(o.truth || "（这一锅没有汤底）") + "</p></div>" +
      '<p class="ms-note">系统不会把汤底剧透给任何人：本锅继续，你转入旁观——' +
      "想看大家怎么熬就安静看，想递提示就去聊天框打字。</p>" +
      '<div class="modal-actions">' +
      '<button type="button" class="btn primary" id="ms-ok">进入旁观' + ic("eye") + "</button>" +
      "</div></div>";
    document.body.appendChild(host);
    document.body.classList.add("modal-open");
    R.personalOpen = true;
    if (root.SoupFx && root.SoupFx.celebrate) { try { root.SoupFx.celebrate(); } catch (e) { /* 忽略 */ } }
    host.querySelector("#ms-ok").addEventListener("click", function () {
      if (host.parentNode) host.parentNode.removeChild(host);
      document.body.classList.remove("modal-open");
      R.personalOpen = false;
      /* 压轴的全体揭底：等个人弹窗关完再弹，不叠罗汉 */
      var snap = R.snap;
      if (snap && snap.phase === "revealed" && snap.truth && !R.revealedShown) {
        R.revealedShown = true;
        showReveal(snap);
      }
    });
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
      watchManualScroll(qaBox);
    }
    wireResume();
  }

  /* 刚进房 / 换房：丢掉上一次房间留下的渲染指纹，强制重绘一次 */
  function resetRoomSigs() {
    ["#qa-log", "#room-feed", "#room-chat-log"].forEach(function (sel) {
      var el = $(sel);
      if (el) el.__sig = "";
    });
    /* 进房基线：旧报喜不补响铃，上一次锅的个人弹窗状态也不带入 */
    R.cgSeenSeq = 0;
    R.mySolvedShown = false;
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

  /* ---------------- 通用二级确认面板（2026-09-25 防误触） ----------------
   * 撤回准备 / 请离 / 放弃这类「一动就影响全桌或别人」的操作，
   * 点一下必须先弹「确认 / 取消」面板，点确认才真正发请求。 */
  function askConfirm(opts, onYes) {
    var old = document.getElementById("confirm-wrap");
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var host = document.createElement("div");
    host.className = "modal-wrap confirm-wrap";
    host.id = "confirm-wrap";
    host.innerHTML =
      '<div class="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="cf-title">' +
      '<h3 id="cf-title">' + esc(opts.title) + "</h3>" +
      '<p class="modal-sub">' + (opts.desc || "") + "</p>" +
      '<div class="modal-actions">' +
      '<button type="button" class="btn ghost" id="cf-no">取消</button>' +
      '<button type="button" class="btn ' + (opts.danger ? "danger" : "primary") + '" id="cf-yes">' + esc(opts.yes || "确认") + "</button>" +
      "</div></div>";
    document.body.appendChild(host);
    document.body.classList.add("modal-open");
    function close() {
      if (host.parentNode) host.parentNode.removeChild(host);
      document.body.classList.remove("modal-open");
    }
    host.querySelector("#cf-no").addEventListener("click", close);
    host.querySelector("#cf-yes").addEventListener("click", function () { close(); onYes(); });
    host.addEventListener("click", function (ev) { if (ev.target === host) close(); });
  }

  function doReady() {
    var mine = null;
    var s = R.snap;
    if (s) (s.players || []).forEach(function (p) { if (p.uid === myUid(s)) mine = p; });
    var inThisPot = !!(mine && (s.potUids || s.order || []).indexOf(mine.uid) !== -1);
    var withdraw = !!(s && s.phase === "playing" && inThisPot);
    /* 防误触：撤回 = 整桌掀回大堂、提问顺序重排，必须二级确认 */
    if (withdraw) {
      askConfirm({
        title: "确认撤回、回大堂？",
        desc: "你正在本锅提问队列里，撤回会<b>把整桌掀回大堂</b>：全员要重新准备，提问顺序也会重新排队（提问进度保留，但可能有人多问、有人少问）。不想掀桌就点「取消」。",
        yes: "确认撤回（回大堂）",
        danger: true
      }, readyGo);
      return;
    }
    readyGo();
  }

  function readyGo() {
    var mine = null;
    var s = R.snap;
    if (s) (s.players || []).forEach(function (p) { if (p.uid === myUid(s)) mine = p; });
    /* 第④条修复：playing 阶段只有「本锅首发」撤回才会整桌掀回大堂；
       中途加入 / 退出重进的人（不在 potUids 里）点按钮 = 准备并排进本锅队尾，
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
    var ssnap = R.snap || {};
    /* 私有猜底大改：说破者只剩旁观，提问通道已对其关闭 */
    if (ssnap.phase === "playing" && ssnap.mySolved) {
      R.toast("你已说破汤底，本锅只旁观；想递话去聊天框～");
      return;
    }
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
      else if (m === "QUESTION_INVALID") {
        /* 合规闸门：这一句不记账、不消耗回合（累计到第三次才跳过），输入框原话留着好改 */
        var d = (e && e.data) || {};
        R.toast((d.warn || "警告：发问不符合游戏规则") + "\n原因：" + (d.why || "这句没法用是 / 不是回答") +
          (d.left ? "，改成能用「是 / 不是」回答的问法再问一次。" : "，这一棒跳过你。"));
        if (qi) { qi.focus(); qi.classList.add("invalid"); setTimeout(function () { qi.classList.remove("invalid"); }, 1600); }
      }
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
    var s = R.snap || {};
    if (s.mySolved) { R.toast("你已说破本锅汤底，接下来旁观大家熬～"); return; }
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
    /* 猜底条目彻底退出问答面板（私有猜底大改），只剩一问一答 */
    var log = (s.qaLog || []).filter(function (x) { return x.kind === "ask"; });
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
      '<p class="modal-sub">' + ic("secret") + " 全程私密：你写了什么、汤主判了什么色，<b>只有你自己的屏幕看得到</b>——" +
      "不进问答记录，不进实时对话，别人不知道你猜过。</p>" +
      '<textarea id="rguess-input" rows="5" placeholder="我认为，他之所以……是因为……" autocapitalize="off" spellcheck="false"></textarea>' +
      '<p class="guess-feedback" id="rguess-fb"></p>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn ghost" id="rguess-book">' + ic("notebook") + " 我的猜底手账</button>" +
      '<button type="button" class="btn ghost" id="rguess-cancel">再想想</button>' +
      '<button type="button" class="btn primary" id="rguess-submit">提交推理</button>' +
      "</div></div>";
    document.body.appendChild(host);
    document.body.classList.add("modal-open");
    var ta = host.querySelector("#rguess-input");
    var fb = host.querySelector("#rguess-fb");
    var sub = host.querySelector("#rguess-submit");
    var cancel = host.querySelector("#rguess-cancel");
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
      sub.disabled = true;
      act("guess", { text: t }).then(function (r) {
        startWatch();
        var lv = r && r.level;
        if (r && r.snapshot && r.snapshot.exists) { R.snap = r.snapshot; }
        if (r && r.private) {
          /* 私有判定：就地给结果，绝不外流 */
          if (lv === "solved") {
            R.mySolvedShown = true;   /* 拦住快照兜底重复补弹 */
            close();
            /* 先立个人庆祝弹窗，再重绘：全员揭底会被 personalOpen 押后，不叠罗汉 */
            showMySolvedPopup({ truth: r.truth, rank: r.rank, total: r.participants, stats: r.stats });
            if (R.snap) render(R.snap);
            return;
          }
          var cls = (lv === "close" || lv === "vague") ? "close" : "no";
          var leadTxt = lv === "close" ? "部分正确" : (lv === "vague" ? "方向模糊" : "完全错误");
          var leadDot = (lv === "close" || lv === "vague") ? ic("dotY", "dot-y") : ic("dotR", "dot-r");
          /* 冷却秒数一律用服务端当场算好的返回值，别把 120/60 写死在文案里 */
          var cdSec = Math.max(0, Math.round(((r && r.cooldownMs) || 0) / 1000));
          var tierNow = (R.snap && R.snap.cooldownTier) || { solved: 0, step: 7000 };
          var cutNote = tierNow.solved > 0
            ? "（本锅已说破 " + tierNow.solved + " 人，每多说破一人再减 " + (tierNow.step / 1000) + " 秒）"
            : "";
          var cdTip = cdSec ? " 这次要等 " + cdSec + " 秒" + cutNote + "，只算在你自己身上。" : " 冷却结束了再来。";
          fb.innerHTML = "<b>" + leadDot + " " + leadTxt + "</b><span class=\"pv-note\">（只有你看得见）</span><br>" +
            esc((r && r.note) || "方向还不对。") + cdTip;
          fb.className = "guess-feedback pv " + cls;
          ta.readOnly = true;
          cancel.textContent = "知道了";
          R.toast(leadTxt + " · 判定只有你可见");
          return;
        }
        /* 兜底：服务端还是旧版（没有 private 标记）时维持原行为 */
        close();
        if (R.snap) render(R.snap);
        if (lv === "solved") R.toast("对了！汤底揭晓");
        else if (lv === "close") R.toast("已经很近了！45 秒后可再猜");
        else R.toast((r && r.note) || "方向还不对");
      }).catch(function (e) {
        var m = e.message;
        if (m === "COOLDOWN") { close(); R.toast("你还在冷却，等一下再猜（别人不受影响）"); }
        else if (m === "ALREADY_SOLVED") { close(); R.toast(e.note || "你已说破本锅汤底"); }
        else if (AI_ERR_TEXT[m]) {
          sub.disabled = false;
          fb.textContent = aiErrText(m, e.note);
          fb.className = "guess-feedback no";
        } else {
          sub.disabled = false;
          fb.textContent = "提交失败：" + m;
          fb.className = "guess-feedback no";
        }
        startWatch();
      });
    }
    sub.addEventListener("click", submit);
    cancel.addEventListener("click", close);
    host.querySelector("#rguess-book").addEventListener("click", function () { openMyGuessNotebook(); });
    ta.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) submit();
      if (ev.key === "Escape") close();
    });
  }

  /* 我的猜底手账：猜过的每一条内容与判定，只存在我自己的快照视角里 */
  function openMyGuessNotebook() {
    var s = R.snap || {};
    var log = s.myGuessLog || [];
    var LV = {
      solved: ["说破了", "G", "yes"],
      close: ["部分正确", "Y", "partial"],
      vague: ["方向模糊", "Y", "partial"],
      "no": ["完全错误", "R", "no"]
    };
    var host = document.createElement("div");
    host.className = "modal-wrap";
    host.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mgn-title">' +
      '<h3 id="mgn-title">' + ic("notebook") + " 我的猜底手账</h3>" +
      '<p class="modal-sub">这里每一条都只有你看得见：别人既不知道你何时猜、猜了什么，也看不到汤主的判定。</p>' +
      '<div class="room-qa-sheet" id="mgn-body"></div>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn primary" id="mgn-close">合上手账</button>' +
      "</div></div>";
    document.body.appendChild(host);
    document.body.classList.add("modal-open");
    var body = host.querySelector("#mgn-body");
    body.innerHTML = log.length
      ? log.slice().reverse().map(function (x) {
        var v = LV[x.level] || ["未判定", "W", ""];
        return '<div class="qa-item guess ' + esc(x.level || "") + '">' +
          '<div class="qa-q"><span class="qa-k">我的推理</span>' + esc(x.text) + "</div>" +
          '<div class="qa-a"><span class="qa-k verdict ' + esc(v[2]) + '">' + ic("dot" + v[1], "dot-" + v[1].toLowerCase()) + esc(v[0]) + "</span>" + esc(qaStrip("", x.reply)) + "</div>" +
          "</div>";
      }).join("")
      : '<p class="empty">还没猜过。放心猜——这一页只属于你。</p>';
    function close() {
      if (host.parentNode) host.parentNode.removeChild(host);
      document.body.classList.remove("modal-open");
    }
    host.querySelector("#mgn-close").addEventListener("click", close);
    host.addEventListener("click", function (ev) { if (ev.target === host) close(); });
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
          'aria-checked="' + (solv ? "true" : "false") + '" title="标记为已熬出汤底">' + (solv ? ic("check") : "") + "</span>" +
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
          ck.innerHTML = on ? ic("check") : "";
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
  /* 点玩家名字 = 把 @TA 的昵称塞进聊天框（已经打过就不重复加） */
  function insertAt(nick) {
    var nm = String(nick || "").trim();
    if (!nm) return;
    var ib = $("#room-chat-input");
    if (!ib) return;
    toggleChat(true);
    var cur = String(ib.value || "");
    if (cur.indexOf("@" + nm) !== -1) { ib.focus(); return; }
    ib.value = (cur && !/\s$/.test(cur) ? cur + " " : cur) + "@" + nm + " ";
    ib.focus();
    try { ib.setSelectionRange(ib.value.length, ib.value.length); } catch (e) { }
  }

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

  /* 本地找汤底：精品层在 PUZZLES，汤库层在 SOUP_LIBRARY / LIB。
     【策略】汤底明文公开（js/library.public.js 含 truth），所以单人 / 多人
     都能直接查，不必等房号进 revealed 阶段。 */
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

  /* 第⑥条：单人端「放弃」——没有全房可投票，点一下确认就直接上汤底。 */
  function doGiveupSolo() {
    var host = document.createElement("div");
    host.className = "modal-wrap";
    host.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true">' +
      '<h3>' + ic("flag") + " 放弃这一锅？</h3>" +
      '<p class="modal-sub">被卡住了不丢人。放弃后直接揭开本锅汤底，这锅就算过去了。</p>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn ghost" id="gs-no">再想想</button>' +
      '<button type="button" class="btn giveup-btn" id="gs-yes"><span class="giveup-glyph">放弃，上汤底</span></button>' +
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
      var pid0 = root.SoupApp && root.SoupApp.pid ? root.SoupApp.pid() : "";
      var truth = localTruth(pid0);
      var rv = document.createElement("div");
      rv.className = "modal-wrap";
      rv.innerHTML =
        '<div class="modal" role="dialog" aria-modal="true">' +
        "<h3>汤底揭晓</h3>" +
        '<p class="end-note">' + ic("flag") + " 你选择了放弃，直接上汤底。</p>" +
        '<div class="truth-box"><p style="margin:0">' + esc(truth || "这一锅没有汤底。") + "</p></div>" +
        '<div class="modal-actions"><button type="button" class="btn ghost" id="gs-close">知道了</button></div></div>';
      document.body.appendChild(rv);
      document.body.classList.add("modal-open");
      if (root.SoupAudio && root.SoupAudio.sfx) root.SoupAudio.sfx("reveal");
      rv.querySelector("#gs-close").addEventListener("click", function () {
        if (rv.parentNode) rv.parentNode.removeChild(rv);
        document.body.classList.remove("modal-open");
      });
    });
    host.addEventListener("click", function (ev) { if (ev.target === host) close(); });
  }

  /* 密码看汤底（权区）：正确密码 608521。只在本机弹出汤底，不改房间阶段。
     这是「噜噜大王」的专属后门，文案走搞怪风；按钮独立放在别的区域，不跟提问 / 猜底挤一起。 */
  var TRUTH_CODE = "608521";
  function doUnlock(solo) {
    var host = document.createElement("div");
    host.className = "modal-wrap";
    host.innerHTML =
      '<div class="modal modal-unlock" role="dialog" aria-modal="true" aria-labelledby="unlock-title">' +
      '<h3 id="unlock-title" class="unlock-head">' + ic("key") + " 密码看汤底（权区）</h3>" +
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

    /* 本地找汤底走模块级 localTruth（精品 / 汤库 / 引擎索引三层兜底） */
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
   * 「放弃」投票（2026-09-29 重做）
   * 只有还没说破本锅的人能发起、能表态；要所有还没猜出来的人
   * 全部同意才揭底，一人拒绝立刻流产；一轮结束后 60 秒内不能再发起。
   * 一票定音：表过态就不能改，两个按钮一起锁住。
   * ------------------------------------------------------------ */
  var voteTick = 0;

  function doGiveup() {
    /* 防误触（2026-09-25）：发起投票会全房弹窗打断所有人，先二级确认 */
    askConfirm({
      title: "放弃这一锅？",
      desc: "点确认会向「还没猜出来的人」发起放弃投票：所有人都同意才揭开本锅汤底，任何一人拒绝就作罢；一轮结束后 60 秒内不能再发起。",
      yes: "发起投票",
      danger: true
    }, giveupGo);
  }

  function giveupGo() {
    act("giveup", {}).then(function (r) {
      R.toast("已发起「放弃看汤底」投票：要还没猜出来的人全部同意");
      if (r && r.snapshot && r.snapshot.exists) { R.snap = r.snapshot; render(r.snapshot); }
      startWatch();
    }).catch(function (e) {
      var m = e.message;
      if (m === "NOT_PLAYING") R.toast("这锅还没在打，不用放弃");
      else if (m === "VOTE_RUNNING") R.toast(e.note || "已有放弃投票进行中，先投完这一轮");
      else if (m === "GIVEUP_COOLDOWN") R.toast(e.note || "刚投过一轮，等 60 秒再发起");
      else if (m === "SOLVED_NO_GIVEUP") R.toast(e.note || "你已说破本锅，旁观就好");
      else R.toast("发起投票失败：" + m);
    });
  }

  /* 点了就当场锁死：按钮立刻变成「已记下」，另一个按钮再也点不动 */
  function lockVote(yes) {
    var ya = $("#vc-agree"), yn = $("#vc-reject");
    if (ya) { ya.disabled = true; yn && (yn.disabled = true); }
    if (yes && ya) { ya.classList.add("on", "locked"); ya.textContent = ic("check") + " 已同意（不可改）"; }
    if (!yes && yn) { yn.classList.add("on", "locked"); yn.textContent = ic("cross") + " 已拒绝（不可改）"; }
    var card = $("#vote-card");
    if (card) card.classList.add(yes ? "my-yes" : "my-no");
  }

  function castVote(yes) {
    lockVote(yes);
    act("vote", { agree: !!yes, yes: !!yes }).then(function (r) {
      if (r && r.passed) R.toast("全员同意，放弃投票通过 —— 上汤底！");
      else if (r && r.passed === false) R.toast("有人拒绝，放弃投票当场作废，本锅继续（" + ((r.byNick || "有人")) + " 投的拒绝）");
      else R.toast(yes ? "你的票已记下：同意" : "你的票已记下：拒绝");
      if (r && r.snapshot && r.snapshot.exists) { R.snap = r.snapshot; render(r.snapshot); }
      startWatch();
    }).catch(function (e) {
      var m = e.message;
      if (m === "NO_VOTE") R.toast("这一轮投票已经结束了");
      else if (m === "ALREADY_VOTED") R.toast(e.note || "你已经表过态了，这一轮不能再改");
      else if (m === "SOLVED_NO_VOTE") R.toast(e.note || "你已说破本锅，这一票没有你的份");
      else R.toast(e.note || ("投票失败：" + m));
      startWatch();
    });
  }

  function voteSubText(v, left) {
    if (!v) return "";
    var wait = (v.voters || []).filter(function (x) { return !x.voted; }).length;
    var head = "要还没猜出来的 " + v.need + " 人全部同意 · 已同意 " + v.yes + "/" + v.need +
      (v.no ? " · 已拒绝 " + v.no : "") + (wait ? " · " + wait + " 人还没表态" : " · 就差最后几票");
    return head + " · 剩 " + left + "s";
  }

  /* 名单条：谁同意 / 谁拒绝 / 谁还没吭声 */
  function voterRosterHtml(v) {
    var list = (v && v.voters) || [];
    if (!list.length) return "";
    return '<div class="vc-roster">' + list.map(function (x) {
      var cls = x.voted === "yes" ? " r-yes" : (x.voted === "no" ? " r-no" : " r-wait");
      var mark = x.voted === "yes" ? "已同意" : (x.voted === "no" ? "已拒绝" : "待表态");
      return '<span class="vr' + cls + '">' + ic("hand") + " #" + x.seat + " " + esc(x.nickname) + "<i>" + mark + "</i></span>";
    }).join("") + "</div>";
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
        '<div id="vc-roster"></div>' +
        '<div class="vc-actions">' +
        '<button type="button" class="btn vc-yes" id="vc-agree">' + ic("thumbUp") + " 同意</button>" +
        '<button type="button" class="btn vc-no" id="vc-reject">' + ic("thumbDown") + ' 拒绝</button>' +
        "</div>" +
        '<div class="vc-done" id="vc-done"></div>';
      document.body.appendChild(card);
      card.querySelector("#vc-agree").addEventListener("click", function () { castVote(true); });
      card.querySelector("#vc-reject").addEventListener("click", function () { castVote(false); });
    }
    card.classList.remove("hidden");
    var t = $("#vc-title", card);
    if (t) t.innerHTML = ic("flag") + " " + esc(v.byNick || "有玩家") + " 想放弃本锅，直接看汤底";
    var left = Math.max(0, Math.ceil((v.until - Date.now()) / 1000));
    var sub = $("#vc-sub", card);
    if (sub) sub.textContent = voteSubText(v, left);
    var roster = $("#vc-roster", card);
    /* 名单只在内容真的变了才重建，免得每秒闪一次 */
    var rsig = (v.voters || []).map(function (x) { return x.uid + ":" + (x.voted || "-"); }).join(",");
    if (roster && roster.__rsig !== rsig) {
      roster.__rsig = rsig;
      roster.innerHTML = voterRosterHtml(v);
    }
    var ya = $("#vc-agree", card), yn = $("#vc-reject", card), done = $("#vc-done", card);
    var voted = !!(v.youYes || v.youNo);
    card.classList.toggle("my-yes", !!v.youYes);
    card.classList.toggle("my-no", !!v.youNo);
    card.classList.toggle("watching", v.youCanVote === false);
    if (ya && yn) {
      ya.classList.toggle("on", !!v.youYes);
      yn.classList.toggle("on", !!v.youNo);
      ya.classList.toggle("locked", voted || v.youCanVote === false);
      yn.classList.toggle("locked", voted || v.youCanVote === false);
      /* 投过票 / 已说破旁观 → 两个按钮一起锁死，点不动也不会有歧义 */
      ya.disabled = voted || v.youCanVote === false;
      yn.disabled = voted || v.youCanVote === false;
      ya.innerHTML = (v.youYes ? ic("check") + " 已同意（不可改）" : ic("thumbUp") + " 同意");
      yn.innerHTML = (v.youNo ? ic("cross") + " 已拒绝（不可改）" : ic("thumbDown") + " 拒绝");
    }
    if (done) {
      done.textContent = v.youCanVote === false
        ? "你已说破本锅，在旁观战就好——这一锅由还没猜出来的人自己定。"
        : (v.youYes ? "你已经投了「同意」，等其余还没猜出来的人表态。"
          : (v.youNo ? "你已经投了「拒绝」，这一轮当场作废，大家继续熬。"
            : "轮到你表态了：投完就不能改。"));
    }
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

  /* 房主请离玩家 / 清死座位（多②）：防误触，先弹二级确认 */
  function doKick(uid) {
    var s = R.snap || {};
    var target = (s.players || []).filter(function (p) { return p.uid === uid; })[0];
    askConfirm({
      title: "请离 " + (target && target.nickname ? target.nickname : "#" + uid) + "？",
      desc: "TA 会立刻被移出房间、座位空出来；想再玩只能重新用房号进。确认不是手滑再点。",
      yes: "确认请离",
      danger: true
    }, function () { kickGo(uid); });
  }

  function kickGo(uid) {
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

  /* 全局看门狗：每 2 秒确认一次循环活着。
     单人局没有轮询驱动 render，光靠 ensureQaScroll 的惰性调用可能救不回来，
     这里补一个便宜的定时器，谁卡死都能被重新拉起来。 */
  setInterval(function () {
    if (qaScrollWanted()) ensureQaScroll();
  }, 2000);

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
    var bnb = $("#btn-room-notebook"); if (bnb) bnb.addEventListener("click", openMyGuessNotebook);
    var bc = $("#btn-room-choose"); if (bc) bc.addEventListener("click", doChoose);
    var br = $("#btn-room-rand"); if (br) br.addEventListener("click", doRoomRandom);
    var bn = $("#btn-room-next"); if (bn) bn.addEventListener("click", doNext);
    var bk = $("#btn-room-kick"); if (bk) bk.addEventListener("click", doKick);
    var bu = $("#btn-room-giveup"); if (bu) bu.addEventListener("click", doGiveup);
    var bai = $("#btn-room-ai"); if (bai) bai.addEventListener("click", doAi);

    /* 玩家列表是动态生成的，用事件委托接：请离 / 转让 / 点名字 @ 他 */
    var pb = $("#room-players");
    if (pb) pb.addEventListener("click", function (ev) {
      var b = ev.target.closest ? ev.target.closest("[data-kick],[data-transfer],[data-at]") : null;
      if (!b) return;
      ev.preventDefault();
      if (b.hasAttribute("data-transfer")) { doTransfer(Number(b.getAttribute("data-transfer"))); return; }
      if (b.hasAttribute("data-kick")) { doKick(Number(b.getAttribute("data-kick"))); return; }
      insertAt(b.getAttribute("data-at-nick"));
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
    /* 首屏就把右栏备忘录挂出来（首页 / 汤库 / 随机 / 单人对局常驻） */
    syncChatVisibility();
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
    watchQaScroll: function () {
      var box = $("#qa-log");
      if (box) watchManualScroll(box);
    },
    doUnlock: doUnlock,
    doGiveupSolo: doGiveupSolo,
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
