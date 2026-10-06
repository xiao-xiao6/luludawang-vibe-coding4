/* ============================================================
 * 深海汤屋 · 房间（Durable Object）
 * ------------------------------------------------------------
 * 一个实例 = 一个房间。持有：
 *   - 房间状态机 phase: lobby → playing → revealed
 *   - 玩家列表（UID 分配、internalId 去重、昵称、准备态、在线态）
 *   - 本局题目、问答历史 qaLog、猜底冷却
 *
 * 判定全部在服务端（engine.js）：汤底不下发前端。
 * 第一版用 HTTP 轮询（前端 1.2s 拉一次 /state）。
 * ============================================================ */

import {
  getPuzzle,
  publicPuzzle,
  ask as engineAsk,
  stars,
  leaksTruth
} from "./engine.js";
import {
  buildSystemPrompt,
  buildAskUser,
  buildJudgeSystem,
  buildJudgeUser,
  pickJson,
  looseAnswer,
  looseJudge,
  normalizeAskJson,
  normVerdict,
  REASON_TAIL,
  callModel,
  isLocalOnlyUrl,
  LOCAL_URL_HINT,
  GATEWAY_BLOCKED_HINT
} from "./ai.js";

const UID_MAX = 15;             /* 单房最多 15 人 */
const NICK_MAX = 12;            /* 昵称 ≤12 字 */
const TURN_TIMEOUT_MS = 90000;  /* 顺序提问 90s 超时跳过 */
const COOLDOWN_IRR_MS = 90000;  /* 猜底 🔴完全错误 90s 冷却（只算在猜的人身上） */
const COOLDOWN_CLOSE_MS = 45000;/* 猜底 🟡部分正确 45s 冷却（只算在猜的人身上） */
/* 每多一人说破本锅，还在熬的人下一次踩 🔴/🟡 的冷却按人数档位递减；
   减到下限就封住：🟡 最低 10s，🔴 最低 55s。 */
const COOLDOWN_IRR_MIN_MS = 55000;
const COOLDOWN_CLOSE_MIN_MS = 10000;

/* ---- 联机手感参数 ---- */
const ONLINE_MS = 35000;         /* 在线窗口：原 15s 太紧，手机切一下消息就被判离线 */
const DEAD_SEAT_MS = 60000;      /* 死座位：离线超 1 分钟，房主可请离释放座位 */
const NICK_TAKEOVER_MS = 60000;  /* 认领旧座位：同名座位离线且静默超 60s，才允许本人显式认领 */
const PRESENT_FRESH_MS = 45000;  /* 在线新鲜度：可见期间心跳超时也算掉线 */
const ASK_LOCK_MS = 90000;       /* AI 飞行锁：一次提问最长锁 90s，期间连点只算一次 */
const GIVEUP_VOTE_MS = 60000;    /* 放弃投票窗口：60s 内不达标即流产 */
const GIVEUP_GAP_MS = 60000;     /* 放弃发起冷却：上一轮结束后 60s 内不许再点 */
const QA_MAX = 200;              /* 问答日志上限 */
const ASK_STRIKE_MAX = 3;        /* 同一锅累计几次不合规提问就强制跳过该玩家 */
const ASK_MAX_LEN = 90;          /* 一句话问不到 90 字；超长基本是破限长文 */
/* 只能问「是 / 不是 / 部分正确 / 与此无关」能答的问题 —— 下面几类直接判不合规。
   本地硬闸先把明显的脏话、要答案、破限长文拦掉，省一次 key 调用，也免得模型被带跑。 */
const VIOLATION_RULES = [
  {
    code: "ABUSE",
    why: "对汤主开口辱骂或人身攻击",
    re: /(傻[逼比叉]|弱智|智障|妈的|你妈|操你|草你|狗东西|垃圾玩意|废物|白痴|王八|滚蛋|sb|SB)/
  },
  {
    code: "JAILBREAK",
    why: "索要汤底、线索或试图改写规则",
    re: /(忽略(上面|以上|之前|前面)[^。]{0,10}(设定|规则|提示|指令|要求)|系统提示词?(原文)?|把(你的)?(规则|设定|提示词|系统)(原文)?(输出|告诉我|念)|你现在(就)?是|假装(你)?(是|我们)|进入(开发者|debug|调试)模式|告诉我(汤底|答案|真相)|(直接|干脆)说答案|给我(一条|一个)?线索|提示我(一下)?|答案是什么)/
  },
  {
    code: "OPEN",
    why: "这是开放式问题，没法用「是 / 不是」回答",
    re: /(为什么|为何|是什么|什么是|是谁|谁是|怎么样|怎么办|如何处理|如何|哪里|哪儿|什么时候|多久|多少|讲讲|说说|描述|介绍一下|告诉我.{0,6}(故事|经过|情节|原因))/
  }
];
/* 是非问法的特征词：出现任意一个就算「可以用是/不是回答」 */
const POLAR_RE = /(吗|呢？|么？|是不是|是否|有没有|能否|能不能|可不可以|还是|算不算|对不对|得不得|是不是一定)/;

/* 一句话提问的合规检查：返回 { code, why } 或 null。
   顺序：超长 → 脏话 → 破限索答案 → 开放式提问（没有任何是非标记词才拦，避免误伤复合问）。 */
function questionViolation(raw) {
  const q = String(raw || "").trim();
  if (!q) return null;
  if (q.length > ASK_MAX_LEN) return { code: "TOO_LONG", why: "一句话问不到 " + ASK_MAX_LEN + " 字，这条太长了" };
  const polar = POLAR_RE.test(q);
  for (const r of VIOLATION_RULES) {
    if (r.code === "OPEN" && polar) continue;   /* 带着「吗 / 是不是」的复合问句交给汤主判 */
    if (r.re.test(q)) return { code: r.code, why: r.why };
  }
  return null;
}
const CHAT_MAX = 200;            /* 聊天日志上限 */
const CHAT_LEN = 200;            /* 单条聊天字数上限（2026-10-04：120 → 200） */
const CHAT_GAP_MS = 600;         /* 同一人两条聊天最小间隔，防刷屏 */
const GUESS_LOG_MAX = 60;        /* 每人私有猜底手账的条数上限（只有猜的人自己看得到） */

function now() { return Date.now(); }

/* 昵称查重：忽略大小写，排除自己（selfUid=0 表示还没有座位） */
function findNick(s, nick, selfUid) {
  const k = String(nick || "").trim().toLowerCase();
  if (!k) return null;
  return s.players.filter((p) => p.uid !== selfUid && String(p.nickname || "").trim().toLowerCase() === k)[0] || null;
}

function nickTaken(s, nick, selfUid) {
  return !!findNick(s, nick, selfUid);
}

/* 在场判定（2026-10-03 重做）：以「对方屏幕里看得见本项目」为准 ——
   前端页面可见时持续心跳并把 visible 置真，页面一隐藏就立刻上报 false。
   lastSeen 同时兜住进程被系统直接杀掉、连告别心跳都没来得及发的情况。 */
function isPresent(p) {
  const fresh = now() - (p.lastSeen || 0) < PRESENT_FRESH_MS;
  /* 老房间（改动之前建的）没有 visible 字段：退化成按心跳新鲜度判，别让全桌变红 */
  const vis = (p.visible === undefined) ? true : !!p.visible;
  return vis && fresh;
}

/* 切换在场状态：只有真的在「在线↔离线」之间翻转时才更新计时起点，
   这样前端才能算出「在线 2 分」「离线 40 秒」这种连续时长。 */
function applyPresence(p, visible) {
  const on = !!visible;
  const flipped = !!p.visible !== on;
  p.visible = on;
  p.online = on;
  p.lastSeen = now();
  if (flipped) p.stateSince = now();
  return flipped;
}

const NICK_TAKEN_NOTE = "这个昵称已经被占用了，换一个再进房——同名会让聊天框分不清是谁。";

/* @点名：昵称房里唯一，直接按「@昵称」精确匹配；自己@自己不弹提醒 */
function mentionUids(s, selfUid, text) {
  const t = String(text || "");
  if (t.indexOf("@") === -1) return [];
  const out = [];
  s.players.forEach(function (x) {
    const nm = String(x.nickname || "").trim();
    if (!nm || x.uid === selfUid) return;
    if (t.indexOf("@" + nm) !== -1) out.push(x.uid);
  });
  return out;
}

/* 人数档位：≤6 人每多说破一人减 7s，7–10 人减 4s，11–15 人减 2.5s。 */
function cooldownStep(total) {
  if (total <= 6) return 7000;
  if (total <= 10) return 4000;
  return 2500;
}

/* 刚刚这一次判定给 TA 设下的冷却还剩多久（毫秒）；没设冷却则为 0。 */
function pendingCooldown(s, player) {
  const until = (s.guessCooldowns || {})[player.uid] || 0;
  return Math.max(0, until - now());
}

/* 本锅当前实际冷却时长（毫秒）。level: "no" = 🔴，"close"/"vague" = 🟡。
   以 90s / 45s 起步：≤6 人档 5 档减满 35s → 🔴 正好 55s、🟡 正好 10s，两条下限都真落在地上；人数越多档越细，同样只到线为止。 */
function guessCooldownMs(s, level) {
  const red = level === "no";
  const base = red ? COOLDOWN_IRR_MS : COOLDOWN_CLOSE_MS;
  const floor = red ? COOLDOWN_IRR_MIN_MS : COOLDOWN_CLOSE_MIN_MS;
  if (s.solo) return base;
  const total = s.players.length;
  const solved = (s.solveOrder || []).length;
  return Math.max(floor, base - cooldownStep(total) * solved);
}

/* 把服务端错误翻译成前端能直接上屏的 code + 说明，
   不再把「配置错 / 格式错 / 网络抖」全部归成 AI_OFFLINE。 */
function aiErrorCode(e) {
  const m = String((e && e.message) || e || "");
  if (m === "LOCAL_ONLY_URL") return "AI_LOCAL_UNREACHABLE";
  if (m === "EMPTY_REPLY") return "AI_EMPTY_REPLY";
  if (m === "GATEWAY_BLOCKED") return "AI_GATEWAY_BLOCKED";
  if (/^HTTP_4\d\d/.test(m)) return "AI_AUTH_OR_MODEL";
  if (/^HTTP_5\d\d/.test(m)) return "AI_UPSTREAM_5XX";
  if (/abort|aborted|timeout/i.test(m)) return "AI_TIMEOUT";
  if (/fetch failed|network|ENOTFOUND|ECONNREFUSED/i.test(m)) return "AI_NETWORK";
  return "AI_OFFLINE";
}

/* 中转站自家 WAF 拦截（多④）：这不是「key 错 / 模型名错」，别让玩家误改配置。
   GATEWAY_BLOCKED_HINT 文案统一在 ./ai.js 里维护。 */

