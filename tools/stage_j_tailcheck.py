# -*- coding: utf-8 -*-
"""Stage J 收尾诊断：定位纯英文汤面残留 + 新增撞名标题 + 检查发布档字段保留"""
import io, json, os, re, sys, collections
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
DEC = json.JSONDecoder()

def load(p):
    s = io.open(p, encoding="utf-8").read()
    i = s.find("SOUP_LIBRARY"); j = s.find("[", i)
    return DEC.raw_decode(s[j:])[0]

def en_only(s):
    return sum(1 for ch in s if ch.isascii() and ch.isalpha()) >= 10 and not any("\u4e00" <= c <= "\u9fff" for c in s)

master = load(T("data", "library", "library.data.js"))
pub = load(T("js", "library.public.js"))

print("=" * 74)
print("A. 纯英文汤面残留")
print("=" * 74)
for e in master:
    if en_only(e.get("surface", "")):
        print("id  :", e["id"])
        print("_t  :", e.get("_t"), "| src:", e.get("src"), "| srcNo:", e.get("srcNo"))
        print("title:", e.get("title"))
        print("面  :", e.get("surface", "")[:160])
        print("底  :", e.get("truth", "")[:160])
        print("cats:", e.get("cats"))

print()
print("=" * 74)
print("B. 重名标题（标出哪些来自本轮新增 e2s）")
print("=" * 74)
c = collections.Counter(e["title"] for e in master)
byT = collections.defaultdict(list)
for e in master:
    byT[e["title"]].append(e)
for t, n in sorted(c.items()):
    if n > 1:
        tags = ["e2s" if x.get("_t") == "e2s" else ("t2s" if x.get("_t") == "t2s" else "old") for x in byT[t]]
        flag = "  <== 含新增" if "e2s" in tags else ""
        print("  %-14s x%d  %s%s" % (t, n, tags, flag))

print()
print("=" * 74)
print("C. 发布档字段保留情况（可溯源用）")
print("=" * 74)
e2s = [e for e in master if e.get("_t") == "e2s"]
sample = e2s[0] if e2s else None
print("母本 e2s 样例字段:", sorted(sample.keys()) if sample else "-")
pe = [e for e in pub if e.get("src") == "yesnogame.net"]
print("发布档里 yesnogame 来源条数:", len(pe))
if pe:
    print("发布档样例字段:", sorted(pe[0].keys()))
    print("发布档样例:", json.dumps({k: pe[0][k] for k in ("title", "src", "srcNo", "srcUrl", "cats") if k in pe[0]}, ensure_ascii=False))
print("母本 e2s 带 srcUrl 条数:", sum(1 for e in e2s if e.get("srcUrl")))
