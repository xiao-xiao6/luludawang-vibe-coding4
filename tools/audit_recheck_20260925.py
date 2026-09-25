# -*- coding: utf-8 -*-
"""
深海汤屋 · 汤库 872 题复检（2026-09-25 清洗后再检查，只读，不改任何数据）
检查项：
  [1] 相似/重复 —— 四层：
      T1 归一化后汤面/汤底完全相同
      T2 近重复（bigram 强重合 或 TF-IDF 余弦>=0.72）
      T3 疑似同故事改写（余弦 0.30~0.72 且 共享稀有词指纹>=5）
      T4 同名题（剥掉"019 · "编号前缀后标题相同）
  [2] 非简体中文（英文 / 中英混杂 / 繁体，繁体用 zhconv 完整判定）
  [3] 污染（代码/URL/AI指令/模板/HTML实体/零宽/乱码/引流/汤底泄漏/复读/空格异常）
      + 汤面-汤底低重合候选
输出：tools/audit_recheck_20260925_report.txt + .json
"""
import io, re, json, math
from collections import defaultdict, Counter
from zhconv import convert as zconvert

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
LIB = ROOT + r"\js\library.public.js"
OUT_TXT = ROOT + r"\tools\audit_recheck_20260925_report.txt"
OUT_JSON = ROOT + r"\tools\audit_recheck_20260925_report.json"

src = io.open(LIB, encoding="utf-8").read()
i = src.find("var SOUP_LIBRARY")
i = src.find("[", i)
data, _end = json.JSONDecoder().raw_decode(src[i:])
N = len(data)

def field(e, name, default=""):
    v = e.get(name, default)
    return v if isinstance(v, str) else default

# ---------- 繁简 ----------
def to_s(s):
    return zconvert(s, "zh-hans")

AMBIG = set("著乾瞭台彩範儘臓髒")  # 简繁两可/规范简体，不计入繁体
def trad_chars(s):
    out = []
    for ch in s:
        if "\u4e00" <= ch <= "\u9fff" and ch not in AMBIG:
            c = zconvert(ch, "zh-hans")
            if c != ch and len(c) == 1:
                out.append(ch)
    return out

PUNCT = re.compile(r"[\s\u3000，。、！？；：·…—－\-_,\.\!\?\;:\"'“”‘’（）()\[\]【】《》<>{}|/\\~`@#$%^&*+=「」『』]")
def norm(s):
    s = to_s(s)
    s = PUNCT.sub("", s)
    return s

def bigrams(s):
    return set(s[k:k+2] for k in range(len(s)-1)) if len(s) >= 2 else (set([s]) if s else set())

def bigrams_list(s):
    return [s[k:k+2] for k in range(len(s)-1)] if len(s) >= 2 else ([s] if s else [])

def jac(a, b):
    if not a or not b: return 0.0
    return len(a & b) / len(a | b)

def cont(a, b):
    if not a or not b: return 0.0
    return len(a & b) / min(len(a), len(b))

# ---------- 语言 ----------
def lang_of(s):
    cjk = sum(1 for ch in s if "\u4e00" <= ch <= "\u9fff")
    lat = sum(1 for ch in s if ch.isascii() and ch.isalpha())
    total = cjk + lat
    if total == 0:
        return "empty"
    if cjk == 0 and lat > 0:
        return "en"
    if lat / max(1, total) >= 0.5:
        return "mixed-latin"
    return "zh"

