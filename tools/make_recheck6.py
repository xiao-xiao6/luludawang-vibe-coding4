# -*- coding: utf-8 -*-
"""全量复核第六轮 · 准备 1087 道日译中题的 id 清单与三份原文合流。

输出 tools/recheck6_ids.json（全部日译中 srcNo）与 tools/recheck6_orig.json
（srcNo → {title,surface,truth,batch}），后续扫描与分包都只用这两份。
"""
import io, os, json

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
T = lambda *p: os.path.join(ROOT, "tools", *p)

raw = io.open(os.path.join(ROOT, "data", "library", "library.data.js"), encoding="utf-8").read()
h = raw.index("var SOUP_LIBRARY = ") + len("var SOUP_LIBRARY = ")
data, _ = json.JSONDecoder().raw_decode(raw[h:])
j2 = [o for o in data if "日译中" in (o.get("cats") or [])]
ids = sorted({str(o["srcNo"]) for o in j2}, key=int)

BATCHES = {"tools/llt_dump.json": "k1", "tools/llt_dump2.json": "k2", "tools/llt_dump3.json": "k3"}
orig = {}
for rel, tag in BATCHES.items():
    d = json.load(io.open(T(os.path.basename(rel)), encoding="utf-8"))
    items = d["items"] if isinstance(d, dict) and "items" in d else d
    for it in items:
        sid = str(it["id"])
        if sid in orig:
            continue
        orig[sid] = {"id": sid, "title": it.get("title") or "", "surface": it.get("surface") or "",
                     "truth": it.get("truth") or "", "url": it.get("url") or "", "batch": tag}

json.dump(ids, io.open(T("recheck6_ids.json"), "w", encoding="utf-8"))
json.dump(orig, io.open(T("recheck6_orig.json"), "w", encoding="utf-8"), ensure_ascii=False)
hit = [s for s in ids if s in orig]
print("日译中题数:", len(ids), "| 有原文:", len(hit), "| 缺原文:", len(set(ids) - set(orig)))
import collections
print("所属批次:", collections.Counter(orig[s]["batch"] for s in hit))
print("原文字段缺失:", sum(1 for s in hit if not (orig[s]["surface"] and orig[s]["truth"])))
