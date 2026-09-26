# -*- coding: utf-8 -*-
"""
复核 stage_k1 被剔除的 53 条（Phase 2 · 只读 dump）
重点：带 20の扉 / ラテクエリサイクル 标签的题，究竟是「海龟汤变体」还是「问答记录/非汤」。
产出：tools/llt_dropped_review.txt（UTF-8）
"""
import io, os, json, sys

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)

d = json.load(io.open(T("tools", "llt_dump.json"), encoding="utf-8"))
its = d["items"]

HARD = ("20の扉", "ラテクエリサイクル", "ウミガメ風クロスワード", "画像あり！", "合作スープ")

L = []
def say(s=""): L.append(str(s))

say("=== 被闸门命中的题（标签维度）n(dump)=%d ===" % len(its))
groups = {}
for it in its:
    for t in it.get("tags") or []:
        if t in HARD:
            groups.setdefault(t, []).append(it)

for t, arr in groups.items():
    say("")
    say("#" * 78)
    say("### 标签 <%s> → %d 条" % (t, len(arr)))
    say("#" * 78)
    for it in arr[:14]:
        truth = (it["truth"] or "")
        say("")
        say("--- #%s《%s》 author=%s bm=%s | 汤面%d字 汤底%d字"
            % (it["id"], it["title"], it.get("author"), it.get("bookmarks"), len(it["surface"]), len(truth)))
        say("    tags: " + ", ".join(it.get("tags") or []))
        say("    [汤面] " + (it["surface"] or "")[:260].replace("\n", " "))
        say("    [汤底] " + truth[:700].replace("\n", " "))
    if len(arr) > 14:
        say("")
        say("   ... 其余 %d 条 id: %s" % (len(arr) - 14, [x["id"] for x in arr[14:]]))

io.open(T("tools", "llt_dropped_review.txt"), "w", encoding="utf-8").write("\n".join(L))
print("report -> tools/llt_dropped_review.txt | groups:", {k: len(v) for k, v in groups.items()})
