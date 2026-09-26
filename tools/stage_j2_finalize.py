# -*- coding: utf-8 -*-
"""
Stage J2（2026-09-26）：YesNoGame 并入后的收尾
1) 修复历史遗留的非法 _t 字段（依据 cats 推断回 t2s / e2s / 删除）
2) 全库跨语言去重：中文归一化 + Stage D2 校准阈值，**只删本轮新增的 e2s**，老题一律不动
3) 报告新增条目剩余的标题撞名（交下一步改名）
写盘前自动备份。
产出：data/library/library.data.js + tools/stage_j2_log.json
"""
import io, re, json, math, shutil, os, sys, collections
from collections import Counter, defaultdict
from zhconv import convert as zc
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
MASTER = T("data", "library", "library.data.js")
shutil.copyfile(MASTER, T("_local_backup", "library.data.js.bak-stagej2"))

src = io.open(MASTER, encoding="utf-8").read()
head = src[:src.find("var SOUP_LIBRARY")]
i = src.find("var SOUP_LIBRARY"); i = src.find("[", i)
end = src.find("\nvar SOUP_LIB_CATS", i)
tail = src[end:]
data = json.loads(src[i:end].rsplit("]", 1)[0] + "]")
N = len(data)
log = {"before": N}

# ---------- 1) 修 _t 字段 ----------
fixed = []
for e in data:
    t = e.get("_t")
    if t in (None, "t2s", "e2s"):
        continue
    cats = e.get("cats", [])
    if "繁译简" in cats:
        e["_t"] = "t2s"
    elif "英译中" in cats:
        e["_t"] = "e2s"
    else:
        e.pop("_t", None)
    fixed.append({"id": e["id"], "was": str(t)[:40], "now": e.get("_t")})
log["_t_fixed"] = fixed
print("① _t 字段修复: %d 条" % len(fixed))
for f in fixed:
    print("   %s  %r -> %r" % (f["id"], f["was"], f["now"]))

# ---------- 2) 全库去重（只删 e2s） ----------
PUNCT = re.compile(r"[\s\u3000，。、！？；：·…—－\-_,\.\!\?\;:\"'“”‘’（）()\[\]【】《》<>{}|/\\~`@#$%^&*+=「」『』]")
def norm(s): return PUNCT.sub("", zc(s or "", "zh-hans"))
def bg(s): return set(s[k:k+2] for k in range(len(s)-1)) if len(s) >= 2 else (set([s]) if s else set())
def is_en(s):
    lat = sum(1 for ch in s if ch.isascii() and ch.isalpha())
    cjk = sum(1 for ch in s if "\u4e00" <= ch <= "\u9fff")
    return lat > 0 and lat >= cjk * 2

nsurf = [norm(e.get("surface", "")) for e in data]
nbot = [norm(e.get("truth", "")) for e in data]
comb = [a + "#" + b for a, b in zip(nsurf, nbot)]
en = [is_en(e.get("surface", "") + " " + e.get("truth", "")) for e in data]
new = [e.get("_t") == "e2s" for e in data]

tv = [Counter(bg(t)) for t in comb]
df = Counter()
for g in tv:
    for x in g: df[x] += 1
idf = {g: math.log(N / (1 + v)) for g, v in df.items()}
nrm = [math.sqrt(sum((v * idf.get(g, 0)) ** 2 for g, v in c.items())) for c in tv]
def cos(a, b):
    ca, cb = tv[a], tv[b]
    if len(ca) > len(cb): ca, cb = cb, ca
    s = sum(v * cb.get(g, 0) * (idf.get(g, 0) ** 2) for g, v in ca.items())
    return s / (nrm[a] * nrm[b]) if nrm[a] and nrm[b] else 0.0

rare = [set(x for x in bg(comb[k]) if df[x] <= 8 and re.fullmatch(r"[\u4e00-\u9fff]{2}", x)) for k in range(N)]
cand = set()
inv = defaultdict(list)
for k, r in enumerate(rare):
    for x in r: inv[x].append(k)
for x, lst in inv.items():
    if len(lst) > 60: continue
    for a in range(len(lst)):
        for b in range(a + 1, len(lst)): cand.add((lst[a], lst[b]))
