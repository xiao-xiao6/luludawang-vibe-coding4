# -*- coding: utf-8 -*-
"""繁译简未对齐 45 条：用前缀/包含宽松匹配再找原文，判断是清洗差异还是原文档版本不同"""
import io, os, re, json, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
rows = json.load(io.open(T("tools", "checkup_all.json"), encoding="utf-8"))
pairs = json.load(io.open(T("tools", "checkup_pairs.json"), encoding="utf-8"))
al = {p["id"] for p in pairs}
PUNCT = re.compile(r"[\s\u3000，。、！？；：·…—－\-_,\.\!\?\;:\"'“”‘’（）()\[\]【】《》<>{}|/\\~`@#$%^&*+=「」『』※★☆●○■□◇♡]+")
def norm(s): return PUNCT.sub("", (s or "").lower())
from zhconv import convert as zc
def nzh(s): return norm(zc(s or "", "zh-hans"))

trad = []
for fn in (r"D:\Downloads\train_8k.json", r"D:\Downloads\test_1.5k.json"):
    for e in json.load(io.open(fn, encoding="utf-8")):
        trad.append((nzh(e.get("surface") or ""), e))
print("原文档条数:", len(trad))
miss = [r for r in rows if "繁译简" in r["cats"] and r["id"] not in al]
hit_pre = hit_con = 0
for r in miss:
    k = nzh(r["surface"])
    if not k: continue
    found = None
    for tk, e in trad:
        if not tk: continue
        m = min(len(k), len(tk))
        if m >= 12 and k[:12] == tk[:12]:
            found = ("prefix", tk[:40]); break
    if not found:
        for tk, e in trad:
            if len(k) >= 16 and (k[:16] in tk or tk[:16] in k):
                found = ("contain", tk[:40]); break
    if found: hit_pre += 1
    else: hit_con += 1
print("宽松匹配命中:", hit_pre, " 仍未命中:", hit_con)
# 抽 3 条仍未命中的，打印译文与最相似原文
def jac(a, b):
    A = set(a[i:i+2] for i in range(len(a)-1)); B = set(b[i:i+2] for i in range(len(b)-1))
    return len(A & B) / max(1, len(A | B))
shown = 0
for r in miss:
    k = nzh(r["surface"])
    best = max(((jac(k, tk), tk) for tk, _ in trad if tk), default=(0, ""))
    if best[0] < 0.35:
        print("\n-- %s %s 最相似jac=%.2f" % (r["id"], r["title"][:14], best[0]))
        print("   译:", r["surface"][:70].replace("\n", " "))
        print("   原:", best[1][:70])
        shown += 1
        if shown >= 4: break