function aiErrorNote(e) {
  const code = aiErrorCode(e);
  const m = String((e && e.message) || e || "").replace(/\s+/g, " ").trim();
  const map = {
    AI_LOCAL_UNREACHABLE: LOCAL_URL_HINT,
    AI_EMPTY_REPLY: "模型返回里没有可读正文（可能是 maxTokens 太小被截断，或该模型把正文放进了思考字段）",
    AI_GATEWAY_BLOCKED: GATEWAY_BLOCKED_HINT,
    AI_AUTH_OR_MODEL: "上游报 4xx（" + m.slice(0, 100) + "）。检查地址/模型名/Key；若提示「来源被拦截/策略拦截」，是该中转站封了 Cloudflare 机房 IP：请用内网穿透（cloudflared / ngrok / frp）把本地净化中转发成公网地址，或换直连服务商",
    AI_UPSTREAM_5XX: "上游服务暂时出错，等一会儿再问一次（" + m.slice(0, 100) + "）",
    AI_TIMEOUT: "请求超时，上游太慢或网络不稳",
    AI_NETWORK: "机房那边连不上这个地址，检查接口地址是否写错",
    AI_OFFLINE: m.slice(0, 120)
  };
  return map[code] || m.slice(0, 120);
}

/* 模型不守格式时带上一句更强的重申再要一次；也接受明文判定 */
const RETRY_HINT =
  "\n\n【上次的回答没被读懂，请重新回答】优先输出一个 JSON 对象：{\"verdict\":\"yes|no|partial|irr\",\"reply\":\"…\",\"clue\":0}；实在做不到 JSON，就只回一句话，以「是。」「不是。」「部分正确。」「与此无关。」其中之一开头。如果玩家一次问了好几个小问题，先给一个最贴切的总体判定词，再用短句逐一简短回答；禁止复述问题（「玩家问…」「你问的是…」这类句式不行）。严禁输出思考过程、分析、举例或任何理由，也不要提到汤底。";

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }, cors || {})
  });
}

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.state = null;
    /* 写盘刻度：只有状态真的变了才落盘 */
    this._dirty = false;
    /* DO Alarm 兜底：记住已预约的触发时刻，避免每次请求都重写 alarm */
    this._alarmKey = undefined;
  }

  /* ---------------- 持久化 ---------------- */

  async load() {
    if (this.state) return this.state;
    this.state = (await this.ctx.storage.get("state")) || null;
    return this.state;
  }

  async save() {
    if (this.state) await this.ctx.storage.put("state", this.state);
    this._dirty = false;
  }

  /* 状态变更统一走这里：rev +1（增量轮询的游标），并标脏等待落盘 */
  bump() {
    const s = this.state;
    if (!s) return;
    s.rev = (s.rev || 0) + 1;
    this._dirty = true;
  }

  /* ---------------- 初始化 ---------------- */

  /* 建房：房主固定 #1，昵称必填 ≤12 字 */
  async create({ roomCode, internalId, nickname, solo }) {
    this.state = {
      roomCode,
      solo: !!solo,                 /* 单人模式：无轮序、无准备，选完汤直接开问 */
      phase: "lobby",              /* lobby | playing | revealed */
      hostUid: 1,
      nextUid: 1,
      order: [],                   /* 开局后随机固定的提问顺序（uid 数组） */
      potUids: [],                 /* 本锅开局阵容：区分首发与中途加入（第⑧条） */
      turnIdx: 0,
      turnDeadline: 0,
      puzzleId: null,
      revealed: [],                /* 全员共享的已挖线索编号（规格 #2） */
      qaLog: [],
      /* 本锅战况统计（2026-09-26）：报喜框 / 个人庆祝弹窗 / 终局排行榜的三个数据格用它。
         单独计数而不是数 qaLog：qaLog 有 200 条上限，长房截断后统计会失真。 */
      potAskTotal: 0,              /* 本锅全桌提问总数 */
      potAskByUid: {},             /* uid → 本锅个人提问数 */
      potStartedAt: 0,             /* 本锅开锅时刻（算个人用时的起点） */
      guessCooldowns: {},          /* uid → 冷却到期时间戳：每人独立，互不影响 */
      lastGuess: null,
      /* ---- 多人「私有猜底」大改（2026-09-25）----
         猜底内容与汤主判定只回给猜的人；谁何时猜、猜了什么、判了什么，
         全桌一概不知。只有猜对（solved）那一刻，才由汤主在聊天里报喜。 */
      solveOrder: [],              /* 猜对汤底的先后名单 [{uid, nickname, at}] = 最终排行榜 */
      guessLog: [],                /* 私有猜底手账（条目带 uid，快照只把「我自己的」发给我） */
      allSolved: false,            /* 本锅是否以「全员说破」方式结束 */
      ai: null,                    /* 房主配置的 AI（key 只在服务端，规格 #11） */
      pendingAI: null,             /* 汤主正在熬的那一句（全桌可见的「思考中」） */
      chatLog: [],                 /* 房间聊天 */
      chatSeq: 0,
      vote: null,                  /* 放弃投票（2026-09-29 重做：仅未说破者全票同意才揭底） */
      giveupCooldownUntil: 0,      /* 放弃发起冷却到点 */
      giveUp: false,               /* 本锅是否由投票放弃而揭底 */
      rev: 1,                      /* 增量轮询游标：变了才推全量快照 */
      players: [],
      createdAt: now(),
      updatedAt: now()
    };
    await this.addPlayer({ internalId, nickname, isHost: true });
    await this.save();
    return this.snapshot(internalId);
  }

  /* ---------------- 玩家 ---------------- */

  async addPlayer({ internalId, nickname, isHost, reclaim }) {
    const s = this.state;
    if (!s) return { error: "NO_ROOM" };
    const id = String(internalId || "").trim();
    const nick = String(nickname || "").trim();

    if (!nick) return { error: "NICKNAME_REQUIRED" };
    if (nick.length > NICK_MAX) return { error: "NICKNAME_TOO_LONG" };

    /* 建房 / 重进：同一 internalId 重复进房 → 视为重连，不重复占位 */
    const exist = s.players.filter((p) => p.internalId === id)[0];
    if (exist) {
      applyPresence(exist, true);
      if (nick && nick !== exist.nickname) {
        if (nickTaken(s, nick, exist.uid)) return { error: "NICKNAME_TAKEN", note: NICK_TAKEN_NOTE };
        exist.nickname = nick;
      }
      this.bump();
      return { player: exist };
    }

    /* 昵称唯一：与在座任何一人重名一律拒（含只差大小写）。
       2026-10-03 修掉一个真 bug：旧版这里藏着一条「同名 + 离线超 60 秒就静默接管旧座位」的
       逻辑，而「离线」靠的是轮询心跳 —— 房主切出去回个消息的功夫，别人拿同名进房就会把
       房主的座位连名字一起顶走，房主变成「画面还在房间里、人已经查无此人」的孤儿，任何操作都失败。
       现在接管改成必须前端明确带 reclaim 的「认领」，而且只认已经不在场的人。 */
    const sameNick = findNick(s, nick, 0);
    if (sameNick) {
      const idle = Math.max(0, now() - (sameNick.lastSeen || 0));
      const claimable = idle > NICK_TAKEOVER_MS && !isPresent(sameNick);
      if (reclaim && claimable) {
        const oldId = sameNick.internalId;
        sameNick.internalId = id;
        applyPresence(sameNick, true);
        sameNick.ready = false;
        this.sysEvent(sameNick.nickname + " 认领了那个空了 " + Math.round(idle / 1000) + " 秒的旧座位（原设备身份已失效）。");
        this.bump();
        return { player: sameNick, reclaimed: true, oldInternalId: oldId };
      }
      return {
        error: "NICKNAME_TAKEN",
        note: claimable
          ? "这个昵称对应着一个离线很久的旧座位。如果那就是你自己，点「认领旧座位」回来。"
          : NICK_TAKEN_NOTE,
        reclaimAvailable: claimable,
        idleMs: idle
      };
    }

    if (s.players.length >= UID_MAX) return { error: "ROOM_FULL" };

    const uid = s.nextUid++;
    const p = {
      uid,
      internalId: id,
      nickname: nick,
      isHost: !!isHost || uid === s.hostUid,
      ready: false,
      solved: false,               /* 多人：本锅是否已猜对汤底（下一锅重置） */
      online: true,
      visible: true,               /* 2026-10-03：屏幕里看得见本项目才算在线 */
      stateSince: now(),           /* 上一次「在线↔离线」翻转的时刻，前端据此算时长 */
      lastSeen: now()
    };
    s.players.push(p);
    /* 第⑩条：座位从上往下按 uid 稳定排序，重排后席位号 = 数组下标 + 1 */
    s.players.sort((a, b) => a.uid - b.uid);
    this.bump();
    return { player: p };
  }

  /* 系统事件（第④条）：离开 / 接管房主 / 请离 / 撤回准备 / 加入队列
     这类与汤无关的文案一律 feed:true，只上「实时对话」，不污染问答记录 */
  sysEvent(text, extra) {
    const s = this.state;
    s.qaLog.push(Object.assign({ kind: "sys", feed: true, text: text, at: now() }, extra || {}));
    if (s.qaLog.length > QA_MAX) s.qaLog = s.qaLog.slice(-QA_MAX);
    this.bump();
  }

  /* 把一个人从房间里拿掉，并修正轮次。返回被请离的人。 */
  removePlayer(s, uid) {
    const target = s.players.filter((x) => x.uid === Number(uid))[0];
    if (!target) return null;
    const wasTurn = s.order.length && s.order[s.turnIdx] === target.uid;
    s.players = s.players.filter((x) => x.uid !== target.uid);
    s.order = s.order.filter((u) => u !== target.uid);
    s.potUids = (s.potUids || []).filter((u) => u !== target.uid);
    /* 已说破的人退出房间：说破名单同步除名（2026-09-26 修播报口径）。
       以前只减「房间总人数」不减「已说破人数」，汤主报喜会出现 5/5 之后还冒出 6/5
       的怪账；现在分子分母一起 -1，后续报喜与排行榜都只算还在座的人。 */
    if (s.solveOrder && s.solveOrder.length) {
      s.solveOrder = s.solveOrder.filter((o) => o.uid !== target.uid);
    }
    if (s.vote) {
      /* 投票中途有人退房：把 TA 的票摘掉，门槛按「还没说破的在座人数」重算 */
      s.vote.yes = s.vote.yes.filter((u) => u !== target.uid);
      s.vote.no = s.vote.no.filter((u) => u !== target.uid);
      this.recountVote(s);
    }
    if (s.guessCooldowns) delete s.guessCooldowns[target.uid];
    if (!s.order.length) {
      s.turnIdx = 0;
      s.turnDeadline = 0;
    } else {
      if (s.turnIdx >= s.order.length) s.turnIdx = 0;
      /* 被请离的人正好轮到自己：把倒计时交给下一位 */
      if (wasTurn && s.phase === "playing") {
        s.turnDeadline = s.solo ? 0 : now() + TURN_TIMEOUT_MS;
      }
    }
    return target;
  }

  /* 房主请人：任意在座玩家都能请离（房主自己除外）。
     离线超过 1 分钟的人走「死座位」通道，其余走普通请离。 */
  async kick({ internalId, uid }) {
    const s = this.state;
    const me = s.players.filter((x) => x.internalId === internalId)[0];
    if (!me || !me.isHost) return { error: "ONLY_HOST" };
    const target = s.players.filter((x) => x.uid === Number(uid))[0];
    if (!target) return { error: "NO_SUCH_PLAYER" };
    if (target.isHost) return { error: "CANNOT_KICK_HOST" };
    const idle = now() - (target.lastSeen || 0) >= DEAD_SEAT_MS;
    this.removePlayer(s, target.uid);
    this.sysEvent(idle
      ? target.nickname + " 的座位被房主收回了（离线太久）。"
      : target.nickname + " 被房主请离了房间。");
    /* 同离开：请离死座位也可能让剩下的人凑齐「全员说破」 */
    if (s.phase === "playing") this.maybeFinishPot(s);
    return { ok: true, uid: target.uid };
  }

  async setNick({ internalId, nickname }) {
    const s = this.state;
    const nick = String(nickname || "").trim();
    if (!nick) return { error: "NICKNAME_REQUIRED" };
    if (nick.length > NICK_MAX) return { error: "NICKNAME_TOO_LONG" };
    const p = s.players.filter((x) => x.internalId === internalId)[0];
    if (!p) return { error: "NOT_IN_ROOM" };
    /* 改名同样不许撞名（含大小写差异的同名） */
    if (nickTaken(s, nick, p.uid)) return { error: "NICKNAME_TAKEN", note: NICK_TAKEN_NOTE };
    p.nickname = nick;
    this.bump();
    return { player: p };
  }

  async heartbeat({ internalId }) {
    const p = this.state.players.filter((x) => x.internalId === internalId)[0];
    if (p) { applyPresence(p, true); }
    return { ok: true };
  }

  /* 在场心跳（2026-10-03）：「在线」= 你的屏幕里看得见本项目。
     2026-10-04 二修：快速切屏时「离线/在线」两条上报会乱序到达 ——
     迟到的 false 把刚回来的人又按成离线，别人就一直看到他离线计时。
     每条上报带客户端事件时间 at，服务端只认比水位更新的那条；
     任何路径把玩家翻回在线时都推水位（轮询心跳翻线也算）。 */
  async presence({ internalId, visible, at }) {
    const s = this.state;
    const p = s.players.filter((x) => x.internalId === internalId)[0];
    if (!p) return { error: "NOT_IN_ROOM" };
    const ts = Number(at) || 0;
    if (ts && p.presMark && ts < p.presMark) {
      return { ok: true, stale: true };   // 过期上报：直接丢，不动状态
    }
    const flipped = applyPresence(p, visible !== false);
    if (visible !== false) p.presMark = Math.max(ts, p.presMark || 0, now());
    if (flipped) this.bump();
    return { ok: true, since: p.stateSince || now() };
  }

  /* 点「离开房间」就立刻从全桌名单里消失，不再留下占座位的幽灵。
     房主离开时，把房主交给还在的最小号，房间不用重开。 */
  async leave({ internalId }) {
    const s = this.state;
    if (!s) return { ok: true };
    const p = s.players.filter((x) => x.internalId === internalId)[0];
    if (!p) return { ok: true };
    const wasHost = !!p.isHost;
    this.removePlayer(s, p.uid);
    if (wasHost && s.players.length) {
      const next = s.players.slice().sort((a, b) => a.uid - b.uid)[0];
      s.players.forEach((x) => { x.isHost = x.uid === next.uid; });
      s.hostUid = next.uid;
      this.sysEvent("房主离开了，#" + next.uid + " " + next.nickname + " 接过房主。");
    } else {
      this.sysEvent(p.nickname + " 离开了房间。");
    }
    /* 退场的人不再阻塞终局：若留下的人已全部说破，本锅当场结束 */
    if (s.phase === "playing") this.maybeFinishPot(s);
    return { ok: true };
  }

  /* ---------------- 房间聊天（新①：右下角常驻小聊天框） ----------------
   * 与「问答记录」分开：聊天只是玩家之间的闲聊，不占轮次、不喂 AI。 */
  async say({ internalId, text, clientId }) {
    const s = this.state;
    const p = s.players.filter((x) => x.internalId === internalId)[0];
    if (!p) return { error: "NOT_IN_ROOM" };
    const raw = String(text || "").replace(/\s+/g, " ").trim().slice(0, CHAT_LEN);
    if (!raw) return { error: "EMPTY_TEXT" };
    const cid = String(clientId || "").trim().slice(0, 48);
    /* 幂等：同一条（同 clientId）重复送达只入账一次，网络重试不会刷屏 */
    if (cid) {
      const dup = s.chatLog.filter((x) => x.clientId === cid)[0];
      if (dup) return { ok: true, item: dup, dup: true };
    }
    const last = s.chatLog.filter((x) => x.uid === p.uid).slice(-1)[0];
    if (last && now() - last.at < CHAT_GAP_MS) return { error: "TOO_FAST" };
    const item = {
      kind: "chat",
      uid: p.uid,
      nickname: p.nickname,
      text: raw,
      clientId: cid,
      /* @提醒（2026-10-03）：昵称在房里唯一，所以「@名字」能精确对上人 */
      mentions: mentionUids(s, p.uid, raw),
      at: now()
    };
    s.chatLog.push(item);
    if (s.chatLog.length > CHAT_MAX) s.chatLog = s.chatLog.slice(-CHAT_MAX);
    s.chatSeq = (s.chatSeq || 0) + 1;
    item.seq = s.chatSeq;
    this.bump();
    return { ok: true, item };
  }

  /* ---------------- AI 配置（只有房主 #1 能配，规格 #11） ---------------- */

  async setAi({ internalId, config }) {
    const s = this.state;
    const p = s.players.filter((x) => x.internalId === internalId)[0];
    if (!p || !p.isHost) return { error: "ONLY_HOST" };
    const c = config || {};
    if (c.clear) {
      s.ai = null;
      return { ok: true, ai: null };
    }
    const cfg = {
      provider: String(c.provider || "custom").slice(0, 32),
      kind: c.kind === "anthropic" ? "anthropic" : "openai",
      baseUrl: String(c.baseUrl || "").trim().replace(/\/+$/, ""),
      model: String(c.model || "").trim(),
      apiKey: String(c.apiKey || "").trim()
    };
    if (!cfg.baseUrl || !cfg.model || !cfg.apiKey) return { error: "AI_CONFIG_INCOMPLETE" };
    s.ai = cfg;
    this.bump();
    return { ok: true, ai: { provider: cfg.provider, model: cfg.model } };
  }

  /* AI 是否就绪：掉线时返回 false，调用方回退关键词判定 */
  aiReady() {
    const a = this.state.ai;
    return !!(a && a.baseUrl && a.model && a.apiKey);
  }

  /* 测试连接：房主填完配置先验一发，免得保存了才发现是错的。
     只用一条极简 ping，不消耗房间题目上下文；返回真实错误原因。 */
  async aiTest({ internalId, config }) {
    const s = this.state;
    const p = s.players.filter((x) => x.internalId === internalId)[0];
    if (!p || !p.isHost) return { error: "ONLY_HOST" };
    const c = config || {};
    const cfg = {
      provider: String(c.provider || "custom").slice(0, 32),
      kind: c.kind === "anthropic" ? "anthropic" : "openai",
      baseUrl: String(c.baseUrl || "").trim().replace(/\/+$/, ""),
      model: String(c.model || "").trim(),
      apiKey: String(c.apiKey || "").trim(),
      timeoutMs: 20000
    };
    if (!cfg.baseUrl || !cfg.model || !cfg.apiKey) return { error: "AI_CONFIG_INCOMPLETE" };
    /* 本机地址对 Cloudflare 机房永远不可达：不如提前拦住，把可操作的提示直接给房主 */
    if (isLocalOnlyUrl(cfg.baseUrl)) return { error: "AI_LOCAL_UNREACHABLE", note: LOCAL_URL_HINT };
    try {
      const text = await callModel(cfg,
        "你是海龟汤游戏的汤主。只输出一个 JSON 对象。",
        "回复 {\"ok\":true}，不要输出别的。");
      if (!text) return { error: "AI_TEST_EMPTY", note: "模型回了空内容" };
      return { ok: true, sample: String(text).slice(0, 80) };
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (msg === "LOCAL_ONLY_URL") return { error: "AI_LOCAL_UNREACHABLE", note: LOCAL_URL_HINT };
      if (msg === "GATEWAY_BLOCKED") return { error: "AI_GATEWAY_BLOCKED", note: GATEWAY_BLOCKED_HINT };
      if (msg === "EMPTY_REPLY") return { error: "AI_TEST_EMPTY", note: "模型返回里没有可读正文（可能是 maxTokens 太小被截断，或该模型把正文放进了思考字段）" };
      return { error: "AI_TEST_FAIL", note: msg.slice(0, 160) };
    }
  }

  /* 问 AI：失败返回 { error, note }（上层不再一律报掉线） */
  async aiAsk(puzzle, question, history) {
    if (!this.aiReady()) return { error: "AI_OFFLINE", note: "房间还没有配置 AI 汤主" };
    const cfg = this.state.ai;
    const taken = this.state.revealed.map((i) => i + 1);
    const ctx = {
      revealed: this.state.revealed.map((i) => "第 " + (i + 1) + " 条"),
      taken: taken,
      history: (history || []).slice(-6)
    };
    /* 关键词结果只作内部参考，不上屏 */
    const hint = engineAsk(puzzle, question, this.state.revealed);
    if (hint.kind === "clue" || hint.kind === "again") {
      ctx.hintClue = { n: hint.index + 1, type: hint.verdict, text: hint.reply };
    }
    try {
      const sys = buildSystemPrompt(puzzle);
      const usr = buildAskUser(puzzle, question, ctx);
      /* 归一化只在拿得到 json 时才有意义：模型偶尔整段不守格式，
         这时 pickJson / looseAnswer 都认不出，只能带更强提醒再要一次。 */
      let text = await callModel(cfg, sys, usr);
      let j = pickJson(text) || looseAnswer(text);
      let norm = j ? normalizeAskJson(j, puzzle) : null;
      if (!norm) {
        /* 格式不对或判定词认不出：带上更强的格式重申再要一次，别一枪就判死 */
        text = await callModel(cfg, sys, usr + RETRY_HINT);
        j = pickJson(text) || looseAnswer(text);
        norm = j ? normalizeAskJson(j, puzzle) : null;
      }
      if (!norm) return { error: "AI_BAD_FORMAT", note: "汤主两次都没给出可认的判定（已自动重试过）；这个模型输出太自由，建议房主换 deepseek-chat 等更守格式的模型" };
      /* 纵深防线（规格 #11）：归一之后、上屏之前再过一遍思考链硬过滤。
         即便上游归一漏网，也绝不把「但汤底核心：…」这类分析贴到玩家面前。 */
      let reply = String(norm.reply || "");
      const leadSafe = { yes: "是", no: "不是", partial: "部分正确", irr: "与此无关" }[norm.verdict] || "与此无关";
      const bodySafe = reply.replace(/^(与此无关|部分正确|不是|是)[。.！!？?：:；;、,，\s]*/, "").trim();
      if (!bodySafe || REASON_TAIL.test(reply) || REASON_TAIL.test(bodySafe)) reply = leadSafe + "。";
      return { verdict: norm.verdict, reply, clue: norm.clue };
    } catch (e) {
      return { error: aiErrorCode(e), note: aiErrorNote(e) };
    }
  }

  /* 判推理：失败返回 { error, note }。
     判定输出只有一行小 JSON：maxTokens 压到 220、温度 0.1 —— 又快又稳，
     也顺手掐掉思考型模型长篇发挥的空间（2026-10-04）。 */
  async aiJudge(puzzle, guess) {
    if (!this.aiReady()) return { error: "AI_OFFLINE", note: "房间还没有配置 AI 汤主" };
    const cfg = Object.assign({}, this.state.ai, { maxTokens: 220, temperature: 0.35 });
    try {
      const sys = buildJudgeSystem(puzzle);
      const usr = buildJudgeUser(puzzle, guess);
      let text = await callModel(cfg, sys, usr);
      let j = pickJson(text) || looseJudge(text);
      if (!j) {
        text = await callModel(cfg, sys, usr + "\n\n【上次的回答没被读懂，请重新回答】只输出一个 JSON 对象：{\"level\":\"solved|close|vague|no\",\"note\":\"…\"}，第一个字符必须是 {，全中文。");
        j = pickJson(text) || looseJudge(text);
      }
      if (!j) return { error: "AI_BAD_FORMAT", note: "汤主两次都没给出可读的判定（已自动重试过）；建议房主换更守格式的模型" };
      /* level 宽松归一 */
      var rawL = String(j.level || j.result || "").trim().toLowerCase();
      var level = "no";
      if (/^solved|^对|^猜对|^说破/.test(rawL)) level = "solved";
      else if (/^close|^接近|^很近/.test(rawL)) level = "close";
      else if (/^vague|^模糊|^太短/.test(rawL)) level = "vague";
      else if (["solved","close","vague","no"].indexOf(rawL) !== -1) level = rawL;
      var note = String(j.note || j.reply || "").slice(0, 120).trim();
      /* 短评同样过思考链硬过滤：带分析痕迹整段丢弃，多句只留第一短句，全脏回标准话术；
         混进两个以上连续英文单词的（思维链漏网）一律丢。 */
      if (note && REASON_TAIL.test(note)) note = "";
      if (note && /[A-Za-z]{2,}[ ,][A-Za-z]{2,}/.test(note)) note = "";
      /* 泄底硬过滤：note 原样带出汤底连续 ≥7 字而玩家没说过 → 整条丢弃。
         提示词再禁也只是概率，这一层是确定性的（图二那种「未说出同伴死亡与用其肉钓鱼」就是它拦）。 */
      if (note && leaksTruth(puzzle, guess, note)) note = "";
      if (note && (note.match(/[。！？]/g) || []).length >= 3) {
        var mFn = note.match(/^[^。！？；]{0,40}/);
        note = mFn ? mFn[0].replace(/\s+$/, "") : "";
      }
      if (!note || REASON_TAIL.test(note)) note = { solved: "说破了。", close: "已经很近了。", vague: "再讲清楚一点。", no: "方向还不对。" }[level];
      return { level, note };
    } catch (e) {
      return { error: aiErrorCode(e), note: aiErrorNote(e) };
    }
  }

  /* ---------------- 准备 & 开局 ---------------- */

  async setReady({ internalId, ready }) {
    const s = this.state;
    const p = s.players.filter((x) => x.internalId === internalId)[0];
    if (!p) return { error: "NOT_IN_ROOM" };

    /* 开局后点「撤回准备」（2026-10-03 重做）：只影响自己 —— 把自己标成未准备
       并退出本锅的提问队列，别人该干嘛干嘛；中途加入的人本来就是这套逻辑，
       现在首发的人也一样。以前是「谁一撤，全桌掀回大堂」，一个人手滑把所有人的
       进度清空，太不讲理。只有一种情况才回大堂：还在房间的每个人都撤了。 */
    if (s.phase === "playing" && !ready) {
      /* 多人：已经猜对汤底的人本来就旁观，撤回与否都不影响本锅 */
      if (p.solved) { this.bump(); return { ok: true, phase: s.phase, solved: true }; }
      const wasTurn = s.order.length > 0 && s.order[s.turnIdx] === p.uid;
      p.ready = false;
      s.order = s.order.filter((u) => u !== p.uid);
      if (s.turnIdx >= s.order.length) s.turnIdx = 0;
      if (wasTurn && s.order.length) s.turnDeadline = s.solo ? 0 : now() + TURN_TIMEOUT_MS;
      /* 还在熬的人一个都不剩：这锅没人玩了，才退回大堂重开
         （已说破的人只是旁观，TA 有没有勾「准备」不该把全桌钉在这一锅里） */
      if (!s.players.some((x) => x.ready && !x.solved)) {
        s.phase = "lobby";
        s.order = [];
        s.turnIdx = 0;
        s.turnDeadline = 0;
        s.vote = null;
        this.resetPotSolve(s);
        s.qaLog.push({ kind: "sys", feed: true, text: p.nickname + " 撤回了准备，全桌都没有在熬的锅了，回到大堂。", at: now() });
        this.bump();
        return { ok: true, phase: s.phase, everyoneLeft: true };
      }
      s.qaLog.push({ kind: "sys", feed: true, text: p.nickname + " 退出了本锅的提问（别人继续，下一锅要重新准备）。", at: now() });
      this.bump();
      return { ok: true, phase: s.phase };
    }

    /* 中途加入（第⑧条）：这锅正在打时点「准备」，按席位号升序插进当前轮询队列，
       轮到 TA 时自然接上 —— 不打断任何人、不掀桌、不清问答记录与进度。
       已经揭底时仍按「为下一锅准备」处理。 */
    if (s.phase === "playing") {
      if (!ready) { p.ready = false; this.bump(); return { ok: true, phase: s.phase, queued: false }; }
      p.ready = true;
      if (!s.order.length) { s.order = [p.uid]; s.turnIdx = 0; }
      else if (s.order.indexOf(p.uid) === -1) insertUidAsc(s, p.uid);
      s.qaLog.push({ kind: "sys", feed: true, text: p.nickname + " 加入了本锅的提问队列，稍后就会轮到 TA。", at: now() });
      this.bump();
      return { ok: true, phase: s.phase, queued: true };
    }
    if (s.phase === "revealed") {
      if (!ready) { p.ready = false; this.bump(); return { ok: true, phase: s.phase, queued: false }; }
      p.ready = true;
      this.bump();
      return { ok: true, phase: s.phase, queued: true };
    }
    p.ready = !!ready;

    /* 全员准备 + 已选好汤 才开局；没选汤时不许开局，否则 60s 超时轰炸 */
    const allReady = s.players.length > 0 && s.players.every((x) => x.ready);
    if (allReady && s.puzzleId) {
      /* 按席位号由小到大固定发言顺序（2026-09-29）：1 → 2 → 3 → 1 真顺序轮转 */
      s.order = ascUids(s.players.map((x) => x.uid));
      s.potUids = s.order.slice();
      s.turnIdx = 0;
      s.turnDeadline = s.solo ? 0 : now() + TURN_TIMEOUT_MS;
      s.phase = "playing";
      this.resetPotSolve(s);
      s.potStartedAt = now();      /* 本锅计时起点（个人用时的锚） */
    }
    this.bump();
    return { ok: true, phase: s.phase };
  }

  /* ---------------- 放弃投票（2026-09-29 重做） ----------------
   * 只有「还没说破本锅」的人能发起、能表态；已说破的人只旁观，不替人做主。
   * 必须所有还没猜出来的人都同意才揭底；任何一人拒绝 → 立刻流产。
   * 一轮投票结束后 60 秒内不许再发起（giveupCooldownUntil），免得点个不停。
   * 一票定音：表过态就不能改、也不能再点另一个按钮。
   * 揭底走与猜对完全相同的 revealed 通道。 */

  /* 该表态的人：本锅还没说破的在座玩家 */
  ballotBox(s) {
    return s.players.filter((p) => !p.solved).map((p) => p.uid);
  }

  voteNeed(s) {
    return Math.max(1, this.ballotBox(s).length);
  }

  /* 每次快照前清扫：过期的投票自动作废，并进入 60 秒发起冷却 */
  sweepVote() {
    const s = this.state;
    if (!s || !s.vote) return;
    if (s.vote.until > now()) return;
    s.vote = null;
    s.giveupCooldownUntil = now() + GIVEUP_GAP_MS;
    this.sysEvent("放弃投票没收齐全员同意，本锅继续（" + Math.round(GIVEUP_GAP_MS / 1000) + " 秒后才能再发起）。");
  }

  async startGiveup({ internalId }) {
    const s = this.state;
    if (s.phase !== "playing") return { error: "NOT_PLAYING" };
    const p = s.players.filter((x) => x.internalId === internalId)[0];
    if (!p) return { error: "NOT_IN_ROOM" };
    /* 多人：已说破的人不得发起放弃 —— 不能再替还没猜出的人提前剧透 */
    if (!s.solo && p.solved) return { error: "SOLVED_NO_GIVEUP", note: "你已说破本锅，剩下的人自己熬；不用替大家发起放弃。" };
    this.sweepVote();
    if (s.vote) {
      /* 已有投票在跑：发起者没变就当续票入口，别人点则提示先投票 */
      if (s.vote.byUid === p.uid) return { ok: true, vote: this.voteView(s, p.uid) };
      return { error: "VOTE_RUNNING", note: "已有放弃投票进行中，先投完这一轮" };
    }
    if (s.giveupCooldownUntil && now() < s.giveupCooldownUntil) {
      return {
        error: "GIVEUP_COOLDOWN",
        note: "刚投过一轮，" + Math.ceil((s.giveupCooldownUntil - now()) / 1000) + " 秒后才能再发起放弃",
        until: s.giveupCooldownUntil
      };
    }
    s.vote = {
      byUid: p.uid,
      byNick: p.nickname,
      yes: [p.uid],
      no: [],
      need: this.voteNeed(s),
      total: this.voteNeed(s),
      until: now() + GIVEUP_VOTE_MS
    };
    s.giveupCooldownUntil = now() + GIVEUP_GAP_MS;
    this.sysEvent(p.nickname + " 发起了「放弃这一锅」投票：要" + s.vote.total + " 个还没猜出来的人全部同意才结束本锅（汤底只给已说破的人看），一人拒绝就作罢，60 秒内有效。");
    this.bump();
    /* 只剩一个人还没猜出来时，TA 自己这一票就是「全员同意」，当场结算 */
    const outcome = this.settleVote(s);
    return outcome || { ok: true, vote: this.voteView(s, p.uid) };
  }

  async castVote({ internalId, yes }) {
    const s = this.state;
    this.sweepVote();
    if (s.phase !== "playing" || !s.vote) return { error: "NO_VOTE" };
    const p = s.players.filter((x) => x.internalId === internalId)[0];
    if (!p) return { error: "NOT_IN_ROOM" };
    /* 已说破的人在旁观席上，这一票没有 TA 的份 */
    if (p.solved) return { error: "SOLVED_NO_VOTE", note: "你已说破本锅，旁观就好——这一放不放弃，由还没猜出来的人自己定。" };
    const v = s.vote;
    /* 一票定音：表过态就不能改，也不许再点另一个按钮 */
    if (v.yes.indexOf(p.uid) !== -1 || v.no.indexOf(p.uid) !== -1) {
      return { error: "ALREADY_VOTED", note: "你已经表过态了，这一轮不能再改。" };
    }
    if (yes) v.yes.push(p.uid); else v.no.push(p.uid);
    this.recountVote(s);
    const outcome = this.settleVote(s);
    this.bump();
    return outcome || { ok: true, vote: this.voteView(s, p.uid), myVote: yes ? "yes" : "no" };
  }

  /* 投票的对外形状：快照与动作响应共用一份，前端拿到的字段永远一致 */
  voteView(s, myUidArg) {
    const v = s.vote;
    if (!v) return null;
    const seatOfUid = (u) => {
      const i = s.players.findIndex((x) => x.uid === u);
      return i >= 0 ? i + 1 : 0;
    };
    const nickOfUid = (u) => {
      const p = s.players.filter((x) => x.uid === u)[0];
      return p ? p.nickname : "";
    };
    const me = s.players.filter((x) => x.uid === myUidArg)[0] || null;
    const youSolved = !!(me && me.solved);
    const ballot = s.players.filter((x) => !x.solved).map(function (x) {
      const state = v.yes.indexOf(x.uid) !== -1 ? "yes"
        : (v.no.indexOf(x.uid) !== -1 ? "no" : null);
      return { uid: x.uid, seat: seatOfUid(x.uid), nickname: x.nickname, voted: state };
    });
    return {
      byUid: v.byUid,
      byNick: v.byNick,
      yes: v.yes.length,
      no: v.no.length,
      need: v.need,
      total: v.need,
      until: v.until,
      youYes: !!me && v.yes.indexOf(me.uid) !== -1,
      youNo: !!me && v.no.indexOf(me.uid) !== -1,
      youCanVote: !!me && !youSolved,
      youSolved: youSolved,
      voters: ballot,
      yesNicks: v.yes.map(nickOfUid),
      noNicks: v.no.map(nickOfUid)
    };
  }

  /* 中途进房 / 退房 / 说破：门槛按「当前还没说破的人」实时重算，作废的票一并摘掉 */
  recountVote(s) {
    const v = s.vote;
    if (!v) return;
    const box = this.ballotBox(s);
    v.yes = v.yes.filter((u) => box.indexOf(u) !== -1);
    v.no = v.no.filter((u) => box.indexOf(u) !== -1);
    v.need = Math.max(1, box.length);
    v.total = box.length;
  }

  /* 结算：全员同意→揭底；有人拒绝→立刻流产；否则返回 null 等下一票 */
  settleVote(s) {
    const v = s.vote;
    if (!v) return null;
    if (v.yes.length >= v.need) {
      s.vote = null;
      s.giveUp = true;
      this.reveal(s, null, "投票放弃");
      return { ok: true, passed: true, revealed: true };
    }
    if (v.no.length) {
      const lastNo = v.no[v.no.length - 1];
      const who = s.players.filter((x) => x.uid === lastNo)[0];
      s.vote = null;
      s.giveupCooldownUntil = now() + GIVEUP_GAP_MS;
      this.sysEvent("放弃投票被 " + ((who && who.nickname) || "#" + lastNo) + " 否决（需全员同意），本锅继续。");
      return { ok: true, passed: false, byNick: (who && who.nickname) || "" };
    }
    return null;
  }

  /* 揭底统一入口：猜对与投票放弃共用同一条 revealed 通道 */
  reveal(s, player, how) {
    const puzzle = getPuzzle(s.puzzleId);
    s.phase = "revealed";
    s.guessCooldowns = {};
    s.vote = null;
    if (player) s.giveUp = false;
    if (player) {
      s.winnerUid = player.uid;
      s.winnerNick = player.nickname;
    } else {
      s.winnerUid = 0;
      s.winnerNick = "";
    }
    s.revealHow = how || "说破";
    s.stars = puzzle ? stars(puzzle, s.qaLog.filter((x) => x.kind === "ask").length) : 1;
  }

  /* 房主选汤（规格 #5：只有 #1 能选） */
  async choosePuzzle({ internalId, puzzleId }) {
    const s = this.state;
    const p = s.players.filter((x) => x.internalId === internalId)[0];
    if (!p || !p.isHost) return { error: "ONLY_HOST" };
    if (!getPuzzle(puzzleId)) return { error: "NO_SUCH_PUZZLE" };
    s.puzzleId = puzzleId;
    /* 单人：选完汤立刻可问，不需要「准备」这一环 */
    if (s.solo) {
      s.order = s.players.map((x) => x.uid);
      s.turnIdx = 0;
      s.turnDeadline = 0;
      s.phase = "playing";
      s.potStartedAt = now();
    }
    this.bump();
    return { ok: true, phase: s.phase };
  }

  /* ---------------- 提示通道（第⑥条：线索 / 提示机制整体下线） ----------------
   * 只保留路由兜底，防旧客户端或缓存页面打到这个 action 时报「未知动作」。 */

  async hint() {
    return { error: "HINT_REMOVED", note: "线索与提示机制已下线，全靠提问熬真相。" };
  }

  /* ---------------- 提问通道（每 60s 超时跳过，规格 #7） ---------------- */

  async ask({ internalId, question }) {
    const s = this.state;
    if (s.phase !== "playing") return { error: "NOT_PLAYING" };
    this.sweepTurn();

    const p = s.players.filter((x) => x.internalId === internalId)[0];
    if (!p) return { error: "NOT_IN_ROOM" };
    const cur = s.order[s.turnIdx];
    if (p.uid !== cur) return { error: "NOT_YOUR_TURN", turnUid: cur };
    /* 轮到自己还能开口 = 人确实在场：把「等待队列」里的人顺手转成已准备，
       免得中途加入的人明明在答，却被下一锅判成未准备。 */
    if (!p.ready) { p.ready = true; this.bump(); }

    /* 飞行锁（多①）：AI 正在想上一句时，后面所有重复请求一律拒掉。
       前端按钮已经禁用了，这一层是防脚本/防手滑的硬保险：
       连点 N 次只会产生 1 次上游调用，Key 不会被白白烧掉。 */
    if (s.askInFlightUntil && now() < s.askInFlightUntil) {
      return { error: "AI_BUSY", note: "上一句汤主还在熬，等它答完再问。", until: s.askInFlightUntil };
    }

    const puzzle = getPuzzle(s.puzzleId);
    const raw = String(question || "").slice(0, 200);
    if (!raw.trim()) return { error: "EMPTY_QUESTION" };

    /* 合规闸门（本地硬判，先烧规则不烧 key）：开放式提问、要答案、破限长文、骂汤主，
       一律不记账、不消耗回合，只给警告并计次。 */
    const viol = questionViolation(raw);
    if (viol) return this.rejectAsk(s, p, viol.code, viol.why);

    let verdict = "irr";
    let reply = "与此无关。";
    let viaAi = false;

    if (puzzle) {
      /* 规格 #11/#12：只走 AI；AI 没配或掉线 → 提示重问，不记账、不消耗回合 */
      if (this.aiReady()) {
        /* 上锁 + 全桌广播「思考中」 */
        s.askInFlightUntil = now() + ASK_LOCK_MS;
        s.pendingAI = { uid: p.uid, nickname: p.nickname, question: raw, at: now() };
        this.bump();
        try {
          const ai = await this.aiAsk(puzzle, raw, s.qaLog.filter((x) => x.kind === "ask").map((x) => ({ q: x.question, a: x.reply })));
          if (!ai || ai.error) {
            s.askInFlightUntil = 0;
            s.pendingAI = null;
            this.bump();
            return { error: (ai && ai.error) || "AI_OFFLINE", note: (ai && ai.note) || "" };
          }
          /* 模型认定这句话根本没法用是 / 不是回：同样走不合规流程，这句不上问答记录 */
          if (ai.verdict === "invalid") {
            s.askInFlightUntil = 0;
            s.pendingAI = null;
            return this.rejectAsk(s, p, "OPEN", "汤主判定这句没法用「是 / 不是」回答");
          }
          /* 一问一答（2026-10-04）：模型检出这句话里包着多个问题 ——
             整句不答，原样回一句纠正提示；不计警告、不消耗回合、不上问答池。 */
          if (ai.verdict === "multi") {
            s.askInFlightUntil = 0;
            s.pendingAI = null;
            const multiNote = "检测到您的发问中存在多个问题，请挑一个问，每次提问只允许问一个问题。";
            return { error: "MULTI_QUESTION", code: "MULTI", why: "一句话里问了多个问题", note: multiNote, warn: multiNote };
          }
          verdict = ai.verdict;
          reply = ai.reply;
          viaAi = true;
        } finally {
          s.askInFlightUntil = 0;
          s.pendingAI = null;
        }
      } else {
        /* 2026-10-04：关键词汤主整体下线——精品层与汤库一律必须 AI 汤主。
           汤底只在服务端 AI 手里，没有底可撞的关键词汤主已无存在意义。 */
        return { error: "AI_REQUIRED", note: "这一锅的真相只在服务端 AI 汤主手里：先配好模型才能提问" };
      }
    }

    const item = {
      kind: "ask",
      uid: p.uid,
      nickname: p.nickname,
      question: raw,
      verdict,
      reply,
      viaAi,
      at: now()
    };
    s.qaLog.push(item);
    if (s.qaLog.length > QA_MAX) s.qaLog = s.qaLog.slice(-QA_MAX);
    /* 本锅战况计数：只对真正入账的提问 +1（AI 失败回退的不算） */
    s.potAskTotal = (s.potAskTotal || 0) + 1;
    if (!s.potAskByUid) s.potAskByUid = {};
    s.potAskByUid[p.uid] = (s.potAskByUid[p.uid] || 0) + 1;
    /* 问对了一句合规的话，之前的警告一笔勾销 */
    if (s.askStrikes) s.askStrikes[p.uid] = 0;
    this.advanceTurn();
    this.bump();
    return { ok: true, item, rev: s.rev };
  }

  /* 跳过本轮（2026-10-04）：轮到自己没思路就直接交棒，不用为了跳过硬发一句污染问答池。
     只进「实时对话」流水（feed），不进问答记录；不计提问数、不算不合规、不动警告次数。 */
  async skip({ internalId }) {
    const s = this.state;
    if (s.phase !== "playing") return { error: "NOT_PLAYING" };
    const p = s.players.filter((x) => x.internalId === internalId)[0];
    if (!p) return { error: "NOT_IN_ROOM" };
    if (s.solo) return { error: "SOLO_NO_SKIP", note: "单人就你一个，跳过没有意义" };
    const cur = s.order[s.turnIdx];
    if (p.uid !== cur) return { error: "NOT_YOUR_TURN", turnUid: cur };
    this.sysEvent(p.nickname + " 跳过了这一棒，把话头交给下一位。");
    this.advanceTurn();
    this.bump();
    return { ok: true, rev: s.rev };
  }

  /* 不合规提问：不记账、不消耗回合（单人房除外，那只有自己），只给警告并计次；
     同一锅累计到 ASK_STRIKE_MAX 次就强制跳过他，把轮次交给下一位。
     单人房没有「下一位」：文案只说重新提问，计次也不产生跳过后果。 */
  rejectAsk(s, p, code, why) {
    if (s.solo) {
      this.bump();
      const soloWarn = "警告：发问不符合游戏规则，请重新提问";
      return { error: "QUESTION_INVALID", code: code, why: why, note: soloWarn, warn: soloWarn };
    }
    if (!s.askStrikes) s.askStrikes = {};
    const n = (s.askStrikes[p.uid] || 0) + 1;
    s.askStrikes[p.uid] = n;
    const left = ASK_STRIKE_MAX - n;
    let skipped = false;
    let nextSeat = 0;
    if (left <= 0) {
      skipped = true;
      s.askStrikes[p.uid] = 0;
      const before = s.order.length ? s.order[s.turnIdx] : 0;
      this.advanceTurn();
      skipped = s.order.length > 1 && s.order[s.turnIdx] !== before;
      const idx = s.players.findIndex((x) => x.uid === s.order[s.turnIdx]);
      if (idx >= 0) nextSeat = idx + 1;
    }
    const warn = skipped
      ? "警告：发问不符合游戏规则，本锅已累计 " + ASK_STRIKE_MAX + " 次，这一棒跳过你，轮到下一位玩家。"
      : "警告：发问不符合游戏规则，再出现 " + left + " 次强制跳过你并轮到下一位玩家。";
    /* 警告只发给当事人（响应里带 warn，前端就地弹条）；
       全桌对话流里只在真的强制跳过那一拍留一条，免得有人反复踩线刷屏。 */
    if (skipped) {
      s.qaLog.push({ kind: "sys", feed: true, text: p.nickname + " 连续 " + ASK_STRIKE_MAX + " 次提问不合规，本轮跳过。", at: now() });
    }
    this.bump();
    return {
      error: "QUESTION_INVALID",
      code: code,
      why: why,
      strikes: n,
      left: Math.max(0, left),
      skipped: skipped,
      nextSeat: nextSeat,
      warn: warn,
      note: warn
    };
  }

  advanceTurn() {
    const s = this.state;
    s.turnIdx = (s.turnIdx + 1) % Math.max(1, s.order.length);
    /* 单人：只有一个玩家，不设超时（否则会自己把自己跳过） */
    s.turnDeadline = s.solo ? 0 : now() + TURN_TIMEOUT_MS;
    this.bump();
  }

  /* 兜底闹钟（第①条）：全桌都切后台、一个轮询都没有时，
     单靠 sweepTurn 的被动触发是推不动的，得让 DO 自己在到点时醒来。 */
  async syncAlarm() {
    const s = this.state;
    const want = (s && s.phase === "playing" && s.puzzleId && !s.solo && s.turnDeadline) ? s.turnDeadline : 0;
    if (this._alarmKey === want) return;
    this._alarmKey = want;
    try {
      if (want) await this.ctx.storage.setAlarm(want);
      else await this.ctx.storage.deleteAlarm();
    } catch (e) {
      this._alarmKey = undefined;
    }
  }

  async alarm() {
    try {
      await this.load();
      if (!this.state) return;
      this._alarmKey = 0;
      this.sweepTurn();
      await this.syncAlarm();
      if (this._dirty) await this.save();
    } catch (e) { /* 闹钟失败不影响下一轮轮询里的清扫 */ }
  }

  /* 超时清扫：一次可以连跳多人（上一位刚好被跳过、而新的一位也已超期时），
     但每一跳都是完整的 90s 重新计时，所以最多只可能跳一次；循环只做兵底。 */
  sweepTurn() {
    const s = this.state;
    /* 没选汤 / 没在玩的局，不 sweep，否则空房间也会每 90s 弹「超时跳过」 */
    if (!s || s.phase !== "playing" || !s.puzzleId || !s.turnDeadline) return;
    if (s.solo || !s.order || !s.order.length) return;
    let guard = 0;
    while (now() > s.turnDeadline && guard++ < 8) {
      const uid = s.order[s.turnIdx];
      const who = s.players.filter((x) => x.uid === uid)[0];
      const nick = who ? who.nickname : "";
      /* 第④条：超时是「与汤无关」的系统事件，不混进问答记录，
         改成 feed:true 只进「实时对话」 */
      s.qaLog.push({
        kind: "timeout",
        feed: true,
        uid: uid,
        nickname: nick,
        at: now(),
        reply: (nick ? nick : "#" + uid) + " 超时，已跳过"
      });
      if (s.qaLog.length > QA_MAX) s.qaLog = s.qaLog.slice(-QA_MAX);
      this.advanceTurn();
      /* 单人房 / 队列为空：advanceTurn 会把 deadline 归零，循环自然退出 */
      if (!s.turnDeadline) break;
    }
  }

  /* ---------------- 猜底通道（多人：全程私密，2026-09-25 大改） ----------------
   * 猜底内容与汤主判定只回给猜的人：
   *   - 不进共享 qaLog（别人看不到 TA 何时猜、猜了什么、判了什么色）；
   *   - 条目带 uid，snapshot 只把「我自己的」猜底合并回我的视角问答流；
   *   - 冷却本来就是每人独立（myGuessCooldownUntil 只发自己的）。
   * 单人（solo）维持旧行为：判对 = 直接揭本锅汤底。
   */

  async guess({ internalId, text }) {
    const s = this.state;
    if (s.phase !== "playing") return { error: "NOT_PLAYING" };
    const p = s.players.filter((x) => x.internalId === internalId)[0];
    if (!p) return { error: "NOT_IN_ROOM" };
    if (!s.solo && p.solved) return { error: "ALREADY_SOLVED", note: "你已说破本锅汤底，接下来安静看其他人熬～" };
    /* 冷却只算在猜的人身上，别人不受影响 */
    if (!s.guessCooldowns) s.guessCooldowns = {};
    const until = s.guessCooldowns[p.uid] || 0;
    if (now() < until) {
      return { error: "COOLDOWN", until };
    }

    const puzzle = getPuzzle(s.puzzleId);
    const raw = String(text || "").slice(0, 500);
    if (!raw.trim()) return { error: "EMPTY_GUESS" };

    let level = "no";
    let note = "方向还不对。";
    let viaAi = false;

    if (puzzle) {
      if (this.aiReady()) {
        const ai = await this.aiJudge(puzzle, raw);
        if (!ai || ai.error) return { error: (ai && ai.error) || "AI_OFFLINE", note: (ai && ai.note) || "" };
        level = ai.level;
        note = ai.note;
        viaAi = true;
      } else {
        /* 猜底同样一律 AI 判（关键词汤主已下线） */
        return { error: "AI_REQUIRED", note: "推理要由服务端 AI 汤主来判：先配好模型再猜" };
      }
    }

    const item = {
      kind: "guess",
      priv: true,
      uid: p.uid,
      nickname: p.nickname,
      text: raw,
      level,
      reply: note,
      viaAi,
      at: now()
    };

    if (s.solo) {
      /* 单人：房间只有 TA 一个人，走旧通道（判对 = 立刻揭底结算）。
       * 解出的这一刻，汤底只回给 TA —— 之后快照也只认「解出者本人」。 */
      delete item.priv;
      s.qaLog.push(item);
      if (s.qaLog.length > QA_MAX) s.qaLog = s.qaLog.slice(-QA_MAX);
      s.lastGuess = { uid: p.uid, nickname: p.nickname, level, note, at: item.at };
      this.settleGuess(level, s, puzzle, p);
      this.bump();
      const out = { ok: true, item, level, note, cooldownMs: pendingCooldown(s, p) };
      if (level === "solved" && puzzle) out.truth = puzzle.truth || "";
      return out;
    }

    /* 多人：进私有猜底手账，绝不上共享问答流 */
    if (!s.guessLog) s.guessLog = [];
    s.guessLog.push(item);
    if (s.guessLog.length > 600) s.guessLog = s.guessLog.slice(-600);
    this.settleGuess(level, s, puzzle, p);
    this.bump();
    const out = { ok: true, item, level, note, private: true, cooldownMs: pendingCooldown(s, p) };
    if (level === "solved" && puzzle) {
      out.solved = true;
      out.rank = (s.solveOrder || []).length;
      out.participants = this.potMembers(s).length;
      /* 三个战况数据随答返回：个人弹窗当场展示，不用等下一拍快照 */
      const mineEntry = (s.solveOrder || []).filter((o) => o.uid === p.uid).slice(-1)[0];
      out.stats = (mineEntry && mineEntry.stats) || null;
      /* 汤底只发给刚刚猜对的这个人（别人连 TA 猜对了都要晚一步才在聊天里知道） */
      out.truth = puzzle.truth || "";
      out.snapshot = this.snapshot(internalId);
    }
    return out;
  }

  /* 结算：🔴/🟡 只给猜的人设冷却；🟢 单人=揭底，多人=说破者退场旁观，全员说破才揭底。
     多人冷却会按「本锅已有几人说破」逐档缩短（见 guessCooldownMs）。 */
  settleGuess(level, s, puzzle, player) {
    if (!s.guessCooldowns) s.guessCooldowns = {};
    if (level === "no" || level === "vague") {
      s.guessCooldowns[player.uid] = now() + guessCooldownMs(s, level);
    } else if (level === "close") {
      s.guessCooldowns[player.uid] = now() + guessCooldownMs(s, "close");
    } else if (level === "solved") {
      if (s.solo) {
        /* 单人说破也标 solved：刷新重进后快照凭 myTruth 继续只给 TA 看汤底 */
        player.solved = true;
        this.reveal(s, player, "说破");
        return;
      }
      this.markSolved(s, player);
      this.maybeFinishPot(s);
    }
  }

  /* 本锅参与名单（实时算）：首发阵容 ∪ 此刻还在队列里的人 ∪ 已说破的人；
     中途退出房间 / 退出队列的人不再等待 TA（第⑧条口径）。 */
  potMembers(s) {
    const set = [];
    const add = (u) => {
      if (u && set.indexOf(u) === -1 && s.players.some((x) => x.uid === u)) set.push(u);
    };
    (s.potUids || []).forEach(add);
    (s.order || []).forEach(add);
    (s.solveOrder || []).forEach((o) => add(o.uid));
    return set;
  }

  /* 开新锅 / 掀回大堂：说破名单、私有手账、全员标志、放弃冷却全部归零 */
  resetPotSolve(s) {
    s.solveOrder = [];
    s.guessLog = [];
    s.allSolved = false;
    s.potAskTotal = 0;
    s.potAskByUid = {};
    s.giveupCooldownUntil = 0;
    s.askStrikes = {};
    s.players.forEach((x) => { x.solved = false; });
    this.bump();
  }

  /* 说破一人：记名 → 退出轮询队列（当轮即刻交棒） → 汤主在聊天里报喜 */
  markSolved(s, player) {
    if (!s.solveOrder) s.solveOrder = [];
    player.solved = true;
    /* 三个战况数据在说破这一刻就地冻结：个人提问数 / 全桌总提问数 / 从开锅到说破的用时 */
    const stats = {
      askMine: (s.potAskByUid && s.potAskByUid[player.uid]) || 0,
      askTotal: s.potAskTotal || 0,
      ms: Math.max(0, now() - (s.potStartedAt || now()))
    };
    s.solveOrder.push({ uid: player.uid, nickname: player.nickname, at: now(), stats: stats });
    const rank = s.solveOrder.length;
    const wasTurn = s.order[s.turnIdx] === player.uid;
    const oi = s.order.indexOf(player.uid);
    if (oi !== -1) s.order.splice(oi, 1);
    if (!s.order.length) {
      s.turnIdx = 0;
      s.turnDeadline = 0;
    } else {
      if (oi !== -1 && oi < s.turnIdx) s.turnIdx -= 1;
      if (s.turnIdx >= s.order.length) s.turnIdx = 0;
      if (wasTurn) s.turnDeadline = now() + TURN_TIMEOUT_MS;
    }
    if (s.guessCooldowns) delete s.guessCooldowns[player.uid];
    /* 说破的人退出旁观席：放弃投票的门槛按「还没说破的人」实时重算 */
    if (s.vote) this.recountVote(s);
    this.congratsChat(s, player, rank, this.potMembers(s).length, stats);
    this.bump();
  }

  /* 汤主报喜：进房间聊天（前端用炫彩特效框渲染），只报人名与名次，绝不带汤底 */
  congratsChat(s, player, rank, total, stats) {
    if (!s.chatLog) s.chatLog = [];
    s.chatSeq = (s.chatSeq || 0) + 1;
    const rest = Math.max(0, total - rank);
    const tail = rest > 0
      ? "TA 已退出一问一答，转入旁观；本锅还剩 " + rest + " 人，全员说破才揭底。"
      : "全员都说破，本锅圆满，马上统一揭底！";
    s.chatLog.push({
      kind: "chat",
      type: "congrats",
      uid: 0,
      nickname: "汤主",
      text: "恭喜 #" + player.uid + " " + player.nickname + " 第 " + rank + " 个猜对了本锅汤底！" + tail,
      solverUid: player.uid,
      solverNick: player.nickname,
      rank,
      total,
      stats: stats || null,
      at: now(),
      seq: s.chatSeq
    });
    if (s.chatLog.length > CHAT_MAX) s.chatLog = s.chatLog.slice(-CHAT_MAX);
  }

  /* 全员说破 → 统一揭底 + 排行榜（与猜对走同一条 revealed 通道） */
  maybeFinishPot(s) {
    const ids = this.potMembers(s);
    if (!ids.length) return false;
    const all = ids.every((u) => {
      const pl = s.players.filter((x) => x.uid === u)[0];
      return !!(pl && pl.solved);
    });
    if (!all) return false;
    s.allSolved = true;
    const first = s.players.filter((x) => x.uid === s.solveOrder[0].uid)[0] || null;
    this.reveal(s, first, "全员说破");
    this.bump();
    return true;
  }

  /* 下一锅：房间不散，全员重新准备（规格 #15） */
  async nextPuzzle({ internalId, puzzleId }) {
    const s = this.state;
    const p = s.players.filter((x) => x.internalId === internalId)[0];
    if (!p || !p.isHost) return { error: "ONLY_HOST" };
    s.phase = "lobby";
    s.puzzleId = puzzleId || null;
    s.qaLog = [];
    s.revealed = [];
    s.order = [];
    s.turnIdx = 0;
    s.turnDeadline = 0;
    s.guessCooldowns = {};
    s.lastGuess = null;
    s.winnerUid = 0;
    s.winnerNick = "";
    s.stars = 0;
    s.pendingAI = null;
    s.askInFlightUntil = 0;
    s.vote = null;
    s.giveUp = false;
    s.giveupCooldownUntil = 0;
    s.revealHow = "";
    /* 新锅：说破名单 / 私有猜底手账 / 全员标志 / 战况统计全部清零，人人重新来过 */
    s.solveOrder = [];
    s.guessLog = [];
    s.allSolved = false;
    s.potAskTotal = 0;
    s.potAskByUid = {};
    s.players.forEach((x) => { x.solved = false; });
    /* 这锅还在打时已经点过准备的人，下一锅直接算准备好；其余人重新准备。
       全员都准备好了就直接开下一锅，不用再干等。 */
    const queued = s.players.filter((x) => x.ready).map((x) => x.uid);
    s.potUids = [];
    if (queued.length && queued.length === s.players.length && s.puzzleId) {
      s.order = ascUids(queued);
      s.potUids = s.order.slice();
      s.turnIdx = 0;
      s.turnDeadline = s.solo ? 0 : now() + TURN_TIMEOUT_MS;
      s.phase = "playing";
      s.potStartedAt = now();
    }
    this.bump();
    return { ok: true, phase: s.phase };
  }

  /* ---------------- 房主转让（第⑨条） ----------------
   * 只有现任房主能转；转完立刻落一条系统消息，全桌在实时对话里看得见。 */
  async transferHost({ internalId, uid }) {
    const s = this.state;
    if (!s) return { error: "NO_ROOM" };
    const me = s.players.filter((x) => x.internalId === internalId)[0];
    if (!me || !me.isHost) return { error: "ONLY_HOST" };
    const target = s.players.filter((x) => x.uid === Number(uid))[0];
    if (!target) return { error: "NO_SUCH_PLAYER" };
    if (target.uid === me.uid) return { error: "ALREADY_HOST" };
    s.players.forEach((x) => { x.isHost = x.uid === target.uid; });
    s.hostUid = target.uid;
    s.qaLog.push({
      kind: "sys",
      feed: true,
      text: me.nickname + " 把房主交给了 " + target.nickname + "。",
      at: now()
    });
    if (s.qaLog.length > QA_MAX) s.qaLog = s.qaLog.slice(-QA_MAX);
    this.bump();
    return { ok: true, hostUid: target.uid };
  }

  /* ---------------- 快照 & 路由 ---------------- */

  snapshot(meId) {
    const s = this.state;
    if (!s) return { exists: false };
    this.sweepTurn();
    this.sweepVote();
    /* 轮询即心跳：会来拉快照就说明页面正看得见（前端隐藏时不再轮询）。
       这里只续约、不 bump —— 状态翻转由 /presence 那条路负责播报。 */
    const you = meId ? s.players.filter((p) => p.internalId === meId)[0] : null;
    if (you && (!you.visible || now() - (you.lastSeen || 0) > 5000)) {
      const before = !!you.visible;
      you.visible = true;
      you.online = true;
      you.lastSeen = now();
      if (!before) you.stateSince = now();
      you.presMark = now();   // 同快路径：能来拉快照就是看得见
    }
    const out = {
      exists: true,
      rev: s.rev || 0,
      roomCode: s.roomCode,
      solo: !!s.solo,
      youUid: you ? you.uid : 0,
      /* 第⑩条：席位号同步下发（= players 排序后的下标 + 1） */
      youSeat: you ? (s.players.indexOf(you) + 1) : 0,
      phase: s.phase,
      hostUid: s.hostUid,
      order: s.order,
      /* 前端按它区分「首发可掀桌 / 中途加入只退自己」（第⑧条） */
      potUids: s.potUids || s.order || [],
      turnIdx: s.turnIdx,
      turnUid: s.order.length ? s.order[s.turnIdx] : null,
      turnSeat: (function () {
        if (!s.order.length) return 0;
        const u = s.order[s.turnIdx];
        const i = s.players.findIndex((x) => x.uid === u);
        return i >= 0 ? i + 1 : 0;
      })(),
      /* 按编号顺序轮转：还差几棒轮到你（0 = 就是你；-1 = 你不在队列里） */
      turnsUntilMe: (function () {
        if (!you || !s.order.length) return -1;
        const i = s.order.indexOf(you.uid);
        if (i === -1) return -1;
        return (i - s.turnIdx + s.order.length) % s.order.length;
      })(),
      /* 队列快照：[{uid, seat, nickname, state: now|later|done}]，前端摆成一条「发言顺序」 */
      turnQueue: (function () {
        if (!s.order.length) return [];
        const len = s.order.length;
        return s.order.map(function (u, i) {
          const p = s.players.filter((x) => x.uid === u)[0];
          return {
            uid: u,
            seat: p ? (s.players.indexOf(p) + 1) : 0,
            nickname: p ? p.nickname : "",
            offset: (i - s.turnIdx + len) % len
          };
        }).sort(function (a, b) { return a.offset - b.offset; });
      })(),
      turnDeadline: s.turnDeadline,
      puzzleId: s.puzzleId,
      puzzle: s.puzzleId ? publicPuzzle(s.puzzleId) : null,
      revealed: s.revealed.slice(),
      /* 已解锁线索的文字：这些内容早已在问答里念给全场，不算泄露；
         未解锁的线索依旧只在服务端（规格 #12 汤底不下发） */
      /* 第⑥条：线索 / 提示机制已整体下线，不再下发 revealedClues / clueTotal */
      /* 只下发「我自己」的冷却，别人的冷却不共享、也不泄露 */
      myGuessCooldownUntil: you && s.guessCooldowns ? (s.guessCooldowns[you.uid] || 0) : 0,
      /* 下一次踩雷要等多久（已按说破人数递减）：给前端把真实秒数说清楚 */
      myNextCooldown: { no: guessCooldownMs(s, "no"), close: guessCooldownMs(s, "close") },
      cooldownTier: { total: s.players.length, solved: (s.solveOrder || []).length, step: cooldownStep(s.players.length) },
      /* 本锅累计的「提问不合规」警告次数（前端据此显示还剩几次机会） */
      myStrikes: you && s.askStrikes ? (s.askStrikes[you.uid] || 0) : 0,
      strikeMax: ASK_STRIKE_MAX,
      /* 私有猜底大改：lastGuess 只留单人模式；多人房不再全桌广播，
         否则等于把「谁/何时/猜了什么/判什么色」泄露给全桌 */
      lastGuess: s.solo ? s.lastGuess : null,
      /* 「汤主正在思考」：全桌可见，谁问的都一样，不在场的人也知道进度 */
      pendingAI: s.pendingAI ? {
        uid: s.pendingAI.uid,
        nickname: s.pendingAI.nickname,
        question: s.pendingAI.question,
        at: s.pendingAI.at
      } : null,
      ai: s.ai
        ? (you && you.isHost
            ? { provider: s.ai.provider, model: s.ai.model, baseUrl: s.ai.baseUrl, hasKey: !!s.ai.apiKey }
            /* 非房主只看到模型名；baseUrl 和 key 一样只留服务端（规格 #11/#12） */
            : { provider: s.ai.provider, model: s.ai.model })
        : null,
      winnerUid: s.winnerUid || 0,
      winnerNick: s.winnerNick || "",
      /* ---- 多人私有猜底（2026-09-25）----
         solveOrder / potCount：谁第几个说破是公开战绩（聊天里汤主已报喜）；
         myGuessLog：只把「我自己」的猜底手账发给我；
         myTruth：还在对局中但已说破的人，凭它恢复个人汤底弹窗（刷新不丢）。 */
      solveOrder: (s.solveOrder || []).map(function (o, i) {
        return { uid: o.uid, nickname: o.nickname, rank: i + 1, at: o.at, stats: o.stats || null };
      }),
      /* 本锅实时战况：终局排行榜给「还没说破的人」也摆上个人提问数与全桌总提问数 */
      askStats: {
        total: s.potAskTotal || 0,
        byUid: s.potAskByUid || {}
      },
      potCount: s.solo ? (s.players || []).length : this.potMembers(s).length,
      allSolved: !!s.allSolved,
      mySolved: !!(you && you.solved),
      myRank: (function () {
        if (!you) return 0;
        const i = (s.solveOrder || []).findIndex((o) => o.uid === you.uid);
        return i >= 0 ? i + 1 : 0;
      })(),
      myGuessLog: (s.guessLog || []).filter((x) => you && x.uid === you.uid).slice(-30),
      /* 放弃投票状态（2026-09-29 重做）：只有还没说破的人能表态；
         voters 让全桌看见「谁还没表态」，冷却剩余让按钮自己解释为什么点不动 */
      giveUp: !!s.giveUp,
      revealHow: s.revealHow || "",
      giveupCooldownLeft: Math.max(0, (s.giveupCooldownUntil || 0) - now()),
      vote: (s.vote && s.phase === "playing") ? this.voteView(s, you ? you.uid : 0) : null,
      stars: s.stars || 0,
      /* 防御性过滤：万一旧房间还残留猜底条目，也只发给猜的人自己 */
      qaLog: s.qaLog.filter(function (x) {
        return !x.priv || (you && x.uid === you.uid);
      }).slice(-QA_MAX),
      chatLog: (s.chatLog || []).slice(-CHAT_MAX),
      chatSeq: s.chatSeq || 0,
      players: s.players.map((p, i) => ({
        uid: p.uid,
        /* 席位号（第⑩条）：只看「从上往下数第几个」，退出重进 / 换昵称都会重排，
           uid 仍是内部唯一身份，不参与展示 */
        seat: i + 1,
        nickname: p.nickname,
        isHost: p.isHost,
        ready: p.ready,
        solved: !!p.solved,        /* 多人：本锅已说破（旁观中） */
        online: isPresent(p),
        /* 在线/离线的起点：前端据此显示「在线 2 分」「离线 40 秒」 */
        stateSince: p.stateSince || p.lastSeen || 0,
        /* 房主面板据此点亮「请离死座位」按钮 */
        seatRemovable: !p.isHost && now() - (p.lastSeen || 0) >= DEAD_SEAT_MS
      })),
      updatedAt: s.updatedAt
    };
    /* 汤底（2026-10-04 定档）：**只发给被 AI 汤主判定解出过的本人**，
     * 绝不进全房广播 —— 没解出的人投票放弃也只能看到「未揭晓」。
     * 未解出者的界面据 mySolved=false + phase=revealed 自行显示占位文案。 */
    if (you && you.solved && s.puzzleId) {
      const full = getPuzzle(s.puzzleId);
      out.myTruth = full ? full.truth || "" : "";
    }
    return out;
  }

  async fetch(request) {
    await this.load();
    const url = new URL(request.url);
    const action = url.searchParams.get("action");
    let body = {};
    if (request.method === "POST") {
      try { body = await request.json(); } catch (e) { body = {}; }
    }
    /* 「我是谁」：轮询带 ?me=internalId，动作带 body.internalId */
    const meId = url.searchParams.get("me") || body.internalId || "";

    if (!this.state) {
      if (action === "create") {
        const out0 = await this.create(body);
        return json(out0, 200, this.cors());
      }
      return json({ exists: false }, 200, this.cors());
    }

    /* ---------- 增量轮询（新②）：rev 没变就只回一个极小的响应 ----------
     * 轮询频率可以放心提到 1.5s：绝大多数请求只有几十字节，
     * 对手感延时的贡献远小于整包快照的序列化 + 传输。
     * 只有真的有人提问 / 说话 / 状态变了，才回全量快照。
     */
    if (action === "state") {
      /* 【卡在 0s 的根治点】超时清扫必须排在增量快路径「之前」。
         旧顺序里，全桌挂机时 rev 永远不变，每个轮询都在 snapshot() 之前
         就 return { unchanged:true }，sweepTurn() 一次都跑不到，
         于是前端倒计时归零却永远等不到跳过。清扫真推进了轮次就会 bump，
         下面的 since 比对自然失败，本次自动回全量快照。 */
      this.sweepTurn();
      this.sweepVote();
      const since = Number(url.searchParams.get("since"));
      if (isFinite(since) && since > 0 && since === (this.state.rev || 0)) {
        /* 快路径也必须刷心跳：否则「一直没动作」的玩家会被误判离线。
           只更新 lastSeen，不动 rev，所以不会把别人也吵醒。
           注意别把「已经上报离线」的人偷偷刷回在线 —— 那由 /presence 说了算。 */
        const me = meId ? this.state.players.filter((p) => p.internalId === meId)[0] : null;
        if (me) {
          me.lastSeen = now();
          if (me.visible === false) {
            /* 2026-10-04 修「回来了却还显示离线」：
               手机端切回前台时那条 presence(true) 偶发丢失（keepalive 被杀 / 弱网），
               而此后 TA 的每一次轮询都走这条快路径 —— 旧代码只续 lastSeen 不翻 visible，
               全量快照路径又只翻「当次轮询者本人」，于是别人眼里 TA 一直离线、秒数一直涨，
               直到 TA 做了 say 之类的动作 bump 了 rev 才顺带修好。
               轮询只在页面可见时发生：收到轮询本身就等于「屏幕回来了」，直接翻回在线并广播。 */
            applyPresence(me, true);
            me.presMark = now();   // 轮询即「屏幕可见」的铁证：把这条水位也推上去
            this.bump();
          } else if (me.visible !== false) {
            me.online = true;
          }
        }
        this.state.updatedAt = now();
        /* 只刷心跳时也要把闹钟对齐：否则上一条请求中途报错会留下过时的 alarm */
        await this.syncAlarm();
        this.state.updatedAt = now();
        /* 兜底：若上一请求有未落盘的变更（中途抛错），这里顺手补写，避免丢失 */
        if (this._dirty) await this.save();
        return json({ exists: true, unchanged: true, rev: since }, 200, this.cors());
      }
      const out0 = this.snapshot(meId);
      this.state.updatedAt = now();
      await this.syncAlarm();
      if (this._dirty) await this.save();
      return json(out0, 200, this.cors());
    }

    let out;
    switch (action) {
      case "create":
        out = this.snapshot(meId);
        break;
      case "join":
        out = await this.addPlayer({ ...body, isHost: false });
        if (!out.error) out = this.snapshot(meId);
        break;
      case "set-nick":
        out = await this.setNick(body);
        break;
      case "heartbeat":
        out = await this.heartbeat(body);
        break;
      case "presence":
        out = await this.presence(body);
        break;
      case "say":
        out = await this.say(body);
        break;
      case "kick":
        out = await this.kick(body);
        if (!out.error) out = this.snapshot(meId);
        break;
      case "transfer":
        out = await this.transferHost(body);
        if (!out.error) out = this.snapshot(meId);
        break;
      case "leave":
        out = await this.leave(body);
        break;
      case "set-ai":
        out = await this.setAi(body);
        break;
      case "ai-test":
        out = await this.aiTest(body);
        break;
      case "ready":
        out = await this.setReady(body);
        if (!out.error) out = this.snapshot(meId);
        break;
      case "choose":
        out = await this.choosePuzzle(body);
        break;
      case "ask":
        out = await this.ask(body);
        break;
      case "skip":
        out = await this.skip(body);
        break;
      case "hint":
        out = await this.hint(body);
        break;
      case "guess":
        out = await this.guess(body);
        if (!out.error) out = Object.assign({}, out, { snapshot: this.snapshot(meId) });
        break;
      case "next":
        out = await this.nextPuzzle(body);
        break;
      case "giveup":
        out = await this.startGiveup(body);
        if (!out.error) out = Object.assign({}, out, { snapshot: this.snapshot(meId) });
        break;
      case "vote":
        out = await this.castVote(body);
        if (!out.error) out = Object.assign({}, out, { snapshot: this.snapshot(meId) });
        break;
      case "state":
        out = this.snapshot(meId);
        break;
      default:
        out = { error: "UNKNOWN_ACTION" };
    }

    this.state.updatedAt = now();
    await this.syncAlarm();
    /* 不脏不写：轮询和纯读动作不再反复把整个 state 写回存储 */
    if (this._dirty) await this.save();
    return json(out, out && out.error ? 400 : 200, this.cors());
  }

  cors() {
    return {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type"
    };
  }
}

/* 席位号由小到大 = uid 由小到大（players 恒按 uid 排序，seat = 下标 + 1） */
function ascUids(uids) {
  return uids.slice().sort((a, b) => a - b);
}

/* 把新加入的人按编号插进当前轮询队列，并保持 turnIdx 仍指向同一个人 */
function insertUidAsc(s, uid) {
  let i = s.order.length;
  for (let k = 0; k < s.order.length; k++) {
    if (uid < s.order[k]) { i = k; break; }
  }
  s.order.splice(i, 0, uid);
  if (i <= s.turnIdx) s.turnIdx += 1;
}
