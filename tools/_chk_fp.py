# -*- coding: utf-8 -*-
"""验证 R1/R5 是否假阳性：英译中的字符比分布 + 缺数字是否转为中文数字"""
import io, os, re, json, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
pairs = json.load(io.open(T("tools", "checkup_pairs.json"), encoding="utf-8"))
iss = json.load(io.open(T("tools", "checkup_trans_issues.json"), encoding="utf-8"))
import statistics
by = {}
for p in pairs: by[p["id"]] = p
for tag in ("英译中", "日译中", "繁译简"):
    rs = []
    for p in pairs:
        if p["tag"] != tag: continue
        o, z = p["o_truth"], p["zh_truth"]
        if len(o) > 60: rs.append(len(z) / len(o))
    if rs:
        print("%s 汤底 中/原长度比：中位数 %.2f 最小 %.2f 样本 %d" % (tag, statistics.median(rs), min(rs), len(rs)))
# R1 按标签统计
from collections import Counter
r1 = [i for i in iss if i["rule"] == "R1_UNDERTRANSLATE"]
print("R1 按标签:", dict(Counter(i["tag"] for i in r1)))
r5 = [i for i in iss if i["rule"] == "R5_NUM_LOST"]
print("R5 按标签:", dict(Counter(i["tag"] for i in r5)))
CN = "零一二三四五六七八九十百千万两遍半"
print("\nR5 抽查：缺的数字是否以中文数字出现")
for i in r5[:12]:
    p = by.get(i["id"])
    if not p: continue
    miss = re.findall(r"[\d\.\uff10-\uff19]+", i["detail"].split("缺数字")[1].split("（")[0]) if "缺数字" in i["detail"] else []
    z = p["zh_surface"] + p["zh_truth"]
    hit = []
    for m in miss[:4]:
        mm = m.strip("0123456789０１２３４５６７８９") or m
        cn = "".join(CN[int(c)] if c.isdigit() else c for c in mm if c.isdigit() or c in "０１２３４５６７８９")
        hit.append("%s→中文数字出现:%s" % (m, any(c in z for c in CN) and any(x in z for x in (m, cn, mm))))
    print("  %s [%s] %s" % (i["id"], i["tag"], "; ".join(hit)))
