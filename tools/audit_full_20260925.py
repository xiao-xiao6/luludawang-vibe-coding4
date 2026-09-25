# -*- coding: utf-8 -*-
"""
深海汤屋 · 汤库 872 题全量体检（只读，不改任何数据）
检查项：
  [1] 汤面/汤底 相似或重复（含标题相同簇）
  [2] 非简体中文（繁体 / 英文 / 其它）
  [3] 汤面-汤底不匹配 & 污染（代码/AI指令/URL/模板残留/汤底复读汤面…）
输出：tools/audit_full_20260925_report.txt + .json
"""
import io, re, json, sys
from collections import defaultdict

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
LIB = ROOT + r"\js\library.public.js"
OUT_TXT = ROOT + r"\tools\audit_full_20260925_report.txt"
OUT_JSON = ROOT + r"\tools\audit_full_20260925_report.json"

# ---------- 加载 ----------
src = io.open(LIB, encoding="utf-8").read()
i = src.find("var SOUP_LIBRARY")
i = src.find("[", i)
dec = json.JSONDecoder()
data, _end = dec.raw_decode(src[i:])
N = len(data)

def field(e, name, default=""):
    v = e.get(name, default)
    return v if isinstance(v, str) else default

# ---------- 繁简归一 ----------
T2S = {
"湯":"汤","龜":"龟","來":"来","說":"说","時":"时","點":"点","麼":"么","樣":"样","們":"们","經":"经","還":"还","沒":"没","於":"于","後":"后","發":"发","個":"个","為":"为","東":"东","車":"车","馬":"马","鳥":"鸟","龍":"龙","鳳":"凤","門":"门","問":"问","間":"间","開":"开","關":"关","陽":"阳","陰":"阴","雲":"云","電":"电","書":"书","畫":"画","聲":"声","聽":"听","覺":"觉","讓":"让","誰":"谁","這":"这","那":"那","裡":"里","兒":"儿","號":"号","頭":"头","見":"见","觀":"观","記":"记","認":"认","論":"论","設":"设","語":"语","請":"请","識":"识","護":"护","豐":"丰","貴":"贵","隱":"隐","雙":"双","雜":"杂","難":"难","願":"愿","類":"类","體":"体","驗":"验","證":"证","試":"试","讀":"读","變":"变","選":"选","遠":"远","適":"适","遭":"遭","邊":"边","進":"进","連":"连","遊":"游","運":"运","道":"道","遺":"遗","釋":"释","鑒":"鉴","長":"长","隊":"队","階":"阶","隨":"随","險":"险","風":"风","飛":"飞","飯":"饭","飼":"饲","駐":"驻","駕":"驾","騎":"骑","驚":"惊","骨":"骨","鬥":"斗","魚":"鱼","鳴":"鸣","鴻":"鸿","鵬":"鹏","麗":"丽","麥":"麦","黨":"党","齊":"齐","齒":"齿","實":"实","寫":"写","詞":"词","詩":"诗","誤":"误","調":"调","談":"谈","謝":"谢","議":"议","護":"护","報":"报","場":"场","塊":"块","塗":"涂","塚":"冢","夢":"梦","奪":"夺","奮":"奋","婦":"妇","嫻":"娴","嬋":"婵","嬌":"娇","嬤":"嬷","孫":"孙","學":"学","寧":"宁","寶":"宝","將":"将","專":"专","尊":"尊","對":"对","尋":"寻","導":"导","爾":"尔","塵":"尘","層":"层","屬":"属","嶄":"崭","嶺":"岭","巰":"巯","帥":"帅","師":"师","帳":"帐","帶":"带","幀":"帧","幾":"几","庫":"库","廁":"厕","廂":"厢","廈":"厦","廚":"厨","廟":"庙","廠":"厂","徹":"彻","徑":"径","憶":"忆","態":"态","懷":"怀","憮":"怃","戀":"恋","戲":"戏","戶":"户","撲":"扑","攬":"揽","敵":"敌","數":"数","斃":"毙","斬":"斩","斷":"断","無":"无","歷":"历","歸":"归","歿":"殁","殺":"杀","氣":"气","匯":"汇","漢":"汉","漚":"沤","潛":"潜","潤":"润","漲":"涨","漸":"渐","漁":"渔","滅":"灭","燈":"灯","靈":"灵","災":"灾","為":"为","獨":"独","豬":"猪","貓":"猫","獻":"献","環":"环","現":"现","瑣":"琐","瑪":"玛","疑":"疑","療":"疗","瘋":"疯","癰":"痈","盡":"尽","監":"监","盤":"盘","眉":"眉","真":"真","眼":"眼","着":"着","睜":"睁","瞞":"瞒","矯":"矫","碼":"码","確":"确","禮":"礼","禎":"祯","穫":"获","穌":"稣","積":"积","稱":"称","穩":"稳","窮":"穷","竊":"窃","笑":"笑","篩":"筛","籃":"篮","籌":"筹","簽":"签","簡":"简","簀":"笮","總":"总","繡":"绣","繳":"缴","繼":"继","績":"绩","緬":"缅","纜":"缆","罌":"罂","罰":"罚","罷":"罢","羅":"罗","羈":"羁","羊":"羊","美":"美","翹":"翘","翻":"翻","聖":"圣","聞":"闻","聯":"联","聰":"聪","肅":"肃","膚":"肤","臍":"脐","臨":"临","自":"自","至":"至","臾":"臾","與":"与","舊":"旧","舍":"舍","艙":"舱","艦":"舰","茲":"兹","花":"花","蕩":"荡","蝦":"虾","蝕":"蚀","蠣":"蛎","":"蔑","術":"术","衛":"卫","衝":"冲","衞":"卫","補":"补","裝":"装","裡":"里","製":"制","複":"复","賈":"贾","賞":"赏","賜":"赐","贈":"赠","趙":"赵","輔":"辅","輕":"轻","輝":"辉","輩":"辈","輪":"轮","轉":"转","辭":"辞","農":"农","遲":"迟","遼":"辽","郟":"郏","郵":"邮","鄉":"乡","鄰":"邻","醜":"丑","釋":"释","釀":"酿","醫":"医","釁":"衅","鑄":"铸","鋒":"锋","鋼":"钢","錄":"录","錯":"错","錨":"锚","鍵":"键","鍛":"锻","鎮":"镇","鏡":"镜","鐘":"钟","鐵":"铁","顯":"显","顰":"颦","風":"风","飄":"飘","飯":"饭","飼":"饲","養":"养","餛":"馄","饞":"馋","馬":"马","馭":"驭","駐":"驻","駕":"驾","騎":"骑","驗":"验","驚":"惊","骨":"骨","體":"体","髮":"发","鬥":"斗","魚":"鱼","鮮":"鲜","鱷":"鳄","鳥":"鸟","鳳":"凤","鳴":"鸣","鵬":"鹏","麗":"丽","麥":"麦","點":"点","黨":"党","齊":"齐","齒":"齿","龍":"龙","龜":"龟",
}
def to_simplified(s):
    return "".join(T2S.get(ch, ch) for ch in s)

