/* 回归自检：不开浏览器，验证本轮修复的核心逻辑不回归
 * 覆盖：Bug1 clearRoom / Bug2 心跳 / Bug3 撤准备回大堂 / Bug5 空局不轰炸
 *       Bug9 容错·重试 / Bug4 分层选汤 / Bug7+8 渲染目标
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

const room = read("worker/src/room.js");
const ai = read("worker/src/ai.js");
const net = read("js/net.js");
const ui = read("js/room-ui.js");
const html = read("index.html");
const css = read("style.css");
const app = read("js/app.js");
const idx = read("worker/src/index.js");

console.log("\n[P0] Bug 9 · AI 掉线");
ok("callModel 有重试循环", /for \(var attempt = 0; attempt < 2; attempt\+\+\)/.test(ai));
ok("4xx 不重试直接抛", /HTTP_4\\d\\d/.test(ai));
ok("reasoning_content 兜底", /reasoning_content/.test(ai));
ok("pickJson 容错尾逗号", /尾逗号/.test(ai) && ai.indexOf("$1") !== -1);
ok("服务端 aiTest 方法", /async aiTest\(/.test(room));
ok("ai-test 动作已注册", /case "ai-test"/.test(room));
ok("前端有「测试连接」按钮", /id="rai-test"/.test(ui));
ok("测试调用走 ai-test", /act\("ai-test"/.test(ui));

console.log("\n[P0] Bug 5 · 超时跳过轰炸");
ok("sweepTurn 要求 puzzleId（提前返回式）", /s\.phase !== "playing" \|\| !s\.puzzleId \|\| !s\.turnDeadline/.test(room));
ok("setReady 开局要求 puzzleId", /if \(allReady && s\.puzzleId\)/.test(room));

console.log("\n[P1] Bug 2 · 在线离线");
ok("snapshot 有心跳参数", /async snapshot\(.*meId/.test(room) || /snapshot\(meId\)/.test(room));
ok("轮询即心跳刷 lastSeen（带 5s 节流）", /you\.lastSeen = now\(\)/.test(room) && /now\(\) - \(you\.lastSeen \|\| 0\) > 5000/.test(room));
ok("online 阈值已放宽", /ONLINE_MS\s*=\s*35000/.test(room) && /now\(\) - \(p\.lastSeen \|\| 0\) < ONLINE_MS/.test(room));

console.log("\n[P1] Bug 3 · 取消准备");
ok("playing 阶段撤回回大堂", /s\.phase === "playing" && !ready/.test(room));
ok("撤回后全员重置 ready", /s\.players\.forEach\(\(x\) => \{ x\.ready = false; \}\)/.test(room));
ok("前端撤回按钮文案", /撤回准备（回大堂）/.test(ui));

console.log("\n[P1] Bug 1 · 刷新回房");
ok("net 有 clearRoom", /function clearRoom\(\)/.test(net));
ok("clearRoom 已导出", /clearRoom: clearRoom/.test(net));
ok("leaveRoom 调用 clearRoom", /if \(N && N\.clearRoom\) N\.clearRoom\(\)/.test(ui));
ok("单人房号不触发多人 resume", /if \(m\.solo\) return false;/.test(ui));

console.log("\n[P2] Bug 4 · 选汤数据源");
ok("选汤面板有分层 tab", /data-layer="core"/.test(ui) && /data-layer="lib"/.test(ui));
ok("选汤走本地汤库并分页", /function localPool\(\)/.test(ui) && /st\.page \* PAGE/.test(ui));
ok("服务端仍支持 layer", /layer === "lib" \? allPuzzleIds\(\) : corePuzzleIds\(\)/.test(idx));
ok("服务端支持 q 模糊搜", /url\.searchParams\.get\("q"\)/.test(idx));

console.log("\n[P3] Bug 7+8 · 布局重构");
ok("布局三列", /grid-template-columns: 300px minmax\(0, 1fr\) 302px/.test(css));
ok("左栏问答记录存在", /class="col-qa"/.test(html));
ok("右栏线索板存在", /class="col-clue"/.test(html));
ok("已删除 room-mode 藏右栏规则", !/body\.room-mode \.col-clue\s*\{\s*display:\s*none/.test(css));
ok("第⑥条：room-ui 不再渲染线索板", !/clue-list/.test(ui));
ok("renderQa 指向全局 #qa-log", /var box = \$\("#qa-log"\)/.test(ui));
ok("不再引用已删除的 room-qa-log", !/\$\("#room-qa-log"\)/.test(ui));
ok("不再保留 room-clues 旧类", !/class="room-clues"/.test(html));
ok("响应式不再把三列压成两列", !/\.layout \{ grid-template-columns: minmax\(0, 1fr\) 268px; \}/.test(css));

console.log("\n[连带] 界面切换 / 清空按钮");
ok("清空问答按钮已恢复", /id="btn-qa-clear"/.test(html));
ok("多人房隐藏清空按钮", /body\.room-mode \.qa-clear \{ display: none; \}/.test(css));
ok("切界面时收起房间屏", /function leaveRoomScreen\(\)/.test(app));
ok("room-ui 导出 leaveScreen", /leaveScreen: function \(\)/.test(ui));
ok("sys 消息有渲染分支", /x\.kind === "sys"/.test(ui));

console.log("\n" + (fail === 0 ? "✅ 全部通过" : "❌ 有失败") + "  " + pass + " passed / " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
