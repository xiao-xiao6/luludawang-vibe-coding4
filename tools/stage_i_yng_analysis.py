# -*- coding: utf-8 -*-
"""
Stage I-1：YesNoGame 采集结果 × 现库 去重分析（只读，不写库）
目的：算清 233 道里有多少是「真新增」，多少与已入库的英译中（Jed 系）重复。
依据：tools/en_dump.json 保存着已入库英译中题目的**英文原文**（115 条），
     可直接与 YesNoGame 英文汤面做归一化比对。
产出：tools/yng_analysis.json（分类清单）+ 控制台摘要
"""
import io, re, json, os

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"

PUNCT = re.compile(r"[\s\u3000，。、！？；：·…—－\-_,\.\!\?\;:\"'“”‘’（）()\[\]【】《》<>{}|/\\~`@#$%^&*+=「」『』]")

def norm(s):
    return PUNCT.sub("", (s or "").lower())

def bigrams(s):
    return set(s[k:k+2] for k in range(len(s)-1)) if len(s) >= 2 else (set([s]) if s else set())

dump = json.load(io.open(os.path.join(ROOT, "tools", "yng_dump.json"), encoding="utf-8"))
items = dump["items"] if isinstance(dump, dict) else dump
print("YesNoGame 已采集:", len(items), "| 失败:", len(dump.get("failed", [])) if isinstance(dump, dict) else "n/a")

# 已入库英译中题目的英文原文
en_path = os.path.join(ROOT, "tools", "en_dump.json")
en = json.load(io.open(en_path, encoding="utf-8")) if os.path.exists(en_path) else []
en_norm_surface = {}
for e in en:
    en_norm_surface.setdefault(norm(e.get("surface", "")), e.get("id"))

master_src = io.open(os.path.join(ROOT, "data", "library", "library.data.js"), encoding="utf-8").read()
master = json.loads(master_src[master_src.find("[", master_src.find("var SOUP_LIBRARY")):
                                master_src.find("\nvar SOUP_LIB_CATS")].rsplit("]", 1)[0] + "]")
master_surfaces = [norm(e.get("surface", "")) for e in master]
master_set = set(master_surfaces)
master_grams = [bigrams(s) for s in master_surfaces]

exact_dup, similar_dup, fresh = [], [], []
for it in items:
    ns = norm(it["surface"])
    if not ns:
        continue
    if ns in en_norm_surface:
        exact_dup.append({"id": it["id"], "why": "与已入库英译中题面完全相同", "with": en_norm_surface[ns], "title": it["title"]})
        continue
    if ns in master_set:
        exact_dup.append({"id": it["id"], "why": "与现库题面完全相同", "with": None, "title": it["title"]})
        continue
    g = bigrams(ns)
    best, best_j = 0.0, -1
    for j, mg in enumerate(master_grams):
        if not mg or not g:
            continue
        inter = len(g & mg)
        cont = inter / max(1, min(len(g), len(mg)))
        if cont > best:
            best, best_j = cont, j
    if best >= 0.86:
        similar_dup.append({"id": it["id"], "title": it["title"], "sim": round(best, 3),
                            "with": master[best_j].get("title"), "with_id": master[best_j].get("id")})
    else:
        fresh.append({"id": it["id"], "title": it["title"], "surface": it["surface"], "truth": it["truth"],
                      "sim_max": round(best, 3)})

summary = {"collected": len(items), "exact_dup": len(exact_dup), "similar_dup": len(similar_dup), "fresh": len(fresh)}
io.open(os.path.join(ROOT, "tools", "yng_analysis.json"), "w", encoding="utf-8").write(
    json.dumps({"summary": summary, "exact_dup": exact_dup, "similar_dup": similar_dup, "fresh": fresh},
               ensure_ascii=False, indent=1))

print(json.dumps(summary, ensure_ascii=False))
print("\n--- 完全重复样本 ---")
for x in exact_dup[:6]:
    print("  ", x["id"], x["title"], "|", x["why"])
print("\n--- 疑似重复（相似度）样本 ---")
for x in similar_dup[:8]:
    print("  ", x["id"], x["title"], "~", x["with"], x["sim"])
print("\n--- 真新增样本（前 10）---")
for x in fresh[:10]:
    print("  ", x["id"], "|", x["title"], "|", x["surface"][:60].replace("\n", " "))
