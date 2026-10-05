/* ============================================================
 * 玩家实测 CLI —— 真人玩家视角的唯一入口（测试用）
 * 只打线上 API，不读任何本地数据文件；汤面从房间快照里看。
 * 用法：
 *   node tools/player_cli.js new   <id> <nick> <puzzleId>
 *   node tools/player_cli.js join  <room> <id> <nick>
 *   node tools/player_cli.js ready <room> <id>
 *   node tools/player_cli.js ask   <room> <id> "问题"
 *   node tools/player_cli.js guess <room> <id> "推理"
 *   node tools/player_cli.js skip  <room> <id>
 *   node tools/player_cli.js giveup <room> <id>
 *   node tools/player_cli.js vote  <room> <id> yes|no
 *   node tools/player_cli.js state <room> <id>
 *   node tools/player_cli.js solonew <id> <puzzleId>
 *   node tools/player_cli.js soloask <id> <code> "问题"
 *   node tools/player_cli.js solonguess <id> <code> "推理"
 *   node tools/player_cli.js sologiveup <id> <code>
 * ============================================================ */
const BASE = process.env.BASE || "https://soup-room.57gqq9hsq.workers.dev";
const MOCK_AI = {
  provider: "mock", kind: "openai",
  baseUrl: "https://soup-mock-ai.57gqq9hsq.workers.dev/v1",
  model: "mock-host", apiKey: "mock-key"
};

async function req(path, method, body) {
  const r = await fetch(BASE + path, {
    method: method || "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}
function out(obj) { console.log(JSON.stringify(obj)); }

async function main() {
  const [cmd, ...a] = process.argv.slice(2);
  if (cmd === "new") {
    const [id, nick, pid] = a;
    const r = await req("/api/room/new", "POST", { internalId: id, nickname: nick });
    const rc = r.j.roomCode;
    await req("/api/room/" + rc + "/set-ai", "POST", { internalId: id, config: MOCK_AI });
    const c = await req("/api/room/" + rc + "/choose", "POST", { internalId: id, puzzleId: pid });
    const rd = await req("/api/room/" + rc + "/ready", "POST", { internalId: id, ready: true });
    const s = await req("/api/room/" + rc + "/state?me=" + id);
    out({ room: rc, phase: rd.phase || c.phase, title: s.j.puzzle && s.j.puzzle.dispTitle, surface: s.j.puzzle && s.j.puzzle.surface });
  } else if (cmd === "join") {
    const [rc, id, nick] = a;
    const r = await req("/api/room/" + rc + "/join", "POST", { internalId: id, nickname: nick });
    const s = await req("/api/room/" + rc + "/state?me=" + id);
    out({ joined: !r.j.error, phase: s.j.phase, turnUid: s.j.turnUid, youUid: s.j.youUid, title: s.j.puzzle && s.j.puzzle.dispTitle, surface: s.j.puzzle && s.j.puzzle.surface });
  } else if (cmd === "ready") {
    const [rc, id] = a;
    const r = await req("/api/room/" + rc + "/ready", "POST", { internalId: id, ready: true });
    out({ phase: r.j.phase, err: r.j.error });
  } else if (cmd === "ask") {
    const [rc, id, q] = a;
    const r = await req("/api/room/" + rc + "/ask", "POST", { internalId: id, question: q });
    out(r.j.item ? { verdict: r.j.item.verdict, reply: r.j.item.reply } : { err: r.j.error, note: r.j.note, why: r.j.why });
  } else if (cmd === "guess") {
    const [rc, id, t] = a;
    const r = await req("/api/room/" + rc + "/guess", "POST", { internalId: id, text: t });
    out({ level: r.j.level, note: r.j.note, err: r.j.error, truthToMe: r.j.truth ? r.j.truth.slice(0, 40) + "…" : null, privateOk: !!r.j.private });
  } else if (cmd === "skip") {
    const [rc, id] = a;
    const r = await req("/api/room/" + rc + "/skip", "POST", { internalId: id });
    out({ ok: r.j.ok, err: r.j.error });
  } else if (cmd === "giveup") {
    const [rc, id] = a;
    const r = await req("/api/room/" + rc + "/giveup", "POST", { internalId: id });
    out({ ok: r.j.ok, passed: r.j.passed, err: r.j.error, note: r.j.note });
  } else if (cmd === "vote") {
    const [rc, id, y] = a;
    const r = await req("/api/room/" + rc + "/vote", "POST", { internalId: id, yes: y === "yes" });
    out({ ok: r.j.ok, passed: r.j.passed, err: r.j.error, note: r.j.note });
  } else if (cmd === "state") {
    const [rc, id] = a;
    const r = await req("/api/room/" + rc + "/state?me=" + id);
    const j = r.j;
    out({
      phase: j.phase, turnUid: j.turnUid, youUid: j.youUid,
      players: (j.players || []).map((p) => p.uid + ":" + p.nickname + (p.solved ? ":已说破" : "")),
      qaTail: (j.qaLog || []).slice(-6).map((x) => (x.kind === "ask" ? x.nickname + "问:" + x.question + "→" + x.verdict : x.kind + ":" + (x.text || x.reply || ""))),
      myTruthChars: j.myTruth ? j.myTruth.length : 0,
      broadcastTruth: "truth" in j,
      giveUp: j.giveUp, solveOrder: (j.solveOrder || []).map((o) => o.nickname),
      vote: j.vote ? { yes: j.vote.yes, no: j.vote.no, need: j.vote.need, youCanVote: j.vote.youCanVote, leftSec: Math.max(0, Math.round(((j.vote.until || 0) - Date.now()) / 1000)) } : null,
      giveupCooldownLeftSec: Math.round((j.giveupCooldownLeft || 0) / 1000)
    });
  } else if (cmd === "solonew") {
    const [id, pid] = a;
    const r = await req("/api/solo/new", "POST", { internalId: id, nickname: "独汤客", puzzleId: pid });
    const rc = r.j.roomCode;
    await req("/api/solo/" + rc + "/set-ai", "POST", { internalId: id, config: MOCK_AI });
    const s = await req("/api/solo/" + rc + "/state?me=" + id);
    out({ code: rc, phase: s.j.phase, title: s.j.puzzle && s.j.puzzle.dispTitle, surface: s.j.puzzle && s.j.puzzle.surface });
  } else if (cmd === "soloask") {
    const [id, rc, q] = a;
    const r = await req("/api/solo/" + rc + "/ask", "POST", { internalId: id, question: q });
    out(r.j.item ? { verdict: r.j.item.verdict, reply: r.j.item.reply } : { err: r.j.error, note: r.j.note });
  } else if (cmd === "solonguess") {
    const [id, rc, t] = a;
    const r = await req("/api/solo/" + rc + "/guess", "POST", { internalId: id, text: t });
    out({ level: r.j.level, note: r.j.note, err: r.j.error, until: r.j.until || undefined, truthToMe: r.j.truth ? r.j.truth.slice(0, 40) + "…" : null });
  } else if (cmd === "sologiveup") {
    const [id, rc] = a;
    const r = await req("/api/solo/" + rc + "/giveup", "POST", { internalId: id });
    const s = await req("/api/solo/" + rc + "/state?me=" + id);
    out({ passed: r.j.passed, phase: s.j.phase, myTruthChars: s.j.myTruth ? s.j.myTruth.length : 0, broadcastTruth: "truth" in s.j });
  } else {
    console.log("未知命令：" + cmd);
    process.exit(1);
  }
}
main().catch((e) => { console.log(JSON.stringify({ fatal: String(e && e.message || e) })); process.exit(1); });
