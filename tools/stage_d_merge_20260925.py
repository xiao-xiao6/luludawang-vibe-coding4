# -*- coding: utf-8 -*-
"""
深海汤屋 · Stage D：繁译简并入 466 道（写盘）
来源：tools/txt_merge_check_20260925_report.json(missing) + fuzzy(suspect_existing)
规则：
 - 排除 23 条已有 + 16 条疑似已有 → 466 道
 - 同汤面多汤底取最长；新题内部再互相去重
 - zhconv 繁→简 + 全局清洗（含 著→着 助词修正）
 - cats = 自动题材 + ["繁译简"]；id=lib_+sha1(归一化汤面)[:12]
 - SOUP_LIB_CATS 追加 繁译简/英译中
产出：data/library/library.data.js + tools/stage_d_log.json
"""
import io, re, json, hashlib
from collections import Counter, defaultdict
from zhconv import convert as zc

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
MASTER = ROOT + r"\data\library\library.data.js"
ATT = ROOT + r"\.opensquilla\attachments\82855477-6607-472b-85df-85c0617542ac"

# ---------- 载入母本 ----------
src = io.open(MASTER, encoding="utf-8").read()
head = src[:src.find("var SOUP_LIBRARY")]
i = src.find("var SOUP_LIBRARY"); i = src.find("[", i)
end = src.find("\nvar SOUP_LIB_CATS", i)
tail = src[end:]
data = json.loads(src[i:end].rsplit("]", 1)[0] + "]")

# ---------- 清洗函数 ----------
PUNCT = re.compile(r"[\s\u3000，。、！？；：·…—－\-_,\.\!\?\;:\"'“”‘’（）()\[\]【】《》<>{}|/\\~`@#$%^&*+=「」『』]")
ZW = re.compile(u"[\u200b\u200c\u200d\ufeff\u00a0]")
QUOTE_MARK = re.compile(r"^\s*>\s?", re.M)
def norm(s):
    return PUNCT.sub("", zc(s or "", "zh-hans"))
def fix_zhe(s):
    # 助词 著→着，保留 著名/著作/原著/显著/执著/编著/昭著 等
    out = []
    for k, ch in enumerate(s):
        if ch == "著":
            prev = s[k-1] if k else ""
            nxt = s[k+1] if k + 1 < len(s) else ""
            if prev in "专原显执编昭见" or nxt in "名作":
                out.append(ch)
            else:
                out.append("着"); 
        else:
            out.append(ch)
    return "".join(out)
