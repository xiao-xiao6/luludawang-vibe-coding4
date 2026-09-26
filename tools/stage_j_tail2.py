# -*- coding: utf-8 -*-
"""Stage J 收尾诊断 2：_t 字段污染普查 + 重名标题归类"""
import io, json, os, sys, collections, re
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
DEC = json.JSONDecoder()

def load(p):
    s = io.open(p, encoding="utf-8").read()
    i = s.find("SOUP_LIBRARY"); j = s.find("[", i)
    return DEC.raw_decode(s[j:])[0]

d = load(T("data", "library", "library.data.js"))
print("母本总数:", len(d))

print("\n" + "=" * 74)
print("A. _t 字段取值普查（合法值：t2s / e2s / 缺失）")
print("=" * 74)
c = collections.Counter(repr(e.get("_t")) for e in d)
for k, n in c.most_common():
    print("  %-20s %d" % (k[:60], n))

print("\n--- 非法 _t 明细 ---")
for e in d:
    t = e.get("_t")
    if t is not None and t not in ("t2s", "e2s"):
        print("  id=%s | _t=%r | title=%s" % (e["id"], str(t)[:60], e.get("title")))

print("\n" + "=" * 74)
print("B. 重名标题归类（标出是否含本轮 e2s 新增）")
print("=" * 74)
byT = collections.defaultdict(list)
for e in d:
    byT[e["title"]].append(e)
newdup = []
for t, arr in sorted(byT.items()):
    if len(arr) > 1:
        tags = ["e2s" if x.get("_t") == "e2s" else ("t2s" if x.get("_t") == "t2s" else "old") for x in arr]
        has_new = "e2s" in tags
        if has_new: newdup.append(t)
        print("  %-16s x%d %s%s" % (t, len(arr), tags, "  <== 含新增" if has_new else ""))
        if has_new:
            for x in arr:
                print("      - [%s] %s | %s" % (x.get("_t") or "old", x["id"], x.get("surface", "")[:52].replace("\n", " ")))

print("\n含新增的重名标题:", newdup)

print("\n" + "=" * 74)
print("C. e2s 新增里与全库标题撞车的具体条目")
print("=" * 74)
for e in d:
    if e.get("_t") == "e2s" and len(byT[e["title"]]) > 1:
        others = [x for x in byT[e["title"]] if x["id"] != e["id"]]
        print("\n新增 %s《%s》" % (e["id"], e["title"]))
        print("   面:", e.get("surface", "")[:90].replace("\n", " "))
        for o in others:
            print("   撞 [%s] %s《%s》 面:%s" % (o.get("_t") or "old", o["id"], o.get("title"), o.get("surface", "")[:70].replace("\n", " ")))
