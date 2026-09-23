/* ============================================================
 * 深海汤屋 · 联机入口（Worker 路由）
 * ------------------------------------------------------------
 * 路由表：
 *   POST /api/room/new        建房（返回 6 位房号）
 *   POST /api/room/:code/*    房间内动作（转发给对应 Durable Object）
 *   GET  /api/room/:code/state 拉取房间快照（HTTP 轮询入口）
 *   GET  /api/health          健康检查
 *
 * 全部动作统一转发到 DO 的 fetch(?action=xxx)。
 * ============================================================ */

export { Room } from "./room.js";
import {
  allPuzzleIds as _allIds,
  corePuzzleIds as _coreIds,
  publicPuzzle as _pub,
  puzzleLayer as _layer
} from "./engine.js";
import { getPuzzle as _get } from "./engine.js";
const allPuzzleIds = _allIds;
const corePuzzleIds = _coreIds;
const publicPuzzle = _pub;
const puzzleLayer = _layer;
const getPuzzle = _get;

/* ---------- 建房限流（规格 #12 阶段 6：防公开网址被刷） ----------
 * 尽力而为的内存计数：同一 isolate 同 IP 每天最多 40 间。
 * 不引入 KV 等新依赖，房内动作不设限（规格：单人限流，多人房不设限）。
 */
const NEW_ROOM_DAILY = 40;
const newRoomHits = new Map();

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function rateLimited(ip) {
  const key = todayKey() + "|" + ip;
  const rec = newRoomHits.get(key);
  const n = rec ? rec.n : 0;
  if (n >= NEW_ROOM_DAILY) return true;
  newRoomHits.set(key, { n: n + 1, at: Date.now() });
  /* 顺手清掉过期记录，避免 isolate 长期驻留时无限增长 */
  if (newRoomHits.size > 5000) {
    const today = todayKey();
    for (const k of newRoomHits.keys()) {
      if (k.indexOf(today + "|") !== 0) newRoomHits.delete(k);
    }
  }
  return false;
}

const CODE_LEN = 6;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; /* 去掉易混 I/O/0/1 */

function makeRoomCode() {
  let out = "";
  const buf = new Uint8Array(CODE_LEN);
  crypto.getRandomValues(buf);
  for (let i = 0; i < CODE_LEN; i++) out += CODE_CHARS[buf[i] % CODE_CHARS.length];
  return out;
}

/* 白名单命中就回显该来源。
 * 必须把请求里的 Origin 传进来：写死白名单第一项时，
 * localhost / 127.0.0.1 / 预览域名的预检和正式响应都会对不上，浏览器直接拦掉。
 * 未配置白名单时放行任意来源（仅开发兜底）。 */
function corsHeaders(env, origin) {
  const list = (env.ALLOWED_ORIGINS || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  let allow = "";
  if (!list.length) allow = origin || "*";
  else if (origin && list.indexOf(origin) !== -1) allow = origin;
  else if (!origin) allow = list[0];
  const headers = {
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    "vary": "Origin"
  };
  if (allow) headers["access-control-allow-origin"] = allow;
  return headers;
}

function json(data, env, status, origin) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }, corsHeaders(env, origin))
  });
}

