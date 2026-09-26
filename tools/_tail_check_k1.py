# -*- coding: utf-8 -*-
"""Stage K-1e 尾部嫌疑复核（Phase 2 · 只读）
逐条验明 6 条「出题/填空味」嫌疑：#18752 / #2952 / #11092 / #10833 / #10569 / #7399
产出：tools/llt_tail6_report.txt（UTF-8，ASCII 打印，避免控制台编码炸）
"""
import io, os, re, json, sys

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)

fresh = json.load(io.open(T("tools", "llt_fresh_final.json"), encoding="utf-8"))
byid = {i["id"]: i for i in fresh["items"]}

PATS = [
    ("B1 を当ててください", r"を当ててください"),
    ("B2 を当て", r"を当て"),
    ("B3 当ててほしい", r"当ててほしい"),
    ("B4 当ててくれ", r"当ててくれ"),
    ("B5 なぞなぞ", r"なぞなぞ"),
    ("B6 クイズ", r"クイズ"),
    ("B7 何でしょう", r"何でしょう"),
    ("B8 を答えよ", r"を答えよ"),
    ("B9 求めよ", r"求めよ"),
    ("B10 当ててください", r"当ててください"),
    ("C1 〇〇", r"〇〇"),
    ("C2 ◯◯", r"◯◯"),
    ("C3 【A】式", r"【\s*[A-ZＡ-Ｚ]\s*】"),
    ("C4 空欄", r"空欄"),
    ("C5 に入る言葉", r"に入る言葉"),
]
COMP = [(n, re.compile(p)) for n, p in PATS]

L = []
def say(s=""): L.append(str(s))

say("定稿总数: %d" % len(fresh["items"]))
say("=" * 78)

TARGETS = [18752, 2952, 11092, 10833, 10569, 7399]
for lid in TARGETS:
    it = byid.get(lid)
    if not it:
        say("#%s 不在定稿中" % lid)
        say("")
        continue
    s = it.get("surface") or ""
    t = it.get("truth") or ""
    hit = [n for n, p in COMP if p.search(s) or p.search(t)]
    say("#%s | 面%d 底%d | bm=%s" % (lid, len(s), len(t), it.get("bookmarks")))
    say("   title: " + (it.get("title") or ""))
    say("   tags : " + ", ".join((it.get("tags") or [])[:8]))
    say("   命中 : " + (", ".join(hit) if hit else "(none)"))
    say("   [S] " + s.replace("\n", " ")[:400])
    say("   [T] " + t.replace("\n", " ")[:400])
    say("-" * 78)

io.open(T("tools", "llt_tail6_report.txt"), "w", encoding="utf-8").write("\n".join(L))
print("report written: tools/llt_tail6_report.txt | chars=%d | targets=%d" % (len("\n".join(L)), len(TARGETS)))
