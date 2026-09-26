# -*- coding: utf-8 -*-
"""
2026-09-27 全量体检 · 第 0 步：统一数据集
精品层 js/data.js + js/data-more.js + 汤库 data/library/library.data.js
→ tools/checkup_all.json （1621 条，带 layer/src/cats/关键字段）
"""
import io, os, re, json, sys
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)

def extract_array(s):
    """取字符串里第一个平衡的 JSON 数组（从第一个 '[' 开始）"""
    i = s.find("[")
    d = 0; instr = False; esc = False
    for k in range(i, len(s)):
        ch = s[k]
        if instr:
            if esc: esc = False
            elif ch == "\\": esc = True
            elif ch == '"': instr = False
            continue
        if ch == '"': instr = True
        elif ch == "[": d += 1
        elif ch == "]":
            d -= 1
            if d == 0:
                return json.loads(s[i:k+1])
    raise ValueError("unbalanced array")

rows = []

# ---- 精品层 ----
for fn in ("js/data.js", "js/data-more.js"):
    src = io.open(T(*fn.split("/")), encoding="utf-8").read()
    arr = extract_array(src)
    for p in arr:
        rows.append({
            "layer": "core", "file": fn, "id": p.get("id"),
            "title": p.get("title") or "", "dispTitle": p.get("dispTitle") or "",
            "surface": p.get("surface") or "", "truth": p.get("truth") or "",
            "cats": p.get("cats") or [], "src": p.get("src") or "core",
            "srcNo": p.get("srcNo"), "lang": p.get("lang") or "zh",
            "_t": p.get("_t") or "", "quality": p.get("quality") or "",
            "mode": p.get("mode") or "truth",
        })

# ---- 汤库层 ----
src = io.open(T("data", "library", "library.data.js"), encoding="utf-8").read()
i = src.find("var SOUP_LIBRARY"); i = src.find("[", i)
d = 0; instr = False; esc = False; end = -1
for k in range(i, len(src)):
    ch = src[k]
    if instr:
        if esc: esc = False
        elif ch == "\\": esc = True
        elif ch == '"': instr = False
        continue
    if ch == '"': instr = True
    elif ch == "[": d += 1
    elif ch == "]":
        d -= 1
        if d == 0: end = k; break
lib = json.loads(src[i:end+1])
for p in lib:
    rows.append({
        "layer": "lib", "file": "data/library/library.data.js", "id": p.get("id"),
        "title": p.get("title") or "", "dispTitle": p.get("dispTitle") or "",
        "surface": p.get("surface") or "", "truth": p.get("truth") or "",
        "cats": p.get("cats") or [], "src": p.get("src") or "",
        "srcNo": p.get("srcNo"), "lang": p.get("lang") or "zh",
        "_t": p.get("_t") or "", "quality": p.get("quality") or "",
        "mode": p.get("mode") or "",
    })

io.open(T("tools", "checkup_all.json"), "w", encoding="utf-8").write(
    json.dumps(rows, ensure_ascii=False))
core_n = sum(1 for r in rows if r["layer"] == "core")
lib_n = len(rows) - core_n
print("精品层:", core_n, "汤库层:", lib_n, "合计:", len(rows))
from collections import Counter
tag = Counter()
for r in rows:
    for c in r["cats"]:
        if c in ("繁译简", "英译中", "日译中"): tag[c] += 1
print("翻译标签分布:", dict(tag))
ids = [r["id"] for r in rows]
print("id 全局唯一:", len(set(ids)) == len(ids))
