# -*- coding: utf-8 -*-
"""Stage K-1d 交叉验收（Phase 2 · 只读）
1) 剔除原因分布 + 新剔条目核对
2) 之前 D4 误杀救回的 28 道是否全部仍在定稿
3) 对定稿重跑「非海龟汤形态」四类模式，确认已清
4) 批次文件与定稿一致性
产出：tools/llt_k1d_verify.txt
"""
import io, os, re, json, sys, glob
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)

L = []
def say(s=""): L.append(str(s))

fresh = json.load(io.open(T("tools", "llt_fresh_final.json"), encoding="utf-8"))
items, dropped, review = fresh["items"], fresh["dropped"], fresh["review"]
dump = json.load(io.open(T("tools", "llt_dump.json"), encoding="utf-8"))
byid = {i["id"]: i for i in dump["items"]}
keep = {i["id"] for i in items}

from collections import Counter
say("=" * 78)
say("1) 定稿 %d 条 | 剔除 %d 条" % (len(items), len(dropped)))
say("=" * 78)
say("剔除原因分布:")
for k, n in Counter(d["why"].split("(")[0].split(":")[0] for d in dropped).most_common():
    say("   %-28s %d" % (k, n))

say("")
say("--- D8/D9/D10/D7 新剔明细（核对是否为真非海龟汤）---")
for d in dropped:
    if d["why"][:3] in ("D8 ", "D9 ", "D10", "D7 "):
        it = byid.get(d["id"], {})
        say("  #%-6s %-30s %s" % (d["id"], d["title"], d["why"]))
        say("      面: " + (it.get("surface") or "").replace("\n", " ")[:120])

say("")
say("=" * 78)
say("2) D4 误杀救回的 28 道是否仍在定稿")
say("=" * 78)
RESCUED = [15615, 11248, 10912, 15861, 10204, 5040, 9321, 7197, 8296, 6101, 18552, 19659, 19376,
           19167, 18662, 17918, 17619, 17182, 16642, 13695, 14899, 13271, 12715, 12181, 11602,
           11842, 9661, 8694]
gone = [x for x in RESCUED if x not in keep]
say("仍在定稿: %d / %d" % (len(RESCUED) - len(gone), len(RESCUED)))
say("被新闸门二次剔除: %s" % (gone if gone else "无"))
for g in gone:
    d = next((x for x in dropped if x["id"] == g), None)
    say("   #%s → %s" % (g, d["why"] if d else "?"))

say("")
say("=" * 78)
say("3) 定稿残留「非海龟汤形态」复查（应为 0）")
say("=" * 78)
PATS = [
    ("A 互动游戏体", re.compile(r"【\s*回答一覧\s*】|【《\s*ルール\s*》】|亀夫君|亀夫問題|宣言すると正解|エンディング")),
    ("B 出题/测验", re.compile(r"を当ててください|を当てよう|なぞなぞ|クイズ|何でしょう|当ててほしい")),
    ("C 填空代称", re.compile(r"〇〇|◯◯|【\s*[A-ZＡ-Ｚ]\s*】|空欄|に入る言葉")),
    ("D 活动会场", re.compile(r"投票会場|記念企画|おぶざいやー|ビブリオバトル|カメオ・デ・イック|ウミガメダービー")),
]
for name, pat in PATS:
    ids = [i["id"] for i in items if pat.search((i.get("surface") or "") + "\n" + (i.get("truth") or ""))]
    say("  %-14s %d 条 %s" % (name, len(ids), ids[:20]))

say("")
say("=" * 78)
say("4) 批次一致性")
say("=" * 78)
bs = sorted(glob.glob(T("tools", "llt_trans_in", "batch_*.json")))
tot, allids = 0, []
for b in bs:
    d = json.load(io.open(b, encoding="utf-8"))
    tot += d["count"]; allids += [x["id"] for x in d["items"]]
    say("  %s %2d 条  (%s ~ %s)" % (os.path.basename(b), d["count"], d["items"][0]["id"], d["items"][-1]["id"]))
say("批次总条数 %d | 定稿 %d | 一致: %s" % (tot, len(items), tot == len(items)))
say("批次 id 与定稿 id 集合一致: %s" % (set(allids) == keep))
say("批次内无重复: %s" % (len(set(allids)) == len(allids)))
say("空字段: 面 %d 底 %d" % (sum(1 for i in items if not (i.get("surface") or "").strip()),
                          sum(1 for i in items if not (i.get("truth") or "").strip())))

say("")
tl = sorted(len(i["truth"]) for i in items)
say("汤底长度 min=%d 中位=%d max=%d" % (tl[0], tl[len(tl) // 2], tl[-1]))
say("汤面合计 %d 字 | 汤底合计 %d 字" % (sum(len(i["surface"]) for i in items),
                                    sum(len(i["truth"]) for i in items)))

io.open(T("tools", "llt_k1d_verify.txt"), "w", encoding="utf-8").write("\n".join(L))
print("verify -> tools/llt_k1d_verify.txt | 定稿 %d | 救回仍在 %d/%d | 批次一致 %s"
      % (len(items), len(RESCUED) - len(gone), len(RESCUED), set(allids) == keep))
