# -*- coding: utf-8 -*-
"""
Stage I-6：YesNoGame × 已入库英译中 去重（词级匹配 + 分档校准）
为什么重做：Stage I-4 用「字符二元组 Dice」判重，短文本/常见词把相似度抬得很高，
            产生大量假阳性（例：#357 The cave ↔ 风停了，实为两题）。
本版：英文按「词」比对（去停用词），并输出分档样本供人工校准阈值。
产出：tools/yng_wordmatch_report.txt
"""
import io, os, re, json, sys
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)

STOP = set("""a an the and or but if then than that this these those of in on at to for from with without
by as is was were are be been being he she it they them his her its their him her i you we me my your our
not no do does did done have has had will would can could should may might must there here when where why how
what who whom which while during after before over under again once all any both each few more most other
some such only own same so too very s t just don now out up down off about into through because""".split())

def toks(s):
    return set(w for w in re.findall(r"[a-z0-9']+", (s or "").lower()) if w not in STOP and len(w) > 1)

def dice(a, b):
    if not a or not b: return 0.0
    return 2.0 * len(a & b) / (len(a) + len(b))

items = json.load(io.open(T("tools", "yng_dump.json"), encoding="utf-8"))["items"]
en = json.load(io.open(T("tools", "en_dump.json"), encoding="utf-8"))
drop = set(json.load(io.open(T("tools", "en_drop.json"), encoding="utf-8"))["drop"])
POOL = [e for e in en if e["id"] not in drop and e["id"] != "lib_cc9e2fec9557"]
PG = [{"id": e["id"], "title": (e.get("title") or "").strip(),
       "s": toks(e.get("surface", "")), "t": toks(e.get("truth", "")),
       "st": toks(e.get("surface", "") + " " + e.get("truth", ""))} for e in POOL]

recs = []
for x in items:
    gt_s, gt_t = toks(x["surface"]), toks(x["truth"])
    gt_all = gt_s | gt_t
    best = {"s": 0.0, "t": 0.0, "a": 0.0, "with_id": None, "with_title": None}
    for p in PG:
        ds, dt, da = dice(gt_s, p["s"]), dice(gt_t, p["t"]), dice(gt_all, p["st"])
        score = max(da, dt)                       # 综合：整题 vs 汤底
        if score > max(best["a"], best["t"]):
            best = {"s": round(ds, 3), "t": round(dt, 3), "a": round(da, 3),
                    "with_id": p["id"], "with_title": p["title"]}
    recs.append({"id": x["id"], "title": x["title"], "surface": x["surface"], "truth": x["truth"], **best})

def band(r):
    m = max(r["t"], r["a"])
    if m >= 0.70: return "A_高置信"
    if m >= 0.55: return "B_较可信"
    if m >= 0.40: return "C_待判"
    return "D_净新增"

for r in recs: r["band"] = band(r)
cnt = {}
for r in recs: cnt[r["band"]] = cnt.get(r["band"], 0) + 1

out = []
P = lambda s="": out.append(s)
P("词级匹配分档：%s" % json.dumps(cnt, ensure_ascii=False))
P("（对照池＝已入库英译中 %d 条英文原文）" % len(POOL))

for b in ["A_高置信", "B_较可信", "C_待判"]:
    grp = sorted([r for r in recs if r["band"] == b], key=lambda x: -max(x["t"], x["a"]))
    P("")
    P("=" * 78)
    P("%s（%d 条）" % (b, len(grp)))
    P("=" * 78)
    for r in grp[:14]:
        P("-" * 78)
        P("YNG#%-4s 《%s》  T=%.2f A=%.2f S=%.2f  ←→ %s《%s》"
          % (r["id"], r["title"][:34], r["t"], r["a"], r["s"], r["with_id"] or "-", (r["with_title"] or "")[:22]))
        P("  YNG面: %s" % r["surface"][:170].replace("\n", " "))
        P("  YNG底: %s" % r["truth"][:170].replace("\n", " "))

D = [r for r in recs if r["band"] == "D_净新增"]
P("")
P("=" * 78)
P("D_净新增（%d 条）前 20 条" % len(D))
P("=" * 78)
for r in D[:20]:
    P("YNG#%-4s 《%s》 T=%.2f" % (r["id"], r["title"][:34], r["t"]))
    P("   面: %s" % r["surface"][:150].replace("\n", " "))
    P("   底: %s" % r["truth"][:150].replace("\n", " "))

io.open(T("tools", "yng_wordmatch_report.txt"), "w", encoding="utf-8").write("\n".join(out))
json.dump(recs, io.open(T("tools", "yng_wordmatch.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("\n".join(out[:80]))
print("\n[完整报告 tools/yng_wordmatch_report.txt]")
