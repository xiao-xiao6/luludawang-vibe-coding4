# -*- coding: utf-8 -*-
"""2026-09-25 全库体检：精品100(js/data.js+data-more.js) + 汤库988(js/library.public.js)
检查：①污染汤面 ②空格/粘连/重复标点/超长汤面 ③汤面汤底错配 ④汤底尾部污染/残留
只读不改，结果写 tools/audit_20260925_report.txt
"""
import re, json, collections

BASE = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
OUT = open(BASE + r"\tools\audit_20260925_report.txt", "w", encoding="utf-8")

def w(*a):
    OUT.write(" ".join(str(x) for x in a) + "\n")

CJK = r"\u4e00-\u9fff"
FULLW = "\u3000\uff01\uff1f\uff1a\uff1b\uff0c"

def cjk_count(s): return len(re.findall("[" + CJK + "]", s))
def latin_count(s): return len(re.findall(r"[A-Za-z]", s))
def digit_count(s): return len(re.findall(r"\d", s))

def bigrams(s):
    s = re.sub(r"[^\u4e00-\u9fffA-Za-z0-9]", "", s)
    return set(s[i:i+2] for i in range(len(s)-1))

def overlap(a, b):
    A, B = bigrams(a), bigrams(b)
    if not A or not B: return 0.0
    return len(A & B) / min(len(A), len(B))

items = []

def load_js_array(path, varname):
    src = open(path, encoding="utf-8").read()
    i = src.index(varname)
    j = src.index("[", i)
    depth, k, instr, esc = 0, j, False, False
    while True:
        c = src[k]
        if instr:
            if esc: esc = False
            elif c == "\\": esc = True
            elif c == '"': instr = False
        else:
            if c == '"': instr = True
            elif c == "[": depth += 1
            elif c == "]":
                depth -= 1
                if depth == 0: break
        k += 1
    return json.loads(src[j:k+1])

try:
    for f, var, layer in ((BASE + r"\js\data.js", "PUZZLES", "精"),
                          (BASE + r"\js\data-more.js", "PUZZLES_MORE", "精"),
                          (BASE + r"\js\library.public.js", "SOUP_LIBRARY", "库")):
        arr = load_js_array(f, var)
        for p in arr:
            p["_layer"] = layer
            p["_file"] = f.split("\\")[-1]
            items.append(p)
        w(f"[load] {f.split(chr(92))[-1]} {var}: {len(arr)}")
except Exception as e:
    w("[FATAL] parse failed:", repr(e))
    raise SystemExit(1)

# 去重（id 层）
seen = collections.Counter(p.get("id") for p in items)
dups = [k for k, v in seen.items() if v > 1]
w(f"[total] {len(items)} 条，重复 id {len(dups)}: {dups[:10]}")
w(f"[len surface] 精={sum(1 for p in items if p['_layer']=='精')} 库={sum(1 for p in items if p['_layer']=='库')}")
w("")

def field(p, name): return str(p.get(name) or "")

flag = collections.defaultdict(list)

