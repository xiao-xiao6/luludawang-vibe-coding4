# -*- coding: utf-8 -*-
"""
Stage I-4：YesNoGame × 已入库 去重（语义版）
理由：同题不同译本「汤面」措辞差异大，但「汤底」说的是同一件事。
      故对每条 YNG 题同时算 surface-Dice 与 truth-Dice，取综合判定。
产出：tools/yng_final.json（fresh / dup / review 三分类）
"""
import io, os, re, json, sys
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)

PUNCT = re.compile(r"[\s\u3000，。、！？；：·…—－\-_,\.\!\?\;:\"'“”‘’（）()\[\]【】《》<>{}|/\\~`@#$%^&*+=「」『』]")
def norm(s): return PUNCT.sub("", (s or "").lower())
def grams(s): return set(s[k:k+2] for k in range(len(s)-1)) if len(s) >= 2 else (set([s]) if s else set())
def dice(a, b):
    if not a or not b: return 0.0
    return 2.0 * len(a & b) / (len(a) + len(b))

items = json.load(io.open(T("tools", "yng_dump.json"), encoding="utf-8"))["items"]
en = json.load(io.open(T("tools", "en_dump.json"), encoding="utf-8"))
drop = set(json.load(io.open(T("tools", "en_drop.json"), encoding="utf-8"))["drop"])
POOL = [e for e in en if e["id"] not in drop and e["id"] != "lib_cc9e2fec9557"]

# 对照池索引
PG = []
for e in POOL:
    PG.append({"id": e["id"], "title": (e.get("title") or "").strip(),
               "s": grams(norm(e.get("surface", ""))), "t": grams(norm(e.get("truth", ""))),
               "tsl": len(norm(e.get("truth", "")))})

S_HARD, T_HARD = 0.62, 0.45     # 汤面/汤底 硬重复阈值
S_SOFT, T_SOFT = 0.45, 0.30     # 疑似区间

fresh, dup, review = [], [], []
for x in items:
    ns, nt = norm(x["surface"]), norm(x["truth"])
    gs, gt = grams(ns), grams(nt)
    best_s, best_t, bid, btitle = 0.0, 0.0, None, None
    for p in PG:
        ds = dice(gs, p["s"]); dt = dice(gt, p["t"])
        score = max(ds, dt)
        if score > max(best_s, best_t):
            best_s, best_t, bid, btitle = ds, dt, p["id"], p["title"]
    rec = {"id": x["id"], "title": x["title"], "s": round(best_s, 3), "t": round(best_t, 3),
           "with_id": bid, "with_title": btitle,
           "surface": x["surface"], "truth": x["truth"]}
    if best_s >= S_HARD or best_t >= T_HARD:
        dup.append(rec)
    elif best_s >= S_SOFT or best_t >= T_SOFT:
        review.append(rec)
    else:
        fresh.append(rec)

json.dump({"fresh": fresh, "dup": dup, "review": review,
           "counts": {"fresh": len(fresh), "dup": len(dup), "review": len(review)}},
          io.open(T("tools", "yng_final.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

print("总 %d | 确定重复 %d | 待复核 %d | 净新增 %d" % (len(items), len(dup), len(review), len(fresh)))
print("\n--- 确定重复（汤面或汤底高度一致）---")
for r in sorted(dup, key=lambda x: -max(x["s"], x["t"])):
    print("  S%.2f T%.2f  #%-4s %-30s <- %s %s" % (r["s"], r["t"], r["id"], r["title"][:30], r["with_id"], (r["with_title"] or "")[:22]))
print("\n--- 待复核（抽样 25）---")
for r in sorted(review, key=lambda x: -max(x["s"], x["t"]))[:25]:
    print("  S%.2f T%.2f  #%-4s %-30s <- %s %s" % (r["s"], r["t"], r["id"], r["title"][:30], r["with_id"], (r["with_title"] or "")[:22]))