/* 房号 → DO 实例：同名房号恒定映射到同一 DO */
function roomStub(env, code) {
  const id = env.ROOM.idFromName(code.toUpperCase());
  return env.ROOM.get(id);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = request.headers.get("origin") || "";
    const reply = function (data, status) { return json(data, env, status, origin); };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env, origin) });
    }

    if (path === "/api/health") {
      return reply({ ok: true, service: "soup-room", at: Date.now() });
    }

    /* 题面清单：只给汤面，**绝不含汤底**（房主选汤用）
     * 默认只列精品层 100 题；?layer=lib 才列汤库层（900+ 题，量大有分页） */
    if (path === "/api/puzzles" && request.method === "GET") {
      const layer = url.searchParams.get("layer") || "core";
      const ids = layer === "lib" ? allPuzzleIds() : corePuzzleIds();
      const q = (url.searchParams.get("q") || "").trim();
      const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 200));
      let list = ids.map(publicPuzzle).filter(Boolean);
      list = list.filter((p) => p.layer === (layer === "lib" ? "lib" : "core"));
      if (q) {
        list = list.filter((p) =>
          String(p.dispTitle || p.title || "").indexOf(q) !== -1 ||
          String(p.surface || "").indexOf(q) !== -1
        );
      }
      const total = list.length;
      return reply({
        ok: true,
        layer,
        total,
        offset,
        puzzles: list.slice(offset, offset + limit)
      });
    }

    /* 单个题面 */
    const pm = path.match(/^\/api\/puzzle\/([\w-]+)$/);
    if (pm) {
      const p = publicPuzzle(pm[1]);
      if (!p) return reply({ error: "NO_SUCH_PUZZLE" }, 404);
      return reply({ ok: true, puzzle: p });
    }

    /* 汤底揭晓：**只能凭房号取，且只有揭晓后（phase=revealed）才给**。
     * 前端「熬完这锅」结算页调它拿真相，平时 403（规格 #12 A1）。
     * GET /api/truth/:roomCode/:puzzleId */
    const tm = path.match(/^\/api\/truth\/([A-Za-z0-9]{4,10})\/([\w-]+)$/);
    if (tm) {
      const code = tm[1].toUpperCase();
      const pid = tm[2];
      const snap = await roomStub(env, code)
        .fetch(new Request("https://do/?action=state", { method: "GET" }))
        .then((r) => r.json())
        .catch(() => null);
      if (!snap || !snap.exists) return reply({ error: "NO_SUCH_ROOM" }, 404);
      if (snap.phase !== "revealed" || snap.puzzleId !== pid) {
        return reply({ error: "NOT_REVEALED" }, 403);
      }
      const full = getPuzzle(pid);
      if (!full) return reply({ error: "NO_SUCH_PUZZLE" }, 404);
      return reply({ ok: true, truth: full.truth || "" });
    }

    /* 题库概览：两层各多少题（前端显示「共 N 道」用，不含任何汤底） */
    if (path === "/api/puzzle-stats" && request.method === "GET") {
      const all = allPuzzleIds();
      let core = 0, lib = 0;
      for (const id of all) (puzzleLayer(id) === "lib" ? lib++ : core++);
      return reply({ ok: true, total: all.length, core, lib });
    }

    /* 建房 */
    if (path === "/api/room/new" && request.method === "POST") {
      const ip = request.headers.get("cf-connecting-ip") || "unknown";
      if (rateLimited(ip)) {
        return reply({ error: "RATE_LIMITED", note: "今天开的房间有点多，明天再来。" }, 429);
      }
      let body = {};
      try { body = await request.json(); } catch (e) { body = {}; }
      let code = makeRoomCode();
      /* 极小概率撞号：探测 3 次 */
      for (let i = 0; i < 3; i++) {
        const snap = await roomStub(env, code).fetch(
          new Request("https://do/?action=state", { method: "GET" })
        ).then((r) => r.json()).catch(() => ({ exists: false }));
        if (!snap || !snap.exists) break;
        code = makeRoomCode();
      }
      const res = await roomStub(env, code).fetch(
        new Request("https://do/?action=create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            roomCode: code,
            internalId: body.internalId,
            nickname: body.nickname
          })
        })
      );
      const data = await res.json();
      return reply(Object.assign({ roomCode: code }, data), res.status);
    }

    /* ---------- 单人模式（规格 #12 A1：判定 / 汤底都只在服务端） ----------
     * 单人 = 一个只有自己的房间；走同一套 DO，口径与多人完全一致。
     */
    if (path === "/api/solo/new" && request.method === "POST") {
      const ip = request.headers.get("cf-connecting-ip") || "unknown";
      if (rateLimited(ip)) {
        return reply({ error: "RATE_LIMITED", note: "今天的调用有点多，明天再来。" }, 429);
      }
      let body = {};
      try { body = await request.json(); } catch (e) { body = {}; }
      const code = "S" + makeRoomCode().slice(0, 5);
      const stub = roomStub(env, code);
      await stub.fetch(new Request("https://do/?action=create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          roomCode: code,
          internalId: body.internalId || "solo",
          nickname: body.nickname || "汤客",
          solo: true
        })
      }));
      if (body.puzzleId) {
        await stub.fetch(new Request("https://do/?action=choose", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ internalId: body.internalId || "solo", puzzleId: body.puzzleId })
        }));
      }
      return reply({ ok: true, roomCode: code });
    }

    /* 单人会话内的动作：/api/solo/:code/:action */
    const sm = path.match(/^\/api\/solo\/([A-Za-z0-9]{4,10})\/([a-z-]+)$/);
    if (sm) {
      const code = sm[1].toUpperCase();
      const action = sm[2];
      let body = {};
      if (request.method === "POST") {
        try { body = await request.json(); } catch (e) { body = {}; }
      }
      const meRaw = (request.method === "GET")
        ? (url.searchParams.get("me") || "")
        : (body.internalId || "");
      const sinceRaw = url.searchParams.get("since") || "";
      const meQ = meRaw ? "&me=" + encodeURIComponent(meRaw) : "";
      const sinceQ = sinceRaw ? "&since=" + encodeURIComponent(sinceRaw) : "";
      const target = new Request("https://do/?action=" + encodeURIComponent(action) + meQ + sinceQ, {
        method: request.method === "GET" ? "GET" : "POST",
        headers: { "content-type": "application/json" },
        body: request.method === "GET" ? undefined : JSON.stringify(body)
      });
      const res = await roomStub(env, code).fetch(target);
      const text = await res.text();
      return new Response(text, {
        status: res.status,
        headers: Object.assign({
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store"
        }, corsHeaders(env, origin))
      });
    }

    /* 房间内动作：/api/room/:code/:action
       增量轮询靠 ?since=<rev> 透传给 DO，未变更时只回极小响应（新②。 */
    const m = path.match(/^\/api\/room\/([A-Za-z0-9]{4,10})(?:\/([a-z-]+))?$/);
    if (m) {
      const code = m[1].toUpperCase();
      const action = m[2] || url.searchParams.get("action") || "state";
      let body = {};
      if (request.method === "POST") {
        try { body = await request.json(); } catch (e) { body = {}; }
      }
      const meRaw = url.searchParams.get("me") || "";
      const sinceRaw = url.searchParams.get("since") || "";
      const target = new Request("https://do/?action=" + encodeURIComponent(action) +
        (meRaw ? "&me=" + encodeURIComponent(meRaw) : "") +
        (sinceRaw ? "&since=" + encodeURIComponent(sinceRaw) : ""), {
        method: request.method === "GET" ? "GET" : "POST",
        headers: { "content-type": "application/json" },
        body: request.method === "GET" ? undefined : JSON.stringify(body)
      });
      const res = await roomStub(env, code).fetch(target);
      const text = await res.text();
      return new Response(text, {
        status: res.status,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          ...corsHeaders(env, origin)
        }
      });
    }

    return reply({ error: "NOT_FOUND", path }, 404);
  }
};