TRAD_CHARS = set(T2S.keys())

# ---------- 归一化 ----------
PUNCT = re.compile(r"[\s\u3000，。、！？；：·…—－\-_,\.\!\?\;:\"'“”‘’（）()\[\]【】《》<>{}|/\\~`@#$%^&*+=]")
def norm(s):
    s = to_simplified(s)
    s = PUNCT.sub("", s)
    return s

def bigrams(s):
    return set(s[k:k+2] for k in range(len(s)-1)) if len(s) >= 2 else set([s]) if s else set()

def jac(a, b):
    if not a or not b: return 0.0
    return len(a & b) / len(a | b)

def cont(a, b):
    """containment: overlap / smaller set"""
    if not a or not b: return 0.0
    return len(a & b) / min(len(a), len(b))

# ---------- 语言分类 ----------
def lang_of(s):
    cjk = sum(1 for ch in s if "\u4e00" <= ch <= "\u9fff")
    lat = sum(1 for ch in s if ch.isascii() and ch.isalpha())
    digits = sum(1 for ch in s if ch.isdigit())
    total = cjk + lat
    if total == 0:
        return "empty"
    if lat > 0 and lat / max(1, total) >= 0.6 and cjk == 0:
        return "en"
    if lat > 0 and lat / max(1, total) >= 0.5:
        return "mixed-latin"
    return "zh"

def trad_count(s):
    return sum(1 for ch in s if ch in TRAD_CHARS)