# ---------- [2] 语言检查 ----------
en_list, mixed_list = [], []
trad_full, trad_part, trad_trace = [], [], []
for e in data:
    sid = e.get("id", "?")
    title = field(e, "dispTitle") or field(e, "title") or sid
    s, t = field(e, "surface"), field(e, "truth")
    ls, lt = lang_of(s), lang_of(t)
    rec = {"id": sid, "title": title, "lang_s": ls, "lang_t": lt, "snippet": (s[:60] or t[:60])}
    if ls == "en" or lt == "en":
        en_list.append(rec)
    elif ls == "mixed-latin" or lt == "mixed-latin":
        mixed_list.append(rec)
    cjks = sum(1 for ch in s if "\u4e00" <= ch <= "\u9fff")
    cjkt = sum(1 for ch in t if "\u4e00" <= ch <= "\u9fff")
    ts_, tt_ = trad_chars(s), trad_chars(t)
    ratio = max(len(ts_) / max(1, cjks), len(tt_) / max(1, cjkt))
    if ratio >= 0.20:
        trad_full.append({**rec, "ratio": round(ratio, 3), "chars": "".join(sorted(set(ts_ + tt_)))[:40]})
    elif ratio >= 0.03:
        trad_part.append({**rec, "ratio": round(ratio, 3), "chars": "".join(sorted(set(ts_ + tt_)))[:40]})
    elif ratio > 0:
        trad_trace.append({**rec, "ratio": round(ratio, 4), "chars": "".join(sorted(set(ts_ + tt_)))[:40]})

# ---------- [1] 相似/重复 ----------
entries = []
for e in data:
    entries.append({
        "id": e.get("id", "?"),
        "title": field(e, "dispTitle") or field(e, "title"),
        "ns": norm(field(e, "surface")),
        "nt": norm(field(e, "truth")),
        "surface": field(e, "surface"),
        "truth": field(e, "truth"),
    })
bs = [bigrams(x["ns"]) for x in entries]
bt = [bigrams(x["nt"]) for x in entries]
comb = [x["ns"] + x["nt"] for x in entries]

# TF-IDF 余弦
tv = [Counter(bigrams_list(t)) for t in comb]
dfc = Counter()
for c in tv:
    for g in c: dfc[g] += 1
IDF = {g: math.log(N / (1 + v)) for g, v in dfc.items()}
VECN = [math.sqrt(sum((v * IDF.get(g, 0)) ** 2 for g, v in c.items())) for c in tv]
def cos_doc(a, b):
    ca, cb = tv[a], tv[b]
    if len(ca) > len(cb): ca, cb = cb, ca
    s = sum(v * cb.get(g, 0) * (IDF.get(g, 0) ** 2) for g, v in ca.items())
    return s / (VECN[a] * VECN[b]) if VECN[a] and VECN[b] else 0.0

# 稀有词指纹：只出现在 <=8 篇里的双字中文词
rare = [set(x for x in bigrams(comb[k]) if dfc[x] <= 8 and re.fullmatch(r"[\u4e00-\u9fff]{2}", x)) for k in range(N)]
inv_r = defaultdict(list)
for k, r in enumerate(rare):
    for x in r: inv_r[x].append(k)
pairshare = Counter()
for x, lst in inv_r.items():
    if len(lst) > 60: continue
    lst = sorted(set(lst))
    for a in range(len(lst)):
        for b in range(a + 1, len(lst)):
            pairshare[(lst[a], lst[b])] += 1

# bigram 强重合候选
def candidate_pairs(vecs):
    idx = defaultdict(list)
    for k, v in enumerate(vecs):
        for g in v:
            idx[g].append(k)
    pairs = set()
    for g, lst in idx.items():
        if len(lst) > 400: continue
        lst = sorted(set(lst))
        for a in range(len(lst)):
            for b in range(a + 1, len(lst)):
                pairs.add((lst[a], lst[b]))
    return pairs

cands = candidate_pairs(bs) | candidate_pairs(bt)
big_pairs = []
for (a, b) in cands:
    if a == b: continue
    js, cs = jac(bs[a], bs[b]), cont(bs[a], bs[b])
    jt, ct = jac(bt[a], bt[b]), cont(bt[a], bt[b])
    same_title = entries[a]["title"] and entries[a]["title"] == entries[b]["title"]
    hit = None
    if js >= 0.55 or cs >= 0.72: hit = "surface"
    elif jt >= 0.50 or ct >= 0.70: hit = "truth"
    elif same_title and (js >= 0.30 or jt >= 0.30): hit = "title+weak"
    if hit:
        big_pairs.append({"a": entries[a]["id"], "b": entries[b]["id"], "kind": hit,
                          "js": round(js, 3), "cs": round(cs, 3), "jt": round(jt, 3), "ct": round(ct, 3),
                          "ta": entries[a]["title"], "tb": entries[b]["title"]})
