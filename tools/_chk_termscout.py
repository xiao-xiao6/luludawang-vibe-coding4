# -*- coding: utf-8 -*-
"""侦查：日译中 165 条里，原文专名 vs 译文用词的真实对应（含上下文），供制定安全替换表"""
import io, os, re, json, sys
from collections import Counter, defaultdict
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
llt = {str(it["id"]): it for it in json.load(io.open(T("tools", "llt_fresh_final.json"), encoding="utf-8"))["items"]}

# 译文中所有含 龟/海 的 2-4 字词
W = re.compile(r"[\u4e00-\u9fff]{0,2}[龟海][\u4e00-\u9fff]{0,2}")
combo = defaultdict(Counter)   # (原文专名集合) -> 译文词计数
ctx = defaultdict(list)        # 译文词 -> 上下文样例
for e in data:
    if e.get("src") != "late-late.jp": continue
    o = llt.get(str(e.get("srcNo")))
    if not o: continue
    ja = (o.get("surface") or "") + (o.get("truth") or "")
    names = tuple(sorted(n for n in ("カメオ", "カメコ", "ウミオ", "ウミコ", "亀山") if n in ja))
    z = (e.get("surface") or "") + (e.get("truth") or "")
    for m in W.finditer(z):
        combo[names][m.group(0)] += 1
        ctx[m.group(0)].append((e.get("srcNo"), z[max(0, m.start()-12):m.end()+12].replace("\n", " ")))
print("===== 原文专名组合 → 译文用词 =====")
for names, c in sorted(combo.items(), key=lambda x: -sum(x[1].values())):
    print("原文[%s]" % ("+".join(names) or "无"))
    for w, n in c.most_common():
        print("    %-8s x%d" % (w, n))
print()
print("===== 需要判定的模糊词（上下文样例）=====")
for w in ("小龟", "小龟子", "小龟女", "小龟男", "龟男", "龟女", "海男", "海女", "小海", "乌龟", "龟山", "海子", "海雄"):
    if w in ctx:
        print("--- %s (%d 处)" % (w, len(ctx[w])))
        for no, s in ctx[w][:4]:
            print("     #%s …%s…" % (no, s))
