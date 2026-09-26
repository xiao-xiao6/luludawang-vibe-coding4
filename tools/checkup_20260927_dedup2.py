# -*- coding: utf-8 -*-
"""双向候选去重：候选对来自 汤面相似 ∪ 汤底相似，再统一打分复核"""
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
def jac(a, b):
    if not a or not b: return 0.0
    return len(a & b) / len(a | b)

def candidates(vecs, TH_SEED):
    inv = defaultdict(list)
    for i, s in enumerate(vecs):
        for t in s: inv[t].append(i)
    out = set()
    for i, s in enumerate(vecs):
        cnt = defaultdict(int)
        for t in s:
            for j in inv[t]:
                if j != i: cnt[j] += 1
        for j, c in cnt.items():
            u = len(s | vecs[j])
            if u and c / u >= TH_SEED:
                out.add((min(i, j), max(i, j)))
    return out

cand = candidates(bs, 0.35) | candidates(bt, 0.35)
print("候选对(种子):", len(cand))
pairs = []
for i, j in cand:
    js = jac(bs[i], bs[j]); jt = jac(bt[i], bt[j])
    if max(js, jt) >= 0.45:
        pairs.append((round(max(js, jt), 3), round(js, 3), round(jt, 3), i, j))
pairs.sort(key=lambda x: -x[0])
print("≥0.45 对:", len(pairs))
lines = []
for sc, js, jt, i, j in pairs:
    a, b = rows[i], rows[j]
    lines.append("=== %.2f 面%.2f 底%.2f\n A[%s|%s|%s] %s\n  面:%s\n  底:%s\n B[%s|%s|%s] %s\n  面:%s\n  底:%s" % (
        sc, js, jt, a["id"], a["src"][:20], "/".join(a["cats"][:3]), a["title"],
        a["surface"][:130].replace("\n", " "), a["truth"][:130].replace("\n", " "),
        b["id"], b["src"][:20], "/".join(b["cats"][:3]), b["title"],
        b["surface"][:130].replace("\n", " "), b["truth"][:130].replace("\n", " ")))
io.open(T("tools", "checkup_dedup_pairs.txt"), "w", encoding="utf-8").write("\n\n".join(lines))
json.dump([{"score": s, "sj": js, "tj": jt, "a": rows[i]["id"], "b": rows[j]["id"]} for s, js, jt, i, j in pairs],
          io.open(T("tools", "checkup_dedup_pairs.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("已写 tools/checkup_dedup_pairs.txt")