big_pairs.sort(key=lambda r: -(max(r["js"], r["jt"])))

# 余弦候选
idxmap = defaultdict(list)
for k, c in enumerate(tv):
    for g in c:
        if IDF.get(g, 0) >= 2.0:
            idxmap[g].append(k)
cos_cands = set()
for g, lst in idxmap.items():
    if len(lst) > 120: continue
    lst = sorted(set(lst))
    for a in range(len(lst)):
        for b in range(a + 1, len(lst)):
            cos_cands.add((lst[a], lst[b]))
cos_t2, cos_t3 = [], []
for (a, b) in cos_cands:
    v = cos_doc(a, b)
    if v >= 0.72:
        cos_t2.append({"a": entries[a]["id"], "b": entries[b]["id"], "cos": round(v, 3),
                       "rare": pairshare[(a, b)], "tier": "T2-cos", "ta": entries[a]["title"], "tb": entries[b]["title"]})
    elif v >= 0.30 and pairshare[(a, b)] >= 5:
        cos_t3.append({"a": entries[a]["id"], "b": entries[b]["id"], "cos": round(v, 3),
                       "rare": pairshare[(a, b)], "tier": "T3-samestory", "ta": entries[a]["title"], "tb": entries[b]["title"]})
cos_t2.sort(key=lambda r: -r["cos"])
cos_t3.sort(key=lambda r: -r["cos"])

# 同名组（剥编号前缀）
def title_key(t):
    t = re.sub(r"^[\d#]+\s*[·.、\-]\s*", "", t)
    t = re.sub(r"^无题\s*[·.]\s*", "", t)
    return norm(t)
title_groups = defaultdict(list)
for x in entries:
    tk = title_key(x["title"])
    if tk and len(tk) >= 2: title_groups[tk].append(x["id"])
dup_title = {k: v for k, v in title_groups.items() if len(v) > 1}

# 聚类：T1/T2(bigram+cos) 为强边；T3 为弱边（单独统计，不入强簇以免过并）
strong_edges = [p for p in big_pairs if p["kind"] in ("surface", "truth")] + cos_t2
parent = list(range(N))
def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]; x = parent[x]
    return x
def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb: parent[rb] = ra
kmap = {entries[k]["id"]: k for k in range(N)}
for p in strong_edges:
    union(kmap[p["a"]], kmap[p["b"]])
cluster_map = defaultdict(set)
for p in strong_edges:
    r = find(kmap[p["a"]])
    cluster_map[r].add(p["a"]); cluster_map[r].add(p["b"])
cluster_list = [{"root": entries[r]["title"], "size": len(m), "ids": sorted(m)} for r, m in cluster_map.items()]
cluster_list.sort(key=lambda c: -c["size"])
dup_involved = sum(c["size"] for c in cluster_list)
dup_removable = sum(c["size"] - 1 for c in cluster_list)

# T3 弱边合并后的"宽口径"簇（把 T2 簇 + T3 边再并一次，给出上限估计）
for p in cos_t3:
    union(kmap[p["a"]], kmap[p["b"]])
wide_map = defaultdict(set)
for p in strong_edges + cos_t3:
    r = find(kmap[p["a"]])
    wide_map[r].add(p["a"]); wide_map[r].add(p["b"])
wide_list = [{"root": entries[r]["title"], "size": len(m), "ids": sorted(m)} for r, m in wide_map.items()]
wide_list.sort(key=lambda c: -c["size"])
wide_involved = sum(c["size"] for c in wide_list)
wide_removable = sum(c["size"] - 1 for c in wide_list)

# 完全相同
exact_surface = defaultdict(list)
exact_truth = defaultdict(list)
for x in entries:
    if x["ns"]: exact_surface[x["ns"]].append(x["id"])
    if x["nt"]: exact_truth[x["nt"]].append(x["id"])
dup_s = {k: v for k, v in exact_surface.items() if len(v) > 1}
dup_t = {k: v for k, v in exact_truth.items() if len(v) > 1}