# ---------- 污染特征 ----------
CODE_PAT = re.compile(
    r"(function\s*\(|=>\s*[\{\(]|console\.log|document\.|window\.|require\(|import\s+|export\s+"
    r"|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=|\bdef\s+\w+\(|\bprint\(|import\s+\w+\s+|json\.loads"
    r"|<\s*/?\s*(html|body|div|span|script|p|br|img|a)\b|SELECT\s+\w+\s+FROM|\bclass\s+\w+\s*[:\{]"
    r"|\breturn\s+[\{\"]|sys\.argv|os\.path|subprocess|requests\.get)", re.I)
URL_PAT = re.compile(r"https?://|www\.|\.com\b|\.net\b|\.top\b|\.org\b", re.I)
AICMD_PAT = re.compile(
    r"(你是\s*(一)?(个|位)?\s*(AI|人工智能|助手|汤主|语言模型)|作为(一个|位)?\s*(AI|助手|语言模型)"
    r"|对不起[，,].{0,8}(无法|不能|抱歉)|我无法|作为一个|指令[:：]|prompt[:：]|system\s*prompt"
    r"|请(按|按照|根据).{0,10}(格式|要求).{0,10}(输出|回答)|以下(是|为).{0,6}(提示词|指令|prompt)"
    r"|忽略(上面|以上|之前).{0,6}(指令|要求)|忽略所有|扮演|角色设定[:：]|设定[:：]你)", re.I)
TEMPLATE_PAT = re.compile(r"(\{\{|\}\}|\$\{|%\s*(if|for|endfor|endif)|<%|占位|placeholder|TODO|FIXME|XXX(?![A-Za-z])|\bTBD\b|待补充|暂无汤底|（无汤底）|\(无汤底\)?)", re.I)
BBCode_PAT = re.compile(r"\[(/?)(b|i|u|color|url|img|r|c|y|t|st)\]", re.I)
GAMEHELP_PAT = re.compile(r"(玩法说明|游戏规则|主持人只能回答|提问时|本(世界|游戏)内|问卷二维码|上传海龟汤|选择子条目|合集容器)", re.I)
JUNK_REPEAT_PAT = re.compile(r"(\S)\1{5,}|[A-Za-z]\1{9,}")

report = defaultdict(list)

# ---------- [2] 语言 ----------
en_list, trad_list, mixed_list = [], [], []
for e in data:
    sid = e.get("id","?")
    title = field(e,"dispTitle") or field(e,"title") or sid
    s, t = field(e,"surface"), field(e,"truth")
    ls, lt = lang_of(s), lang_of(t)
    ts = trad_count(s); tt = trad_count(t)
    cjks = sum(1 for ch in s if "\u4e00"<=ch<="\u9fff")
    cjkt = sum(1 for ch in t if "\u4e00"<=ch<="\u9fff")
    rec = {"id":sid,"title":title,"lang_s":ls,"lang_t":lt,"trad_s":ts,"trad_t":tt,
           "snippet":(s[:60] or t[:60])}
    if ls=="en" or lt=="en":
        en_list.append(rec)
    elif ls=="mixed-latin" or lt=="mixed-latin":
        mixed_list.append(rec)
    if (cjks and ts/max(1,cjks) >= 0.05) or (cjkt and tt/max(1,cjkt) >= 0.05):
        rec2 = dict(rec); rec2["trad_ratio_s"] = round(ts/max(1,cjks),3); rec2["trad_ratio_t"] = round(tt/max(1,cjkt),3)
        trad_list.append(rec2)

# ---------- [1] 相似/重复 ----------
entries = []
for e in data:
    entries.append({
        "id": e.get("id","?"),
        "title": field(e,"dispTitle") or field(e,"title"),
        "ns": norm(field(e,"surface")),
        "nt": norm(field(e,"truth")),
        "surface": field(e,"surface"),
        "truth": field(e,"truth"),
    })
bs = [bigrams(x["ns"]) for x in entries]
bt = [bigrams(x["nt"]) for x in entries]

# inverted index candidate pairs on surface bigrams + truth bigrams
def candidate_pairs(vecs):
    idx = defaultdict(list)
    for k, v in enumerate(vecs):
        for g in v:
            idx[g].append(k)
    pairs = set()
    for g, lst in idx.items():
        if len(lst) > 400:  # too common, skip to avoid blowup
            continue
        lst = sorted(set(lst))
        for a in range(len(lst)):
            for b in range(a+1, len(lst)):
                pairs.add((lst[a], lst[b]))
    return pairs

