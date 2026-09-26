# -*- coding: utf-8 -*-
"""
Stage I-3：YesNoGame 采集结果分诊（只读 + 产出候选清单）
做三件事：
  A. 超长/多问句汤面 → 污染体检（疑似混入多题、推荐位、评论区）
  B. soft 重复的命中分布分析（找出「hub」条目，避免误判）
  C. 生成最终入库候选 tools/yng_fresh.json（剔除硬重复 + 超长可疑）
输出：tools/yng_triage_report.txt（UTF-8，避免控制台编码问题）
"""
import io, os, re, json, sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)

items = json.load(io.open(T("tools", "yng_dump.json"), encoding="utf-8"))["items"]
en = json.load(io.open(T("tools", "en_dump.json"), encoding="utf-8"))
drop = set(json.load(io.open(T("tools", "en_drop.json"), encoding="utf-8"))["drop"])
POOL = {e["id"]: e for e in en if e["id"] not in drop and e["id"] != "lib_cc9e2fec9557"}

SRC = io.open(T("data", "library", "library.data.js"), encoding="utf-8").read()
i = SRC.find("var SOUP_LIBRARY"); i = SRC.find("[", i)
end = SRC.find("\nvar SOUP_LIB_CATS", i)
master = {e["id"]: e for e in json.loads(SRC[i:end].rsplit("]", 1)[0] + "]")}

ana = json.load(io.open(T("tools", "yng_analysis.json"), encoding="utf-8"))
hard, soft = ana["hard_dup"], ana["soft_dup"]

out = []
P = lambda s="": out.append(s)

# ---------- A. 超长汤面污染体检 ----------
SUS = ["related", "comments", "share", "next story", "previous puzzle", "login", "register",
       "cookie", "vote", "submit", "add a comment", "rate this", "all rights"]
longs = sorted([x for x in items if len(x["surface"]) > 400], key=lambda x: -len(x["surface"]))
P("=" * 78)
P("A. 超长汤面体检（>400 字符，共 %d 条）" % len(longs))
P("=" * 78)
flag_hold = []
for x in longs:
    s = x["surface"]
    blocks = [b for b in re.split(r"\n\s*\n", s) if b.strip()]
    q = s.count("?")
    sus = [w for w in SUS if w in s.lower()]
    bad = len(blocks) > 4 or q > 3 or bool(sus)
    if bad:
        flag_hold.append(x["id"])
    P("  #%-5s %-32s len=%-5d blocks=%-2d q=%d susp=%s%s"
      % (x["id"], x["title"][:32], len(s), len(blocks), q, sus, "   <== 暂缓" if bad else ""))

# ---------- B. hub 分析 ----------
P("")
P("=" * 78)
P("B. soft 重复命中分布（识别 hub 条目，防误判）")
P("=" * 78)
cnt = {}
for s in soft:
    cnt[s["with_id"]] = cnt.get(s["with_id"], 0) + 1
for k, v in sorted(cnt.items(), key=lambda x: -x[1])[:10]:
    m = master.get(k); p = POOL.get(k)
    psl = len((p or {}).get("surface", ""))
    P("  %s  ×%-3d | 在现库:%s | 标题:%s | 对照池汤面长度:%d"
      % (k, v, bool(m), (m or {}).get("title"), psl))
longhit = [s for s in soft if len((POOL.get(s["with_id"]) or {}).get("surface", "")) > 300]
P("  soft 中命中「长文本条目」的对数: %d / %d" % (len(longhit), len(soft)))

# ---------- C. 最终候选 ----------
hard_ids = {h["id"] for h in hard}
final, held = [], []
for x in items:
    if x["id"] in hard_ids:
        held.append({"id": x["id"], "title": x["title"], "why": "与已入库英译中重复"})
    elif x["id"] in flag_hold:
        held.append({"id": x["id"], "title": x["title"], "why": "超长/多问句，疑似解析串味"})
    else:
        final.append(x)

json.dump({"items": final, "held": held}, io.open(T("tools", "yng_fresh.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)

P("")
P("=" * 78)
P("C. 入库候选")
P("=" * 78)
P("  硬重复剔除 : %d 条  %s" % (len(hard_ids), sorted(hard_ids)))
P("  超长暂缓   : %d 条  %s" % (len(flag_hold), sorted(flag_hold)))
P("  最终候选   : %d 条" % len(final))
P("  其中汤底<40字符: %d 条" % sum(1 for x in final if len(x["truth"]) < 40))
P("  汤底长度中位数: %d" % sorted(len(x["truth"]) for x in final)[len(final) // 2])

io.open(T("tools", "yng_triage_report.txt"), "w", encoding="utf-8").write("\n".join(out))
print("\n".join(out))
print("\n[已写入 tools/yng_triage_report.txt 与 tools/yng_fresh.json]")