# ---------- [3] 污染 ----------
CODE_PAT = re.compile(
    r"(function\s*\(|=>\s*[\{\(]|console\.log|document\.|window\.|require\(|import\s+|export\s+"
    r"|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=|\bdef\s+\w+\(|\bprint\(|json\.loads"
    r"|<\s*/?\s*(html|body|div|span|script|p|br|img|a)\b|SELECT\s+\w+\s+FROM|\bclass\s+\w+\s*[:\{]"
    r"|\breturn\s+[\{\"]|sys\.argv|os\.path|subprocess|requests\.get)", re.I)
URL_PAT = re.compile(r"https?://|www\.|\.com\b|\.net\b|\.top\b|\.org\b|\.cn\b|baidu|tieba|zhihu|douyin|bilibili", re.I)
AICMD_PAT = re.compile(
    r"(你是\s*(一)?(个|位)?\s*(AI|人工智能|助手|汤主|语言模型)|作为(一个|位)?\s*(AI|助手|语言模型)"
    r"|对不起[，,].{0,8}(无法|不能|抱歉)|我无法|作为一个|指令[:：]|prompt[:：]|system\s*prompt"
    r"|请(按|按照|根据).{0,10}(格式|要求).{0,10}(输出|回答)|以下(是|为).{0,6}(提示词|指令|prompt)"
    r"|忽略(上面|以上|之前).{0,6}(指令|要求)|忽略所有|扮演|角色设定[:：]|设定[:：]你)", re.I)
TEMPLATE_PAT = re.compile(r"(\{\{|\}\}|\$\{|%\s*(if|for|endfor|endif)|<%|占位|placeholder|TODO|FIXME|XXX(?![A-Za-z])|\bTBD\b|待补充|暂无汤底|（无汤底）|\(无汤底\)?)", re.I)
BBCode_PAT = re.compile(r"\[(/?)(b|i|u|color|url|img|r|c|y|t|st)\]", re.I)
GAMEHELP_PAT = re.compile(r"(玩法说明|游戏规则|主持人只能回答|提问时|本(世界|游戏)内|问卷二维码|上传海龟汤|选择子条目|合集容器)", re.I)
ENTITY_PAT = re.compile(r"&(amp|lt|gt|quot|#39|#\d+);|&#x[0-9a-fA-F]+;")
ZW_PAT = re.compile(r"[\u200b\u200c\u200d\u2060\ufeff\x00-\x08\x0b\x0c\x0e-\x1f]")
MOJI_PAT = re.compile(r"(Ã[\x80-\xbf°]|â€|锟斤拷|烫烫烫|\ufffd)")
CONTACT_PAT = re.compile(r"(QQ\s*[:：]?\d{5,}|\d{8,}@qq|微信号|加微信|加群|进群|公众号|扫码关注|二维码|私信我)", re.I)
LEAK_PAT = re.compile(r"(汤底[:：]|答案是[:：]|真相是[:：])", re.I)
JUNK_REPEAT_PAT = re.compile(r"(\S)\1{5,}")
SENT_SPLIT = re.compile(r"[。！？!?；;\n]")

contaminated = []
for e in data:
    sid = e.get("id", "?")
    s, t = field(e, "surface"), field(e, "truth")
    title = field(e, "dispTitle") or field(e, "title") or sid
    flags = []
    for name, pat in (("code", CODE_PAT), ("url", URL_PAT), ("ai_cmd", AICMD_PAT),
                      ("template", TEMPLATE_PAT), ("bbcode", BBCode_PAT), ("gamehelp", GAMEHELP_PAT),
                      ("html_entity", ENTITY_PAT), ("zero_width_ctrl", ZW_PAT), ("mojibake", MOJI_PAT),
                      ("contact_spam", CONTACT_PAT), ("truth_leak_in_surface", LEAK_PAT)):
        ms = pat.search(s); mt = pat.search(t)
        if ms: flags.append(("surface", name, s[max(0, ms.start()-15):ms.end()+25]))
        if mt: flags.append(("truth", name, t[max(0, mt.start()-15):mt.end()+25]))
    if s and t and (norm(s) in norm(t) or norm(t) in norm(s)) and len(norm(s)) >= 15:
        flags.append(("both", "truth_repeats_surface", ""))
    if len(norm(s)) < 8:
        flags.append(("surface", "too_short", s))
    if len(norm(t)) < 10:
        flags.append(("truth", "truth_too_short", t))
    if JUNK_REPEAT_PAT.search(s) or JUNK_REPEAT_PAT.search(t):
        flags.append(("both", "junk_repeat", ""))
    for fld, txt in (("surface", s), ("truth", t)):
        parts = [norm(x) for x in SENT_SPLIT.split(txt) if len(norm(x)) >= 6]
        cc = Counter(parts)
        for k, v in cc.items():
            if v >= 3:
                flags.append((fld, "sentence_repeat_x%d" % v, k[:30]))
                break
    if s != s.strip() or t != t.strip() or "  " in s or "  " in t or "\u3000" in s or "\u3000" in t:
        flags.append(("both", "space_anomaly", ""))
    ls, lt = lang_of(s), lang_of(t)
    if (ls == "zh" and lt == "en") or (ls == "en" and lt == "zh"):
        flags.append(("both", "lang_mismatch", "s=%s t=%s" % (ls, lt)))
    if flags:
        contaminated.append({"id": sid, "title": title, "flags": flags})

