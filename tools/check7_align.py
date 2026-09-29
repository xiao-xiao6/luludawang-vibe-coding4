# -*- coding: utf-8 -*-
"""
第七轮 · 繁译简 / 英译中 体检 —— 建原文对照表 + 繁译简机械比对

原文来源：
  - 繁译简 436  ↔ d:\\Downloads\\train_8k.json / test_1.5k.json（按 (src, srcNo) 精确回查繁体原文）
  - 英译中 216  ↔ tools/yng_fresh_final.json（yesnogame.net/en 抓取档，srcNo=sid）
  - 英译中  81  ↔ tools/en_dump.json（boop-yyt / Jed's List / repo-scan，按库 id 回查）

产出：
  tools/check7_pair/t2s_NN.txt   繁译简「繁体原文 → 现库简体」全文对照包
  tools/check7_pair/e2s_NN.txt   英译中「英文原文 → 现库译文」全文对照包
  tools/check7_t2s_mech.json     繁译简机械比对分类结果
用法：python -X utf8 tools/check7_align.py
"""
import io, os, re, json, sys
from collections import Counter
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
from zhconv import convert as zc

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
T = lambda *p: os.path.join(ROOT, "tools", *p)
MASTER = os.path.join(ROOT, "data", "library", "library.data.js")
DATASETS = {
    "dataset:train_8k": r"d:\Downloads\train_8k.json",
    "dataset:test_1.5k": r"d:\Downloads\test_1.5k.json",
}

src = io.open(MASTER, encoding="utf-8").read()
lib, _ = json.JSONDecoder().raw_decode(src[src.index("var SOUP_LIBRARY = ") + len("var SOUP_LIBRARY = "):])

# ---------- 原文索引 ----------
ds = {}
for lab, fn in DATASETS.items():
    arr = json.load(io.open(fn, encoding="utf-8"))
    for e in arr:
        ds[(lab, e["id"])] = {"title": (e.get("title") or "").strip(),
                              "surface": e.get("surface") or "",
                              "truth": e.get("bottom") or ""}
yng = {str(it["sid"]): it for it in json.load(io.open(T("yng_fresh_final.json"), encoding="utf-8"))["items"]}
endump = {e["id"]: e for e in json.load(io.open(T("en_dump.json"), encoding="utf-8"))}

fan = [e for e in lib if "繁译简" in e.get("cats", [])]
eng = [e for e in lib if "英译中" in e.get("cats", [])]

# ---------- 繁译简机械比对 ----------
PUNCT = re.compile(r"[\s\u3000，。、！？；：·…—－\-_,\.\!\?\;:\"'“”‘’（）()\[\]【】《》<>{}|/\\~`@#$%^&*+=「」『』※★☆●○■□◇♡\-–—…]+")
def norm(s):
    return PUNCT.sub("", zc(s or "", "zh-hans"))

def ratio(a, b):
    """SequenceMatcher 相似度（去标点后简体字符流）"""
    from difflib import SequenceMatcher
    return SequenceMatcher(None, a, b, autojunk=False).ratio()

mech = []
for e in fan:
    o = ds.get((e["src"], e["srcNo"]))
    if o is None:
        mech.append({"srcNo": e["srcNo"], "id": e["id"], "cls": "NO_SOURCE"}); continue
    row = {"srcNo": e["srcNo"], "id": e["id"], "title": e["title"]}
    worst = 1.0
    for f, of in (("title", "title"), ("surface", "surface"), ("truth", "truth")):
        a, b = norm(o[of]), norm(e[f])
        r = ratio(a, b)
        row["r_" + f] = round(r, 3)
        row["len_o_" + f], row["len_z_" + f] = len(a), len(b)
        if r < worst:
            worst = r
    row["worst"] = worst
    row["o"] = o
    row["z"] = {k: e[k] for k in ("title", "surface", "truth")}
    if worst >= 0.995:
        row["cls"] = "EXACT"
    elif worst >= 0.90:
        row["cls"] = "NEAR"
    elif worst >= 0.55:
        row["cls"] = "REWRITE"
    else:
        row["cls"] = "DIVERGE"
    # 简转后仍残留的繁体字（库内文本自身含繁体形）
    resid = [c for c in set(e["surface"] + e["truth"] + e["title"]) if zc(c, "zh-hans") != c and "\u4e00" <= c <= "\u9fff"]
    row["trad_residue"] = "".join(sorted(resid))
    mech.append(row)

print("繁译简机械分类:", Counter(r["cls"] for r in mech).most_common())
print("残留繁体字的题数:", sum(1 for r in mech if r.get("trad_residue")))
io.open(T("check7_t2s_mech.json"), "w", encoding="utf-8").write(
    json.dumps([{k: v for k, v in r.items() if k not in ("o", "z")} for r in mech], ensure_ascii=False, indent=0))

# ---------- 分包输出 ----------
def dump(items, tag, per=40):
    outs = []
    n = max(1, (len(items) + per - 1) // per)
    for i in range(n):
        chunk = items[i * per:(i + 1) * per]
        lines = []
        for e, o in chunk:
            lines.append("[%s] 《%s》 原帖 #%s" % (e["id"], e["title"], e["srcNo"]))
            if tag == "t2s":
                lines.append("原文标题: %s" % o["title"])
                lines.append("原文汤面: %s" % o["surface"])
                lines.append("现库汤面: %s" % e["surface"])
                lines.append("原文汤底: %s" % o["truth"])
                lines.append("现库汤底: %s" % e["truth"])
            else:
                lines.append("原帖标题: %s" % (o.get("title") or ""))
                lines.append("原文汤面: %s" % o["surface"])
                lines.append("现库汤面: %s" % e["surface"])
                lines.append("原文汤底: %s" % o["truth"])
                lines.append("现库汤底: %s" % e["truth"])
            lines.append("")
        p = T("check7_pair", "%s_%02d.txt" % (tag, i + 1))
        io.open(p, "w", encoding="utf-8").write("\n".join(lines))
        outs.append((os.path.basename(p), len(chunk)))
    return outs

fan_pairs = [(e, ds[(e["src"], e["srcNo"])]) for e in fan if (e["src"], e["srcNo"]) in ds]
eng_pairs = []
for e in eng:
    o = None
    if e["src"] == "yesnogame.net":
        y = yng.get(str(e["srcNo"]))
        if y:
            o = {"title": y.get("title", ""), "surface": y.get("surface", ""), "truth": y.get("truth", "")}
    else:
        d = endump.get(e["id"])
        if d:
            o = {"title": d.get("title", ""), "surface": d.get("surface", ""), "truth": d.get("truth", "")}
    if o is None:
        print("!! 英文原文缺失:", e["id"], e["src"], e["srcNo"])
    else:
        eng_pairs.append((e, o))
print("繁译简可对照:", len(fan_pairs), "/", len(fan), "  英译中可对照:", len(eng_pairs), "/", len(eng))
print("t2s 包:", dump(fan_pairs, "t2s"))
print("e2s 包:", dump(eng_pairs, "e2s", per=34))
