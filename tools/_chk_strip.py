# -*- coding: utf-8 -*-
import io, os, json, sys
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
e = byid.get("lib_c523f2698204")
s = e["surface"]
print("len", len(s))
print(repr(s[-260:]))
print("---- 是否含 13f7db:", "lib_13f7db377f7b" in byid)
