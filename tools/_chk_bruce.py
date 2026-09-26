# -*- coding: utf-8 -*-
import io, os, re, json, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
pairs = json.load(io.open(T("tools", "checkup_pairs.json"), encoding="utf-8"))
for p in pairs:
    if p["tag"] != "英译中": continue
    o = (p["o_surface"] or "") + " " + (p["o_truth"] or "")
    if re.search(r"\bBruce\b", o):
        print("###", p["id"], p["zh_title"])
        print("原面:", (p["o_surface"] or "")[:200].replace("\n", " "))
        print("译面:", (p["zh_surface"] or "")[:200].replace("\n", " "))
        print("原底:", (p["o_truth"] or "")[:260].replace("\n", " "))
        print("译底:", (p["zh_truth"] or "")[:260].replace("\n", " "))
        print()
# 繁译简未对齐的 45 条：查原因
rows = json.load(io.open(T("tools", "checkup_all.json"), encoding="utf-8"))
al = {p["id"] for p in pairs}
PUNCT = re.compile(r"[\s\u3000，。、！？；：·…—－\-_,\.\!\?\;:\"'“”‘’（）()\[\]【】《》<>{}|/\\~`@#$%^&*+=「」『』※★☆●○■□◇♡]+")
def norm(s): return PUNCT.sub("", (s or "").lower())
from zhconv import convert as zc
trad = {}
for fn in (r"D:\Downloads\train_8k.json", r"D:\Downloads\test_1.5k.json"):
    for e in json.load(io.open(fn, encoding="utf-8")):
        trad[norm(zc(e.get("surface") or "", "zh-hans"))] = e
miss = [r for r in rows if "繁译简" in r["cats"] and r["id"] not in al]
print("繁译简未对齐:", len(miss))
for r in miss[:12]:
    k = norm(r["surface"])
    print("  %s | %s | 面:%s" % (r["id"], r["title"][:14], r["surface"][:44].replace("\n", " ")))
    print("     归一化后在原文索引中:", k in trad, "| 长度:", len(k))
