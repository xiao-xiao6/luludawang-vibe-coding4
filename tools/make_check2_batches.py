# -*- coding: utf-8 -*-
"""本轮 · Stage L-4：为新译好的题出两批复检包（并入前后都可跑，数据取自清理后的译文）。

1) tools/check2_align/align_NN.txt —— 只看中文：题名/汤面/汤底是否同一故事
2) tools/check2_pair/pair_NN.txt —— 日文原文 ↔ 中文译文，查错翻/少翻/漏翻/截断/加戏
用法：python tools/make_check2_batches.py
"""
import io, os, re, json, shutil

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
T = lambda *p: os.path.join(ROOT, "tools", *p)

# 以母本为准（并入后），只取本轮新入库的 srcNo
fresh = {str(x["id"]): x for x in json.load(io.open(T("llt2_fresh.json"), encoding="utf-8"))["items"]}
raw = io.open(os.path.join(ROOT, "data", "library", "library.data.js"), encoding="utf-8").read()
i = raw.find("var SOUP_LIBRARY"); i = raw.find("[", i)
lib = json.loads(raw[i:raw.find("\nvar SOUP_LIB_CATS", i)].rsplit("]", 1)[0] + "]")
tr = {str(e["srcNo"]): {"title": e["title"], "surface": e["surface"], "truth": e["truth"]}
      for e in lib if e.get("src") == "late-late.jp" and str(e.get("srcNo")) in fresh}
ids = [k for k in tr if k in fresh]
print("可复检:", len(ids))

for d in ("check2_align", "check2_pair"):
    p = T(d)
    if os.path.isdir(p):
        shutil.rmtree(p)
    os.makedirs(p)

CAP = 42000


def run(dirname, stem, renderer):
    blocks, size, n = [], 0, 0
    for sid in ids:
        b = renderer(sid)
        if size + len(b) > CAP and blocks:
            n += 1
            io.open(T(dirname, "%s_%02d.txt" % (stem, n)), "w", encoding="utf-8").write("".join(blocks))
            blocks, size = [], 0
        blocks.append(b); size += len(b)
    if blocks:
        n += 1
        io.open(T(dirname, "%s_%02d.txt" % (stem, n)), "w", encoding="utf-8").write("".join(blocks))
    print(dirname, "→", n, "批")


def flat(s):
    return (s or "").replace("\n", "⏎")


def align(sid):
    v = tr[sid]
    return "[%s] 《%s》\n汤面: %s\n汤底: %s\n\n" % (sid, v["title"], flat(v["surface"]), flat(v["truth"]))


def pair(sid):
    j, v = fresh[sid], tr[sid]
    return ("[%s] 《%s》 原帖 #%s\n原文汤面: %s\n站内汤面: %s\n原文汤底: %s\n站内汤底: %s\n\n" % (
        sid, v["title"], sid,
        re.sub(r"\s+", " ", j.get("surface") or "")[:1500],
        re.sub(r"\s+", " ", v["surface"])[:1200],
        re.sub(r"\s+", " ", j.get("truth") or "")[:2600],
        re.sub(r"\s+", " ", v["truth"])[:2000]))


run("check2_align", "align", align)
run("check2_pair", "pair", pair)