inv2 = defaultdict(list)
for k, c in enumerate(tv):
    for g in c:
        if df[g] <= 60: inv2[g].append(k)
for g, lst in inv2.items():
    if len(lst) > 60: continue
    for a in range(len(lst)):
        for b in range(a + 1, len(lst)): cand.add((lst[a], lst[b]))
pairshare = Counter()
for x, lst in inv.items():
    if len(lst) > 60: continue
    for a in range(len(lst)):
        for b in range(a + 1, len(lst)): pairshare[(lst[a], lst[b])] += 1

def clean_title(e):
    t = (e.get("title") or "").strip()
    t = re.sub(r"^\d+\s*[·.、]\s*", "", t)
    return norm(t)

edges = set()
for key, arr, ml in (("S", nsurf, 8), ("T", nbot, 15)):
    g = defaultdict(list)
    for k, s in enumerate(arr):
        if len(s) >= ml: g[s].append(k)
    for s, lst in g.items():
        for a in range(len(lst)):
            for b in range(a + 1, len(lst)): edges.add((lst[a], lst[b]))
for (a, b) in cand:
    if a == b: continue
    c = cos(a, b); r = pairshare.get((a, b), 0)
    hit = False
    if en[a] or en[b]: hit = c >= 0.85
    else: hit = c >= 0.72 or (c >= 0.30 and r >= 5)
    if not hit and clean_title(data[a]) and clean_title(data[a]) == clean_title(data[b]) and not (en[a] or en[b]) and (c >= 0.45 or r >= 5):
        hit = True
    if hit: edges.add((min(a, b), max(a, b)))

parent = list(range(N))
def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]; x = parent[x]
    return x
for a, b in edges:
    ra, rb = find(a), find(b)
    if ra != rb: parent[rb] = ra
groups = defaultdict(list)
for k in range(N): groups[find(k)].append(k)

drop = set()
removed = []
for r, c in groups.items():
    if len(c) < 2: continue
    olds = [k for k in c if not new[k]]
    news = [k for k in c if new[k]]
    if olds:
        for k in news:
            drop.add(k)
            removed.append({"id": data[k]["id"], "title": data[k].get("title"),
                            "surface": data[k]["surface"][:40],
                            "dup_with": [data[x]["id"] for x in olds[:3]]})
    else:
        best = max(c, key=lambda k: (len(nbot[k]), len(nsurf[k])))
        for k in c:
            if k != best:
                drop.add(k)
                removed.append({"id": data[k]["id"], "title": data[k].get("title"),
                                "surface": data[k]["surface"][:40],
                                "dup_with": [data[best]["id"]]})
log["dropped_e2s"] = removed
print("\n② 全库去重（只删 e2s）: 命中 %d 条" % len(removed))
for r in removed:
    print("   %s《%s》 <- 与 %s 重复" % (r["id"], r["title"], r["dup_with"]))

data2 = [e for k, e in enumerate(data) if k not in drop]
log["after"] = len(data2)

# ---------- 3) 标题撞名报告 ----------
byT = defaultdict(list)
for e in data2: byT[e["title"]].append(e)
collide = []
for e in data2:
    if e.get("_t") == "e2s" and len(byT[e["title"]]) > 1:
        collide.append({"id": e["id"], "title": e["title"],
                        "others": [x["id"] for x in byT[e["title"]] if x["id"] != e["id"]]})
log["e2s_title_collisions"] = collide
print("\n③ 新增条目剩余撞名: %d" % len(collide))
for c in collide: print("   %s《%s》 撞 %s" % (c["id"], c["title"], c["others"]))

body = head + "var SOUP_LIBRARY = " + json.dumps(data2, ensure_ascii=False, separators=(",", ":")) + ";" + tail
io.open(MASTER, "w", encoding="utf-8").write(body)
io.open(T("tools", "stage_j2_log.json"), "w", encoding="utf-8").write(json.dumps(log, ensure_ascii=False, indent=1))
print("\nOK %d -> %d | _t修复 %d | 删重复 %d | e2s剩 %d" % (
    N, len(data2), len(fixed), len(removed), sum(1 for e in data2 if e.get("_t") == "e2s")))
