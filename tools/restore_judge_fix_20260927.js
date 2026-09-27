/* ============================================================
 * 一键还原：把 2026-09-27「判定修复」改动的文件恢复成改动前
 * ------------------------------------------------------------
 * 用法：
 *   node tools/restore_judge_fix_20260927.js           # 先看会改哪些文件（不写盘）
 *   node tools/restore_judge_fix_20260927.js --apply    # 真还原
 *
 * 备份来源：_local_backup/ai-judge-fix-<时间戳>/
 * 只还原 3 个源文件（js/ai.js、worker/src/ai.js、worker/src/room.js），
 * 新增的 2 个验收脚本不动（它们是新增文件，留着不影响站点）。
 * ============================================================ */
"use strict";

const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const BACKUP_ROOT = path.join(ROOT, "_local_backup");

const TARGETS = [
  { bak: "js__ai.js.bak", to: path.join("js", "ai.js") },
  { bak: "worker__src__ai.js.bak", to: path.join("worker", "src", "ai.js") },
  { bak: "worker__src__room.js.bak", to: path.join("worker", "src", "room.js") }
];

function findLatestBackup() {
  if (!fs.existsSync(BACKUP_ROOT)) return null;
  const dirs = fs.readdirSync(BACKUP_ROOT)
    .filter((d) => /^ai-judge-fix-/.test(d))
    .map((d) => ({ d, p: path.join(BACKUP_ROOT, d) }))
    .filter((x) => fs.statSync(x.p).isDirectory());
  if (!dirs.length) return null;
  dirs.sort((a, b) => (a.d < b.d ? 1 : -1));   /* 时间戳倒序，取最新 */
  return dirs[0].p;
}

const apply = process.argv.indexOf("--apply") !== -1;
const bakDir = findLatestBackup();

if (!bakDir) {
  console.error("找不到备份目录：_local_backup/ai-judge-fix-*/");
  console.error("请确认备份还在，或改用 git 还原：git checkout -- js/ai.js worker/src/ai.js worker/src/room.js");
  process.exit(1);
}

console.log("备份目录：" + path.relative(ROOT, bakDir));
console.log(apply ? "模式：真还原（--apply）" : "模式：预演（加 --apply 才写盘）");
console.log("");

let ok = 0, miss = 0;
for (const t of TARGETS) {
  const src = path.join(bakDir, t.bak);
  const dst = path.join(ROOT, t.to);
  if (!fs.existsSync(src)) {
    console.log("  ✗ 备份缺失：" + t.bak);
    miss++;
    continue;
  }
  const before = fs.existsSync(dst) ? fs.statSync(dst).size : -1;
  const after = fs.statSync(src).size;
  console.log("  → " + t.to + "   " + before + " 字节  ⇒  " + after + " 字节");
  if (apply) {
    fs.copyFileSync(src, dst);
    ok++;
  }
}

console.log("");
if (apply) {
  console.log("已还原 " + ok + " 个文件" + (miss ? "，" + miss + " 个失败" : "") + "。");
  console.log("还原后建议跑一遍：node tools/verify_ai_fixes.js");
} else {
  console.log("预演结束，未写盘。确认无误后加 --apply 执行。");
}
