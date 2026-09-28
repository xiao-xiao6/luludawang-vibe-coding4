# -*- coding: utf-8 -*-
"""复检第三轮 · 生成 A/B 两类复检包（数据源=修正后的当前母本，原文源=llt_dump2.json）。

A 包：标题/汤面/汤底 三态是否同一故事 + 污染残留（只看中文，不给原文）
B 包：日文原文 ↔ 现库中文，逐条判错翻/漏翻/少翻/多翻/加戏
      B 包一律全文输出、不做任何截断，避免上轮「文件里看不到下文」造成的误报。
"""
import io, os, json, collections

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
T = lambda *p: os.path.join(ROOT, "tools", *p)
NZ = lambda s: (s or "").replace("\n", "⏎").replace("\r", "")

raw = io.open(os.path.join(ROOT, "data", "library", "library.data.js"), encoding="utf-8").read()
h = raw.index("var SOUP_LIBRARY = ") + len("var SOUP_LIBRARY = ")
data, _ = json.JSONDecoder().raw_decode(raw[h:])

ids = set(json.load(io.open(T("recheck3_ids.json"), encoding="utf-8")))
by = [(sn, o) for o, sn in
      ((o, str(o.get("srcNo"))) for o in data if o.get("src") == "late-late.jp")
      if sn in ids]
by.sort(key=lambda x: int(x[0]))
orig = {str(x["id"]): x for x in json.load(io.open(T("llt_dump2.json"), encoding="utf-8"))["items"]}
print("待复检:", len(by), "| 有原文:", sum(1 for sn, o in by if sn in orig))

for d in ("check3_align", "check3_pair"):
    p = os.path.join(ROOT, "tools", d)
    if not os.path.isdir(p):
        os.makedirs(p)
    for f in os.listdir(p):
        os.remove(os.path.join(p, f))

PER_A, PER_B = 78, 39
k = 0
for i in range(0, len(by), PER_A):
    k += 1
    with io.open(T("check3_align", "align_%02d.txt" % k), "w", encoding="utf-8") as f:
        for sn, o in by[i:i + PER_A]:
            f.write("[%s] 《%s》\n汤面: %s\n汤底: %s\n\n" % (sn, NZ(o["title"]), NZ(o["surface"]), NZ(o["truth"])))
k = 0
for i in range(0, len(by), PER_B):
    k += 1
    with io.open(T("check3_pair", "pair_%02d.txt" % k), "w", encoding="utf-8") as f:
        for sn, o in by[i:i + PER_B]:
            g = orig.get(sn) or {}
            f.write("[%s] 《%s》 原帖 #%s\n原文汤面: %s\n现库汤面: %s\n原文汤底: %s\n现库汤底: %s\n\n" % (
                sn, NZ(o["title"]), sn, NZ(g.get("surface")), NZ(o["surface"]),
                NZ(g.get("truth")), NZ(o["truth"])))
print("A包:", len(os.listdir(T("check3_align"))), "份 | B包:", len(os.listdir(T("check3_pair"))), "份")
for d in ("check3_align", "check3_pair"):
    p = os.path.join(ROOT, "tools", d)
    tot = sum(os.path.getsize(os.path.join(p, x)) for x in os.listdir(p))
    print("   ", d, "%.0f KB" % (tot / 1024.0))
