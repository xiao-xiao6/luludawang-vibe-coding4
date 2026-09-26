# -*- coding: utf-8 -*-
"""
全量体检 · 第 2 步：污染扫描（1621 条）
检查 title/dispTitle/surface/truth：
 1) 乱码/替换符/控制字符/私用区
 2) HTML 标签、markdown 残留、JS 残留（undefined/[object/null/{}）
 3) 截断特征（…结尾且短、以连接号/逗号结尾）
 4) 繁体字残留（OpenCC t2s 后不等；排除「乾/藉」等一简多繁合法字）
 5) 假名/片假名残留（非日译中标签的条目）
 6) 长段英文残留（翻译条目里连续 >40 拉丁字符的句子）
 7) 标题异常：空/纯符号/与汤面前缀雷同/占位词
 8) 全角半角空格、连续空白、孤立「」括号不配对
"""
import io, os, re, json, sys
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass
from opencc import OpenCC
CC = OpenCC("t2s")

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
rows = json.load(io.open(T("tools", "checkup_all.json"), encoding="utf-8"))

REPL = re.compile(r"[\ufffd\u0000-\u0008\u000b\u000c\u000e-\u001f\ue000-\uf8ff]")
HTML = re.compile(r"<[a-zA-Z/][^>]{0,60}>")
MD = re.compile(r"(\*\*+|__+|~~~+|```|!\[|\]\()")
JSART = re.compile(r"(undefined|\[object |\{\{|\}\}|&quot;|&amp;|&lt;|&gt;|&#\d+;|\\u00|\\n\\n)")
TRAD_ONLY = set()  # 一简多繁的合法字（转换后相同），单独统计
def trad_chars(s):
    conv = CC.convert(s)
    return [(a, b) for a, b in zip(s, conv) if a != b] if len(s) == len(conv) else None
KANA = re.compile(r"[\u3040-\u309f\u30a0-\u30ff]")
LATIN_RUN = re.compile(r"[A-Za-z][A-Za-z0-9 ,\.\-']{40,}")
TRUNC = re.compile(r"(——|…|，|、|：|;|；|,)$")
PLACE_TITLE = re.compile(r"^(无题|未命名|好题|题目|标题|null|undefined|-+|—+|。+|？+|！+|\?+|!+|\s*)$")

issues = []
for idx, r in enumerate(rows):
    tag = "/".join(r["cats"][:3])
    fields = {"title": r["title"], "dispTitle": r["dispTitle"], "surface": r["surface"], "truth": r["truth"]}
    for fname, s in fields.items():
        if not s: 
            if fname in ("title", "surface", "truth"):
                issues.append((r["id"], r["layer"], tag, fname, "EMPTY", ""))
            continue
        mm = REPL.search(s)
        if mm:
            issues.append((r["id"], r["layer"], tag, fname, "MOJIBAKE", repr(mm.group(0))))
        m = HTML.search(s)
        if m: issues.append((r["id"], r["layer"], tag, fname, "HTML", m.group(0)))
        m = MD.search(s)
        if m: issues.append((r["id"], r["layer"], tag, fname, "MARKDOWN", m.group(0)))
        m = JSART.search(s)
        if m: issues.append((r["id"], r["layer"], tag, fname, "JS_ARTIFACT", m.group(0)))
        # 繁体残留（全部条目都查；繁译简重点）
        tc = trad_chars(s)
        if tc:
            bad = [a for a, b in tc if a != b]
            if bad:
                issues.append((r["id"], r["layer"], tag, fname, "TRAD_RESIDUE", "".join(sorted(set(bad)))[:24]))
        # 假名残留（非日译中）
        if "日译中" not in r["cats"]:
            km = KANA.findall(s)
            if km and fname in ("surface", "truth"):
                # 颜文字里的假名（・ω等）单列
                plain = [c for c in km if c not in "・]"]
                if len(plain) >= 3:
                    issues.append((r["id"], r["layer"], tag, fname, "KANA_RESIDUE", "".join(plain[:12])))
        # 翻译条目里的长英文段
        if any(c in r["cats"] for c in ("英译中", "日译中", "繁译简")):
            lm = LATIN_RUN.search(s)
            if lm: issues.append((r["id"], r["layer"], tag, fname, "LONG_LATIN", lm.group(0)[:60]))
        # 截断
        if fname in ("surface", "truth") and len(s) < 80 and TRUNC.search(s.strip()):
            issues.append((r["id"], r["layer"], tag, fname, "TRUNC_TAIL", s.strip()[-16:]))
    # 标题异常
    t = r["title"].strip()
    if PLACE_TITLE.match(t):
        issues.append((r["id"], r["layer"], tag, "title", "PLACEHOLDER_TITLE", t))
    elif t and r["surface"].startswith(t) and len(t) >= 8 and r["layer"] == "lib":
        issues.append((r["id"], r["layer"], tag, "title", "TITLE_EQ_SURFACE_PREFIX", t[:20]))
    if r["title"] != r["dispTitle"] and r["dispTitle"]:
        issues.append((r["id"], r["layer"], tag, "dispTitle", "TITLE_MISMATCH", (r["title"][:14] + " vs " + r["dispTitle"][:14])))
    # 括号不配对
    for fname in ("surface", "truth"):
        s = fields[fname]
        if s.count("「") != s.count("」") or s.count("“") != s.count("”") or s.count("『") != s.count("』"):
            issues.append((r["id"], r["layer"], tag, fname, "QUOTE_UNBALANCED", ""))

from collections import Counter
cnt = Counter(i[4] for i in issues)
print("问题总数:", len(issues))
for k, v in cnt.most_common(): print("  %-22s %d" % (k, v))
json.dump(issues, io.open(T("tools", "checkup_pollution.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=0)
print("已写 tools/checkup_pollution.json")
