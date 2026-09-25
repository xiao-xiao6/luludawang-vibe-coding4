# -*- coding: utf-8 -*-
"""2026-09-25 污染专项扫描（只读）：
汤面混入代码/AI设定文本/链接来源/乱码标点；汤底尾部编号残留/来源元信息/未完占位；
重复汤面；中长汤面清单。输出分类明细 + tools/pollution_20260925.json 修复候选。"""
import re, json, io, sys, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"

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

items = []
for f, var, layer in ((BASE + r"\js\data.js", "PUZZLES", "精"),
                      (BASE + r"\js\data-more.js", "PUZZLES_MORE", "精"),
                      (BASE + r"\js\library.public.js", "SOUP_LIBRARY", "库")):
    for p in load_js_array(f, var):
        p["_layer"] = layer
        items.append(p)

CODE_PAT = re.compile(r"(```|expect\(|=>|function\s|require\(|import\s|\bdef\s|module\.exports|JSON\.|\.js\b|\.py\b|\bdef main|toMatchObject|assertEqual|print\()")
AGENT_PAT = re.compile(r"(开场白|游戏启动|请执行|提示用户|你需要在回答|作为AI|作为人工智能|原封不动|接下来请|请你扮演|你是.{0,6}(裁判|主持人|汤主)|系统提示|role\s*[:：]\s*(user|system))")
LINK_PAT = re.compile(r"(https?://|www\.|\.com/|\.com\b|example\.test|\]\(http|mailto:)")
SRC_PAT = re.compile(r"(KONpiGG|boop-yyt|astrbot|YanJiaHuan|hongqipiaopiao|许二木|转载|来源[:：]|出处[:：]|\(JM\)|\(RA )")
ODD_PAT = re.compile(r"([。，；]\.{2,}|……[。；]\.|5\s*;|;\s*-那|\?{2,}|!{2,}|，，|。。|,,|——{1}[^——]|[a-zA-Z]{0,3}\uFFFD)")

CAT = collections.defaultdict(list)

def meta(p, s):
    return f"{p['_layer']}|{p.get('id')}|{(str(p.get('dispTitle') or p.get('title') or '') or s[:14])[:22]}"

for p in items:
    s = str(p.get("surface") or "")
    t = str(p.get("truth") or "")
    m = meta(p, s)
    if CODE_PAT.search(s):  CAT["S1-汤面混入代码"].append((m, s[:150]))
    if AGENT_PAT.search(s): CAT["S2-汤面混入AI设定"].append((m, s[:150]))
    if LINK_PAT.search(s):  CAT["S3-汤面含链接"].append((m, s[:120]))
    if SRC_PAT.search(s):   CAT["S4-汤面含来源标记"].append((m, s[:120]))
    if ODD_PAT.search(s):   CAT["S5-汤面乱码标点"].append((m, s[:150]))
    # 汤底污染
    if re.search(r"[。！？”]\\s*(?:[^。！？\\n]{0,4})?\\d{1,2}[、.．][^。]{0,25}\\s*$", t):
        CAT["T1-汤底尾部编号残留"].append((m, t[-80:]))
    if LINK_PAT.search(t) or SRC_PAT.search(t):
        CAT["T2-汤底含来源/链接"].append((m, t[-80:]))
    if CODE_PAT.search(t):
        CAT["T3-汤底混入代码"].append((m, t[-120:]))
    if re.search(r"(未完待续|（未完|待补充|答案见下|如下所示|省略$)", t):
        CAT["T4-汤底未完/占位"].append((m, t[-60:]))

# 重复汤面
def norm(x): return re.sub(r"[^0-9A-Za-z\u4e00-\u9fff]", "", x)
seen = collections.defaultdict(list)
for p in items:
    s = str(p.get("surface") or "")
    if len(s) >= 20: seen[norm(s)].append(str(p.get("id")))
dup = {k: v for k, v in seen.items() if len(v) > 1}

# 纯英文汤面统计（合法英文题 vs 真乱码）
en = [p for p in items if not re.search(r"[\u4e00-\u9fff]", str(p.get("surface") or "")) and re.search(r"[A-Za-z]{6}", str(p.get("surface") or ""))]

print("== 分类计数 ==")
for k in sorted(CAT): print(f"  {k}: {len(CAT[k])}")
print(f"  DUP-重复汤面组: {len(dup)}")
print(f"  EN-纯英文汤面(合法保留): {len(en)}")
print()
for k in sorted(CAT):
    print(f"########## {k} ##########")
    for m, ev in CAT[k]:
        print("  -", m)
        print("      ", ev.replace(chr(10), "⏎"))
    print()
print("########## DUP ##########")
for k, v in list(dup.items())[:40]:
    print("  -", k[:36], "=>", v)

json.dump({k: [list(x) for x in v] for k, v in CAT.items()},
          open(BASE + r"\tools\pollution_20260925.json", "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
print("\n[saved] tools/pollution_20260925.json")
