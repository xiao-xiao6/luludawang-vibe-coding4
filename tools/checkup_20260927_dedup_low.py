# -*- coding: utf-8 -*-
"""低阈值近似重复复核：THRESH=0.50，打印双方汤面+汤底供人工判断"""
import io, os, re, json, sys
from collections import defaultdict
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
rows = json.load(io.open(T("tools", "checkup_all.json"), encoding="utf-8"))
PUNCT = re.compile(r"[\s\u3000，。、！？；：·…—－\-_,\.\!\?\;:\"'“”‘’（）()\[\]【】《》<>{}|/\\~`@#$%^&*+=「」『』※★☆●○■□◇♡]+")
def norm(s): return PUNCT.sub("", (s or "").lower())
def bg(s):
    s = norm(s)
    return set(s[i:i+2] for i in range(len(s)-1)) if len(s) > 1 else ({s} if s else set())
bs = [bg(r["surface"]) for r in rows]
bt = [bg(r["truth"]) for r in rows]
inv = defaultdict(list)
for i, s in enumerate(bs):
    for t in s: inv[t].append(i)
TH, MIN = 0.50, 10
seen = set(); pairs = []
for i, s in enumerate(bs):
    if len(norm(rows[i]["surface"])) < MIN: continue
    cnt = defaultdict(int)
    for t in s:
        for j in inv[t]:
            if j > i: cnt[j] += 1
    for j, c in cnt.items():
        if (i, j) in seen: continue
        if len(norm(rows[j]["surface"])) < MIN: continue
        u = len(s | bs[j])
        if not u: continue
        js = len(s & bs[j]) / u
        if js < TH * 0.7: continue
        jt = (len(bt[i] & bt[j]) / len(bt[i] | bt[j])) if (bt[i] and bt[j]) else 0
        sc = max(js, jt)
        if sc >= TH:
            seen.add((i, j)); pairs.append((sc, js, jt, i, j))
pairs.sort(key=lambda x: -x[0])
print("候选对:", len(pairs))
for sc, js, jt, i, j in pairs:
    a, b = rows[i], rows[j]
    print("\n===%.2f 面%.2f 底%.2f" % (sc, js, jt))
    print(" A[%s|%s|%s] %s" % (a["id"], a["src"][:20], "/".join(a["cats"][:3]), a["title"]))
    print("   面:", a["surface"][:150].replace("\n", " "))
    print("   底:", a["truth"][:150].replace("\n", " "))
    print(" B[%s|%s|%s] %s" % (b["id"], b["src"][:20], "/".join(b["cats"][:3]), b["title"]))
    print("   面:", b["surface"][:150].replace("\n", " "))
    print("   底:", b["truth"][:150].replace("\n", " "))
json.dump([{"score": sc, "sj": js, "tj": jt, "a": rows[i]["id"], "b": rows[j]["id"]} for sc, js, jt, i, j in pairs],
          io.open(T("tools", "checkup_dedup_low.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