cands = candidate_pairs(bs) | candidate_pairs(bt)
pairs_out = []
for (a, b) in cands:
    if a == b: continue
    js, cs = jac(bs[a], bs[b]), cont(bs[a], bs[b])
    jt, ct = jac(bt[a], bt[b]), cont(bt[a], bt[b])
    same_title = entries[a]["title"] and entries[a]["title"] == entries[b]["title"]
    hit = None
    if js >= 0.55 or cs >= 0.72:
        hit = "surface"
    elif jt >= 0.50 or ct >= 0.70:
        hit = "truth"
    elif same_title and (js >= 0.30 or jt >= 0.30):
        hit = "title+weak"
    if hit:
        pairs_out.append({"a": entries[a]["id"], "b": entries[b]["id"], "kind": hit,
                          "js": round(js,3), "cs": round(cs,3), "jt": round(jt,3), "ct": round(ct,3),
                          "ta": entries[a]["title"], "tb": entries[b]["title"]})
pairs_out.sort(key=lambda r: -(max(r["js"], r["jt"])))

# union-find clusters
parent = list(range(len(entries)))
def find(x):
    while parent[x]!=x:
        parent[x]=parent[parent[x]]; x=parent[x]
    return x
def union(a,b):
    ra,rb=find(a),find(b)
    if ra!=rb: parent[rb]=ra
kmap = {entries[k]["id"]: k for k in range(len(entries))}
strong = [p for p in pairs_out if p["kind"] in ("surface","truth")]
for p in strong:
    union(kmap[p["a"]], kmap[p["b"]])
clusters = defaultdict(list)
for p in strong:
    clusters[find(kmap[p["a"]])].append(p)
cluster_list = []
seen_roots = set()
for p in strong:
    r = find(kmap[p["a"]])
    if r in seen_roots: continue
    seen_roots.add(r)
    # collect members
    members = set()
    for q in strong:
        if find(kmap[q["a"]])==r:
            members.add(q["a"]); members.add(q["b"])
    cluster_list.append({"root": entries[r]["title"], "size": len(members), "ids": sorted(members)})
cluster_list.sort(key=lambda c:-c["size"])

# exact duplicates
exact_surface = defaultdict(list)
exact_truth = defaultdict(list)
for x in entries:
    if x["ns"]: exact_surface[x["ns"]].append(x["id"])
    if x["nt"]: exact_truth[x["nt"]].append(x["id"])
dup_s = {k:v for k,v in exact_surface.items() if len(v)>1}
dup_t = {k:v for k,v in exact_truth.items() if len(v)>1}

# title groups (normalized title)
title_groups = defaultdict(list)
for x in entries:
    nt = norm(x["title"])
    if nt: title_groups[nt].append(x["id"])
dup_title = {k:v for k,v in title_groups.items() if len(v)>1}

# ---------- [3] 污染 & 不匹配 ----------
contaminated = []
for e in data:
    sid = e.get("id","?")
    s, t = field(e,"surface"), field(e,"truth")
    title = field(e,"dispTitle") or field(e,"title") or sid
    flags = []
    for name, pat in (("code",CODE_PAT),("url",URL_PAT),("ai_cmd",AICMD_PAT),
                      ("template",TEMPLATE_PAT),("bbcode",BBCode_PAT),("gamehelp",GAMEHELP_PAT)):
        ms = pat.search(s); mt = pat.search(t)
        if ms: flags.append(("surface", name, s[max(0,ms.start()-15):ms.end()+25]))
        if mt: flags.append(("truth", name, t[max(0,mt.start()-15):mt.end()+25]))
    # truth repeats surface verbatim
    if s and t and (norm(s) in norm(t) or norm(t) in norm(s)) and len(norm(s))>=15:
        flags.append(("both","truth_repeats_surface",""))
    # surface too short
    if len(norm(s)) < 8:
        flags.append(("surface","too_short", s))
    # suspicious long-run junk
    if JUNK_REPEAT_PAT.search(s) or JUNK_REPEAT_PAT.search(t):
        flags.append(("both","junk_repeat",""))
    if flags:
        contaminated.append({"id":sid,"title":title,"flags":flags})

# surface-truth mismatch candidates: low bigram overlap
mismatch = []
for e in data:
    s, t = norm(field(e,"surface")), norm(field(e,"truth"))
    if len(s) < 10 or len(t) < 10: continue
    jv = jac(bigrams(s), bigrams(t))
    cv = cont(bigrams(s), bigrams(t))
    if jv < 0.02 and cv < 0.045:
        mismatch.append({"id":e.get("id","?"),"title":field(e,"dispTitle") or field(e,"title"),
                         "jac":round(jv,4),"cont":round(cv,4),
                         "surface":field(e,"surface")[:70],"truth":field(e,"truth")[:70]})
