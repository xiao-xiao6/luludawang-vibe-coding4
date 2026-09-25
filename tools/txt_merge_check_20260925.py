# -*- coding: utf-8 -*-
"""
任务4：train_8k.json / test_1.5k.json 与项目题库比对（只读）
- 统计两文件真实题目数（按归一化汤面去重；同一汤面多个汤底单独标记）
- 与项目 972 题（精品 100 + 汤库 872）比对：精确汤面 / 精确汤底 / 近似（包含度/余弦）
- 输出项目里没有的题目清单（繁中原文，供后续汉化并入）
输出：tools/txt_merge_check_20260925_report.txt + .json
"""
import io, re, json, math
from collections import defaultdict, Counter
from zhconv import convert as zconvert

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
ATT = ROOT + r"\.opensquilla\attachments\82855477-6607-472b-85df-85c0617542ac"
OUT_TXT = ROOT + r"\tools\txt_merge_check_20260925_report.txt"
OUT_JSON = ROOT + r"\tools\txt_merge_check_20260925_report.json"

PUNCT = re.compile(r"[\s\u3000，。、！？；：·…—－\-_,\.\!\?\;:\"'“”‘’（）()\[\]【】《》<>{}|/\\~`@#$%^&*+=「」『』]")
def norm(s):
    s = zconvert(s or "", "zh-hans")
    s = PUNCT.sub("", s)
    return s
def bg(s):
    return set(s[k:k+2] for k in range(len(s)-1)) if len(s) >= 2 else (set([s]) if s else set())
def cont(a, b):
    if not a or not b: return 0.0
    return len(a & b) / min(len(a), len(b))
def jac(a, b):
    if not a or not b: return 0.0
    return len(a & b) / len(a | b)

# ---------- 加载项目 ----------
def load_js_array(path, marker):
    s = io.open(path, encoding="utf-8").read()
    i = s.find(marker)
    i = s.find("[", i)
    return json.JSONDecoder().raw_decode(s[i:])[0]

proj = []
for fn, marker, layer in [("js\\data.js", "var PUZZLES", "精品"),
                          ("js\\data-more.js", "var PUZZLES_MORE", "精品"),
                          ("js\\library.public.js", "var SOUP_LIBRARY", "汤库")]:
    arr = load_js_array(ROOT + "\\" + fn, marker)
    for e in arr:
        proj.append({"layer": layer, "id": e.get("id", "?"),
                     "title": e.get("dispTitle") or e.get("title") or "",
                     "s": norm(e.get("surface", "")), "t": norm(e.get("truth", ""))})
proj_s = [(p, bg(p["s"])) for p in proj]
proj_t = [(p, bg(p["t"])) for p in proj]
surface_index = defaultdict(list)
for k, p in enumerate(proj):
    if p["s"]: surface_index[p["s"]].append(k)
truth_index = defaultdict(list)
for k, p in enumerate(proj):
    if p["t"]: truth_index[p["t"]].append(k)

# ---------- 加载附件并去重 ----------
def load_txt(fn):
    arr = json.load(io.open(ATT + "\\" + fn, encoding="utf-8"))
    recs = []
    for e in arr:
        recs.append({"src": fn.split("_")[0], "id": e.get("id"), "title": (e.get("title") or "").strip(),
                     "surface": (e.get("surface") or "").strip(), "bottom": (e.get("bottom") or "").strip()})
    return recs

train = load_txt("553bbf9369a6-train_8k.json")
test = load_txt("2832489f4efb-test_1.5k.json")
allrec = train + test

# 按归一化汤面聚合
puzzles = OrderedDict = {}
for r in allrec:
    ns = norm(r["surface"])
    if not ns: continue
    key = ns
    if key not in puzzles:
        puzzles[key] = {"ns": ns, "surface": r["surface"], "bottoms": [], "titles": set(), "ids": set(), "nrec": 0}
    p = puzzles[key]
    p["nrec"] += 1
    p["ids"].add("%s#%s" % (r["src"], r["id"]))
    if r["title"]: p["titles"].add(r["title"])
    nb = norm(r["bottom"])
    if not any(b[0] == nb for b in p["bottoms"]):
        p["bottoms"].append((nb, r["bottom"]))

P = list(puzzles.values())
P.sort(key=lambda x: -x["nrec"])
multi_bottom = [p for p in P if len(p["bottoms"]) > 1]

