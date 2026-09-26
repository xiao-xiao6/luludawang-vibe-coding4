# -*- coding: utf-8 -*-
"""D11 之后：核实 #2952 是否仍在定稿，并查「思い浮かべ」类措辞在定稿中的分布
产出：tools/llt_d11_check.txt
"""
import io, os, re, json

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)

fresh = json.load(io.open(T("tools", "llt_fresh_final.json"), encoding="utf-8"))
items = fresh["items"]
dropped = fresh["dropped"]
byid = {i["id"]: i for i in items}

L = []
def say(s=""): L.append(str(s))

say("定稿 %d | 剔除 %d" % (len(items), len(dropped)))
say("")
say("## #2952 状态")
d = next((x for x in dropped if x["id"] == 2952), None)
say("  #2952 " + ("已剔除 → " + d["why"] if d else "仍在定稿 <<< 需处理"))
say("")
say("## 新剔（D11）明细")
for x in dropped:
    if x["why"].startswith("D11"):
        say("  #%-6s %-30s %s" % (x["id"], x["title"], x["why"]))
say("")
say("## 定稿中「思い浮かべ」出现（核实是否漏网）")
P = re.compile(r"思い浮かべ")
for i in items:
    if P.search(i.get("surface") or "") or P.search(i.get("truth") or ""):
        say("  #%-6s《%s》面%d 底%d tags=%s" % (
            i["id"], i["title"][:28], len(i["surface"] or ""), len(i["truth"] or ""),
            ",".join((i.get("tags") or [])[:4])))
        say("      面: " + (i["surface"] or "").replace("\n", " ")[:170])
say("")
say("## 定稿中「鬼」游戏/多人参与特征（核实是否漏网）")
P2 = re.compile(r"回答権|相談欄|参加者|鬼の正体|１人１回")
for i in items:
    if P2.search(i.get("surface") or ""):
        say("  #%-6s《%s》" % (i["id"], i["title"][:28]))
        say("      面: " + (i["surface"] or "").replace("\n", " ")[:170])
say("")
say("## 全库「物当て/何者当て」残留（应为 0）")
P3 = re.compile(r"物当て|何者であるかを当ててください|誰でしょう|何でしょう")
for i in items:
    if P3.search(i.get("surface") or ""):
        say("  #%-6s《%s》" % (i["id"], i["title"][:28]))
say("(以上为空则清干净)")
say("")
say("## 关键守恒检查")
RESCUED = [15615, 11248, 10912, 15861, 10204, 5040, 9321, 7197, 8296, 6101, 18552, 19659, 19376,
           19167, 18662, 17918, 17619, 17182, 16642, 13695, 14899, 13271, 12715, 12181, 11602,
           11842, 9661, 8694]
keep = {i["id"] for i in items}
gone = [x for x in RESCUED if x not in keep]
say("  D4 救回 28 道中仍在定稿: %d / 28" % (28 - len(gone)))
for g in gone:
    dd = next((x for x in dropped if x["id"] == g), None)
    say("     #%s → %s" % (g, dd["why"] if dd else "?"))
say("  #18752 / #11092 / #7399（判留）状态: %s" % ", ".join(
    "#%s=%s" % (x, "留" if x in keep else "剔") for x in [18752, 11092, 7399]))

io.open(T("tools", "llt_d11_check.txt"), "w", encoding="utf-8").write("\n".join(L))
print("written tools/llt_d11_check.txt")
