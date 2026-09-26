# -*- coding: utf-8 -*-
import io, os, json, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
rows = {r["id"]: r for r in json.load(io.open(T("tools", "checkup_all.json"), encoding="utf-8"))}
iss = json.load(io.open(T("tools", "checkup_pollution.json"), encoding="utf-8"))
for i in iss:
    r = rows.get(i[0])
    print("%-24s %s [%s] %s | %s" % (i[4], i[0], i[3], i[5][:44], (r["title"] if r else "")[:16]))
