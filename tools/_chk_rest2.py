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
def show(i, tl=90, zl=130):
    r = byid.get(i)
    if not r: print("-- (缺)", i); return None
    print("--", i, r["title"][:18], "|", r["src"][:16], "|", "/".join(r["cats"][:3]))
    print("   面:", r["surface"][:tl].replace("\n", " "))
    print("   底:", r["truth"][:zl].replace("\n", " "))
    return r

print("##### 039海难侥幸 / 洋娃娃嚎哭家族")
for r in rows:
    if "海难侥幸" in r["title"] or ("洋娃娃" in r["surface"] and "嚎啕" in r["surface"]):
        print(r["id"], r["title"][:16], "|", r["src"][:16]); print("   面:", r["surface"][:70].replace("\n"," ")); print("   底:", r["truth"][:100].replace("\n"," "))
print()
print("##### 吹蜡烛/生日杀友三家")
for i in ("lib_056db100d29a", "lib_2bfce712eedb", "lib_c9a312d8972e"): show(i)
print()
print("##### 图书馆一百元两家")
for i in ("lib_146ba5100f1f", "lib_641dec1f9ed2"): show(i)
print()
print("##### 借书翻第N页两家")
for i in ("lib_314cc038dce2", "lib_71e675399a64"): show(i)
print()
print("##### 山顶敲门 aac5e74f3bff")
show("lib_aac5e74f3bff")
print()
print("##### 谁没淋湿 / 相依为命习惯")
for kw in ("没有迈步", "染上了一个习惯"):
    for r in rows:
        if kw in r["surface"]:
            print(kw, "->", r["id"], r["title"][:14], "|", r["src"][:16])
print()
print("##### 许二木10条 库内最近邻")
xu = [r for r in rows if "许二木" in r["src"]]
others = [r for r in rows if "许二木" not in r["src"]]
for x in xu:
    best = (0, None)
    for o in others:
        j = max(jac(bg(x["surface"]), bg(o["surface"])), jac(bg(x["truth"]), bg(o["truth"])))
        if j > best[0]: best = (j, o)
    print("%s %-10s -> %.2f [%s] %s" % (x["id"], x["title"][:8], best[0], best[1]["src"][:14], best[1]["title"][:14]))
