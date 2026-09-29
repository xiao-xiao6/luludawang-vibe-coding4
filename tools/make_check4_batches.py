# -*- coding: utf-8 -*-
"""第三轮 · 并库前自查：给 458 候选生成 A/B 两类复检包（数据源 = 清理后的译文 + 本地原文）。

与上一轮的顺序不同：这轮**先自查再并库**，这样删坏题不会影响最终收录数。
A 包：标题/汤面/汤底 三态是否同一故事 + 污染残留（只给中文）
B 包：日文原文 ↔ 中文译文 全文对照，判错翻/漏翻/少翻/多翻/加戏（全文不截断）
产出：tools/check4_align/align_NN.txt、tools/check4_pair/pair_NN.txt
"""
import io, os, json

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
T = lambda *p: os.path.join(ROOT, "tools", *p)
NZ = lambda s: (s or "").replace("\n", "⏎").replace("\r", "")

trans = json.load(io.open(T("llt3_trans_clean.json"), encoding="utf-8"))
order = [str(it["id"]) for it in json.load(io.open(T("llt3_fresh.json"), encoding="utf-8"))["items"]]
orig = {str(x["id"]): x for x in json.load(io.open(T("llt_dump3.json"), encoding="utf-8"))["items"]}

ids = [s for s in order if s in trans and s in orig]
print("可复检:", len(ids))

for d in ("check4_align", "check4_pair"):
    p = T(d)
    if not os.path.isdir(p):
        os.makedirs(p)
    for f in os.listdir(p):
        os.remove(os.path.join(p, f))

PER_A, PER_B = 78, 34
k = 0
for i in range(0, len(ids), PER_A):
    k += 1
    with io.open(T("check4_align", "align_%02d.txt" % k), "w", encoding="utf-8") as f:
        for sid in ids[i:i + PER_A]:
            v = trans[sid]
            f.write("[%s] 《%s》\n汤面: %s\n汤底: %s\n\n" % (sid, NZ(v["title"]), NZ(v["surface"]), NZ(v["truth"])))
k = 0
for i in range(0, len(ids), PER_B):
    k += 1
    with io.open(T("check4_pair", "pair_%02d.txt" % k), "w", encoding="utf-8") as f:
        for sid in ids[i:i + PER_B]:
            v, g = trans[sid], orig[sid]
            f.write("[%s] 《%s》 原帖 #%s\n原文汤面: %s\n译文汤面: %s\n原文汤底: %s\n译文汤底: %s\n\n" % (
                sid, NZ(v["title"]), sid, NZ(g.get("surface")), NZ(v["surface"]),
                NZ(g.get("truth")), NZ(v["truth"])))
for d in ("check4_align", "check4_pair"):
    p = T(d)
    tot = sum(os.path.getsize(os.path.join(p, x)) for x in os.listdir(p))
    print("   %s: %d 份 / %.0f KB" % (d, len(os.listdir(p)), tot / 1024.0))
