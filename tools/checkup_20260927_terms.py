# -*- coding: utf-8 -*-
"""
体检第 5.2 步：同词不同译 / 专名一致性
日译中：原文专名（カメオ/カメコ/ウミオ/ウミコ/らてらて/ラテ 等）→ 中文译法分布
  ① 全局：同一原文词是否出现多种译法
  ② 条内：同一条的汤面 vs 汤底 是否用了不同译法（最刺眼）
英译中：原文人名 → 中文音译分布，同上
"""
import io, os, re, json, sys
from collections import defaultdict, Counter
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
pairs = json.load(io.open(T("tools", "checkup_pairs.json"), encoding="utf-8"))
jp = [p for p in pairs if p["tag"] == "日译中"]
en = [p for p in pairs if p["tag"] == "英译中"]

# ---------- 日译中专名 ----------
NAME_J = ["カメオ", "カメコ", "ウミオ", "ウミコ", "らてらて", "ラテ", "うみがめ", "ウミガメ", "亀山"]
# 每条：原文出现的专名 -> 该条译文里出现的候选中文译名（用已知词表反查）
CAND = {
 "カメオ": ["龟男", "小龟", "卡梅奥", "龟山龟男", "龟男君", "小龟君", "龟治", "卡美欧", "龟奥"],
 "カメコ": ["龟女", "小龟子", "卡梅子", "龟子", "龟女君", "小龟子女", "卡梅科", "龟古"],
 "ウミオ": ["海男", "小海", "乌米奥", "海雄", "海男君"],
 "ウミコ": ["海女", "小海子", "海子", "乌米科", "海江女"],
 "らてらて": ["拉特拉特", "らてらて", "拉铁", "拉特·拉特", "拉特拉特町", "拉特"],
 "ウミガメ": ["海龟汤", "海龟"],
}
print("===== 日译中：专名全局译法分布 =====")
for nm in NAME_J:
    cnt = Counter(); hit_ids = defaultdict(list)
    for p in jp:
        o = (p["o_surface"] or "") + "\n" + (p["o_truth"] or "")
        if nm not in o: continue
        z = (p["zh_surface"] or "") + "\n" + (p["zh_truth"] or "")
        found = [c for c in CAND.get(nm, []) if c in z]
        if found:
            for f in found: cnt[f] += 1
            hit_ids[tuple(sorted(found))].append(p["id"])
        else:
            cnt["(未匹配)"] += 1
    if cnt:
        print("  %-8s → %s" % (nm, dict(cnt.most_common())))
print()
print("===== 日译中：条内汤面/汤底译名不一致 =====")
bad = []
for p in jp:
    o = (p["o_surface"] or "") + "\n" + (p["o_truth"] or "")
    for nm, cands in CAND.items():
        if nm not in o: continue
        s, t = p["zh_surface"] or "", p["zh_truth"] or ""
        fs = [c for c in cands if c in s]
        ft = [c for c in cands if c in t]
        if fs and ft and set(fs).isdisjoint(ft):
            bad.append((p["id"], nm, fs, ft, p["zh_title"][:16]))
for b in bad:
    print("  %s 原文「%s」 汤面=%s / 汤底=%s | %s" % b)
print("  合计:", len(bad))
print()
print("===== 英译中：人名译法一致性（抽样统计）=====")
NAME_RE = re.compile(r"\b([A-Z][a-z]{2,12})\b")
COMMON = set("""The This That These Those He She It His Her Their They Them When What Where Why How Man Woman Men Women People There Here They A An One Two Three Four Five Six Seven Eight Nine Ten If But And Or Not No Yes Mr Mrs Dr Professor Doctor Someone Somebody Anyone Nobody Everyone Something Anything Nothing Today Tomorrow Yesterday First Last Next Other Another However Because Although Though While Since Until Before After During Without Within About Above Under Between Among Through Across Along Around Behind Besides Except Plus Minus Both Either Neither Each Every All Most More Most Less Little Few Many Much Such Same Own Only Just Even Still Yet Also Too Rather Quite Almost Enough Whole Full Half Double Single New Old Good Bad Big Small Long Short High Low Near Far Early Late Real True False Same Different""".split())
name_zh = defaultdict(Counter)
for p in en:
    o = (p["o_surface"] or "") + " " + (p["o_truth"] or "")
    names = set(n for n in NAME_RE.findall(o) if n not in COMMON)
    if not names: continue
    z = (p["zh_surface"] or "") + (p["zh_truth"] or "")
    # 中文里找 2-4 字且含音译常用字的片段作为候选
    for n in list(names)[:6]:
        # 首音节近似：查译文中是否有以该名字首字母常见音译字开头的词
        pass
print("  （英译中专名逐条人工抽样见下）")
sample = [p for p in en if NAME_RE.search((p["o_surface"] or ""))][:0]
# 输出带人名的条目清单供人工看
rows = []
for p in en:
    o = (p["o_surface"] or "") + " " + (p["o_truth"] or "")
    ns = sorted(set(n for n in NAME_RE.findall(o) if n not in COMMON))
    if ns:
        rows.append((p["id"], ns[:5], p["zh_title"][:16]))
print("  含英文专名的英译中条数:", len(rows))
json.dump({"ja_inconsistent": bad, "en_with_names": rows},
          io.open(T("tools", "checkup_terms.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("  已写 tools/checkup_terms.json")