for p in items:
    sid = f"{p['_layer']}|{p.get('id','?')}|{field(p,'dispTitle') or field(p,'title') or field(p,'surface')[:12]}"
    s, t = field(p, "surface"), field(p, "truth")
    # ① 污染汤面
    if not s.strip(): flag["E-空汤面"].append((sid, ""))
    if len(s) > 400: flag["A1-超长汤面>400"].append((sid, f"len={len(s)}"))
    if latin_count(s) > 15 and cjk_count(s) == 0: flag["A2-纯英文/非中文汤面"].append((sid, s[:70]))
    if "【" in s or "】" in s: flag["A3-含【】标记"].append((sid, s[:70]))
    if ("http" in s) or ("www." in s) or (".com" in s): flag["A4-含链接"].append((sid, s[:70]))
    if re.search(r"[A-Za-z0-9]{20,}", s): flag["A5-疑似乱码长串"].append((sid, s[:70]))
    if "github" in s.lower() or "konpigg" in s.lower() or "astrbot" in s.lower(): flag["A6-含来源残留"].append((sid, s[:70]))
    # ② 空格 / 排版
    if re.search(r"\s", re.sub(r" +", " ", s).strip()) and re.search(r"[ " + CJK + r"] [" + CJK + r"]|[ " + CJK + r"]\s+", s):
        pass
    if re.search(r"[" + CJK + r"][ \t]{2,}[" + CJK + r"]", s): flag["B1-连续空格夹中文"].append((sid, s[:90]))
    if re.search(r"\[" + CJK + r"] [" + CJK + r"]", s): flag["B2-中文间单空格"].append((sid, s[:90]))
    if re.search(r"[^\x00-\xff]", s) and re.search(r"[" + CJK + r"][a-zA-Z\x00-\x7f]+[" + CJK + r"]", s) and re.search(r"[\u4e00-\u9fff][a-z]{2,}[\u4e00-\u9fff]", s): pass
    if re.search(r"(。|？|！|，){2,}", s): flag["B4-重复标点"].append((sid, s[:90]))
    if re.search(r"[，、。；：]{2,}", s) and not re.search(r"……|？！", s): pass
    if re.search(r"[" + CJK + r"][" + FULLW + r"]{0,1}[" + CJK + r"]", s) and "  " in s: flag["B5-含双空格"].append((sid, s[:90]))
    if "\u3000" in s: flag["B6-全角空格"].append((sid, s[:90]))
    # ③ 汤面汤底错配
    if t.strip():
        ov = overlap(s, t)
        if len(t) > 15 and ov < 0.06:
            flag["C1-汤面汤底几乎无交集"].append((sid, f"ov={ov:.3f} S={s[:46]}… T={t[:46]}…"))
    else:
        flag["C2-无汤底"].append((sid, ""))
    # ④ 汤底污染
    if re.search(r"\d{1,2}[、\.．]" + r"[，。！？、；]?$", t.strip()): flag["D1-汤底尾部编号"].append((sid, t[-50:]))
    m = re.search(r"。[^\u4e00-\u9fff]{0,3}(?:\d{1,2}[、\.．])?\s*(.{0,20})$", t.strip())
    if re.search(r"[，、。]\s*\d{1,2}[、\.．]\s*[^0-9]{1,12}$", t.strip()): flag["D2-汤底尾部疑似残留"].append((sid, t[-60:]))
    if "（编辑" in t or "（已" in t and "（已压缩）" in t: flag["D3-编辑标记"].append((sid, t[-60:]))
    if re.search(r"https?://|www\.|\.com|\.cn|\.net", t): flag["D4-含链接"].append((sid, t[-70:]))
    if re.search(r"(完|未完待续|接上|同上|见下|答案略|略…|……略)", t[-25:]): flag["D5-截断/略"].append((sid, t[-60:]))
    if "..." in t or "。。。" in t or "？？" in t: flag["D6-汤底重复标点"].append((sid, t[-60:]))
    if "\u3000" in t or re.search(r"[" + CJK + r"][ \t]{2,}[" + CJK + r"]", t): flag["D7-汤底空格异常"].append((sid, t[-60:]))
    if re.search(r"(作者|来源|出处|转载|整理|收集|upd|update|edit|ocr|OCR|校对)", t) and not re.search(r"转载", s): flag["D8-含元信息词"].append((sid, t[-60:]))

w("========== 汇总（按类） ==========")
for k in sorted(flag):
    w(f"{k}: {len(flag[k])}")
w("")
for k in sorted(flag):
    w(f"########## {k} ##########")
    for sid, ev in flag[k]:
        w(f"  - {sid}")
        if ev: w(f"      {ev}")
    w("")

# 额外：最长汤面前 30
w("########## 汤面长度 top30 ##########")
for p in sorted(items, key=lambda x: -len(field(x, "surface")))[:30]:
    w(f"  len={len(field(p,'surface'))} {p['_layer']}|{p.get('id')}|{(field(p,'dispTitle') or field(p,'title'))[:20]} | {field(p,'surface')[:80]}")

OUT.close()
print("done")
