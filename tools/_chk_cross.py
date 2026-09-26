# -*- coding: utf-8 -*-
import io, os, re, json, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
rows = {r["id"]: r for r in json.load(io.open(T("tools", "checkup_all.json"), encoding="utf-8"))}
PUNCT = re.compile(r"[\s\u3000，。、！？；：·…—－\-_,\.\!\?\;:\"'“”‘’（）()\[\]【】《》<>{}|/\\~`@#$%^&*+=「」『』※★☆●○■□◇♡？！.]+")
def norm(s): return PUNCT.sub("", (s or "").lower())
def bg(s):
    s = norm(s); return set(s[i:i+2] for i in range(len(s)-1)) if len(s)>1 else ({s} if s else set())
def jac(a,b): return (len(a&b)/len(a|b)) if (a and b) else 0.0
def cont(a,b): return len(a&b)/max(1,min(len(a),len(b)))
PAIRS = [
 ("elevator","lib_5a74db2ed992"),("elevator","lib_4d4ae7aa267f"),("elevator","lib_ef652fe14c3e"),("elevator","lib_5267d633ce14"),
 ("match","lib_73c238975974"),("match","lib_9a2bf4d46848"),
 ("turtle","lib_44433fb07ea5"),("turtle","lib_75f091e6b064"),("turtle","lib_720d22c7f8ee"),
 ("music","lib_43e1934bbc83"),("music","lib_e09338da20be"),
 ("fog","lib_776b70302820"),("fog","lib_d3c52f26b4cd"),
 ("umbrellanight","lib_aac5e74f3bff"),
]
for c, l in PAIRS:
    if c not in rows or l not in rows: print("(缺)", c, l); continue
    a, b = rows[c], rows[l]
    js, jf = jac(bg(a["surface"]), bg(b["surface"])), jac(bg(a["truth"]), bg(b["truth"]))
    cs, cf = cont(bg(a["surface"]), bg(b["surface"])), cont(bg(a["truth"]), bg(b["truth"]))
    print("%-14s ~ %-20s 面jac%.2f 底jac%.2f | 面含%.2f 底含%.2f  %s" % (c, l, js, jf, cs, cf, b["title"][:14]))
# 精品里有没有 棺材/没淋湿
print()
for r in rows.values():
    if r["layer"] == "core" and ("淋" in r["surface"] or "棺材" in r["surface"] or "同时到达" in r["surface"]):
        print("core命中:", r["id"], r["title"], "|", r["surface"][:60])
