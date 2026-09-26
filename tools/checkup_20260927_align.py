# -*- coding: utf-8 -*-
"""
体检第 4 步：建「译文 ↔ 原文」对齐表
- 繁译简 447  ↔ D:\Downloads\train_8k.json / test_1.5k.json（繁体原文）
- 英译中 221  ↔ tools/yng_fresh_final.json（英文原文，srcNo=sid）
- 英译中 84   ↔ extracted4 源仓库（boop-yyt situation_puzzle 等）+ Jed 档
- 日译中 165  ↔ tools/llt_fresh_final.json（日文原文，srcNo=id）
产出 tools/checkup_pairs.json
"""
import io, os, re, json, sys, glob
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass
from zhconv import convert as zc

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
WS = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace"
T = lambda *p: os.path.join(ROOT, *p)
rows = json.load(io.open(T("tools", "checkup_all.json"), encoding="utf-8"))

PUNCT = re.compile(r"[\s\u3000，。、！？；：·…—－\-_,\.\!\?\;:\"'“”‘’（）()\[\]【】《》<>{}|/\\~`@#$%^&*+=「」『』※★☆●○■□◇♡]+")
def norm(s): return PUNCT.sub("", (s or "").lower())
def norm_t(s): return norm(zc(s or "", "zh-hans"))

pairs = []   # {id, tag, zh_title, zh_surface, zh_truth, o_title, o_surface, o_truth, o_src}

# ---------- 1) 繁译简 ↔ train_8k/test_1.5k ----------
trad = {}
for fn, lab in ((r"D:\Downloads\train_8k.json", "train_8k"), (r"D:\Downloads\test_1.5k.json", "test_1.5k")):
    if not os.path.exists(fn): print("缺:", fn); continue
    arr = json.load(io.open(fn, encoding="utf-8"))
    for e in arr:
        k = norm_t(e.get("surface") or "")
        if k and k not in trad:
            trad[k] = {"title": (e.get("title") or "").strip(), "surface": e.get("surface") or "",
                       "truth": e.get("bottom") or "", "lab": lab, "no": e.get("id")}
print("繁体原文索引:", len(trad))
n_t2s = 0
for r in rows:
    if "繁译简" not in r["cats"]: continue
    k = norm(r["surface"])
    o = trad.get(k)
    if o:
        n_t2s += 1
        pairs.append({"id": r["id"], "tag": "繁译简", "zh": r, "o": o})
print("繁译简对齐:", n_t2s, "/", sum(1 for r in rows if "繁译简" in r["cats"]))

# ---------- 2) 英译中(yesnogame) ↔ yng_fresh_final ----------
yng = {str(it["sid"]): it for it in json.load(io.open(T("tools", "yng_fresh_final.json"), encoding="utf-8"))["items"]}
n_e = 0
for r in rows:
    if r["src"] == "yesnogame.net":
        o = yng.get(str(r["srcNo"]))
        if o:
            n_e += 1
            pairs.append({"id": r["id"], "tag": "英译中", "zh": r,
                          "o": {"title": o.get("title",""), "surface": o.get("surface",""),
                                "truth": o.get("truth",""), "lab": "yng", "no": r["srcNo"]}})
print("yesnogame 对齐:", n_e, "/", sum(1 for r in rows if r["src"] == "yesnogame.net"))

# ---------- 3) 英译中(boop-yyt / Jed) ↔ extracted4 ----------
bp = os.path.join(WS, "extracted4", "boop-yyt__situation_puzzle__master", "situation_puzzle-master")
qf = glob.glob(os.path.join(bp, "**", "*question*"), recursive=True)
af = glob.glob(os.path.join(bp, "**", "*answer*"), recursive=True)
print("boop 问/答文件:", [os.path.basename(x) for x in qf+af][:6])

def parse_pairs_file(path):
    """常见格式：每行/每块 Q: ... A: ... 或 JSON"""
    txt = io.open(path, encoding="utf-8", errors="replace").read()
    out = {}
    try:
        j = json.loads(txt)
        if isinstance(j, list):
            for e in j:
                q = norm(e.get("question") or e.get("q") or e.get("surface") or "")
                a = e.get("answer") or e.get("a") or e.get("truth") or ""
                if q: out[q] = {"title": (e.get("title") or "").strip(), "surface": e.get("question") or e.get("surface") or "",
                                "truth": a, "lab": os.path.basename(path), "no": e.get("id")}
            return out
    except Exception:
        pass
    # 文本格式：空行分块，Q/A 前缀
    blocks = re.split(r"\n\s*\n", txt)
    for b in blocks:
        m = re.match(r"\s*(?:Q|问|question)[:：]\s*(.+?)(?:\n\s*)(?:A|答|answer)[:：]\s*(.+)", b, re.S | re.I)
        if m:
            out[norm(m.group(1))] = {"title": "", "surface": m.group(1).strip(), "truth": m.group(2).strip(),
                                     "lab": os.path.basename(path), "no": None}
    return out
boop_idx = {}
for f in qf + af:
    if os.path.isfile(f) and os.path.getsize(f) < 3_000_000:
        for k, v in parse_pairs_file(f).items():
            boop_idx.setdefault(k, v)
print("boop 索引:", len(boop_idx))
n_b = 0
for r in rows:
    if r["src"] in ("github:boop-yyt/situation_puzzle",) or "Jed" in r["src"]:
        o = boop_idx.get(norm(r["surface"]))
        if o:
            n_b += 1
            pairs.append({"id": r["id"], "tag": "英译中", "zh": r, "o": o})
print("boop/Jed 对齐:", n_b, "/", sum(1 for r in rows if r["src"] in ("github:boop-yyt/situation_puzzle",) or "Jed" in r["src"]))

# ---------- 4) 日译中 ↔ llt_fresh_final ----------
llt = {str(it["id"]): it for it in json.load(io.open(T("tools", "llt_fresh_final.json"), encoding="utf-8"))["items"]}
n_j = 0
for r in rows:
    if r["src"] == "late-late.jp":
        o = llt.get(str(r["srcNo"]))
        if o:
            n_j += 1
            pairs.append({"id": r["id"], "tag": "日译中", "zh": r,
                          "o": {"title": o.get("title",""), "surface": o.get("surface",""),
                                "truth": o.get("truth",""), "lab": "llt", "no": r["srcNo"]}})
print("late-late 对齐:", n_j, "/", sum(1 for r in rows if r["src"] == "late-late.jp"))

slim = [{"id": p["id"], "tag": p["tag"], "src": p["zh"]["src"], "srcNo": p["zh"]["srcNo"],
         "cats": p["zh"]["cats"], "zh_title": p["zh"]["title"], "zh_surface": p["zh"]["surface"],
         "zh_truth": p["zh"]["truth"], "o_title": p["o"]["title"], "o_surface": p["o"]["surface"],
         "o_truth": p["o"]["truth"], "o_lab": p["o"]["lab"]} for p in pairs]
io.open(T("tools", "checkup_pairs.json"), "w", encoding="utf-8").write(json.dumps(slim, ensure_ascii=False))
from collections import Counter
print("总对齐:", len(slim), dict(Counter(p["tag"] for p in slim)))
