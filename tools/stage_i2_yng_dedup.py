# -*- coding: utf-8 -*-
"""
Stage I-2：YesNoGame × 现库 去重分析（修正版，只读，不写库）
修正 Stage I-1 的两处统计缺陷：
  1) 对照池误含已下架的英文垃圾题（tools/en_drop.json 26 条）→ 命中虚高
     （例如 lib_e334c7747e0b / lib_0fa0dac82fb7 被反复命中，其实是垃圾/残片）
  2) 相似度用「不对称包含度」→ 短文本假阳性爆炸（346 对）
改用：对称 Dice 系数 + 归一化长度门槛 + 标题辅助判定。
产出：tools/yng_analysis.json
"""
import io, os, re, json

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)

PUNCT = re.compile(r"[\s\u3000，。、！？；：·…—－\-_,\.\!\?\;:\"'“”‘’（）()\[\]【】《》<>{}|/\\~`@#$%^&*+=「」『』]")
def norm(s): return PUNCT.sub("", (s or "").lower())
def grams(s): return set(s[k:k+2] for k in range(len(s) - 1)) if len(s) >= 2 else (set([s]) if s else set())
def dice(a, b):
    if not a or not b: return 0.0
    return 2.0 * len(a & b) / (len(a) + len(b))

# ---------- 载入 ----------
dump = json.load(io.open(T("tools", "yng_dump.json"), encoding="utf-8"))
items = dump["items"] if isinstance(dump, dict) else dump
en = json.load(io.open(T("tools", "en_dump.json"), encoding="utf-8"))
drop = set(json.load(io.open(T("tools", "en_drop.json"), encoding="utf-8"))["drop"])
# 真正已入库的英译中题（排除已下架垃圾 + 那条本就是中文的误判题）
POOL = [e for e in en if e["id"] not in drop and e["id"] != "lib_cc9e2fec9557"]
print("YesNoGame:", len(items), "| 对照池(已入库英译中):", len(POOL), "| 已排除下架垃圾:", len(drop))

MINLEN = 40                      # 归一化长度门槛：低于此长度不参与判定，避免短文本噪声
DUP_HARD, DUP_SOFT = 0.80, 0.55  # Dice 阈值

# ---------- 1) 与已入库英译中比对 ----------
pg = [(e["id"], (e.get("title") or "").strip(), grams(norm(e.get("surface", "")))) for e in POOL]
hard, soft, fresh = [], [], []
for x in items:
    ns = norm(x["surface"]); g = grams(ns)
    if len(ns) < MINLEN:
        fresh.append({"id": x["id"], "title": x["title"], "note": "过短未判", "dice": None})
        continue
    best, bj = 0.0, None
    for eid, et, eg in pg:
        if not eg: continue
        d = dice(g, eg)
        if d > best: best, bj = d, (eid, et)
    rec = {"id": x["id"], "title": x["title"], "dice": round(best, 3), "with_id": bj[0], "with_title": bj[1]}
    (hard if best >= DUP_HARD else soft if best >= DUP_SOFT else fresh).append(rec)

# ---------- 2) 采集内部去重（同样用 Dice + 门槛）----------
inner = []
valid = [(x, norm(x["surface"])) for x in items if len(norm(x["surface"])) >= MINLEN]
for i in range(len(valid)):
    for j in range(i + 1, len(valid)):
        d = dice(grams(valid[i][1]), grams(valid[j][1]))
        if d >= DUP_HARD:
            inner.append({"dice": round(d, 3), "a": valid[i][0]["id"], "a_title": valid[i][0]["title"],
                          "b": valid[j][0]["id"], "b_title": valid[j][0]["title"]})

# 内部重复簇 → 只保留汤底最长的一条
inner_drop = set()
by_id = {x["id"]: x for x in items}
for pair in sorted(inner, key=lambda p: -p["dice"]):
    a, b = pair["a"], pair["b"]
    if a in inner_drop or b in inner_drop: continue
    loser = a if len(by_id[a]["truth"]) < len(by_id[b]["truth"]) else b
    inner_drop.add(loser)

summary = {
    "collected": len(items),
    "inner_dup_pairs": len(inner),
    "inner_dup_drop": len(inner_drop),
    "dup_vs_ingested_hard": len(hard),
    "dup_vs_ingested_soft": len(soft),
    "fresh_candidates": len(fresh) - len(inner_drop),
}
io.open(T("tools", "yng_analysis.json"), "w", encoding="utf-8").write(json.dumps(
    {"summary": summary, "hard_dup": hard, "soft_dup": soft,
     "inner_pairs": inner, "inner_drop_ids": sorted(inner_drop), "fresh": fresh},
    ensure_ascii=False, indent=1))

print(json.dumps(summary, ensure_ascii=False))
print("\n--- 与已入库重复（Dice>=0.80，确定剔除）---")
for h in sorted(hard, key=lambda x: -x["dice"])[:30]:
    print("   %.3f  YNG#%-4s %-30s <- %s %s" % (h["dice"], h["id"], h["title"][:30], h["with_id"], h["with_title"][:24]))
print("\n--- 疑似重复（0.55~0.80，需人工/题目判断）---")
for h in sorted(soft, key=lambda x: -x["dice"])[:20]:
    print("   %.3f  YNG#%-4s %-30s <- %s %s" % (h["dice"], h["id"], h["title"][:30], h["with_id"], h["with_title"][:24]))
print("\n--- 采集内部重复簇（Dice>=0.80）---")
for p in sorted(inner, key=lambda x: -x["dice"])[:15]:
    print("   %.3f  #%-4s %-28s = #%-4s %s" % (p["dice"], p["a"], p["a_title"][:28], p["b"], p["b_title"][:28]))
