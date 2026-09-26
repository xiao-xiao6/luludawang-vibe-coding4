# -*- coding: utf-8 -*-
"""
体检第 5.1 步：补 boop/Jed 原文对齐（用 en_dump.json）+ 繁译简一简多繁反向检测
"""
import io, os, re, json, sys
from collections import Counter
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass
from opencc import OpenCC
S2T = OpenCC("s2t")
T2S = OpenCC("t2s")
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
rows = json.load(io.open(T("tools", "checkup_all.json"), encoding="utf-8"))
pairs = json.load(io.open(T("tools", "checkup_pairs.json"), encoding="utf-8"))
have = {p["id"] for p in pairs}
byid = {r["id"]: r for r in rows}

# ---- A) en_dump 补对齐 ----
en = json.load(io.open(T("tools", "en_dump.json"), encoding="utf-8"))
n = 0
for e in en:
    i = e.get("id")
    if i in have or i not in byid: continue
    r = byid[i]
    if "英译中" not in r["cats"]: continue
    pairs.append({"id": i, "tag": "英译中", "src": r["src"], "srcNo": r["srcNo"], "cats": r["cats"],
                  "zh_title": r["title"], "zh_surface": r["surface"], "zh_truth": r["truth"],
                  "o_title": e.get("title") or "", "o_surface": e.get("surface") or "",
                  "o_truth": e.get("truth") or "", "o_lab": "en_dump"})
    have.add(i); n += 1
print("en_dump 补对齐:", n, "总对:", len(pairs))
tgt = [r for r in rows if ("英译中" in r["cats"]) and r["id"] not in have]
print("仍无原文的英译中:", len(tgt), [x["id"] for x in tgt[:8]])
io.open(T("tools", "checkup_pairs.json"), "w", encoding="utf-8").write(json.dumps(pairs, ensure_ascii=False))

# ---- B) 繁译简：一简多繁过度简化检测 ----
# 原理：译文(简) --s2t--> 繁 --t2s--> 简' ；若 简' != 简 说明存在歧义字
# 再判：原繁体字是否 = s2t 结果（若是，转换正确）；否则可能是过度简化
AMBIG = set("干髮後鍾餘範託穀薑矽矇矓矚藉髒贍/swiss".replace("/swiss",""))
sus = []
t2s_rows = [p for p in pairs if p["tag"] == "繁译简"]
print("繁译简对:", len(t2s_rows))
for p in t2s_rows:
    z = (p["zh_surface"] or "") + "\n" + (p["zh_truth"] or "")
    o = (p["o_surface"] or "") + "\n" + (p["o_truth"] or "")
    if not z.strip() or not o.strip(): continue
    # 逐字：原繁体 -> 应然简体 vs 实际简体
    conv = T2S.convert(o)
    if len(conv) != len(z):
        sus.append((p["id"], "LEN_DIFF", "长度 %d vs %d" % (len(z), len(conv))))
        continue
    diffs = []
    for a, b, c in zip(o, conv, z):
        # a=原繁 b=标准简 c=实际用字
        if b != c:
            diffs.append((a, b, c))
    if diffs:
        kinds = Counter("%s→应%s/实%s" % d for d in diffs)
        sus.append((p["id"], "CHAR_DIFF", kinds.most_common(6)))
print("繁译简与标准转换有差异的条目:", len(sus))
from collections import Counter
cc = Counter()
for i, k, d in sus: cc[k] += 1
print(dict(cc))
# 高频差异字统计
wc = Counter()
for i, k, d in sus:
    if k == "CHAR_DIFF":
        for item, _ in d: wc[item] += 1
print("Top 差异字:", wc.most_common(25))
json.dump([{"id": s[0], "kind": s[1], "detail": s[2]} for s in sus],
          io.open(T("tools", "checkup_t2s_diff.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("已写 checkup_t2s_diff.json")
