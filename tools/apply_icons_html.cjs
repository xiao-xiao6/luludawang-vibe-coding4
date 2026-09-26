/* 一次性静态构建：把 index.html 里所有 emoji 换成同风格内联 SVG。
   跑法：node tools/apply_icons_html.mjs  （改完即可留档，重复跑幂等由源检查兜底） */
const fs = require("fs");
const path = require("path");
const I = require(path.join(__dirname, "..", "js", "icons.js"));
const root = path.join(__dirname, "..");
const file = path.join(root, "index.html");
let t = fs.readFileSync(file, "utf8");
const ic = (n) => I.icon(n);          // <span class="ic"><svg/></span>
const raw = (n) => I.raw(n);          // 裸 svg

const pairs = [
  // 顶栏
  ['<span class="brand-ico" aria-hidden="true">🍲</span>',
   '<span class="brand-ico" aria-hidden="true">' + raw("pot") + "</span>"],
  ["🎲 随机模式", ic("dice") + " 随机模式"],
  ["📚 汤库", ic("books") + " 汤库"],
  ["🏠 多人房间", ic("house") + " 多人房间"],
  ["🤖 AI 汤主</button>", ic("robot") + " AI 汤主</button>"],
  ["🎵 音乐</button>", ic("music") + " 音乐</button>"],
  ['title="播放 / 暂停音乐">⏸</button>', 'title="播放 / 暂停音乐">' + raw("pause") + "</button>"],
  ["🔊 音效</button>", ic("volume") + " 音效</button>"],
  ["✨ 特效</button>", ic("spark") + " 特效</button>"],
  // 大厅装饰大图标
  ['<div class="pot" aria-hidden="true">🍲</div>',
   '<div class="pot" aria-hidden="true">' + raw("pot") + "</div>"],
  ['<div class="pot" aria-hidden="true">🎲</div>',
   '<div class="pot" aria-hidden="true">' + raw("dice") + "</div>"],
  // 规则第 6 条里的 🤖（只有一处）
  ["<b>🤖 AI 汤主</b>", "<b>" + ic("robot") + " AI 汤主</b>"],
  // 房间页头
  ["<h2>🏠 多人汤屋</h2>", "<h2>" + ic("house") + " 多人汤屋</h2>"],
  // 轮次倒计时徽章（初始文案 60s 与 JS 的 90s 无关：JS 每秒会重画）
  ['role="timer" aria-live="off">⏳ 60s</span>',
   'role="timer" aria-live="off">' + ic("hourglass") + " 90s</span>"],
  // 问底栏按钮
  [">📋 问答记录</button>", ">" + ic("clipboard") + " 问答记录</button>"],
  [">🤫 猜底手账</button>", ">" + ic("secret") + " 猜底手账</button>"],
  [">📓 备忘录＆线索整理处</span>", ">" + ic("notebook") + " 备忘录＆线索整理处</span>"],
  ["💬 房间聊天<span", ic("chat") + " 房间聊天<span"]
];

let miss = 0;
for (const [from, to] of pairs) {
  const n = t.split(from).length - 1;
  if (n === 0) { console.error("MISS:", from.slice(0, 60)); miss++; continue; }
  t = t.split(from).join(to);
}

/* favicon：emoji 锅 → 自绘线性锅（深底 + 琥珀描边） */
const favOld = t.match(/<link rel="icon" href="[^"]*" \/>/);
if (favOld) {
  const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>" +
    "<rect width='24' height='24' rx='5' fill='%23140e09'/>" +
    "<g fill='none' stroke='%23d9a441' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'>" +
    "<path d='M4.5 10.5h15'/><path d='M6 10.5v5.2a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4v-5.2'/>" +
    "<path d='M4.5 10.5H3m18 0h-1.5'/>" +
    "<path d='M9.2 7.3c-.6-1 .6-1.7 0-2.7M12 7.3c-.6-1 .6-1.7 0-2.7M14.8 7.3c-.6-1 .6-1.7 0-2.7'/></g></svg>";
  t = t.replace(favOld[0], '<link rel="icon" href="data:image/svg+xml,' + svg + '" />');
} else { console.error("MISS favicon link"); miss++; }

/* 挂 icons.js：必须在 room-ui / app 之前 */
if (t.indexOf("js/icons.js") === -1) {
  t = t.replace('<script src="js/net.js" defer></script>',
    '<script src="js/icons.js" defer></script>\n<script src="js/net.js" defer></script>');
} else { console.error("icons.js 已挂过"); }

fs.writeFileSync(file, t, "utf8");
console.log(miss ? "有 " + miss + " 处没匹配上" : "index.html 图标化完成");
/* 残留 emoji 自检（排除 ★☆●○ 等纯文字排版符号与注释里的圈号） */
const leftover = t.match(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{FE0F}]/gu);
if (leftover) console.log("残留:", [...new Set(leftover)].join(" "));
