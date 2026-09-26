# -*- coding: utf-8 -*-
import io, json, sys, re
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
rows = {r["id"]: r for r in json.load(io.open(ROOT + r"\tools\checkup_all.json", encoding="utf-8"))}
for i in ("lib_2299ca62945f", "lib_7a31e92d9ed9", "lib_aea0dcf7d165", "lib_bafb21fa5402", "lib_bf6dc1df19ca"):
    r = rows[i]
    f = r["surface"] if i == "lib_bf6dc1df19ca" else r["truth"]
    for a, b in (("「", "」"), ("“", "”"), ("『", "』")):
        ca, cb = f.count(a), f.count(b)
        if ca != cb:
            k = f.find(a) if ca > cb else f.find(b)
            print(i, r["title"][:12], "|", a, ca, b, cb, "| …" + f[max(0, k-25):k+25].replace("\n", " ") + "…")
# 繁体残留 3 条详情
print()
for i in ("lib_af5cd136a547", "lib_463d72d94150", "lib_2ee8dbec8a06"):
    r = rows[i]
    for f in ("surface", "truth"):
        hits = [c for c in r[f] if c in "喫篠側慣濃載離"]
        if hits:
            pos = min(r[f].find(c) for c in set(hits))
            print(i, r["title"][:16], f, "|", "".join(sorted(set(hits))), "| …" + r[f][max(0,pos-20):pos+24].replace("\n", " ") + "…")
