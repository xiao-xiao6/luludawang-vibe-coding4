# -*- coding: utf-8 -*-
"""Stage J 终验收（只读）：核对三份数据一致性、标签、空字段、撞名、抽样"""
import io, json, os, re, sys, collections, hashlib
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
DEC = json.JSONDecoder()

def load(p):
    s = io.open(p, encoding="utf-8").read()
    i = s.find("SOUP_LIBRARY")
    j = s.find("[", i)
    return DEC.raw_decode(s[j:])[0], s

TGT = {"lib_0696ae22b31a", "lib_57e7c1800d44", "lib_1b5f8818a812"}

def is_en_only(s):
    lat = sum(1 for ch in s if ch.isascii() and ch.isalpha())
    cjk = sum(1 for ch in s if "\u4e00" <= ch <= "\u9fff")
    return lat > 0 and lat >= cjk * 2

def english_surface(s):
    return sum(1 for ch in s if ch.isascii() and ch.isalpha()) >= 10 and not any("\u4e00" <= c <= "\u9fff" for c in s)

print("=" * 72)
print("三份数据一致性")
print("=" * 72)
files = [("母本", r"data\library\library.data.js"),
         ("worker", r"worker\src\library.data.js"),
         ("发布档", r"js\library.public.js")]
masters = {}
for name, rel in files:
    d, raw = load(T(*rel.split("\\")))
    masters[name] = d
    print("%-6s n=%-5d e2s=%-4d 英译中=%-4d 繁译简=%-4d 含truth=%s" % (
        name, len(d),
        sum(1 for e in d if e.get("_t") == "e2s"),
        sum(1 for e in d if "英译中" in e.get("cats", [])),
        sum(1 for e in d if "繁译简" in e.get("cats", [])),
        '"truth"' in raw))

d = masters["母本"]
print()
print("=" * 72)
print("质量自检")
print("=" * 72)
print("空标题            :", sum(1 for e in d if not (e.get("title") or "").strip()))
print("空汤底            :", sum(1 for e in d if not (e.get("truth") or "").strip()))
print("3 条补底题已清除  :", not ({e["id"] for e in d} & TGT))
print("纯英文汤面残留    :", sum(1 for e in d if english_surface(e.get("surface", ""))))
print("e2s 缺英译中标签  :", sum(1 for e in d if e.get("_t") == "e2s" and "英译中" not in e.get("cats", [])))
print("dispTitle≠title   :", sum(1 for e in d if (e.get("title") or "") != (e.get("dispTitle") or "")))
print("无题/Jed 残留     :", sum(1 for e in d if re.match(r"^(Jed|无题|無題|#)", e.get("title", "") or "")))

c = collections.Counter(e["title"] for e in d)
dups = {v: n for v, n in c.items() if n > 1}
print("全库重名标题数    :", len(dups), "(原库固有，非本轮引入)")

print()
print("=" * 72)
print("新增 e2s 抽样")
print("=" * 72)
new_ids = [e["id"] for e in d if e.get("_t") == "e2s"]
for sid in ["1", "205", "213", "227"]:
    nid = "lib_" + hashlib.sha1(("yng:" + sid).encode("utf-8")).hexdigest()[:12]
    hit = [e for e in d if e["id"] == nid]
    if hit:
        e = hit[0]
        print("\n[%s] %s  cats=%s" % (sid, e["title"], e["cats"]))
        print("   面:", e["surface"][:80].replace("\n", " "))
        print("   底:", e["truth"][:80].replace("\n", " "))

print()
print("新增 e2s 总数:", len(new_ids), "| 母本总数:", len(d))

# 三份数据 id 集合一致
ids_m = {e["id"] for e in masters["母本"]}
for name, arr in masters.items():
    same = {e["id"] for e in arr} == ids_m
    print("%-6s id 集合与母本一致: %s" % (name, same))
