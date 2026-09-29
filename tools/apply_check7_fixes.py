# -*- coding: utf-8 -*-
"""第七轮（繁译简 / 英译中）· 落地修正。

纪律（沿用第六轮）：
  - 先全量预检每一条改动（库 id 在库、字段存在、old 在该字段里恰好出现 1 次、old!=new），
    任何一条不合格就整批中止、不写盘；
  - 只改 tools/_c7_final_ops.json 列出的字段，不动条目顺序、不增删条目；
  - 写盘格式与母本一致（紧凑 JSON + SOUP_LIB_TOTAL 同步），改完回读自检。
用法：python -X utf8 tools/apply_check7_fixes.py [--dry]
"""
import io, os, sys, json, collections, re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
T = lambda *p: os.path.join(ROOT, "tools", *p)
MASTER = os.path.join(ROOT, "data", "library", "library.data.js")
DRY = "--dry" in sys.argv

ops = json.load(io.open(T("_c7_final_ops.json"), encoding="utf-8"))
src = io.open(MASTER, encoding="utf-8").read()
head = "var SOUP_LIBRARY = "
h = src.index(head) + len(head)
data, end = json.JSONDecoder().raw_decode(src[h:])

idx = {}
for i, o in enumerate(data):
    idx.setdefault(str(o.get("id")), []).append(i)

errs, plan = [], []
for k, op in enumerate(ops):
    sid, f, old, new = op["id"], op["field"], op["old"], op["new"]
    where = "#%s.%s[%d]" % (sid, f, k)
    if sid not in idx:
        errs.append("%s 库 id 不在母本" % where); continue
    if len(idx[sid]) > 1:
        errs.append("%s 库 id 重复命中 %d 条" % (where, len(idx[sid]))); continue
    o = data[idx[sid][0]]
    if f not in o:
        errs.append("%s 无该字段" % where); continue
    txt = o.get(f) or ""
    if new and new not in old and new in txt:
        errs.append("%s 疑似已应用过（new 已在字段中）" % where); continue
    c = txt.count(old)
    if c != 1:
        errs.append("%s old 命中 %d 次（应为 1）：%s" % (where, c, old[:40].replace("\n", "⏎"))); continue
    if old == new:
        errs.append("%s old==new" % where); continue
    if new and any(0x00 <= ord(ch) <= 0x08 for ch in new):
        errs.append("%s new 含控制字符" % where); continue
    plan.append((idx[sid][0], f, old, new, op))

print("预检 %d 条改动，通过 %d 条（涉及 %d 题）" % (len(ops), len(plan), len({p[4]["id"] for p in plan})))
if errs:
    print("✗ 预检未过 %d 条，整批不写盘：" % len(errs))
    for e in errs:
        print("   ", e)
    sys.exit(2)
for i, f, old, new, op in plan:
    print("  %-22s %-9s %s" % (op["id"], f, op["why"]))
if DRY:
    print("--dry：不写盘")
    sys.exit(0)

for i, f, old, new, op in plan:
    data[i][f] = (data[i][f] or "").replace(old, new, 1)

tail = re.sub(r"var SOUP_LIB_TOTAL = \d+;", "var SOUP_LIB_TOTAL = %d;" % len(data), src[h + end:])
out = src[:h - len(head)] + head + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";" + tail
io.open(MASTER, "w", encoding="utf-8").write(out)

chk = io.open(MASTER, encoding="utf-8").read()
data2, _ = json.JSONDecoder().raw_decode(chk[chk.index(head) + len(head):])
assert len(data2) == len(data), "条目数不一致"
byid = {o["id"]: o for o in data2}
bad = []
for i, f, old, new, op in plan:
    now = byid[op["id"]][f] or ""
    if old not in new and old in now:
        bad.append("%s.%s 旧串仍在" % (op["id"], f))
    if new and new not in now:
        bad.append("%s.%s 新串未落地" % (op["id"], f))
print("写盘完成：母本 %d 题，改动 %d 处，涉及 %d 题" % (len(data2), len(plan), len({p[4]["id"] for p in plan})))
if bad:
    print("✗ 回读校验异常：")
    for b in bad:
        print("   ", b)
    sys.exit(3)
print("回读校验：全部旧串已清零、全部新串已落地 ✓")
log = [{"id": op["id"], "field": f, "kind": op["kind"], "why": op["why"], "old": old, "new": new}
       for i, f, old, new, op in plan]
io.open(T("check7_fix_log.json"), "w", encoding="utf-8").write(json.dumps(log, ensure_ascii=False, indent=1))
print("日志：tools/check7_fix_log.json")
