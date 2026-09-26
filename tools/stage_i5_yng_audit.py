# -*- coding: utf-8 -*-
"""
Stage I-5：YesNoGame 去重结论「假阳性审计」（只读）
背景：Stage I-4 用「汤底 Dice>=0.45」判定重复，得出 233 条里 161 条重复、仅 5 条新增。
      这个结论过于激进，必须先验证是真重复还是阈值误伤。
做法：把 dup 按置信度分档，逐档抽样对照全文；fresh 全部逐条复核。
产出：tools/yng_dedup_audit.txt
"""
import io, os, re, json, sys
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)

fin = json.load(io.open(T("tools", "yng_final.json"), encoding="utf-8"))
dup, review, fresh = fin["dup"], fin["review"], fin["fresh"]
en = json.load(io.open(T("tools", "en_dump.json"), encoding="utf-8"))
POOL = {e["id"]: e for e in en}

out = []
P = lambda s="": out.append(s)

# ---------- 1) dup 置信度分档 ----------
certain  = [d for d in dup if max(d["s"], d["t"]) >= 0.80 or d["t"] >= 0.85]
likely   = [d for d in dup if d not in certain and (d["t"] >= 0.60)]
border   = [d for d in dup if d not in certain and d not in likely]
P("=" * 78)
P("dup 分档：确定 %d | 较可信 %d | 边界（疑似误伤）%d | 合计 %d" % (len(certain), len(likely), len(border), len(dup)))
P("review %d | fresh %d" % (len(review), len(fresh)))
P("=" * 78)

# ---------- 2) 边界档抽样全文对照 ----------
P("")
P("【边界档抽样：若语义不符，即为误伤，须回收到新增】")
for d in sorted(border, key=lambda x: -x["t"])[:10]:
    p = POOL.get(d["with_id"], {})
    P("-" * 78)
    P("YNG#%s 《%s》  S=%.2f T=%.2f   ←→ 库内 %s《%s》" % (d["id"], d["title"], d["s"], d["t"], d["with_id"], (p.get("title") or "")))
    P("  YNG 汤面: %s" % d["surface"][:260].replace("\n", " "))
    P("  YNG 汤底: %s" % d["truth"][:260].replace("\n", " "))
    P("  库内汤面: %s" % (p.get("surface") or "")[:200].replace("\n", " "))
    P("  库内汤底: %s" % (p.get("truth") or "")[:200].replace("\n", " "))

# ---------- 3) 较可信档抽样（确认阈值是否合理）----------
P("")
P("【较可信档抽样：验证是否真同题】")
for d in sorted(likely, key=lambda x: -x["t"])[:8]:
    p = POOL.get(d["with_id"], {})
    P("-" * 78)
    P("YNG#%s 《%s》  S=%.2f T=%.2f   ←→ 库内《%s》" % (d["id"], d["title"], d["s"], d["t"], (p.get("title") or "")))
    P("  YNG 汤底: %s" % d["truth"][:200].replace("\n", " "))
    P("  库内汤底: %s" % (p.get("truth") or "")[:200].replace("\n", " "))

# ---------- 4) fresh 全量复核 ----------
P("")
P("=" * 78)
P("【净新增全部 %d 条（需逐条确认确实不在库内）】" % len(fresh))
P("=" * 78)
for f in fresh:
    P("")
    P("YNG#%s  《%s》" % (f["id"], f["title"]))
    P("  汤面: %s" % f["surface"][:220].replace("\n", " "))
    P("  汤底: %s" % f["truth"][:220].replace("\n", " "))

io.open(T("tools", "yng_dedup_audit.txt"), "w", encoding="utf-8").write("\n".join(out))
print("\n".join(out[:60]))
print("\n...[全文见 tools/yng_dedup_audit.txt，共 %d 行]" % len(out))