mismatch = []
for e in data:
    s, t = norm(field(e, "surface")), norm(field(e, "truth"))
    if len(s) < 10 or len(t) < 10: continue
    jv = jac(bigrams(s), bigrams(t))
    cv = cont(bigrams(s), bigrams(t))
    if jv < 0.02 and cv < 0.045:
        mismatch.append({"id": e.get("id", "?"), "title": field(e, "dispTitle") or field(e, "title"),
                         "jac": round(jv, 4), "cont": round(cv, 4),
                         "surface": field(e, "surface")[:70], "truth": field(e, "truth")[:70]})
mismatch.sort(key=lambda r: r["jac"])

# ---------- 输出 ----------
out = io.open(OUT_TXT, "w", encoding="utf-8")
W = out.write
W("深海汤屋 · 汤库 %d 题复检报告（2026-09-25 清洗后，只读）\n" % N)
W("=" * 80 + "\n\n")

W("[1] 相似 / 重复\n")
W("  T1 汤面完全相同(归一化): %d 组（涉及 %d 条）\n" % (len(dup_s), sum(len(v) for v in dup_s.values())))
W("  T1 汤底完全相同(归一化): %d 组（涉及 %d 条）\n" % (len(dup_t), sum(len(v) for v in dup_t.values())))
W("  T2 bigram 强重合对: %d 对；T2 余弦>=0.72 对: %d 对\n" % (len([p for p in big_pairs if p['kind'] in ('surface','truth')]), len(cos_t2)))
W("  T3 疑似同故事改写对（0.30<=余弦<0.72 且 稀有指纹>=5）: %d 对\n" % len(cos_t3))
W("  T4 同名标题组: %d 组（涉及 %d 条）\n" % (len(dup_title), sum(len(v) for v in dup_title.values())))
W("  强口径重复簇（T1+T2）: %d 簇，涉及 %d 条，可精简 %d 条\n" % (len(cluster_list), dup_involved, dup_removable))
W("  宽口径重复簇（T1+T2+T3）: %d 簇，涉及 %d 条，可精简 %d 条\n" % (len(wide_list), wide_involved, wide_removable))
W("\n  -- 宽口径簇明细 --\n")
for c in wide_list:
    W("  [簇 %d 条] 代表: %s\n" % (c["size"], c["root"]))
    for mid in c["ids"]:
        ent = next(x for x in entries if x["id"] == mid)
        W("      %s | %s | 面: %s\n" % (mid, ent["title"], ent["surface"][:48]))
W("\n  -- T4 同名组明细 --\n")
for k, v in sorted(dup_title.items(), key=lambda kv: -len(kv[1])):
    W("  [%d 条] %s\n" % (len(v), k))
    for mid in v:
        ent = next(x for x in entries if x["id"] == mid)
        W("      %s | %s\n" % (mid, ent["surface"][:48]))
W("\n  -- T3 疑似同故事对明细 --\n")
for p in cos_t3:
    W("  cos%.2f rare%d %s->%s | %s | %s\n" % (p["cos"], p["rare"], p["a"], p["b"], p["ta"][:18], p["tb"][:18]))
