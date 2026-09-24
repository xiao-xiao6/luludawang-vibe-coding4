/* 本地复跑站点守卫的三条断言（与 .github/workflows/site-guard.yml 同口径）。
 * 用法：node tools/check_site_guard.js
 */
const fs = require("fs");
const { execSync } = require("child_process");

let fail = 0;
function ok(name, cond, extra) {
  console.log((cond ? "  ✓ " : "  ✗ ") + name + (extra ? "   [" + extra + "]" : ""));
  if (!cond) fail++;
}

console.log("\n[1] 内部数据源不得被跟踪");
const tracked = execSync("git ls-files", { encoding: "utf8" }).split("\n");
ok("data/library/ 未被 git 跟踪", !tracked.some((f) => f.startsWith("data/library/")));
ok("worker/src/*.data.js 未被 git 跟踪", !tracked.some((f) => /^worker\/src\/.*\.data\.js$/.test(f)));

console.log("\n[2] 公开汤库档结构自检");
const s = fs.readFileSync("js/library.public.js", "utf8");
ok("含 hasTruth 标记", /hasTruth/.test(s));
const n = (s.match(/\{"id":/g) || []).length;
/* 宽容空白：产物可能被重排成 "hasTruth": true / "hasTruth":true 两种写法 */
const t = (s.match(/"hasTruth"\s*:\s*true/g) || []).length;
ok("题量 ≥ 900", n >= 900, n + " 条");
ok("带汤底 ≥ 900", t >= 900, t + " 条");
ok("不是 ES module（<script src> 可加载）", !/^\s*export\s/m.test(s));

console.log("\n" + (fail === 0 ? "✅ 站点守卫三条全过" : "❌ 有失败") + "  " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