mismatch.sort(key=lambda r:r["jac"])

# ---------- 输出 ----------
out = io.open(OUT_TXT, "w", encoding="utf-8")
W = out.write
W("深海汤屋 · 汤库 %d 题全量体检报告（只读，2026-09-25）\n" % N)
W("="*80 + "\n\n")

W("[1] 相似 / 重复\n")
W("  汤面完全相同组数: %d（涉及 %d 条）\n" % (len(dup_s), sum(len(v) for v in dup_s.values())))
W("  汤底完全相同组数: %d（涉及 %d 条）\n" % (len(dup_t), sum(len(v) for v in dup_t.values())))
W("  标题相同组数: %d（涉及 %d 条）\n" % (len(dup_title), sum(len(v) for v in dup_title.values())))
W("  高相似对（汤面 jac>=0.55 或 cont>=0.72 / 汤底 jac>=0.50 或 cont>=0.70）: %d 对\n" % len(strong))
W("  聚簇后重复簇数: %d，簇内总条数: %d\n" % (len(cluster_list), sum(c["size"] for c in cluster_list)))
W("\n  -- 重复簇明细（按簇大小排序）--\n")
for c in cluster_list:
    W("  [簇 %d 条] 代表: %s\n" % (c["size"], c["root"]))
    for mid in c["ids"]:
        ent = next(x for x in entries if x["id"]==mid)
        W("      %s | %s | 汤面: %s\n" % (mid, ent["title"], ent["surface"][:48]))
W("\n  -- 高相似对明细 --\n")
for p in pairs_out[:400]:
    W("  %s %s->%s | %s | %s | S(j%.2f/c%.2f) T(j%.2f/c%.2f)\n" %
      (p["kind"], p["a"], p["b"], p["ta"][:20], p["tb"][:20], p["js"], p["cs"], p["jt"], p["ct"]))
W("\n")

W("[2] 非简体中文\n")
W("  英文题（汤面或汤底以拉丁为主）: %d 条\n" % len(en_list))
for r in en_list:
    W("      %s | %s | %s\n" % (r["id"], r["title"][:24], r["snippet"][:56]))
W("  中英混杂: %d 条\n" % len(mixed_list))
for r in mixed_list:
    W("      %s | %s | %s\n" % (r["id"], r["title"][:24], r["snippet"][:56]))
W("  繁体中文（繁体字占比>=5%%）: %d 条\n" % len(trad_list))
for r in trad_list:
    W("      %s | %s | 繁s%.2f 繁t%.2f | %s\n" % (r["id"], r["title"][:24], r["trad_ratio_s"], r["trad_ratio_t"], r["snippet"][:48]))
W("\n")

W("[3] 污染 / 不匹配\n")
W("  命中污染特征的条目: %d 条\n" % len(contaminated))
for r in contaminated:
    W("      %s | %s\n" % (r["id"], r["title"][:26]))
    for f in r["flags"]:
        W("          [%s] %s :: %s\n" % (f[0], f[1], f[2].replace("\n"," ")[:70]))
W("\n  汤面-汤底低重合候选（人工复核用）: %d 条\n" % len(mismatch))
for r in mismatch[:120]:
    W("      %s | %s | j%.3f c%.3f\n          面: %s\n          底: %s\n" %
      (r["id"], r["title"][:24], r["jac"], r["cont"], r["surface"], r["truth"]))
out.close()

json.dump({
    "N": N,
    "dup_surface_groups": dup_s, "dup_truth_groups": dup_t, "dup_title_groups": dup_title,
    "strong_pairs": pairs_out, "clusters": cluster_list,
    "en": en_list, "mixed": mixed_list, "trad": trad_list,
    "contaminated": contaminated, "mismatch_low_overlap": mismatch,
}, io.open(OUT_JSON,"w",encoding="utf-8"), ensure_ascii=False, indent=1)

print("DONE N=%d clusters=%d strong_pairs=%d dupS=%d dupT=%d dupTitle=%d en=%d mixed=%d trad=%d tainted=%d mismatch=%d" %
      (N, len(cluster_list), len(strong), len(dup_s), len(dup_t), len(dup_title),
       len(en_list), len(mixed_list), len(trad_list), len(contaminated), len(mismatch)))
