/* 回归自检：验证 2026-09-23 多人联机体验修复包（不依赖真实 Worker 环境）
 * 覆盖：单人左栏刷新 / 聊天框 / 增量轮询 / 飞行锁 / 死座位 / 思考横幅 / AI 拦截提示 / SW 版本
 */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name); }
}

const html = read("index.html");
const css = read("style.css");
const app = read("js/app.js");
const net = read("js/net.js");
const ui = read("js/room-ui.js");
const sw = read("sw.js");
const wai = read("worker/src/ai.js");
const widx = read("worker/src/index.js");
const wroom = read("worker/src/room.js");

console.log("\n[单①] 单人模式提问/推理后左栏立即刷新");
ok("AI 提问后调用 renderQaLog", /state\.history\.push\(\{ q: asked, a: out\.reply \}\);[\s\S]*?renderQaLog\(\);/.test(app));
ok("AI 推理后调用 renderQaLog", /state\.history\.push\(\{ q: "【推理】" \+ text, a: out\.note \}\);[\s\S]*?renderQaLog\(\);/.test(app));

console.log("\n[新①] 右下角常驻聊天框");
ok("HTML 有 #room-chat 容器", /id="room-chat"/.test(html));
ok("HTML 有 #room-chat-log / #room-chat-input / #btn-room-chat-send", /id="room-chat-log"/.test(html) && /id="room-chat-input"/.test(html) && /id="btn-room-chat-send"/.test(html));
ok("CSS 有 .room-chat 固定右下角", /\.room-chat\s*\{[\s\S]*position:\s*fixed;[\s\S]*right:\s*calc\(18px \+ var\(--sar\)\);[\s\S]*bottom:\s*calc\(18px \+ var\(--sab\)\);/.test(css));
ok("CSS 有折叠态 .room-chat.collapsed", /\.room-chat\.collapsed/.test(css));
ok("UI 有 renderChat 渲染", /function renderChat\(s\)/.test(ui));
ok("UI 有 doChat 发送", /function doChat\(\)/.test(ui));
ok("UI 有 toggleChat 折叠", /function toggleChat\(force\)/.test(ui));
ok("服务端有 say 分支", /case "say":\s*out = await this\.say\(body\);/.test(wroom));
ok("服务端 say 有幂等 clientId 去重", /clientId/.test(wroom) && /dup/.test(wroom));
ok("服务端 say 有 TOO_FAST 频控", /TOO_FAST/.test(wroom));
ok("快照下发 chatLog / chatSeq", /chatLog:\s*\(s\.chatLog \|\| \[\]\)\.slice\(-CHAT_MAX\)/.test(wroom) && /chatSeq:\s*s\.chatSeq \|\| 0/.test(wroom));

console.log("\n[新②] 增量轮询（since/rev）");
ok("net.js 带 since 参数", /since=/.test(net) && /state\.rev/.test(net));
ok("net.js 处理 unchanged", /snap\.unchanged/.test(net));
ok("worker index 透传 since", /sinceRaw/.test(widx) && /sinceQ/.test(widx));
ok("DO 快路径返回 unchanged", /unchanged:\s*true/.test(wroom));
ok("DO 快路径也刷 lastSeen", /me\.online = true; me\.lastSeen = now\(\)/.test(wroom));
ok("DO 只在脏时落盘", /if \(this\._dirty\) await this\.save\(\);/.test(wroom));

console.log("\n[多①] AI 飞行锁与全桌「思考中」");
ok("服务端有 ASK_LOCK_MS", /ASK_LOCK_MS/.test(wroom));
ok("ask 检查 askInFlightUntil 并返回 AI_BUSY", /AI_BUSY/.test(wroom));
ok("ask 设置 pendingAI", /s\.pendingAI = \{ uid: p\.uid, nickname: p\.nickname, question: raw, at: now\(\) \}/.test(wroom));
ok("ask 完成后清 pendingAI", /s\.pendingAI = null;/.test(wroom));
ok("快照下发 pendingAI", /pendingAI:\s*s\.pendingAI/.test(wroom));
ok("HTML 有 #room-pending 横幅", /id="room-pending"/.test(html));
ok("CSS 有 .room-pending", /\.room-pending/.test(css));
ok("UI 渲染 pendingAI 横幅", /pending\.nickname/.test(ui) && /pending\.question/.test(ui));
ok("UI 提问后立刻锁按钮", /R\.askBusy = true;/.test(ui) && /paintAskBusy\(true\)/.test(ui));
ok("UI 处理 AI_BUSY 文案", /AI_BUSY/.test(ui));

console.log("\n[多②] 死座位与请离");
ok("服务端有 DEAD_SEAT_MS", /DEAD_SEAT_MS/.test(wroom));
ok("快照下发 seatRemovable", /seatRemovable:\s*!p\.isHost/.test(wroom));
ok("kick 拒绝房主", /CANNOT_KICK_HOST/.test(wroom));
ok("kick 区分死座位与普通请离", /DEAD_SEAT_MS/.test(wroom) && /被房主请离了房间/.test(wroom));
ok("UI 渲染请离按钮", /data-kick/.test(ui));
ok("UI 有 doKick", /function doKick\(uid\)/.test(ui));

console.log("\n[多③] 问答记录二级面板");
ok("HTML 有 #btn-room-qa", /id="btn-room-qa"/.test(html));
ok("UI 有 openQaPanel", /function openQaPanel\(\)/.test(ui));
ok("CSS 有 .room-qa-sheet", /\.room-qa-sheet/.test(css));

console.log("\n[多④] AI 网关/WAF 拦截提示");
ok("服务端识别 GATEWAY_BLOCKED", /GATEWAY_BLOCKED/.test(wai) && /GATEWAY_BLOCKED/.test(wroom));
ok("服务端导出 GATEWAY_BLOCKED_HINT", /export const GATEWAY_BLOCKED_HINT/.test(wai));
ok("UI 有 AI_GATEWAY_BLOCKED 文案", /AI_GATEWAY_BLOCKED/.test(ui));

console.log("\n[多⑤] 实时对话流与电影式左栏滚动");
ok("HTML 有 #room-feed", /id="room-feed"/.test(html));
ok("CSS 有 .room-feed", /\.room-feed/.test(css));
ok("UI 有 renderFeed", /function renderFeed\(s\)/.test(ui));
ok("UI 有 ensureQaScroll / stopQaScroll", /function ensureQaScroll\(\)/.test(ui) && /function stopQaScroll\(\)/.test(ui));
ok("UI 禁止手动滚动", /blockManualScroll/.test(ui));
ok("CSS 有 room-mode 下禁止选择/触摸", /body\.room-mode \.qa-log/.test(css) && /user-select:\s*none/.test(css));

console.log("\n[收尾] Service Worker 缓存版本升级");
ok("sw.js 缓存版本号 ≥ v11", /deepsea-soup-v(1[1-9]|[2-9]\d|[1-9]\d{2,})/.test(sw));

console.log("\n" + (fail === 0 ? "✅ 全部通过" : "❌ 有失败") + "  " + pass + " passed / " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
