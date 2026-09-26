# -*- coding: utf-8 -*-
"""体检第 3 步：定向排查
A. 精品100 vs 汤库1521 跨层相似（低阈值 0.30，经典题防重）
B. 全库同名标题
C. 汤库 src 含 OCR/合集 的条目清单
D. 通用文本伪影扫描：CJK?CJK、'一一'、句中孤立'1'、同字段内重复长片段
"""
import io, os, re, json, sys
from collections import defaultdict
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
rows = json.load(io.open(T("tools", "checkup_all.json"), encoding="utf-8"))
PUNCT = re.compile(r"[\s\u3000，。、！？；：·…—－\-_,\.\!\?\;:\"'“”‘’（）()\[\]【】《》<>{}|/\\~`@#$%^&*+=「」『』※★☆●○■□◇♡]+")
def norm(s): return PUNCT.sub("", (s or "").lower())
def bg(s):
    s = norm(s)
    return set(s[i:i+2] for i in range(len(s)-1)) if len(s) > 1 else ({s} if s else set())
def jac(a, b): return (len(a & b) / len(a | b)) if (a and b) else 0.0

core = [i for i, r in enumerate(rows) if r["layer"] == "core"]
lib = [i for i, r in enumerate(rows) if r["layer"] == "lib"]
bs = {i: bg(rows[i]["surface"]) for i in range(len(rows))}
bt = {i: bg(rows[i]["truth"]) for i in range(len(rows))}
print("===== A. 精品 vs 汤库（面或底 jac>=0.30）=====")
hits = []
for ci in core:
    for li in lib:
        js = jac(bs[ci], bs[li]); jt = jac(bt[ci], bt[li])
        if max(js, jt) >= 0.30:
            hits.append((max(js, jt), js, jt, ci, li))
hits.sort(key=lambda x: -x[0])
for sc, js, jt, ci, li in hits:
    a, b = rows[ci], rows[li]
    print("=== %.2f 面%.2f 底%.2f" % (sc, js, jt))
    print(" [精品] %s | %s" % (a["id"], a["title"][:24]))
    print("   面:", a["surface"][:80].replace("\n", " "))
    print(" [汤库] %s | %s | %s" % (b["id"], b["title"][:24], b["src"][:20]))
    print("   面:", b["surface"][:80].replace("\n", " "))

print("\n===== B. 同名标题（汤库内）=====")
tmap = defaultdict(list)
for r in rows:
    t = (r["title"] or "").strip()
    if t and len(t) >= 3: tmap[t].append(r)
for t, v in sorted(tmap.items()):
    if len(v) > 1:
        print("「%s」 x%d" % (t[:20], len(v)))
        for r in v:
            print("   %s [%s|%s] 面:%s" % (r["id"], r["layer"], r["src"][:18], norm(r["surface"])[:34]))

print("\n===== C. OCR/合集类来源 =====")
srcn = defaultdict(int)
for r in rows:
    if r["layer"] == "lib" and ("OCR" in r["src"] or "许二木" in r["src"] or "rokid" in r["src"]):
        srcn[r["src"]] += 1
print(dict(srcn))

print("\n===== D. 文本伪影 =====")
RE_Q = re.compile(r"[\u4e00-\u9fff]\?[\u4e00-\u9fff]")
RE_DASH = re.compile(r"[\u4e00-\u9fff]一一[\u4e00-\u9fff]")
RE_ONE = re.compile(r"[\u4e00-\u9fff]1[\u4e00-\u9fff]")
nq = nd = no = nr = 0
for r in rows:
    for f in ("surface", "truth"):
        s = r[f]
        if not s: continue
        for m in RE_Q.finditer(s):
            nq += 1
            print("QMARK %s %s …%s…" % (r["id"], f, s[max(0,m.start()-10):m.end()+10].replace("\n"," ")))
            break
        for m in RE_DASH.finditer(s):
            nd += 1
            print("DASH  %s %s …%s…" % (r["id"], f, s[max(0,m.start()-8):m.end()+8].replace("\n"," ")))
            break
        for m in RE_ONE.finditer(s):
            seg = s[max(0,m.start()-6):m.end()+6].replace("\n"," ")
            no += 1
            print("ONE   %s %s …%s…" % (r["id"], f, seg))
            break
        # 同字段重复长片段（>=30字出现两次）
        n = norm(s)
        seen = {}
        L = 30
        dup = False
        for k in range(0, max(0, len(n)-L), 10):
            seg = n[k:k+L]
            if seg in seen and seen[seg] != k:
                dup = True; break
            seen[seg] = k
        if dup:
            nr += 1
            print("DUPSEG %s [%s|%s] %s" % (r["id"], r["layer"], r["src"][:18], r["title"][:16]))
print("伪影计数: QMARK=%d DASH=%d ONE=%d DUPSEG=%d" % (nq, nd, no, nr))
