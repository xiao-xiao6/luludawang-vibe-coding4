# -*- coding: utf-8 -*-
import io, os, json, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
rows = {r["id"]: r for r in json.load(io.open(T("tools", "checkup_all.json"), encoding="utf-8"))}
ids = ["lib_2299ca62945f","lib_40985bc7685d","lib_56bc27c7e7be","lib_697d6e67511a","lib_8e3ab9e40712",
       "lib_a8729117a936","lib_aea0dcf7d165","lib_ba0a80d94a62","lib_d78b09244b6c","lib_ea01667538b7"]
for i in ids:
    r = rows[i]
    print("=" * 24, i, r["title"])
    print("[面]", r["surface"])
    print("[底]", r["truth"])
    print()