W("\n  -- T2 余弦对明细（前 300）--\n")
for p in cos_t2[:300]:
    W("  cos%.2f rare%d %s->%s | %s | %s\n" % (p["cos"], p["rare"], p["a"], p["b"], p["ta"][:18], p["tb"][:18]))
W("\n")

W("[2] 非简体中文\n")
W("  英文题（汤面或汤底纯拉丁）: %d 条\n" % len(en_list))
for r in en_list:
    W("      %s | %s | %s\n" % (r["id"], r["title"][:24], r["snippet"][:56]))
W("  中英混杂: %d 条\n" % len(mixed_list))
for r in mixed_list:
    W("      %s | %s | %s\n" % (r["id"], r["title"][:24], r["snippet"][:56]))
W("  繁体·整篇为主（>=20%%）: %d 条\n" % len(trad_full))
for r in trad_full:
    W("      %s | %s | 繁占比%.2f | 例字:%s | %s\n" % (r["id"], r["title"][:24], r["ratio"], r["chars"], r["snippet"][:40]))
W("  繁体·混有（3%%~20%%）: %d 条\n" % len(trad_part))
for r in trad_part:
    W("      %s | %s | 繁占比%.2f | 例字:%s | %s\n" % (r["id"], r["title"][:24], r["ratio"], r["chars"], r["snippet"][:40]))
W("  繁体·零星残留（<3%%）: %d 条\n" % len(trad_trace))
for r in trad_trace:
    W("      %s | %s | 繁占比%.3f | 例字:%s\n" % (r["id"], r["title"][:24], r["ratio"], r["chars"]))
W("\n")

W("[3] 污染 / 不匹配\n")
W("  命中污染/异常特征的条目: %d 条\n" % len(contaminated))
flagstat = Counter()
for r in contaminated:
    for f in r["flags"]:
        flagstat[f[1]] += 1
W("  特征分布: %s\n" % dict(flagstat))
for r in contaminated:
    W("      %s | %s\n" % (r["id"], r["title"][:26]))
    for f in r["flags"]:
        W("          [%s] %s :: %s\n" % (f[0], f[1], f[2].replace("\n", " ")[:70]))
W("\n  汤面-汤底低重合候选（人工复核用）: %d 条\n" % len(mismatch))
for r in mismatch:
    W("      %s | %s | j%.3f c%.3f\n          面: %s\n          底: %s\n" %
      (r["id"], r["title"][:24], r["jac"], r["cont"], r["surface"], r["truth"]))
out.close()

json.dump({
    "N": N,
    "dup_surface_groups": dup_s, "dup_truth_groups": dup_t, "dup_title_groups": dup_title,
    "big_pairs": big_pairs, "cos_t2": cos_t2, "cos_t3": cos_t3,
    "clusters_strong": cluster_list, "clusters_wide": wide_list,
    "dup_involved": dup_involved, "dup_removable": dup_removable,
    "wide_involved": wide_involved, "wide_removable": wide_removable,
    "en": en_list, "mixed": mixed_list,
    "trad_full": trad_full, "trad_part": trad_part, "trad_trace": trad_trace,
    "contaminated": contaminated, "mismatch_low_overlap": mismatch,
}, io.open(OUT_JSON, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

print("DONE N=%d" % N)
print("  [1] T1面=%d组 T1底=%d组 | T2bigram=%d对 T2cos=%d对 | T3=%d对 | T4同名=%d组" %
      (len(dup_s), len(dup_t), len([p for p in big_pairs if p['kind'] in ('surface','truth')]), len(cos_t2), len(cos_t3), len(dup_title)))
print("      强口径簇=%d 涉及=%d 可精简=%d | 宽口径簇=%d 涉及=%d 可精简=%d" %
      (len(cluster_list), dup_involved, dup_removable, len(wide_list), wide_involved, wide_removable))
print("  [2] en=%d mixed=%d trad_full=%d trad_part=%d trad_trace=%d" %
      (len(en_list), len(mixed_list), len(trad_full), len(trad_part), len(trad_trace)))
print("  [3] tainted=%d mismatch=%d" % (len(contaminated), len(mismatch)))
