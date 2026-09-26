# -*- coding: utf-8 -*-
"""
体检修复 · 第 3 步：
 A) 引号不配对（3 处，其中 2 处是翻译漏/多括号，按日文原文结构修正）
 B) 跨层去重：汤库里与精品层撞车的同一道经典题（精品是手工打磨版，删汤库那份）
"""
import io, os, re, json, shutil, sys
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
MASTER = T("data", "library", "library.data.js")

src = io.open(MASTER, encoding="utf-8").read()
head = src[:src.find("var SOUP_LIBRARY")]
i = src.find("var SOUP_LIBRARY"); i = src.find("[", i)
end = src.find("\nvar SOUP_LIB_CATS", i)
tail = src[end:]
data = json.loads(src[i:end].rsplit("]", 1)[0] + "]")
byid = {e["id"]: e for e in data}
print("条目数:", len(data))

# ---------- A) 引号修正（按原文结构）----------
QUOTES = [
 # 姥姥的葬礼：妈妈那句话缺后引号
 ("lib_bf6dc1df19ca", "surface",
  "妈妈抓着我说：“你爸爸有问题。明早我们就走！2月22号",
  "妈妈抓着我说：“你爸爸有问题。明早我们就走！”2月22号"),
 # 雨，乃人之妄念：原文「なんだって？？」独立成句，其后是叙述
 ("lib_f30b578b106e", "truth",
  "「你说什么？？这完全出乎我的预料，我一时慌了神。",
  "「你说什么？？」这完全出乎我的预料，我一时慌了神。"),
 # 万代不易的命运：内层原文是｛…｝强调，被译成『』导致外层提前闭合 → 改回「」
 ("lib_90019f9e0732", "truth",
  "『和莲见理沙子换了身体、』到了二十七八岁『变成女性理沙子』之后",
  "『「和莲见理沙子换了身体、」到了二十七八岁「变成女性理沙子」之后"),
]
errs = []
for pid, f, old, new in QUOTES:
    e = byid.get(pid)
    if not e: errs.append("缺条目 " + pid); continue
    if old not in e[f]: errs.append("%s.%s 旧串不存在: %s" % (pid, f, old[:24])); continue
    if e[f].count(old) > 1: errs.append("%s.%s 旧串不唯一" % (pid, f)); continue
for x in errs:
    print("预检失败:", x)
if errs: sys.exit(2)
for pid, f, old, new in QUOTES:
    byid[pid][f] = byid[pid][f].replace(old, new)

# 复核全库引号配对
def unbal(s):
    bad = []
    for op, cl in (("「", "」"), ("“", "”"), ("『", "』")):
        if s.count(op) != s.count(cl): bad.append("%s%d/%s%d" % (op, s.count(op), cl, s.count(cl)))
    return bad
left = [(e["id"], f, unbal(e[f])) for e in data for f in ("surface", "truth") if unbal(e.get(f) or "")]
print("修复后仍不配对:", len(left), left[:5])

# ---------- B) 跨层去重 ----------
XDEL = {
 "lib_5a74db2ed992": ("elevator 十二楼的按钮（精品层）", "同一道电梯侏儒经典题，精品版更完整"),
 "lib_73c238975974": ("match 沙漠里的火柴（精品层）", "同一道半根火柴/热气球经典题，精品版更完整"),
 "lib_44433fb07ea5": ("turtle 最后一碗汤（精品层）", "海龟汤本汤，精品版即此题"),
 "lib_75f091e6b064": ("turtle 最后一碗汤（精品层）", "海龟汤本汤的性别变体，同一故事核"),
}
for d in XDEL:
    if d not in byid: errs.append("跨层删除条不存在 " + d)
if errs: print("预检失败(跨层)"); [print("  ", x) for x in errs]; sys.exit(2)

before = len(data)
data = [e for e in data if e["id"] not in XDEL]
print("跨层去重: %d -> %d" % (before, len(data)))

assert all((e.get("title") or "").strip() for e in data)
assert all((e.get("truth") or "").strip() for e in data)
assert all((e.get("surface") or "").strip() for e in data)
shutil.copyfile(MASTER, T("_local_backup", "library.data.js.bak-checkup3"))
body = head + "var SOUP_LIBRARY = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";" + tail
io.open(MASTER, "w", encoding="utf-8").write(body)

rp = T("tools", "checkup_removed.json")
old = json.load(io.open(rp, encoding="utf-8")) if os.path.exists(rp) else {}
for d, (keep, why) in XDEL.items():
    old[d] = {"kept": keep, "why": why, "title": byid[d]["title"], "cross_layer": True}
io.open(rp, "w", encoding="utf-8").write(json.dumps(old, ensure_ascii=False, indent=1))
print("完成 | 最终条目:", len(data), "| 引号修补:", len(QUOTES), "| 跨层删除:", len(XDEL))
