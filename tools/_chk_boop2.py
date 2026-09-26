# -*- coding: utf-8 -*-
import io, os, json, sys, re
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
WS = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace"
rows = json.load(io.open(os.path.join(ROOT, "tools", "checkup_all.json"), encoding="utf-8"))
bp = os.path.join(WS, "extracted4", "boop-yyt__situation_puzzle__master", "situation_puzzle-master", "situation-data")
pz = json.load(io.open(os.path.join(bp, "puzzles.json"), encoding="utf-8"))
lat = json.load(io.open(os.path.join(bp, "lateral_data.json"), encoding="utf-8"))
print("puzzles.json keys 样例:", list(pz.keys())[:8], "共", len(pz))
tgt = [r for r in rows if r["src"] in ("github:boop-yyt/situation_puzzle",) or "Jed" in r["src"]]
print("boop/Jed 条目:", len(tgt))
for r in tgt[:10]:
    print("  srcNo=%s title=%s" % (r["srcNo"], r["title"]))
# Jed 标题里的编号
jed = [r for r in tgt if "Jed" in r["src"]]
print("Jed 条数:", len(jed), "标题样例:", [j["title"] for j in jed[:6]])
