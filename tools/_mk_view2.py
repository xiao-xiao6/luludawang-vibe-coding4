# -*- coding: utf-8 -*-
import io, os, json, re
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
rows = {r["id"]: r for r in json.load(io.open(T("tools", "checkup_all.json"), encoding="utf-8"))}
out = []
def w(s): out.append(s)
for i in ("lib_2299ca62945f","lib_7a31e92d9ed9","lib_aea0dcf7d165","lib_bafb21fa5402","lib_bf6dc1df19ca",
          "lib_2ee8dbec8a06","lib_16dfc330f802","lib_65c3747dc4cb","lib_88b2abdae709","lib_ff7f074e1147",
          "lib_fd7b08ee78c9","lib_247a5da9ccb8","lib_a72e6741b9be","lib_92294fdcf566","lib_6f860967a6c4"):
    r = rows[i]
    w("@@@@ %s | %s | %s" % (i, r["title"], r["src"]))
    w("[S]" + r["surface"])
    w("[T]" + r["truth"])
    w("")
io.open(T("tools", "_fix_view2.txt"), "w", encoding="utf-8").write("\n".join(out))
print("ok", sum(len(x) for x in out))
