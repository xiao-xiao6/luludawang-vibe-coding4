# -*- coding: utf-8 -*-
"""第六轮（全量 1087 道日译中）· 落地修正。

纪律：
  - 先全量预检每一条改动（题号在库、字段存在、old 在该字段里恰好出现 1 次、old!=new），
    任何一条不合格就整批中止、不写盘；
  - 只改 tools/_r6_final_ops.json 里列出的字段，不动条目顺序、不增删条目；
  - 写盘格式与母本一致（紧凑 JSON + SOUP_LIB_TOTAL 同步），改完再自检一遍。
用法：python -X utf8 tools/apply_recheck6_fixes.py [--dry]
"""
import io, os, sys, json, collections

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
T = lambda *p: os.path.join(ROOT, "tools", *p)
MASTER = os.path.join(ROOT, "data", "library", "library.data.js")
DRY = "--dry" in sys.argv

ops = json.load(io.open(T("_r6_final_ops.json"), encoding="utf-8"))
src = io.open(MASTER, encoding="utf-8").read()
head = "var SOUP_LIBRARY = "
h = src.index(head) + len(head)
data, end = json.JSONDecoder().raw_decode(src[h:])

idx = {}
for i, o in enumerate(data):
    idx.setdefault(str(o.get("srcNo")), []).append(i)

# ---------- 预检 ----------
errs, plan = [], []
for k, op in enumerate(ops):
    sn, f, old, new = op["id"], op["field"], op["old"], op["new"]
    where = "#%s.%s[%d]" % (sn, f, k)
    if sn not in idx:
        errs.append("%s 题号不在库" % where); continue
    if len(idx[sn]) > 1:
        errs.append("%s srcNo 重复命中 %d 条" % (where, len(idx[sn]))); continue
    o = data[idx[sn][0]]
    if f not in o:
        errs.append("%s 无该字段" % where); continue
    txt = o.get(f) or ""
    if new and new in txt:
        errs.append("%s 疑似已应用过（new 已在库中），禁止重复落盘" % where); continue
    c = txt.count(old)
    if c != 1:
        errs.append("%s old 命中 %d 次（应为 1）：%s" % (where, c, old[:40].replace("\n", "\u23ce"))); continue
    if old == new:
        errs.append("%s old==new" % where); continue
    if new and any(0x00 <= ord(ch) <= 0x08 for ch in new):
        errs.append("%s new 含控制字符" % where); continue
    plan.append((idx[sn][0], f, old, new, op))

if errs:
    print("\u2717 预检未过 %d 条，整批不写盘：" % len(errs))
    for e in errs:
        print("   ", e)
    sys.exit(2)
print("\u9884\u5168\u90e8 %d \u6761\u6539\u52a8\u901a\u8fc7\uff08\u6d89\u53ca %d \u9898\uff09" % (len(plan), len({p[4]["id"] for p in plan})))
if DRY:
    print("--dry\uff1a\u4e0d\u5199\u76d8")
    sys.exit(0)

# ---------- 应用 ----------
for i, f, old, new, op in plan:
    data[i][f] = (data[i][f] or "").replace(old, new, 1)

import re
tail = re.sub(r"var SOUP_LIB_TOTAL = \d+;", "var SOUP_LIB_TOTAL = %d;" % len(data), src[h + end:])
out = src[:h - len(head)] + head + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";" + tail
io.open(MASTER, "w", encoding="utf-8").write(out)

# ---------- 复核 ----------
chk = io.open(MASTER, encoding="utf-8").read()
h2 = chk.index(head) + len(head)
data2, _ = json.JSONDecoder().raw_decode(chk[h2:])
assert len(data2) == len(data), "\u6761\u76ee\u6570\u4e0d\u4e00\u81f4"
applied = collections.Counter()
bad = []
for i, f, old, new, op in plan:
    sn = op["id"]
    now = [x for x in data2 if str(x.get("srcNo")) == sn][0][f]
    # \u63d2\u5165\u578b\u6539\u6cd5\uff08new \u542b old\uff09\u672c\u6765\u5c31\u4f1a\u4fdd\u7559\u65e7\u4e32\uff0c\u53ea\u6821\u9a8c\u65b0\u4e32\u662f\u5426\u843d\u5730
    if old and old not in new and old in now:
        bad.append("%s.%s \u65e7\u4e32\u4ecd\u5728" % (sn, f))
    if new and new not in now:
        bad.append("%s.%s \u65b0\u4e32\u672a\u843d\u5730" % (sn, f))
    applied[sn] += 1
print("\u5199\u76d8\u5b8c\u6210\uff1a\u6bcd\u672c %d \u9898\uff0c\u6539\u52a8 %d \u5904\uff0c\u6d89\u53ca %d \u9898" % (len(data2), len(plan), len(applied)))
if bad:
    print("\u2717 \u56de\u8bfb\u6821\u9a8c\u5f02\u5e38\uff1a")
    for b in bad:
        print("   ", b)
    sys.exit(3)
print("\u56de\u8bfb\u6821\u9a8c\uff1a\u5168\u90e8\u65e7\u4e32\u5df2\u6e05\u96f6\u3001\u5168\u90e8\u65b0\u4e32\u5df2\u843d\u5730 \u2713")
log = [{"id": op["id"], "field": f, "kind": op["kind"], "why": op["why"], "old": old, "new": new}
       for i, f, old, new, op in plan]
io.open(T("recheck6_fix_log.json"), "w", encoding="utf-8").write(json.dumps(log, ensure_ascii=False, indent=1))
print("\u65e5\u5fd7\uff1atools/recheck6_fix_log.json")
