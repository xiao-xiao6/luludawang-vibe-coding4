# -*- coding: utf-8 -*-
"""
2026-09-27 全量体检 · 第 1 步：去重扫描
① 精确重复：归一化汤面 / 归一化汤底 完全相同
② 近似重复：字符 bigram Jaccard（汤面、汤底分别算，取较高者）
③ 跨层重复：精品 100 与汤库 1521 之间
产出 tools/checkup_dedup.json + 控制台摘要
"""
import io, os, re, json, sys, itertools
from collections import defaultdict
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
rows = json.load(io.open(T("tools", "checkup_all.json"), encoding="utf-8"))

PUNCT = re.compile(r"[\s\u3000，。、！？；：·…—－\-_,\.\!\?\;:\"'“”‘’（）()\[\]【】《》<>{}|/\\~`@#$%^&*+=「」『』※★☆●○■□◇♡]+")
def norm(s): return PUNCT.sub("", (s or "").lower())
def bigrams(s):
    s = norm(s)
    return set(s[i:i+2] for i in range(len(s)-1)) if len(s) > 1 else {s} if s else set()

# ---------- ① 精确重复 ----------
exact_s = defaultdict(list); exact_t = defaultdict(list)
for idx, r in enumerate(rows):
    ns = norm(r["surface"]); nt = norm(r["truth"])
    if ns: exact_s[ns].append(idx)
    if nt: exact_t[nt].append(idx)
dup_surface = {k: v for k, v in exact_s.items() if len(v) > 1}
dup_truth   = {k: v for k, v in exact_t.items() if len(v) > 1}
print("精确重复汤面组:", len(dup_surface), " 涉及条目:", sum(len(v) for v in dup_surface.values()))
print("精确重复汤底组:", len(dup_truth), " 涉及条目:", sum(len(v) for v in dup_truth.values()))

# ---------- ② 近似重复（倒排剪枝） ----------
N = len(rows)
bs = [bigrams(r["surface"]) for r in rows]
bt = [bigrams(r["truth"]) for r in rows]
THRESH = 0.72
MINLEN = 12  # 太短的汤面不参与近似匹配（避免「啊」类误报）

inv = defaultdict(list)
for i, s in enumerate(bs):
    for tok in s: inv[tok].append(i)

cand = set()
for i, s in enumerate(bs):
    if len(norm(rows[i]["surface"])) < MINLEN: continue
    cnt = defaultdict(int)
    for tok in s:
        for j in inv[tok]:
            if j > i: cnt[j] += 1
    for j, c in cnt.items():
        if len(norm(rows[j]["surface"])) < MINLEN: continue
        u = len(s | bs[j])
        if u and c / u >= THRESH * 0.8:  # 粗筛放宽
            cand.add((i, j))

def jac(a, b):
    if not a or not b: return 0.0
    return len(a & b) / len(a | b)

pairs = []
for i, j in cand:
    js = jac(bs[i], bs[j]); jt = jac(bt[i], bt[j])
    score = max(js, jt)
    if score >= THRESH:
        pairs.append({"i": i, "j": j, "surfaceJ": round(js, 3), "truthJ": round(jt, 3),
                      "score": round(score, 3),
                      "a": {"id": rows[i]["id"], "layer": rows[i]["layer"], "src": rows[i]["src"],
                            "title": rows[i]["title"], "cats": rows[i]["cats"],
                            "surface": rows[i]["surface"][:120]},
                      "b": {"id": rows[j]["id"], "layer": rows[j]["layer"], "src": rows[j]["src"],
                            "title": rows[j]["title"], "cats": rows[j]["cats"],
                            "surface": rows[j]["surface"][:120]}})
pairs.sort(key=lambda p: -p["score"])
print("近似重复对(阈值%.2f):" % THRESH, len(pairs))

# ---------- ③ 连通分量聚成簇 ----------
parent = list(range(N))
def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]; x = parent[x]
    return x
def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb: parent[ra] = rb

edges = []
for v in dup_surface.values():
    for a, b in zip(v, v[1:]): union(a, b); edges.append(("exact_surface", a, b))
for v in dup_truth.values():
    for a, b in zip(v, v[1:]): union(a, b); edges.append(("exact_truth", a, b))
for p in pairs:
    union(p["i"], p["j"]); edges.append(("near", p["i"], p["j"]))

clusters = defaultdict(list)
for idx in range(N):
    clusters[find(idx)].append(idx)
multi = sorted([v for v in clusters.values() if len(v) > 1], key=lambda v: -len(v))
print("重复簇数量:", len(multi), " 簇内总条目:", sum(len(v) for v in multi),
      " 理论可删:", sum(len(v) - 1 for v in multi))

out = {
    "exact_surface_groups": [[rows[i]["id"] for i in v] for v in dup_surface.values()],
    "exact_truth_groups": [[rows[i]["id"] for i in v] for v in dup_truth.values()],
    "near_pairs": pairs,
    "clusters": [[{"id": rows[i]["id"], "layer": rows[i]["layer"], "src": rows[i]["src"],
                   "cats": rows[i]["cats"], "title": rows[i]["title"],
                   "surface": rows[i]["surface"], "truth": rows[i]["truth"],
                   "_t": rows[i]["_t"]} for i in v] for v in multi],
}
io.open(T("tools", "checkup_dedup.json"), "w", encoding="utf-8").write(
    json.dumps(out, ensure_ascii=False, indent=1))
print("已写 tools/checkup_dedup.json")

# 摘要：最大的几个簇
for v in multi[:6]:
    print("\n--- 簇 %d 条 ---" % len(v))
    for i in v[:4]:
        r = rows[i]
        print("   [%s|%s|%s] %s | %s" % (r["layer"], r["src"][:22], "/".join(r["cats"][:3]),
                                       r["title"][:16], norm(r["surface"])[:40]))
