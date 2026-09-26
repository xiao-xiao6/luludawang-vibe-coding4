# -*- coding: utf-8 -*-
import io, os, json, sys, re
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
pairs = {p["id"]: p for p in json.load(io.open(T("tools", "checkup_pairs.json"), encoding="utf-8"))}
rows = {r["id"]: r for r in json.load(io.open(T("tools", "checkup_all.json"), encoding="utf-8"))}

p = pairs["lib_f30b578b106e"]; z = rows["lib_f30b578b106e"]["truth"]
k = 1217
print("译文上下文:\n…" + z[k-160:k+160].replace("\n", "⏎") + "…\n")
o = p["o_truth"]
# 用关键词定位原文对应段
for kw in ("脱獄", "売る", "約束", "正義"):
    for m in re.finditer(kw, o):
        seg = o[max(0,m.start()-90):m.start()+90].replace("\n","⏎")
        print("[%s] …%s…\n" % (kw, seg))
        break
