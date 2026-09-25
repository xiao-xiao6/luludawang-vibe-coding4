# -*- coding: utf-8 -*-
"""空格/粘连/异常标点细查（修好上一版 B2 正则漏检的问题）+ 笔仙定位"""
import re, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
CJK = "\u4e00-\u9fff"

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
    for p in load_js_array(BASE + "\\" + f if False else f, var):
        p["_layer"] = layer
        items.append(p)

pat_sp_mid = re.compile("[" + CJK + "] {1,}[" + CJK + "]")
pat_sp_punct = re.compile("[" + CJK + "] +[，。！？、：；,.]")
pat_punct_sp = re.compile("[，。！？、：；] +[" + CJK + "]")
pat_dup_punct = re.compile("(。。|，，|？？|！！|、、|：：|，。|。？|？。|,，|，,)")

rows_sp = []
rows_dup = []
for p in items:
    s = str(p.get("surface") or "")
    sid = f"{p['_layer']}|{p.get('id','?')}|{(p.get('dispTitle') or p.get('title') or s[:10])[:18]}"
    hits = []
    for m in list(pat_sp_mid.finditer(s))[:4]:
        hits.append("|" + s[max(0, m.start()-8):m.end()+8].replace("\n", " ") + "|")
    for m in list(pat_sp_punct.finditer(s))[:2]:
        hits.append("~" + s[max(0, m.start()-6):m.end()+6] + "~")
    for m in list(pat_punct_sp.finditer(s))[:2]:
        hits.append("^" + s[max(0, m.start()-6):m.end()+6] + "^")
    if hits:
        rows_sp.append((sid, len(s), "  ///  ".join(hits)[:150]))
    d = pat_dup_punct.findall(s)
    if d:
        rows_dup.append((sid, "".join(set(d)), s[:60]))

print("== 中文之间夹空格(含标点旁空格):", len(rows_sp))
for r in rows_sp[:70]:
    print("  -", r[0], "len", r[1], "=>", r[2])
print("== 重复/相邻异类标点:", len(rows_dup))
for r in rows_dup[:40]:
    print("  -", r[0], r[1], "=>", r[2])

# 笔仙
print("== 笔仙定位 ==")
for p in items:
    blob = json.dumps(p, ensure_ascii=False)
    if "笔仙" in blob or "筆仙" in blob:
        print("  FOUND", p["_layer"], p.get("id"), "|", str(p.get("title")), "|", str(p.get("dispTitle")))
        print("   SURFACE:", str(p.get("surface")))
