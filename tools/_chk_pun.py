# -*- coding: utf-8 -*-
import io, os, json, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
rows = {r["id"]: r for r in json.load(io.open(T("tools", "checkup_all.json"), encoding="utf-8"))}
pairs = {p["id"]: p for p in json.load(io.open(T("tools", "checkup_pairs.json"), encoding="utf-8"))}
for i in ("lib_625339855804", "lib_90019f9e0732"):
    r = rows[i]
    print("=" * 20, i, r["title"], "srcNo:", r["srcNo"])
    print("[译面]", r["surface"])
    print("[译底]", r["truth"])
    p = pairs.get(i)
    if p:
        print("---[原文面]", p["o_surface"])
        print("---[原文底]", p["o_truth"])
    print()
