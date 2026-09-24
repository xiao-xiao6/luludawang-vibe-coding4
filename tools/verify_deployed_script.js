/* 线上 Worker 部署取证：从 Cloudflare 拉「线上正在跑的」脚本本体，直接核对题库。
 *
 * 为什么这样取证最硬：看的是部署在边缘、真正在执行的那份字节 —— 不是本地文件，
 * 也不是接口的间接推断。打包后非 ASCII 会写成 \uXXXX（大写十六进制），
 * 所以比对时统一转成同一形式。
 *
 * 用法：node tools/verify_deployed_script.js
 */
const fs = require("fs"), os = require("os"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
const ACCOUNT = "bb9c3eb95b20735060fc0002a5250bfe";
const CONF = path.join(os.homedir(), "AppData", "Roaming", "xdg.config", ".wrangler", "config", "default.toml");

/* 打包后的转义形式：非 ASCII → \uXXXX（大写） */
function esc(s) {
  return Array.from(s).map((c) => {
    const cp = c.codePointAt(0);
    return cp > 127 ? "\\u" + cp.toString(16).toUpperCase().padStart(4, "0") : c;
  }).join("");
}

const TEN = ["lib_314cc038dce2","lib_73c238975974","lib_7695fa789e5e","lib_9303cd77d99f",
             "lib_9f6caf094103","lib_ccc003a29e20","lib_d4356e3192b7","lib_d9a053630dee",
             "lib_e24398bc436c","lib_ee8eecd3c58d"];
const TAILS = ["7、呜呜呜", "5、一起走", "11、赏罚分明", "## 58. 《黑猫》",
               "## 56. 《两个哥哥》", "## 55. 《红色高跟鞋》",
               "(See also #1.31.)", "【输出规则】"];

(async () => {
  const token = fs.readFileSync(CONF, "utf8").match(/oauth_token\s*=\s*"([^"]+)"/)[1];
  const H = { authorization: "Bearer " + token };
  const b = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/soup-room`;

  let fail = 0;
  const ok = (n, c, x) => { console.log((c ? "  ✓ " : "  ✗ ") + n + (x ? "   [" + x + "]" : "")); if (!c) fail++; };

  const dep = await (await fetch(b + "/deployments", { headers: H })).json();
  const v = dep.result.deployments[0].versions[0];
  console.log("\n线上版本:", v.version_id, "(" + v.percentage + "%)  created:", dep.result.deployments[0].created_on);

  const src = Buffer.from(await (await fetch(b + "/content/v2", { headers: H })).arrayBuffer()).toString("utf8");
  console.log("脚本体积:", src.length, "字节");

  const localLib = fs.readFileSync(path.join(ROOT, "worker", "src", "library.data.js"), "utf8");
  const lib = JSON.parse(localLib.match(/export const SOUP_LIBRARY_SLIM\s*=\s*(\[.*?\]);/s)[1]);
  const by = {}; lib.forEach((p) => { by[p.id] = p; });

  console.log("\n[1] 10 条历史污染题的「完整干净 truth」在线上脚本中");
  let found = 0;
  for (const id of TEN) {
    const t = by[id].truth;
    const form = esc(t).replace(/"/g, '\\\\\\"');
    const hit = src.indexOf(form) !== -1;
    if (hit) found++;
    else console.log("   未命中:", id);
  }
  ok("干净完整 truth 全部命中", found === 10, found + "/10");

  console.log("\n[2] 污染尾巴在线上脚本中");
  const hitTails = [];
  for (const t of TAILS) {
    const n = src.split(esc(t)).length - 1;
    if (n) hitTails.push(t + "×" + n);
  }
  ok("8 类污染尾巴全部不存在", hitTails.length === 0, hitTails.join(", ") || "0 命中");

  console.log("\n[3] 版本一致性");
  ok("线上版本 = 本次 wrangler deploy 上传的版本", v.version_id === "1fee080f-12c4-4c55-8499-8329f9c22f5d",
     v.version_id);

  console.log("\n" + (fail === 0 ? "✅ 线上运行版本确认：题库干净且完整" : "❌ 有失败") + "  " + fail + " failed\n");
  process.exit(fail === 0 ? 0 : 1);
})();
