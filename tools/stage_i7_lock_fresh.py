# -*- coding: utf-8 -*-
"""
Stage I-7：锁定 YesNoGame 净新增清单（只读 + 产出）
依据 Stage I-6 词级匹配（去掉停用词后按英文词比对）：
  A 高置信重复 >=0.70  → 剔除
  C 待判 0.40~0.55     → 暂缓
  超长/多问句（疑似解析串味）→ 暂缓
产出：tools/yng_fresh_final.json（待翻译入库）
"""
import io, os, json, sys
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)

recs = json.load(io.open(T("tools", "yng_wordmatch.json"), encoding="utf-8"))
en = json.load(io.open(T("tools", "en_dump.json"), encoding="utf-8"))
POOL = {e["id"]: e for e in en}

def sc(r): return max(r["t"], r["a"])
A = sorted([r for r in recs if sc(r) >= 0.70], key=lambda x: -sc(x))
C = sorted([r for r in recs if 0.40 <= sc(r) < 0.55], key=lambda x: -sc(x))
FLAG = {"205", "207", "208", "213", "229"}          # 超长/多问句，暂缓人工复核
flagged = [r for r in recs if r["id"] in FLAG]
excl = {r["id"] for r in A} | {r["id"] for r in C} | FLAG
fresh = sorted([r for r in recs if r["id"] not in excl], key=lambda x: int(x["id"]))

print("总 %d | A高置信 %d | C待判 %d | 超长暂缓 %d | 净新增 %d"
      % (len(recs), len(A), len(C), len(flagged), len(fresh)))
print("\n" + "=" * 78)
print("A. 高置信重复 —— 逐条验明（左侧 YNG / 右侧库内）")
print("=" * 78)
for r in A:
    p = POOL.get(r["with_id"], {})
    print("-" * 78)
    print("YNG#%-4s《%s》 T=%.2f A=%.2f  ←→  %s《%s》"
          % (r["id"], r["title"][:32], r["t"], r["a"], r["with_id"], (p.get("title") or "")[:20]))
    print("  YNG 面: %s" % r["surface"][:190].replace("\n", " "))
    print("  YNG 底: %s" % r["truth"][:190].replace("\n", " "))
    print("  库  面: %s" % (p.get("surface") or "")[:190].replace("\n", " "))
    print("  库  底: %s" % (p.get("truth") or "")[:190].replace("\n", " "))

print("\n" + "=" * 78)
print("C. 待判（%d 条，暂缓）" % len(C))
print("=" * 78)
for r in C:
    p = POOL.get(r["with_id"], {})
    print("  YNG#%-4s《%s》 T=%.2f A=%.2f ←→ %s" % (r["id"], r["title"][:30], r["t"], r["a"], r["with_id"]))
    print("     面: %s" % r["surface"][:150].replace("\n", " "))

print("\n" + "=" * 78)
print("超长/多问句暂缓（%d 条）: %s" % (len(flagged), sorted(FLAG)))
print("=" * 78)

items = [{"id": r["id"], "title": r["title"], "surface": r["surface"], "truth": r["truth"],
          "url": "https://yesnogame.net/en/stories/%s" % r["id"]} for r in fresh]
json.dump({"items": items, "excluded": {"high_conf_dup": sorted([r["id"] for r in A]),
                                        "pending": sorted([r["id"] for r in C]),
                                        "flagged_long": sorted(FLAG)}},
          io.open(T("tools", "yng_fresh_final.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("\n>>> 已写入 tools/yng_fresh_final.json：%d 条待翻译" % len(items))
print(">>> 汤底长度中位数: %d | <40 字符: %d" % (
    sorted(len(i["truth"]) for i in items)[len(items) // 2],
    sum(1 for i in items if len(i["truth"]) < 40)))
