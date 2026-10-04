/* ============================================================
 * 深海汤屋 · 联机客户端（纯新增模块，不改动任何现有逻辑）
 * ------------------------------------------------------------
 * 只用原生 fetch + 短轮询（1.2s），不引第三方库。
 * 挂载方式：<script src="js/net.js" defer></script>（app.js 之前或之后均可）
 *
 * 对外 API（window.SoupNet）：
 *   SoupNet.available()          → 是否已配置后端地址
 *   SoupNet.createRoom(nick)     → 建房，返回 { roomCode, ... }
 *   SoupNet.joinRoom(code, nick) → 进房，返回房间快照
 *   SoupNet.watch(handler)       → 开始轮询，回调每次快照
 *   SoupNet.unwatch()            → 停止轮询
 *   SoupNet.act(action, body)    → 房间内动作（ready/ask/guess/next…）
 *   SoupNet.me                   → { internalId, nickname, roomCode }
 * ============================================================ */

(function (root) {
  "use strict";

  /* ---- 配置：部署 Worker 后把地址填这里（或运行时用 SoupNet.setBase() 覆盖） ---- */
  var DEFAULT_BASE = "https://soup-room.57gqq9hsq.workers.dev";  /* wrangler deploy 已上线 */
  var STORE_KEY = "soupnet.v1";
  /* 1.5s 轮询：服务端开了增量快路径（rev 未变只回几十字节），
     频率提上来也不会把响应体撑大，而延迟直接砍一半。 */
  var POLL_MS = 1500;
  /* 回前台后的“秒恢复”节奏：先快速补救几次，再交回常规频率 */
  var CATCHUP_MS = 300;
  var CATCHUP_TIMES = 4;

  var state = {
    base: DEFAULT_BASE,
    internalId: "",
    nickname: "",
    roomCode: "",     /* 多人房号（断线恢复只认它） */
    soloCode: "",     /* 单人锅房号：与多人房号分开存，互不覆盖（2026-10-04） */
    solo: false,      /* 当前 watch 轮询的是不是单人局 */
    timer: 0,
    catchup: 0,       /* 补救轮询的剩余次数 */
    handler: null,
    last: null,
    rev: 0            /* 服务端快照游标：未变更时服务端只回极小的 unchanged */
  };

  /* ---------------- 本地身份 ---------------- */

  function randId() {
    var a = new Uint8Array(16);
    (root.crypto || {}).getRandomValues
      ? root.crypto.getRandomValues(a)
      : a.forEach(function (_, i) { a[i] = Math.floor(Math.random() * 256); });
    var s = "";
    for (var i = 0; i < a.length; i++) s += ("0" + a[i].toString(16)).slice(-2);
    return "u_" + s;
  }

  function load() {
    try {
      var raw = root.localStorage && localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      state.internalId = o.internalId || "";
      state.nickname = o.nickname || "";
      state.roomCode = o.roomCode || "";
      state.soloCode = o.soloCode || "";
      state.solo = !!o.solo;
      state.base = o.base || state.base;
    } catch (e) { /* 忽略损坏的本地数据 */ }
  }

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        internalId: state.internalId,
        nickname: state.nickname,
        roomCode: state.roomCode,
        soloCode: state.soloCode,
        solo: !!state.solo,
        base: state.base
      }));
    } catch (e) { /* 隐私模式下写不了就算了 */ }
  }

  /* internalId 首次生成后永久固定：断线重连、刷新页面都还是同一个人 */
  function ensureId() {
    if (!state.internalId) { state.internalId = randId(); persist(); }
    return state.internalId;
  }

  /* ---------------- HTTP ---------------- */

  function url(path) {
    return String(state.base || "").replace(/\/+$/, "") + path;
  }

  function req(path, method, body) {
    if (!state.base) return Promise.reject(new Error("NO_BASE"));
    var opt = {
      method: method || "GET",
      headers: { "content-type": "application/json" }
    };
    if (body) opt.body = JSON.stringify(body);
    return fetch(url(path), opt).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) {
          var err = new Error(j && j.error ? j.error : "HTTP_" + r.status);
          err.data = j;
          throw err;
        }
        return j;
      });
    });
  }

  /* ---------------- 对外动作 ---------------- */

  function createRoom(nickname) {
    ensureId();
    state.nickname = String(nickname || "").trim();
    return req("/api/room/new", "POST", {
      internalId: state.internalId,
      nickname: state.nickname
    }).then(function (r) {
      state.roomCode = r.roomCode;
      state.solo = false;
      state.rev = 0;
      persist();
      return r;
    });
  }

  function joinRoom(code, nickname, opts) {
    ensureId();
    state.roomCode = String(code || "").trim().toUpperCase();
    state.solo = false;
    state.rev = 0;
    if (nickname) state.nickname = String(nickname).trim();
    persist();
    return req("/api/room/" + state.roomCode + "/join", "POST", {
      internalId: state.internalId,
      nickname: state.nickname,
      reclaim: !!(opts && opts.reclaim)
    });
  }

  function act(action, body) {
    if (!state.roomCode) return Promise.reject(new Error("NO_ROOM"));
    return req("/api/room/" + state.roomCode + "/" + action, "POST",
      Object.assign({ internalId: state.internalId }, body || {}));
  }

  function fetchState() {
    if (!state.roomCode) return Promise.reject(new Error("NO_ROOM"));
    var q = "";
    if (state.internalId) q += "?me=" + encodeURIComponent(state.internalId);
    /* 带上游标：rev 没变时服务端只回 { unchanged:true }，省下整包快照的传输 */
    if (state.rev) q += (q ? "&" : "?") + "since=" + state.rev;
    return req("/api/room/" + state.roomCode + "/state" + q, "GET");
  }

  /* ---------------- 单人（规格 #12 A1：单人同样全走服务端） ----------------
   * 单人 = 一间只有自己的房间（房号 S 开头）。判定 / 汤底都只在服务端，
   * 前端拿不到 truth —— 汤底只在 AI 汤主判定「解出」的那一刻回给解出者本人。
   */

  function soloNew(puzzleId) {
    ensureId();
    return req("/api/solo/new", "POST", {
      internalId: state.internalId,
      nickname: state.nickname || "汤客",
      puzzleId: puzzleId || ""
    }).then(function (r) {
      state.soloCode = r.roomCode;
      state.solo = true;
      state.rev = 0;
      persist();
      return r;
    });
  }

  function soloAct(action, body, code) {
    /* code：显式指定单人房号。不传就用当前记录的房间号——
       先开单人锅又去串多人房的人，net 里的 roomCode 会被改掉，
       单人侧（app.js）必须拿自己保存的锅号来动作，否则打错门。 */
    var c = String(code || state.soloCode || "");
    if (!c) return Promise.reject(new Error("NO_ROOM"));
    return req("/api/solo/" + c + "/" + action, "POST",
      Object.assign({ internalId: state.internalId }, body || {}));
  }

  function soloState() {
    if (!state.soloCode) return Promise.reject(new Error("NO_ROOM"));
    var q = state.internalId ? ("?me=" + encodeURIComponent(state.internalId)) : "";
    return req("/api/solo/" + state.soloCode + "/state" + q, "GET");
  }

  /* ---------------- 题面（服务端是唯一来源） ----------------
   * 浏览器包里不再有汤面 / 汤底：
   *   puzzleDetail(id) → 逐道取单题汤面（无 truth；服务端按 IP 限流）
   *   puzzleStats()    → 两层题数，显示「共 N 道」用
   */

  function puzzleDetail(id) {
    if (!id) return Promise.reject(new Error("NO_ID"));
    return req("/api/puzzle/" + encodeURIComponent(id), "GET").then(function (r) {
      return (r && r.puzzle) || null;
    });
  }

  function puzzleStats() {
    return req("/api/puzzle-stats", "GET");
  }

  /* ---------------- 轮询 ----------------
   * 三种优化都在这里：
   *   1) 带游标：服务端未变更时只回 { unchanged:true }，不做整包传输；
   *   2) 回前台补救：手机切回来立即跑几次，把漏掉的问答一口气拉齐；
   *   3) 切后台停轮询：手机切走时不再空转，回来时再续上。
   */

  var visWired = false;

  function emit(snap) {
    state.last = snap;
    if (state.handler) state.handler(snap);
  }

  /* 回前台补救：先 300ms 连拉几次，把切后台期间攒下的变化一次补齐，
     随手把 rev 拉平，之后就再无感了。 */
  function catchUp() {
    if (!state.timer && !state.catchup) return;
    state.catchup = CATCHUP_TIMES;
    var step = function () {
      if (!state.catchup) return;
      state.catchup--;
      tickOnce();
      if (state.catchup) setTimeout(step, CATCHUP_MS);
    };
    step();
  }

  /* 在场上报（2026-10-03）：「在线」= 你的屏幕里看得见本项目。
     页面一隐藏就立刻发 visible:false（keepalive：标签页被冻结也发得出），
     重新可见立刻发 visible:true 再接上轮询 —— 全桌看到的绿/红就在这一刻翻。 */
  function reportPresence(visible) {
    /* 在场播报只属于多人房：单人锅没人看在线名单。
       房号用 roomCode（多人），与 soloCode 互不干扰。 */
    if (!state.roomCode || !state.internalId || !state.base) return;
    try {
      fetch(url("/api/room/" + state.roomCode + "/presence"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ internalId: state.internalId, visible: !!visible }),
        keepalive: true
      }).catch(function () { /* 丢一拍没关系：回前台的轮询会自己纠偏 */ });
    } catch (e) { /* 忽略 */ }
  }

  function wireVisibility() {
    if (visWired || typeof document === "undefined") return;
    visWired = true;
    document.addEventListener("visibilitychange", function () {
      /* 切回前台：先报在线，再立即拉一次 + 连补几次；切后台：先报离线再停轮询 */
      if (document.hidden) {
        reportPresence(false);
        if (state.timer) { clearInterval(state.timer); state.timer = 0; }
      } else if (state.roomCode) {
        reportPresence(true);
        if (!state.timer) state.timer = setInterval(tickOnce, POLL_MS);
        catchUp();
      }
    });
    /* 从 bfcache 回来（手机浏览器常走这条路）：同样是「秒恢复」场景 */
    window.addEventListener("pageshow", function (ev) {
      if (ev && ev.persisted && state.roomCode) {
        reportPresence(!document.hidden);
        if (!state.timer) state.timer = setInterval(tickOnce, POLL_MS);
        catchUp();
      }
    });
    /* 关页面 / 刷新：趁还发得出请求先道个别，别人立刻看到你变红 */
    window.addEventListener("pagehide", function () { if (state.roomCode) reportPresence(false); });
  }

  function tickOnce() {
    if (state.solo) {
      soloState().then(function (snap) {
        if (state.handler) state.handler(snap);
      }).catch(function (e) {
        if (state.handler) state.handler({ error: String(e.message || e) });
      });
      return;
    }
    fetchState().then(function (snap) {
      if (snap && snap.unchanged) {
        /* 内容没变：不调 handler（省掉一次无意义的整屏重绘），
           但把缓存的最后一包重新发一次心跳，保持在线状态。 */
        state.rev = snap.rev || state.rev;
        return;
      }
      if (snap && snap.rev) state.rev = snap.rev;
      emit(snap);
    }).catch(function (e) {
      if (state.handler) state.handler({ error: String(e.message || e) });
    });
  }

  function watch(handler) {
    state.handler = handler || null;
    unwatch();
    wireVisibility();
    /* 挂上轮询就先向服务端报一次「我在」（2026-10-04：刷新/重进房时
       visibilitychange 不会触发，不补这一枪，别人会一直看到你离线） */
    reportPresence(true);
    tickOnce();
    state.timer = setInterval(tickOnce, POLL_MS);
  }

  function unwatch() {
    if (state.timer) { clearInterval(state.timer); state.timer = 0; }
    state.catchup = 0;
  }

  /* 单人：轮询走 /api/solo/*，多人走 /api/room/*，一套 watch 通吃 */
  function soloWatch(handler) {
    state.handler = handler || null;
    unwatch();
    wireVisibility();
    reportPresence(true);
    tickOnce();
    state.timer = setInterval(tickOnce, POLL_MS);
  }

  /* ---------------- 昵称框（进房时弹，进项目绝不弹） ----------------
   * 只提供 DOM 构造；何时调用由宿主决定 —— 规格要求：进房那一刻。
   */
  function promptNickname(opts) {
    var o = opts || {};
    return new Promise(function (resolve, reject) {
      var wrap = document.createElement("div");
      wrap.className = "modal-wrap";
      wrap.innerHTML =
        '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="pt-nick-title">' +
        '<h3 id="pt-nick-title">' + (o.title || "起个昵称，进汤屋") + '</h3>' +
        '<p class="modal-sub">' + (o.sub || "昵称最长 12 个字，不能和屋里其他人重名。") + '</p>' +
        '<input id="pt-nick" class="input" type="text" maxlength="12" ' +
        'placeholder="例如：深海捞汤人" autocomplete="off" autocapitalize="off" />' +
        '<p class="guess-feedback" id="pt-nick-err"></p>' +
        '<div class="modal-actions">' +
        '<button type="button" class="btn ghost" id="pt-nick-cancel">取消</button>' +
        '<button type="button" class="btn primary" id="pt-nick-ok">进房</button>' +
        '</div></div>';
      document.body.appendChild(wrap);

      var input = wrap.querySelector("#pt-nick");
      var err = wrap.querySelector("#pt-nick-err");
      input.value = state.nickname || "";
      setTimeout(function () { input.focus(); }, 30);

      function close() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }
      function submit() {
        var v = String(input.value || "").trim();
        if (!v) { err.textContent = "昵称不能为空。"; return; }
        if (v.length > 12) { err.textContent = "昵称最多 12 个字。"; return; }
        state.nickname = v; ensureId(); persist();
        close(); resolve(v);
      }
      wrap.querySelector("#pt-nick-ok").addEventListener("click", submit);
      wrap.querySelector("#pt-nick-cancel").addEventListener("click", function () {
        close(); reject(new Error("CANCELLED"));
      });
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") submit();
        if (e.key === "Escape") { close(); reject(new Error("CANCELLED")); }
      });
    });
  }

  /* ---------------- 导出 ---------------- */

  load();
  ensureId();

  /* 离开房间：先通知服务器把座位真的清掉（全桌立刻看不到这个人），
     再清本地房号。internalId 留着，下次进房还是同一个人。 */
  function leaveRoom() {
    var code = state.roomCode;
    var id = state.internalId;
    var done = Promise.resolve();
    if (code && id && state.base) {
      done = req("/api/room/" + code + "/leave", "POST", { internalId: id }).catch(function () {});
    }
    clearRoom();
    return done;
  }

  /* 只清房号，不清身份 */
  function clearRoom() {
    /* 只退多人房；单人锅的房号另存，互不牵连 */
    state.roomCode = "";
    state.last = null;
    state.rev = 0;
    state.solo = false;
    persist();
  }

  root.SoupNet = {
    available: function () { return !!state.base; },
    baseUrl: function () { return state.base || ""; },
    setBase: function (b) { state.base = String(b || ""); persist(); return state.base; },
    createRoom: createRoom,
    joinRoom: joinRoom,
    act: act,
    fetchState: fetchState,
    watch: watch,
    unwatch: unwatch,
    /* 回前台「秒恢复」：房间层在 visibilitychange / pageshow 里直接调 */
    catchUp: catchUp,
    resetRev: function () { state.rev = 0; },
    promptNickname: promptNickname,
    clearRoom: clearRoom,
    leaveRoom: leaveRoom,
    /* 单人链路（A1） */
    soloNew: soloNew,
    soloAct: soloAct,
    soloState: soloState,
    soloWatch: soloWatch,
    /* 题面 / 统计（服务端唯一来源） */
    puzzleDetail: puzzleDetail,
    puzzleStats: puzzleStats,
    isSolo: function () { return !!state.solo; },
    clearSolo: function () { state.soloCode = ""; state.solo = false; persist(); },
    get me() {
      return { internalId: state.internalId, nickname: state.nickname, roomCode: state.roomCode, soloCode: state.soloCode, solo: !!state.solo };
    },
    get state() { return state.last; }
  };
})(typeof window !== "undefined" ? window : this);