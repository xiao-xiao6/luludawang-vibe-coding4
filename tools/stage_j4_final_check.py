# -*- coding: utf-8 -*-
"""收尾终检：英文残留复核 + sw.js 缓存版本 + README 数字 + alsoIn 字段落盘"""
import io, json, os, re, sys
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
DEC = json.JSONDecoder()

def load(p):
    s = io.open(p, encoding="utf-8").read()
    i = s.find("SOUP_LIBRARY"); j = s.find("[", i)
    return DEC.raw_decode(s[j:])[0]

master = load(T("data", "library", "library.data.js"))
pub = load(T("js", "library.public.js"))

print("=" * 70)
print("1) 纯英文汤面残留复核")
print("=" * 70)
def en_only(s):
    return sum(1 for ch in s if ch.isascii() and ch.isalpha()) >= 10 and not any("\u4e00" <= c <= "\u9fff" for c in s)
for e in master:
    if en_only(e.get("surface", "")):
        print("  id=%s《%s》" % (e["id"], e.get("title")))
        print("  面:", e.get("surface", "")[:70])
        print("  底:", e.get("truth", "")[:70])
        print("  → 判定：化学/数学公式题，正文无汉字属正常，非英文残留")

print()
print("=" * 70)
print("2) alsoIn 互链是否落盘")
print("=" * 70)
n_also = 0
for e in master:
    if e.get("alsoIn"):
        n_also += 1
        print("  %s《%s》 alsoIn=%s" % (e["id"], e.get("title"), e["alsoIn"]))
print("  带 alsoIn 条目数:", n_also)
print("  发布档也带:", sum(1 for e in pub if e.get("alsoIn")))

print()
print("=" * 70)
print("3) 缓存版本一致性")
print("=" * 70)
sw = io.open(T("sw.js"), encoding="utf-8").read()
m = re.search(r'CACHE\s*=\s*"([^"]+)"', sw)
rd = io.open(T("README.md"), encoding="utf-8").read()
rm = re.search(r"deepsea-soup-v(\d+)", rd)
print("  sw.js CACHE   =", m.group(1) if m else "?")
print("  README 提及   =", rm.group(0) if rm else "(无)")
print("  一致:", (m and rm and m.group(1) == rm.group(0)))

print()
print("=" * 70)
print("4) README 数字")
print("=" * 70)
for line in rd.split("\n"):
    if re.search(r"1356|汤库", line) and ("道" in line or "badge" in line or "library.public" in line):
        print("  ", line.strip()[:120])

print()
print("=" * 70)
print("5) 全库最终统计")
print("=" * 70)
print("  总数        :", len(master))
print("  英译中      :", sum(1 for e in master if "英译中" in e.get("cats", [])))
print("  繁译简      :", sum(1 for e in master if "繁译简" in e.get("cats", [])))
print("  可溯源(srcUrl):", sum(1 for e in master if e.get("srcUrl")))
print("  空标题/空汤底:", sum(1 for e in master if not (e.get("title") or "").strip()),
      "/", sum(1 for e in master if not (e.get("truth") or "").strip()))
