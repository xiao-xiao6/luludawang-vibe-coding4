# -*- coding: utf-8 -*-
"""全量复核第六轮 · 生成 A/B 两类复核包（1087 道日译中，全文不截断）。

A 包：标题/汤面/汤底 三态是否同一故事 + 污染残留（只看中文，不给原文）
B 包：日文原文 ↔ 现库中文，逐条判错翻/漏翻/少翻/多翻/加戏
"""
import io, os, json

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
T = lambda *p: os.path.join(ROOT, "tools", *p)
NZ = lambda s: (s or "").replace("\n", "⏎").replace("\r", "")

raw = io.open(os.path.join(ROOT, "data", "library", "library.data.js"), encoding="utf-8").read()
h = raw.index("var SOUP_LIBRARY = ") + len("var SOUP_LIBRARY = ")
data, _ = json.JSONDecoder().raw_decode(raw[h:])
cur = {str(o["srcNo"]): o for o in data if "日译中" in (o.get("cats") or [])}
ids = json.load(io.open(T("recheck6_ids.json"), encoding="utf-8"))
orig = json.load(io.open(T("recheck6_orig.json"), encoding="utf-8"))
by = [(s, cur[s]) for s in ids if s in cur]
by.sort(key=lambda x: int(x[0]))
print("待复核:", len(by), "| 有原文:", sum(1 for s, o in by if s in orig))

for d in ("check6_align", "check6_pair", "check6_verdicts"):
    p = T(d)
    if not os.path.isdir(p):
        os.makedirs(p)
    for f in os.listdir(p):
        os.remove(os.path.join(p, f))

PER_A, PER_B = 78, 39
manifest = {"align": {}, "pair": {}}
k = 0
for i in range(0, len(by), PER_A):
    k += 1
    name = "align_%02d" % k
    with io.open(T("check6_align", name + ".txt"), "w", encoding="utf-8") as f:
        for sn, o in by[i:i + PER_A]:
            manifest["align"][name] = manifest["align"].get(name, [])
            f.write("[%s] 《%s》\n汤面: %s\n汤底: %s\n\n" % (sn, NZ(o["title"]), NZ(o["surface"]), NZ(o["truth"])))
    manifest["align"][name] = [sn for sn, _ in by[i:i + PER_A]]
k = 0
for i in range(0, len(by), PER_B):
    k += 1
    name = "pair_%02d" % k
    g = orig.get(by[i][0]) or {}
    with io.open(T("check6_pair", name + ".txt"), "w", encoding="utf-8") as f:
        for sn, o in by[i:i + PER_B]:
            gg = orig.get(sn) or {}
            f.write("[%s] 《%s》 原帖 #%s [%s]\n原文汤面: %s\n现库汤面: %s\n原文汤底: %s\n现库汤底: %s\n\n" % (
                sn, NZ(o["title"]), sn, gg.get("batch", ""), NZ(gg.get("surface")), NZ(o["surface"]),
                NZ(gg.get("truth")), NZ(o["truth"])))
    manifest["pair"][name] = [sn for sn, _ in by[i:i + PER_B]]
json.dump(manifest, io.open(T("recheck6_manifest.json"), "w", encoding="utf-8"), ensure_ascii=False)
print("A包:", len(manifest["align"]), "份 | B包:", len(manifest["pair"]), "份")
for d in ("check6_align", "check6_pair"):
    p = T(d)
    sz = [os.path.getsize(os.path.join(p, x)) for x in os.listdir(p)]
    print("   ", d, "共 %.0f KB | 单包最大 %.0f KB" % (sum(sz) / 1024.0, max(sz) / 1024.0))
