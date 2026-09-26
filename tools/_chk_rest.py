# -*- coding: utf-8 -*-
import io, os, re, json, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
rows = json.load(io.open(T("tools", "checkup_all.json"), encoding="utf-8"))
byid = {r["id"]: r for r in rows}
PUNCT = re.compile(r"[\s\u3000，。、！？；：·…—－\-_,\.\!\?\;:\"'“”‘’（）()\[\]【】《》<>{}|/\\~`@#$%^&*+=「」『』※★☆●○■□◇♡？！.]+")
def norm(s): return PUNCT.sub("", (s or "").lower())
def bg(s):
    s = norm(s); return set(s[i:i+2] for i in range(len(s)-1)) if len(s)>1 else ({s} if s else set())
def jac(a,b): return (len(a&b)/len(a|b)) if (a and b) else 0.0

print("##### 音乐家族剩余5条 truth")
for i in ("lib_43e1934bbc83","lib_57ae1306e87a","lib_bb9b8da83f0b","lib_09a8742453b7","lib_e09338da20be"):
    r = byid.get(i)
    if r: print("--", i, r["title"], "|", r["src"][:16]); print("   面:", r["surface"][:60].replace("\n"," ")); print("   底:", r["truth"][:110].replace("\n"," "))
print()
print("##### 1a6283e13128 是谁")
r = byid.get("lib_1a6283e13128")
print(r["title"], "|", r["src"]); print("面:", r["surface"][:80]); print("底:", r["truth"][:80])
print()
print("##### 0cf00682e3ce vs 1a6283e13128 相似度")
a, b = byid["lib_0cf00682e3ce"], byid.get("lib_1a6283e13128")
if b: print("面%.2f 底%.2f" % (jac(bg(a["surface"]),bg(b["surface"])), jac(bg(a["truth"]),bg(b["truth"]))))
print()
print("##### 056db100d29a vs 2bfce712eedb")
for i in ("lib_056db100d29a","lib_2bfce712eedb"):
    r = byid[i]; print("--", i, r["title"]); print("   面:", r["surface"][:80].replace("\n"," ")); print("   底:", r["truth"][:120].replace("\n"," "))
print()
print("##### 146ba5100f1f vs 641dec1f9ed2")
for i in ("lib_146ba5100f1f","lib_641dec1f9ed2"):
    r = byid[i]; print("--", i, r["title"]); print("   面:", r["surface"][:80].replace("\n"," ")); print("   底:", r["truth"][:130].replace("\n"," "))
print()
print("##### 314cc038dce2 vs 71e675399a64")
for i in ("lib_314cc038dce2","lib_71e675399a64"):
    r = byid[i]; print("--", i, r["title"]); print("   面:", r["surface"][:80].replace("\n"," ")); print("   底:", r["truth"][:130].replace("\n"," "))
print()
print("##### aac5e74f3bff truth")
r = byid["lib_aac5e74f3bff"]; print(r["title"]); print("面:", r["surface"][:100].replace("\n"," ")); print("底:", r["truth"][:130].replace("\n"," "))
print()
print("##### 棺材淋湿另一版 & 他不喜欢我孪生")
for kw in ("没有迈步", "染上了一个习惯"):
    for r in rows:
        if kw in r["surface"]:
            print(kw, "->", r["id"], r["title"][:14], "|", r["src"][:16], "|", norm(r["surface"])[:40])
print()
print("##### 许二木10条 的库内近重复")
xu = [r for r in rows if "许二木" in r["src"]]
others = [r for r in rows if "许二木" not in r["src"]]
for x in xu:
    best = None
    for o in others:
        j = max(jac(bg(x["surface"]), bg(o["surface"])), jac(bg(x["truth"]), bg(o["truth"])))
        if best is None or j > best[0]: best = (j, o)
    print("%s %-10s 最近: %.2f [%s] %s | %s" % (x["id"], x["title"][:8], best[0], best[1]["src"][:14], best[1]["title"][:12], norm(best[1]["surface"])[:30]))
