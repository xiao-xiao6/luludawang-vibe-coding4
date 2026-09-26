# -*- coding: utf-8 -*-
import io, os, json, sys, re
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
src = io.open(T("data", "library", "library.data.js"), encoding="utf-8").read()
i = src.find("var SOUP_LIBRARY"); i = src.find("[", i)
d = 0
for k in range(i, len(src)):
    if src[k] == "[": d += 1
    elif src[k] == "]":
        d -= 1
        if d == 0:
            data = json.loads(src[i:k+1]); break
byid = {e["id"]: e for e in data}
for no in ("15615", "10912", "7399"):
    e = next((x for x in data if str(x.get("srcNo")) == no), None)
    print("###", no, e["title"])
    print("面:", e["surface"][:180].replace("\n", "⏎"))
    print("底(前200):", e["truth"][:200].replace("\n", "⏎"))
    print()
# 全库坏词扫描
bad = re.compile("龟男男|龟女女|龟男女|海男男|海女女|海男女|龟龟")
n = [e["id"] for e in data if bad.search((e.get("surface") or "") + (e.get("truth") or "") + (e.get("title") or ""))]
print("坏词残留:", len(n), n[:5])
