# -*- coding: utf-8 -*-
"""
Stage I-9：YesNoGame 净新增「定稿」
本轮修正三处误判：
  1) 5 条「超长」(#205/207/208/213/229) 经人工核验为**完整好题**（叙事型长汤面），非解析串味 → 回收
  2) #392《Friday》与库内「没有奖杯」是两道不同的题（阈值误伤）→ 回收
  3) #205 汤底含 "Hints for guessers" 编辑器残留 → 清洗后入库
并逐条验明 9 条高置信重复，输出最终清单与翻译批次。
产出：tools/yng_fresh_final.json + tools/yng_trans_in/batch_*.json
"""
import io, os, re, json, sys
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
IN_DIR = T("tools", "yng_trans_in")
os.makedirs(IN_DIR, exist_ok=True)

recs = json.load(io.open(T("tools", "yng_wordmatch.json"), encoding="utf-8"))
R = {int(r["id"]): r for r in recs}
en = json.load(io.open(T("tools", "en_dump.json"), encoding="utf-8"))
POOL = {e["id"]: e for e in en}

def sc(r): return max(r["t"], r["a"])

# ---------- 1) 逐条验明 9 条高置信重复 ----------
A = sorted([r for r in recs if sc(r) >= 0.70], key=lambda x: -sc(x))
print("=" * 78)
print("逐条验明「高置信重复」（比对汤面+汤底全文）")
print("=" * 78)
confirmed_dup, false_pos = [], []
for r in A:
    p = POOL.get(r["with_id"], {})
    yng = (r["surface"] + " " + r["truth"]).lower()
    lib = ((p.get("surface") or "") + " " + (p.get("truth") or "")).lower()
    # 关键实词重合度（去停用词后的词集 Dice）
    wa = set(re.findall(r"[a-z]{4,}", yng)); wb = set(re.findall(r"[a-z]{4,}", lib))
    d = 2 * len(wa & wb) / max(1, len(wa) + len(wb))
    tag = "确认为同一题" if (r["t"] >= 0.70 or d >= 0.55) else "疑似误伤"
    (confirmed_dup if tag == "确认为同一题" else false_pos).append(r)
    print("-" * 78)
    print("YNG#%-4s《%s》 T=%.2f A=%.2f 词重合=%.2f  <%s>  ←→ %s《%s》"
          % (r["id"], r["title"][:30], r["t"], r["a"], d, tag, r["with_id"], (p.get("title") or "")[:18]))
    print("  YNG 底: %s" % r["truth"][:150].replace("\n", " "))
    print("  库  底: %s" % (p.get("truth") or "")[:150].replace("\n", " "))

print("\n>>> 确认重复 %d 条: %s" % (len(confirmed_dup), sorted(int(r["id"]) for r in confirmed_dup)))
print(">>> 疑似误伤 %d 条: %s" % (len(false_pos), sorted(int(r["id"]) for r in false_pos)))

# ---------- 2) 清洗 #205 汤底残留 ----------
def clean_truth(tid, t):
    if tid == 205:
        t = re.sub(r"^\s*Hints for guessers:[\s\S]*?Answer:\s*", "", t).strip()
        t = re.split(r"\n\s*More mystics", t)[0].strip()
    return t

# ---------- 3) 定稿清单 ----------
RECOVER = {205, 207, 208, 213, 229, 392}          # 回收（误判修正）
dup_ids = {int(r["id"]) for r in confirmed_dup}
fresh = sorted([r for r in recs if int(r["id"]) not in dup_ids], key=lambda x: int(x["id"]))

items = [{"sid": int(r["id"]), "title": r["title"],
          "surface": r["surface"], "truth": clean_truth(int(r["id"]), r["truth"]),
          "url": "https://yesnogame.net/en/stories/%s" % r["id"]} for r in fresh]

json.dump({"items": items,
           "excluded": {"confirmed_dup": sorted(dup_ids),
                        "false_pos_recovered": sorted(RECOVER)}},
          io.open(T("tools", "yng_fresh_final.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

print("\n" + "=" * 78)
print("定稿：233 − %d 重复 = %d 条待翻译（已回收 5 条长题 + #392）" % (len(dup_ids), len(items)))
print("=" * 78)
tl = sorted(len(i["truth"]) for i in items)
print("汤底长度 中位数 %d | <40字符 %d | 汤面最长 %d" % (
    tl[len(tl)//2], sum(1 for i in items if len(i["truth"]) < 40), max(len(i["surface"]) for i in items)))

# ---------- 4) 切批次 ----------
N = 7
base, rem = len(items) // N, len(items) % N
pos, chunks = 0, []
for k in range(N):
    size = base + (1 if k < rem else 0)
    chunks.append(items[pos:pos + size]); pos += size
for k, ch in enumerate(chunks, 1):
    io.open(os.path.join(IN_DIR, "batch_%02d.json" % k), "w", encoding="utf-8").write(
        json.dumps({"batch": k, "count": len(ch), "items": ch}, ensure_ascii=False, indent=1))
    print("  batch_%02d.json  %2d 条  (%s ~ %s)" % (k, len(ch), ch[0]["sid"], ch[-1]["sid"]))

assert len({i["sid"] for it in chunks for i in it}) == len(items), "批次不一致"
assert all(i["surface"].strip() and i["truth"].strip() for i in items), "空字段"
print("\n自检通过：%d 条全覆盖、无重复、无空字段" % len(items))