# ---------- 比对 ----------
def match_proj(p):
    ns = p["ns"]
    if ns in surface_index:
        return "exact_surface", [proj[k] for k in surface_index[ns]][:3]
    hits = []
    for q in p["bottoms"]:
        if q[0] in truth_index:
            hits += [proj[k] for k in truth_index[q[0]]]
    if hits:
        return "exact_truth", hits[:3]
    # 近似：包含度
    bs = bg(ns)
    best = (0, None)
    for p2, bp in proj_s:
        c = cont(bs, bp)
        if c > best[0]: best = (c, p2)
    if best[0] >= 0.80 and len(bs) >= 10:
        return "near_surface", [best[1]]
    bt_all = set().union(*[bg(q[0]) for q in p["bottoms"]]) if p["bottoms"] else set()
    bestt = (0, None)
    for p2, bp in proj_t:
        c = cont(bt_all, bp)
        if c > bestt[0]: bestt = (c, p2)
    if bestt[0] >= 0.80 and len(bt_all) >= 10:
        return "near_truth", [bestt[1]]
    return "missing", []

cat_stat = Counter()
missing_list = []
matched_list = []
for p in P:
    cat, hits = match_proj(p)
    p["cat"] = cat
    p["hits"] = [{"layer": h["layer"], "id": h["id"], "title": h["title"]} for h in hits]
    cat_stat[cat] += 1
    if cat == "missing":
        missing_list.append(p)
    else:
        matched_list.append(p)

# 缺失题里再自查：是否与 train 内其他题近似（txt 自身也有相似题）
miss_pairs = []
for a in range(len(missing_list)):
    ba = bg(missing_list[a]["ns"])
    for b in range(a+1, len(missing_list)):
        bb = bg(missing_list[b]["ns"])
        if cont(ba, bb) >= 0.72 or jac(ba, bb) >= 0.55:
            miss_pairs.append((missing_list[a]["surface"][:30], missing_list[b]["surface"][:30]))

# ---------- 输出 ----------
out = io.open(OUT_TXT, "w", encoding="utf-8")
W = out.write
W("附件数据集 × 项目题库比对报告（只读）\n")
W("=" * 80 + "\n\n")
W("记录数：train=%d  test=%d  合计=%d\n" % (len(train), len(test), len(train) + len(test)))
W("按归一化汤面去重后的真实题目数：%d\n" % len(P))
W("  其中同一汤面挂多个汤底：%d 题（并入时需人工选底）\n" % len(multi_bottom))
W("  test 文件独有汤面数（train 里没有的）：%d\n" % len(set(norm(r['surface']) for r in test) - set(norm(r['surface']) for r in train)))
W("\n与项目 972 题比对结果：\n")
W("  汤面完全相同（已有）: %d\n" % cat_stat["exact_surface"])
W("  汤面不同但汤底完全相同（已有换皮）: %d\n" % cat_stat["exact_truth"])
W("  汤面近似（包含度>=0.80）: %d\n" % cat_stat["near_surface"])
W("  汤底近似（包含度>=0.80）: %d\n" % cat_stat["near_truth"])
W("  项目完全没有（可并入）: %d\n\n" % cat_stat["missing"])
W("  缺失题内部互相近似的对数: %d\n\n" % len(miss_pairs))

W("-- 已有明细（前 80）--\n")
for p in matched_list[:80]:
    hit = p["hits"][0] if p["hits"] else {}
    W("  [%s] %s | 命中 %s/%s | %s\n" % (p["cat"], (list(p["titles"])[0] if p["titles"] else "无题")[:14],
      hit.get("layer", "?"), hit.get("id", "?")[:20], p["surface"][:36]))
W("\n-- 项目没有的题（全部 %d 道，繁中原文）--\n" % len(missing_list))
for k, p in enumerate(missing_list, 1):
    tl = "、".join(list(p["titles"])[:2]) if p["titles"] else "无题"
    W("%3d) [%d条记录|%d种汤底] %s\n" % (k, p["nrec"], len(p["bottoms"]), tl))
    W("     面: %s\n" % p["surface"][:72])
    W("     底: %s\n" % p["bottoms"][0][1][:72])
out.close()

json.dump({
    "train_records": len(train), "test_records": len(test),
    "unique_puzzles": len(P), "multi_bottom": len(multi_bottom),
    "cat_stat": dict(cat_stat),
    "matched": [{"surface": p["surface"], "cat": p["cat"], "hits": p["hits"]} for p in matched_list],
    "missing": [{"title": list(p["titles"])[0] if p["titles"] else "", "nrec": p["nrec"],
                 "nbottoms": len(p["bottoms"]), "surface": p["surface"],
                 "bottoms": [b[1] for b in p["bottoms"]]} for p in missing_list],
}, io.open(OUT_JSON, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

print("DONE records train=%d test=%d | unique puzzles=%d (multi-bottom=%d)" % (len(train), len(test), len(P), len(multi_bottom)))
print("     exact_surface=%d exact_truth=%d near_surface=%d near_truth=%d MISSING=%d" %
      (cat_stat["exact_surface"], cat_stat["exact_truth"], cat_stat["near_surface"], cat_stat["near_truth"], cat_stat["missing"]))
