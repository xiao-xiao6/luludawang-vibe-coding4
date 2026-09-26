# -*- coding: utf-8 -*-
import io, os, json, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
WS = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace"
rows = [json.loads(l) for l in io.open(os.path.join(WS, "海龟汤汤面大全", "海龟汤汤面大全.jsonl"), encoding="utf-8") if l.strip()]
for r in rows:
    t = str(r.get("title") or "")
    if "日记" in t or "侏儒" in t:
        print("@@@", t[:60])
        print("  面:", (r.get("surface") or "")[:400].replace("\n", "⏎"))
        print("  底:", (r.get("bottom") or "")[:200].replace("\n", "⏎"))
        print()
