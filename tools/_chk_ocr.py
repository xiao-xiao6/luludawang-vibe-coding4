# -*- coding: utf-8 -*-
import io, os, re, json, sys
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
rows = json.load(io.open(T("tools", "checkup_all.json"), encoding="utf-8"))

print("===== rokid-collection 标题总览 =====")
for r in rows:
    if r["src"] == "github:bcefghj/rokid-collection":
        t = r["title"]
        flag = "!!!" if (len(t) > 14 or "**" in t or "汤面" in t) else "   "
        print("%s %-6s %s" % (flag, r["id"][4:10], t[:70]))

print("\n===== 许二木OCR 条目 =====")
for r in rows:
    if "许二木" in r["src"]:
        print("--", r["id"], r["title"])
        print("   面:", r["surface"][:110].replace("\n", " "))
        print("   底:", r["truth"][:110].replace("\n", " "))

print("\n===== 一一（误破折号）上下文 =====")
RE = re.compile(r"[\u4e00-\u9fff]一一[\u4e00-\u9fff]")
for r in rows:
    for f in ("surface", "truth"):
        for m in RE.finditer(r[f] or ""):
            print("%s %s …%s…" % (r["id"], f, r[f][max(0,m.start()-14):m.end()+14].replace("\n"," ")))

print("\n===== DUPSEG 两条全文 =====")
for i in ("lib_6fd3d228e4cf", "lib_16dfc330f802"):
    r = next(x for x in rows if x["id"] == i)
    print("###", i, r["title"])
    print("面(%d): %s" % (len(r["surface"]), r["surface"][:500].replace("\n","⏎")))
    print("底(%d): %s" % (len(r["truth"]), r["truth"][:800].replace("\n","⏎")))
