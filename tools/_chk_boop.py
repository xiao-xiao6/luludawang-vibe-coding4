# -*- coding: utf-8 -*-
import io, os, json, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
WS = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace"
bp = os.path.join(WS, "extracted4", "boop-yyt__situation_puzzle__master", "situation_puzzle-master", "situation-data")
for f in ("lateral_data.json", "merge_data.json", "puzzles.json"):
    p = os.path.join(bp, f)
    try:
        j = json.load(io.open(p, encoding="utf-8"))
        print("==", f, type(j).__name__, len(j))
        x = j[0] if isinstance(j, list) else list(j.items())[0]
        print(json.dumps(x, ensure_ascii=False)[:400])
    except Exception as e:
        print("==", f, "ERR", e)
