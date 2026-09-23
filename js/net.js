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
    roomCode: "",
    solo: false,      /* 当前房号是不是单人局（决定走 /api/solo 还是 /api/room） */
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

  function joinRoom(code, nickname) {
    ensureId();
    state.roomCode = String(code || "").trim().toUpperCase();
    state.solo = false;
    state.rev = 0;
    if (nickname) state.nickname = String(nickname).trim();
    persist();
    return req("/api/room/" + state.roomCode + "/join", "POST", {
      internalId: state.internalId,
      nickname: state.nickname
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
   * 前端再也不会拿到 truth —— 和老版本「本地判定 + 前端汤底」彻底切干净。
   */

  function soloNew(puzzleId) {
    ensureId();
    return req("/api/solo/new", "POST", {
      internalId: state.internalId,
      nickname: state.nickname || "汤客",
      puzzleId: puzzleId || ""
    }).then(function (r) {
      state.roomCode = r.roomCode;
      state.solo = true;
      persist();
      return r;
    });
  }

  function soloAct(action, body) {
    if (!state.roomCode) return Promise.reject(new Error("NO_ROOM"));
    return req("/api/solo/" + state.roomCode + "/" + action, "POST",
      Object.assign({ internalId: state.internalId }, body || {}));
  }

  function soloState() {
    if (!state.roomCode) return Promise.reject(new Error("NO_ROOM"));
    var q = state.internalId ? ("?me=" + encodeURIComponent(state.internalId)) : "";
    return req("/api/solo/" + state.roomCode + "/state" + q, "GET");
  }

  /* 揭晓后取汤底：服务端只在 phase=revealed 时给，平时 403。
     掉线 / 未揭晓 / 无底 都安静失败，由调用方决定怎么显示。 */
  function libTruth(roomCode, puzzleId, pid) {
    var code = String(roomCode || state.roomCode || "").trim();
    var id = puzzleId || pid || "";
    if (!code || !id) return Promise.resolve("");
    return req("/api/truth/" + encodeURIComponent(code) + "/" + encodeURIComponent(id), "GET")
      .then(function (r) { return (r && r.truth) || ""; })
      .catch(function () { return ""; });
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

  function wireVisibility() {
    if (visWired || typeof document === "undefined") return;
    visWired = true;
    document.addEventListener("visibilitychange", function () {
      /* 切回前台：立即拉一次 + 连补几次；切后台：停掉定时器，不空转 */
      if (document.hidden) {
        if (state.timer) { clearInterval(state.timer); state.timer = 0; }
      } else if (state.roomCode) {
        if (!state.timer) state.timer = setInterval(tickOnce, POLL_MS);
        catchUp();
      }
    });
    /* 从 bfcache 回来（手机浏览器常走这条路）：同样是「秒恢复」场景 */
    window.addEventListener("pageshow", function (ev) {
      if (ev && ev.persisted && state.roomCode) {
        if (!state.timer) state.timer = setInterval(tickOnce, POLL_MS);
        catchUp();
      }
    });
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
        '<p class="modal-sub">' + (o.sub || "昵称最长 12 个字，可以重复。") + '</p>' +
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

  /* 离开房间：只清房号，不清身份（internalId 还要留着，下次进房还是同一个人） */
  function clearRoom() {
    state.roomCode = "";
    state.solo = false;
    state.last = null;
    state.rev = 0;
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
    /* 单人链路（A1） */
    soloNew: soloNew,
    soloAct: soloAct,
    soloState: soloState,
    soloWatch: soloWatch,
    libTruth: libTruth,
    isSolo: function () { return !!state.solo; },
    get me() {
      return { internalId: state.internalId, nickname: state.nickname, roomCode: state.roomCode, solo: !!state.solo };
    },
    get state() { return state.last; }
  };
})(typeof window !== "undefined" ? window : this);