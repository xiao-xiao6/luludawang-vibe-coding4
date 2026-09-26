# -*- coding: utf-8 -*-
import io, json, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
rows = {r["id"]: r for r in json.load(io.open(ROOT + r"\tools\checkup_all.json", encoding="utf-8"))}
for i in ("lib_6f860967a6c4", "lib_0695135164a2", "lib_1294ed2c0162", "lib_13f7db377f7b", "lib_9303cd77d99f"):
    r = rows[i]
    print("="*20, i, "src:", r["src"], "cats:", r["cats"])
    print("title:", r["title"][:120])
    print("dispTitle:", r["dispTitle"][:120])
    print("surface(%d):" % len(r["surface"]), r["surface"][:400].replace("\n", "⏎"))
    print("truth(%d):" % len(r["truth"]), r["truth"][:600].replace("\n", "⏎"))
    print()
