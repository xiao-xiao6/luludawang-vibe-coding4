# -*- coding: utf-8 -*-
"""Stage K-1c 结构体检（只读 tools/llt_fresh_final.json）
找出仍混在定稿里的「非标准海龟汤形态」，为 D7 闸门提供证据。
产出：tools/llt_struct_audit.txt
"""
import io, os, re, json, sys
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)

fresh = json.load(io.open(T("tools", "llt_fresh_final.json"), encoding="utf-8"))
items = fresh["items"]

L = []
def say(s=""): L.append(str(s))

PATS = [
    ("A 互动游戏体", re.compile(r"【\s*回答一覧\s*】|【《\s*ルール\s*》】|《\s*ルール\s*》|亀夫君|亀夫問題|宣言すると正解|エンディング")),
    ("B 出题/测验", re.compile(r"を当ててください|を当てよう|なぞなぞ|クイズ|何でしょう|当ててほしい|を答えよ|求めよ|補完せよ")),
    ("C 填空代称", re.compile(r"〇〇|◯◯|【\s*[A-ZＡ-Ｚ]\s*】|空欄|に入る言葉")),
    ("D 数字暗号", re.compile(r"^[＜<｛{].*[0-9].*[＞>｝}]")),
]

say("定稿总数: %d" % len(items))
hits = {}
byid = {i["id"]: i for i in items}
for name, pat in PATS:
    ids = [i["id"] for i in items if pat.search((i.get("surface") or "") + "\n" + (i.get("truth") or ""))]
    hits[name] = ids
    say("")
    say("=" * 74)
    say("### %s : %d 条" % (name, len(ids)))
    say("=" * 74)
    for lid in ids:
        it = byid[lid]
        say("  #%-6s《%s》面%d 底%d tags=%s" % (
            lid, it["title"][:28], len(it["surface"] or ""), len(it["truth"] or ""),
            ",".join((it.get("tags") or [])[:4])))
        say("     面: " + (it["surface"] or "").replace("\n", " ")[:160])
        say("     底: " + (it["truth"] or "").replace("\n", " ")[:160])

# 数字占比高的
say("")
say("=" * 74)
say("### E 数字/符号占比 >25% 的汤面")
say("=" * 74)
e = []
for it in items:
    s = it.get("surface") or ""
    if len(s) < 20: continue
    d = len(re.findall(r"[0-9０-９①-⑳]", s))
    if d / max(1, len(s)) > 0.25:
        e.append(it["id"])
        say("  #%-6s《%s》面%d 底%d" % (it["id"], it["title"][:28], len(s), len(it["truth"] or "")))
        say("     面: " + s.replace("\n", " ")[:180])
        say("     底: " + (it["truth"] or "").replace("\n", " ")[:180])
say("E 命中: %d 条 %s" % (len(e), e))

u = sorted(set(sum(hits.values(), []) + e))
say("")
say(">>> 四类并集: %d 条" % len(u))
say(">>> " + str(u))

io.open(T("tools", "llt_struct_audit.txt"), "w", encoding="utf-8").write("\n".join(L))
print("定稿 %d | A=%d B=%d C=%d D=%d E=%d | 并集 %d" % (
    len(items), len(hits["A 互动游戏体"]), len(hits["B 出题/测验"]),
    len(hits["C 填空代称"]), len(hits["D 数字暗号"]), len(e), len(u)))
print("report -> tools/llt_struct_audit.txt")
