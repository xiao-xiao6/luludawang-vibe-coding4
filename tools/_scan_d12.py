# -*- coding: utf-8 -*-
"""D12 候选扫描（Phase 2 · 只读）：把「互动/多人游戏体」标记在定稿中的落点全查出来
产出：tools/llt_d12_scan.txt
"""
import io, os, re, json

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)

fresh = json.load(io.open(T("tools", "llt_fresh_final.json"), encoding="utf-8"))
items = fresh["items"]

MARKERS = [
    ("M01 回答権", r"回答権"),
    ("M02 相談欄", r"相談欄"),
    ("M03 鬼の正体", r"鬼の正体"),
    ("M04 失点", r"失点"),
    ("M05 正解マーカー", r"正解マーカー"),
    ("M06 参加宣言", r"参加宣言"),
    ("M07 お題がこっそり", r"お題がこっそり"),
    ("M08 思い浮かべています", r"思い浮かべています"),
    ("M09 質問は１人１回", r"質問は１人１回|質問は1人1回"),
    ("M10 ポイントが一番高い", r"ポイントが一番高い|優勝となり"),
    ("M11 と言ってください", r"と言ってください"),
    ("M12 【回答】", r"【回答】"),
]
COMP = [(n, re.compile(p)) for n, p in MARKERS]

L = []
def say(s=""): L.append(str(s))

say("定稿总数: %d" % len(items))
say("")
hitmap = {}
for i in items:
    s = i.get("surface") or ""
    t = i.get("truth") or ""
    for n, p in COMP:
        m = p.search(s)
        if m:
            hitmap.setdefault(n, []).append((i["id"], i["title"], m.group(0), s))

say("=" * 78)
say("各标记命中（只看汤面，避免汤底解说误伤）")
say("=" * 78)
for n, _ in COMP:
    v = hitmap.get(n, [])
    say("")
    say("### %s : %d 条" % (n, len(v)))
    for lid, title, mg, s in v:
        say("  #%-6s %-30s 命中「%s」" % (lid, title[:30], mg))
        say("      面: " + s.replace("\n", " ")[:200])

# 并集
ids = sorted({x[0] for v in hitmap.values() for x in v})
say("")
say(">>> 标记并集: %d 条 %s" % (len(ids), ids))

io.open(T("tools", "llt_d12_scan.txt"), "w", encoding="utf-8").write("\n".join(L))
print("written tools/llt_d12_scan.txt | 并集 %d 条 %s" % (len(ids), ids))
