# -*- coding: utf-8 -*-
"""
late-late.jp 落地数据体检（Phase 2 · 只读 dump，不发请求）
产出：tools/llt_health_report.txt（UTF-8）
"""
import io, os, re, json, sys
from collections import Counter

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)

L = []
def say(s): L.append(str(s))

try:
    d = json.load(io.open(T("tools", "llt_dump.json"), encoding="utf-8"))
except Exception as e:
    io.open(T("tools", "llt_health_report.txt"), "w", encoding="utf-8").write("dump 读取失败(可能正在写入): %s" % e)
    sys.exit(0)

its, fails = d["items"], d.get("failed", [])
say("=== late-late.jp 体检 ===")
say("成功 %d 条 | 失败/剔除 %d 条" % (len(its), len(fails)))
say("失败码分布: %s" % dict(Counter(f.get("code") for f in fails)))
say("")

if not its:
    io.open(T("tools", "llt_health_report.txt"), "w", encoding="utf-8").write("\n".join(L))
    sys.exit(0)

# 1) 标签分布
tc = Counter()
for it in its:
    for t in it.get("tags", []) or []:
        tc[t] += 1
say("--- 标签 top 40 ---")
for t, n in tc.most_common(40):
    say("  %3d  %s" % (n, t))
say("")

# 2) 汤底开头的“噪音前缀”
say("--- 汤底开头 12 字 分布 top 25 ---")
for t, n in Counter((it["truth"] or "")[:12] for it in its).most_common(25):
    say("  %3d  %r" % (n, t))
say("")

# 3) 汤面开头
say("--- 汤面开头 8 字 分布 top 20 ---")
for t, n in Counter((it["surface"] or "")[:8] for it in its).most_common(20):
    say("  %3d  %r" % (n, t))
say("")

# 4) 噪音统计
pats = {
    "汤面以 '.' 开头": lambda it: (it["surface"] or "").startswith("."),
    "汤面以 '。' 开头": lambda it: (it["surface"] or "").startswith("。"),
    "汤底以 '.' 开头": lambda it: (it["truth"] or "").startswith("."),
    "汤底含 【": lambda it: "【" in (it["truth"] or ""),
    "汤底含 《": lambda it: "《" in (it["truth"] or ""),
    "汤底含 答え": lambda it: "答え" in (it["truth"] or ""),
    "汤底含 解説": lambda it: "解説" in (it["truth"] or ""),
    "汤底含 正解": lambda it: "正解" in (it["truth"] or ""),
    "汤底含 ……（分隔线）": lambda it: "……" in (it["truth"] or ""),
    "汤面含 画像": lambda it: "画像" in (it["surface"] or ""),
}
say("--- 噪音命中统计（n=%d）---" % len(its))
for k, f in pats.items():
    hits = [it["id"] for it in its if f(it)]
    say("  %-22s %3d  %s" % (k, len(hits), hits[:18]))
say("")

# 5) 疑似非海龟汤品类（标签维度）
BAD_TAGS = ["20の扉", "ウミガメ風クロスワード", "ラテクエリサイクル", "画像あり！", "合作スープ"]
say("--- 疑似非标准品类（含这些标签的题）---")
for bt in BAD_TAGS:
    hits = [it["id"] for it in its if bt in (it.get("tags") or [])]
    if hits:
        say("  标签<%s>: %d 条 %s" % (bt, len(hits), hits[:20]))
        for it in its:
            if bt in (it.get("tags") or []):
                say("     #%s《%s》 truth=%r" % (it["id"], it["title"][:26], (it["truth"] or "")[:70]))
                break
say("")

# 6) 长度极值
tl = sorted((len(it["truth"] or ""), it["id"]) for it in its)
say("--- 汤底最短 15 条 ---")
for n, i in tl[:15]:
    it = next(x for x in its if x["id"] == i)
    say("  #%s len=%3d 《%s》 %r" % (i, n, it["title"][:22], (it["truth"] or "")[:60]))
say("--- 汤底最长 10 条 ---")
for n, i in tl[-10:]:
    it = next(x for x in its if x["id"] == i)
    say("  #%s len=%4d 《%s》 %r" % (i, n, it["title"][:22], (it["truth"] or "")[:90]))
say("")

med = tl[len(tl)//2][0] if tl else 0
say("汤底长度: min=%d 中位=%d max=%d | <20 字符 %d 条 | >1200 字符 %d 条"
    % (tl[0][0] if tl else 0, med, tl[-1][0] if tl else 0,
       sum(1 for n, _ in tl if n < 20), sum(1 for n, _ in tl if n > 1200)))

# 7) 取 3 条长汤底样本，看是否有 Q&A 历史残留
say("")
say("--- 最长 2 条汤底全文（查评论区残留）---")
for n, i in tl[-2:]:
    it = next(x for x in its if x["id"] == i)
    say("### #%s《%s》 len=%d" % (i, it["title"], n))
    say((it["truth"] or "")[:2400])
    say("")

io.open(T("tools", "llt_health_report.txt"), "w", encoding="utf-8").write("\n".join(L))
print("report -> tools/llt_health_report.txt")
