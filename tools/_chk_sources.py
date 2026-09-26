# -*- coding: utf-8 -*-
import io, json, sys, os
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
rows = json.load(io.open(T("tools", "checkup_all.json"), encoding="utf-8"))
from collections import Counter
for tag in ("英译中", "日译中", "繁译简"):
    srcs = Counter(r["src"] for r in rows if tag in r["cats"])
    print(tag, dict(srcs))
# 原文存档可用性
yng = json.load(io.open(T("tools", "yng_fresh_final.json"), encoding="utf-8"))
print("yng_fresh_final:", len(yng["items"]), "字段:", list(yng["items"][0].keys()))
llt = json.load(io.open(T("tools", "llt_fresh_final.json"), encoding="utf-8"))
print("llt_fresh_final:", len(llt["items"]), "字段:", list(llt["items"][0].keys()))
en = json.load(io.open(T("tools", "en_dump.json"), encoding="utf-8"))
print("en_dump:", type(en), len(en) if hasattr(en, "__len__") else "")
if isinstance(en, list) and en: print("  样例:", json.dumps(en[0], ensure_ascii=False)[:200])
if isinstance(en, dict):
    k = list(en.keys())[:3]; print("  keys:", k)
    v = en[k[0]]; print("  样例:", json.dumps(v, ensure_ascii=False)[:200])
# 繁译简原文：soups.json 是否有繁体字段
soups = json.load(io.open(T("data", "library", "soups.json"), encoding="utf-8"))
print("soups.json:", len(soups), "字段:", list(soups[0].keys()))
t2s_like = [s for s in soups if any(ord(c) > 0x4e00 for c in (s.get("title") or "")) and (s.get("_t") or "")]
print("soups _t 分布:", json.dumps(Counter(s.get("_t") or "(无)" for s in soups), ensure_ascii=False))
# PTT 繁体原始档？
for f in ("truth_recovery.json", "ai_truth.json"):
    j = json.load(io.open(T("data", "library", f), encoding="utf-8"))
    print(f, type(j).__name__, len(j), "样例:", json.dumps(j[0] if isinstance(j, list) else list(j.items())[0], ensure_ascii=False)[:180])