def clean_text(s):
    if not s:
        return s
    s = zc(s, "zh-hans")
    s = fix_zhe(s)
    s = ZW.sub("", s)
    s = QUOTE_MARK.sub("", s)
    s = re.sub(r"[ \t]{2,}", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()

# ---------- 载入数据集 ----------
train = json.load(io.open(ATT + r"\553bbf9369a6-train_8k.json", encoding="utf-8"))
test = json.load(io.open(ATT + r"\2832489f4efb-test_1.5k.json", encoding="utf-8"))
puzzles = {}
for srcname, arr in (("dataset:train_8k", train), ("dataset:test_1.5k", test)):
    for e in arr:
        k = norm(e["surface"])
        if not k:
            continue
        if k not in puzzles:
            puzzles[k] = {"title": (e.get("title") or "").strip(), "surface": e["surface"],
                          "bottoms": [], "src": srcname, "srcNo": e.get("id")}
        b = (e.get("bottom") or "").strip()
        if b and b not in puzzles[k]["bottoms"]:
            puzzles[k]["bottoms"].append(b)

# ---------- 排除已有/疑似 ----------
rep = json.load(io.open(ROOT + r"\tools\txt_merge_check_20260925_report.json", encoding="utf-8"))
fz = json.load(io.open(ROOT + r"\tools\txt_merge_check_20260925_fuzzy.json", encoding="utf-8"))
excl = set()
for m in rep["matched"]:
    excl.add(norm(m["surface"]))
for s in fz["suspect_existing"]:
    excl.add(norm(s["surface"]))
todo = {k: v for k, v in puzzles.items() if k not in excl}
log = {"unique_puzzles": len(puzzles), "excluded": len(puzzles) - len(todo), "to_merge_before_internal_dedup": len(todo)}

# ---------- 新题内部去重（同归一化面已合并；再按近似去重：包含度>=0.86 或 稀有重合>=10） ----------
def bg(s): return set(s[k:k+2] for k in range(len(s)-1)) if len(s) >= 2 else (set([s]) if s else set())
keys = sorted(todo.keys(), key=lambda k: -len(max(todo[k]["bottoms"], key=len) if todo[k]["bottoms"] else ""))
kept_keys = []
kept_grams = []
dropped_internal = []
for k in keys:
    g = bg(k)
    dup_of = None
    for j, kg in enumerate(kept_grams):
        inter = len(g & kg)
        cont = inter / max(1, min(len(g), len(kg)))
        if cont >= 0.86:
            dup_of = kept_keys[j]; break
    if dup_of:
        dropped_internal.append({"surface": todo[k]["surface"][:40], "dup_of": todo[dup_of]["surface"][:40]})
    else:
        kept_grams.append(g); kept_keys.append(k)
log["internal_dedup_drops"] = len(dropped_internal)
log["final_merge"] = len(kept_keys)

# ---------- 题材自动分类 ----------
RULES = [
    ("校园", re.compile(r"学校|同学|老师|教室|宿舍|大学|毕业|高考|班主任")),
    ("家庭", re.compile(r"妈妈|爸爸|母亲|父亲|婆婆|老公|老婆|妻子|丈夫|女儿|儿子|姐姐|哥哥|弟弟|妹妹|家里")),
    ("都市", re.compile(r"手机|电梯|外卖|直播|出租车|地铁|公司|老板|同事|快递|微信")),
    ("犯罪", re.compile(r"警察|侦探|凶手|案|绑架|抢劫|杀人|越狱|法庭|律师|坐牢")),
    ("恐怖", re.compile(r"鬼|尸|血|坟|墓|死|杀|命案|闹鬼")),
    ("脑洞", re.compile(r"梦|超能力|外星人|时间旅行|穿越|虚拟|系统|游戏|僵尸|异能|2077|虫洞")),
    ("悬疑", re.compile(r"失踪|监控|线索|真相|疑|秘密|遗书|日记")),
    ("猎奇", re.compile(r"吃人|人肉|器官|肢解|骨|剥皮|毒|蛊")),
    ("温情", re.compile(r"爱着|守护|温暖|感动|表白|婚礼|承诺")),
]
def auto_cats(text):
    for name, pat in RULES:
        if pat.search(text):
            return [name]
    return ["其他"]

# ---------- 构造新条目 ----------
existing_ids = {e["id"] for e in data}
added = []
for k in kept_keys:
    p = todo[k]
    title = clean_text(p["title"])
    surface = clean_text(p["surface"])
    truth = clean_text(max(p["bottoms"], key=len) if p["bottoms"] else "")
    if not surface or not truth:
        continue
    nid = "lib_" + hashlib.sha1(k.encode("utf-8")).hexdigest()[:12]
    n = 0
    while nid in existing_ids:
        n += 1
        nid = "lib_" + hashlib.sha1((k + str(n)).encode("utf-8")).hexdigest()[:12]
    existing_ids.add(nid)
    cats = auto_cats(surface + truth) + ["繁译简"]
    added.append({
        "_t": "t2s", "cats": cats, "difficulty": 2, "dispTitle": title,
        "id": nid, "lang": "zh", "mode": "truth", "quality": "t2s",
        "rawTags": [], "src": p["src"], "srcNo": p["srcNo"], "srcUrl": "",
        "surface": surface, "title": title, "truth": truth, "truthSource": "original",
    })
data.extend(added)
log["added"] = len(added)

# ---------- SOUP_LIB_CATS 追加标签 ----------
tail = tail.replace('"本格","其他"]', '"本格","其他","繁译简","英译中"]', 1)

# ---------- 写回 ----------
body = head + "var SOUP_LIBRARY = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";" + tail
io.open(MASTER, "w", encoding="utf-8").write(body)
io.open(ROOT + r"\tools\stage_d_log.json", "w", encoding="utf-8").write(json.dumps(log, ensure_ascii=False, indent=1))
print("OK master=%d  added=%d  internal_dedup=%d  excluded=%d  empty_title=%d" % (
    len(data), len(added), log["internal_dedup_drops"], log["excluded"],
    sum(1 for a in added if not a["title"])))
