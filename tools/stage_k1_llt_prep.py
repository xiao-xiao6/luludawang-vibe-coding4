# -*- coding: utf-8 -*-
"""
Stage K-1（Phase 2 · 日文源）：late-late.jp 净新增「定稿 + 切翻译批次」
输入：tools/llt_dump.json（fetch_llt.js 产出）
产出：tools/llt_fresh_final.json  +  tools/llt_trans_in/batch_*.json
规则（沿用 YNG 经验）：
 - 无汤底/无汤面一律剔除（纪律 1：无底题不 AI 补底）
 - 汤底过短(<8 字)或为占位（「なし」「未定」等）剔除
 - 汤面归一化后与库内重复者剔除
 - 同源变体保留（后续 alsoIn 处理）
"""
import io, os, re, json, sys
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
IN_DIR = T("tools", "llt_trans_in")
os.makedirs(IN_DIR, exist_ok=True)

dump = json.load(io.open(T("tools", "llt_dump.json"), encoding="utf-8"))
items = dump["items"]
print("抓取落地: %d 条（失败 %d）" % (len(items), len(dump.get("failed", []))))

# ---- 载入母本，做汤面去重 ----
MASTER = T("data", "library", "library.data.js")
src = io.open(MASTER, encoding="utf-8").read()
i = src.find("var SOUP_LIBRARY"); i = src.find("[", i)
end = src.find("\nvar SOUP_LIB_CATS", i)
lib = json.loads(src[i:end].rsplit("]", 1)[0] + "]")
print("母本现库:", len(lib))

PUNCT = re.compile(r"[\s\u3000，。、！？；：·…—－\-_,\.\!\?\;:\"'“”‘’（）()\[\]【】《》<>{}|/\\~`@#$%^&*+=「」『』]")
def norm(s): return PUNCT.sub("", (s or "").lower())
lib_norm = {norm(e.get("surface", "")) for e in lib}

PLACEHOLDER = re.compile(r"^(なし|無し|未定|秘密|ひみつ|なし。|不明|未解決)$")

# --- 非标准品类（体检实测）：这些不是「标准海龟汤」，按纪律硬剔除 ---
HARD_DROP_TAGS = ("ウミガメ風クロスワード", "ラテクエリサイクル", "20の扉")
# 需要人工复核的品类（先保留，但登记出来）
REVIEW_TAGS = ("画像あり！", "合作スープ", "リアル出題向きウミガメ")

# --- 编辑器噪音前缀（体检实测：见 #15615 / #7063 / #11248）---
PREFIX_TRUTH = re.compile(
    r"^\s*[.·。]?\s*(?:【《\s*答え\s*》】|【\s*解説\s*】|【\s*答え\s*】|【\s*正解\s*】|"
    r"《\s*答え\s*》|答え\s*[:：]|解答\s*[:：]|解説\s*[:：]|正解\s*[:：])\s*"
)
PREFIX_SURFACE = re.compile(r"^\s*[.·。]\s*")

def clean_text(s):
    s = PREFIX_TRUTH.sub("", s or "")
    s = PREFIX_SURFACE.sub("", s)
    s = re.sub(r"[ \t]{2,}", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()

fresh, dropped, review = [], [], []
for it in items:
    raw_surface = (it.get("surface") or "").strip()
    raw_truth = (it.get("truth") or "").strip()
    title = (it.get("title") or "").strip()
    lid = it.get("id")
    tags = it.get("tags") or []

    bad = [t for t in tags if t in HARD_DROP_TAGS]
    if bad:
        dropped.append({"id": lid, "why": "非标准品类:" + ",".join(bad)}); continue

    surface = clean_text(raw_surface)
    truth = clean_text(raw_truth)
    if not surface or not truth:
        dropped.append({"id": lid, "why": "空字段"}); continue
    if len(truth) < 8 or PLACEHOLDER.match(truth):
        dropped.append({"id": lid, "why": "汤底过短/占位"}); continue
    if not title:
        dropped.append({"id": lid, "why": "空标题"}); continue
    if norm(surface) in lib_norm:
        dropped.append({"id": lid, "why": "汤面与现库重复"}); continue

    if raw_surface != surface or raw_truth != truth:
        review.append({"id": lid, "why": "已清洗噪音前缀", "before": raw_truth[:60], "after": truth[:60]})
    if any(t in REVIEW_TAGS for t in tags):
        review.append({"id": lid, "why": "品类待复核:" + ",".join(t for t in tags if t in REVIEW_TAGS)})

    it["surface"] = surface
    it["truth"] = truth
    fresh.append(it)

print("定稿: %d 条 | 剔除 %d 条" % (len(fresh), len(dropped)))
for d in dropped[:40]:
    print("   剔除 #%s %s" % (d["id"], d["why"]))

json.dump({"items": fresh, "dropped": dropped},
          io.open(T("tools", "llt_fresh_final.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)

# ---- 切批次 ----
N = max(1, (len(fresh) + 31) // 32)   # 每批 <=32 条
base, rem = len(fresh) // N, len(fresh) % N
pos, chunks = 0, []
for k in range(N):
    size = base + (1 if k < rem else 0)
    chunks.append(fresh[pos:pos + size]); pos += size

for k, ch in enumerate(chunks, 1):
    payload = {"batch": k, "lang": "ja", "count": len(ch),
               "items": [{"id": c["id"], "title": c["title"], "surface": c["surface"], "truth": c["truth"]}
                         for c in ch]}
    io.open(os.path.join(IN_DIR, "batch_%02d.json" % k), "w", encoding="utf-8").write(
        json.dumps(payload, ensure_ascii=False, indent=1))
    print("  batch_%02d.json %2d 条  (%s ~ %s)" % (k, len(ch), ch[0]["id"], ch[-1]["id"]))

allids = [c["id"] for ch in chunks for c in ch]
assert len(allids) == len(fresh), "批次总数不符"
assert len(set(allids)) == len(allids), "批次间重复"
assert set(allids) == {c["id"] for c in fresh}, "批次与源不一致"
print("自检通过：%d 条全覆盖、无重复" % len(allids))
