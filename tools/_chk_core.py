# -*- coding: utf-8 -*-
import io, os, json, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
rows = {r["id"]: r for r in json.load(io.open(T("tools", "checkup_all.json"), encoding="utf-8"))}
for i in ("music", "fog", "elevator", "match", "turtle", "umbrellanight"):
    r = rows.get(i)
    if r:
        print("####", i, r["title"])
        print("面:", r["surface"].replace("\n", "⏎"))
        print("底:", r["truth"].replace("\n", "⏎"))
        print()
# 第七个人没淋湿
for r in rows.values():
    if "没" in r["surface"] and ("淋" in r["surface"] or "湿" in r["surface"]) and "同时到达" in r["surface"]:
        print("###", r["id"], r["title"], "|", r["src"])
        print("面:", r["surface"][:120])
        print("底:", r["truth"][:120])
