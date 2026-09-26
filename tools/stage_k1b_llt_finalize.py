# -*- coding: utf-8 -*-
"""
Stage K-1b（Phase 2 · 日文源 late-late.jp）：定稿 + 切翻译批次
输入：tools/llt_dump.json（fetch_llt.js 产出，273 条）
产出：tools/llt_fresh_final.json + tools/llt_trans_in/batch_*.json + tools/llt_k1_report.txt

闸门（全部基于 2026-09-26 实测体检结论）：
 D1 无汤面/无汤底            → 剔除（纪律 1：无底题不 AI 补底）
 D2 汤底 <20 字或占位词       → 剔除
 D3 品类非标准（社区标签）    → 剔除：20の扉 / ウミガメ風クロスワード / ラテクエリサイクル
 D4 活动/投票公告帖          → 剔除：标签含 らてらておぶざいやー / 月刊らてらて
 D5 离图不可玩              → 剔除：标签含 画像あり！ 且 汤面/汤底指涉 挿絵/イラスト/画像/写真/図/※/絵
 D6 汤面与现库重复           → 剔除
清洗：去掉编辑器噪音前缀（【《 答え 》】/【解説】/行首 . ）与空白规范化
保留但登记：合作スープ / リアル出題向きウミガメ / 新・形式（人工复核）
"""
import io, os, re, json, sys, glob
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
IN_DIR = T("tools", "llt_trans_in")
os.makedirs(IN_DIR, exist_ok=True)

L = []
def say(s=""): L.append(str(s))

dump = json.load(io.open(T("tools", "llt_dump.json"), encoding="utf-8"))
items = dump["items"]
say("抓取落地: %d 条（失败 %d）" % (len(items), len(dump.get("failed", []))))

# ---- 载入母本 ----
MASTER = T("data", "library", "library.data.js")
src = io.open(MASTER, encoding="utf-8").read()
i = src.find("var SOUP_LIBRARY"); i = src.find("[", i)
end = src.find("\nvar SOUP_LIB_CATS", i)
lib = json.loads(src[i:end].rsplit("]", 1)[0] + "]")
say("母本现库: %d" % len(lib))

PUNCT = re.compile(r"[\s\u3000，。、！？；：·…—－\-_,\.\!\?\;:\"'“”‘’（）()\[\]【】《》<>{}|/\\~`@#$%^&*+=「」『』]")
def norm(s): return PUNCT.sub("", (s or "").lower())
lib_norm = {norm(e.get("surface", "")) for e in lib}

PLACEHOLDER = re.compile(r"^(なし|無し|未定|秘密|ひみつ|不明|未解決|事故)$")

HARD_TAGS = ("20の扉", "ウミガメ風クロスワード", "ラテクエリサイクル")
# D4 收窄（2026-09-26 实测修正）：
#   首版规则「标签含评选名即剔除」误杀 28 道好题（例：霜ばしら《名前の距離感》、
#   #11248《硬貨の効果は幸か不幸か》——它们只是当年参赛，本身是完整海龟汤）。
#   实测确认：真正的公告帖只长这样 —— 标题=评选名 / 作者=月刊らてらて放送室 / 带月刊系列标签。
ANN_TITLE = re.compile(r"らてらておぶざいやー|月刊らてらて")
ANN_AUTHOR = "月刊らてらて放送室"
ANN_TAG = "月刊らてらて〜あなたが選ぶ今月の一杯〜"
REVIEW_TAGS = ("合作スープ", "リアル出題向きウミガメ", "新・形式")
IMG_TAG = "画像あり！"
IMG_REF = re.compile(r"挿絵|イラスト|画像|写真|図|※|絵|シルエット")
# 填空/数字/谜题式标记（配合「汤底极短」使用，避免误伤正常汤面里的「〇〇」代称）
FILL_MARK = re.compile(r"〇〇|◯◯|【\s*[A-ZＡ-Ｚ]?\s*】|に入る|を求めよ|補完せよ|空欄|何番|数字で|記号で|次の.{0,8}を")

# D8（2026-09-26 结构体检）：活动/企划会场帖 —— 「汤底」实为结果发表/投票结果，不是汤底
D8_PAT = re.compile(r"投票会場|記念企画|おぶざいやー|ビブリオバトル|カメオ・デ・イック|ウミガメダービー|闇バトル|正解を創りだすウミガメ")
# D9（同）：互动体/亀夫君问题/攻略型 —— 汤底是对话攻略或答案清单，非叙事汤底
D9_PAT = re.compile(r"亀夫君|亀夫問題|【\s*回答一覧\s*】|エンディング|《\s*ルール\s*》|ルール説明|宣言すると正解|ＹＥＳ|Y/N")
# D11（2026-09-26 尾查）：物当て/何者当て型 —— 纯猜物问答，非情境推理。
#   注意：不能泛用「当ててください」（#18752 这类正常叙事谜题也这么写），
#   只打自陈式标记 → 实测 3 条（#2952 / #10833 / #10569）。
D11_PAT = re.compile(r"物当て|何者であるかを当ててください|誰でしょう|何でしょう")
# D12（2026-09-26 尾查）：多人互动游戏体 —— 汤面自陈游戏规则（回答权/相談欄/鬼の正体/失点/正解マーカー…），
#   非「汤面→汤底」结构。实测 3 条：#2952 / #10986 / #14832。
D12_PAT = re.compile(r"回答権|相談欄|鬼の正体|失点|正解マーカー|参加宣言|お題がこっそり|思い浮かべています|質問は[１1]人[１1]回|【回答】")

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
    raw_s = (it.get("surface") or "").strip()
    raw_t = (it.get("truth") or "").strip()
    title = (it.get("title") or "").strip()
    lid = it.get("id")
    tags = it.get("tags") or []

    if not raw_s or not raw_t:
        dropped.append({"id": lid, "title": title[:24], "why": "D1 空字段"}); continue

    surface = clean_text(raw_s)
    truth = clean_text(raw_t)

    if len(truth) < 20 or PLACEHOLDER.match(truth):
        dropped.append({"id": lid, "title": title[:24], "why": "D2 汤底过短/占位(%d字)" % len(truth)}); continue

    bad = [t for t in tags if t in HARD_TAGS]
    if bad:
        dropped.append({"id": lid, "title": title[:24], "why": "D3 非标准品类:" + ",".join(bad)}); continue

    author = (it.get("author") or "")
    if ANN_TITLE.search(title) or ANN_AUTHOR in author or ANN_TAG in tags:
        dropped.append({"id": lid, "title": title[:26], "why": "D4 活动/投票公告帖"}); continue

    if IMG_TAG in tags and (IMG_REF.search(surface) or IMG_REF.search(truth)):
        m = IMG_REF.search(surface) or IMG_REF.search(truth)
        dropped.append({"id": lid, "title": title[:24], "why": "D5 离图不可玩(指涉「%s」)" % m.group(0)}); continue

    # D8（2026-09-26 结构体检新增）：活动/企划会场帖
    if D8_PAT.search(title) or D8_PAT.search(surface[:140]):
        dropped.append({"id": lid, "title": title[:26], "why": "D8 活动/企划会场帖"}); continue

    # D9（同）：互动体/亀夫君问题/攻略型（汤底非叙事）
    if D9_PAT.search(surface) or D9_PAT.search(truth):
        m9 = D9_PAT.search(surface) or D9_PAT.search(truth)
        dropped.append({"id": lid, "title": title[:26], "why": "D9 互动/攻略型(命中「%s」)" % m9.group(0)}); continue

    # D11（同）：物当て/何者当て型（只查汤面，避免汤底解说误伤）
    if D11_PAT.search(surface):
        m11 = D11_PAT.search(surface)
        dropped.append({"id": lid, "title": title[:26], "why": "D11 物当て/何者当て型(命中「%s」)" % m11.group(0)}); continue

    # D12（同）：多人互动游戏体（只查汤面）
    if D12_PAT.search(surface):
        m12 = D12_PAT.search(surface)
        dropped.append({"id": lid, "title": title[:26], "why": "D12 多人互动游戏体(命中「%s」)" % m12.group(0)}); continue

    # D10（同）：数字/暗号型 —— 汤面以数字/符号列表为主，且汤底极短
    if len(truth) < 80 and len(surface) > 20:
        dn = len(re.findall(r"[0-9０-９①-⑳＜＞｛｝]", surface))
        if dn / len(surface) > 0.35:
            dropped.append({"id": lid, "title": title[:26],
                            "why": "D10 数字/暗号型(占比%.0f%%)" % (100.0 * dn / len(surface))}); continue

    # D7（2026-09-26 实测新增）：填空题/数字题/互动问答游戏——非标准海龟汤，且汤底极短无法成汤
    if FILL_MARK.search(surface) and len(truth) < 60:
        m = FILL_MARK.search(surface)
        dropped.append({"id": lid, "title": title[:24],
                        "why": "D7 填空/数字/谜题式（命中「%s」且汤底%d字）" % (m.group(0), len(truth))}); continue

    if norm(surface) in lib_norm:
        dropped.append({"id": lid, "title": title[:24], "why": "D6 汤面与现库重复"}); continue

    if raw_s != surface or raw_t != truth:
        review.append({"id": lid, "why": "已清洗噪音前缀"})
    for t in tags:
        if t in REVIEW_TAGS:
            review.append({"id": lid, "why": "品类待复核:" + t})
            break

    it["surface"] = surface
    it["truth"] = truth
    fresh.append(it)

say("")
say("=" * 76)
say("定稿: %d 条 | 剔除 %d 条" % (len(fresh), len(dropped)))
say("=" * 76)
from collections import Counter
say("剔除原因分布: %s" % dict(Counter(d["why"].split("(")[0].split(":")[0] for d in dropped)))
say("")
say("--- 剔除明细 ---")
for d in dropped:
    say("  #%-6s %-26s %s" % (d["id"], d["title"], d["why"]))
say("")
say("--- 待人工复核登记: %d 条 ---" % len(review))
for r in review[:60]:
    say("  #%-6s %s" % (r["id"], r["why"]))

assert all((c["surface"] or "").strip() and (c["truth"] or "").strip() for c in fresh), "定稿含空字段"
json.dump({"items": fresh, "dropped": dropped, "review": review},
          io.open(T("tools", "llt_fresh_final.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)

# ---- 切批次（每批 <=28 条）----
PER = 28
N = max(1, (len(fresh) + PER - 1) // PER)
base, rem = len(fresh) // N, len(fresh) % N
pos, chunks = 0, []
for k in range(N):
    size = base + (1 if k < rem else 0)
    chunks.append(fresh[pos:pos + size]); pos += size

say("")
say("--- 翻译批次 ---")
# 清理上一轮遗留批次（定稿变小时 N 减少，旧 batch_*.json 不会被覆盖
#   → 会留下「幽灵条目」，造成批次总条数与定稿不一致、跨批重复）
_stale = sorted(glob.glob(os.path.join(IN_DIR, "batch_*.json")))
for _p in _stale:
    os.remove(_p)
if _stale:
    say("  清理旧批次文件 %d 个: %s" % (len(_stale), ", ".join(os.path.basename(x) for x in _stale)))
for k, ch in enumerate(chunks, 1):
    payload = {"batch": k, "lang": "ja", "src": "late-late.jp", "count": len(ch),
               "items": [{"id": c["id"], "title": c["title"], "surface": c["surface"], "truth": c["truth"]}
                         for c in ch]}
    io.open(os.path.join(IN_DIR, "batch_%02d.json" % k), "w", encoding="utf-8").write(
        json.dumps(payload, ensure_ascii=False, indent=1))
    say("  batch_%02d.json %2d 条  (%s ~ %s)" % (k, len(ch), ch[0]["id"], ch[-1]["id"]))

allids = [c["id"] for ch in chunks for c in ch]
assert len(allids) == len(fresh), "批次总数不符"
assert len(set(allids)) == len(allids), "批次间重复"
assert set(allids) == {c["id"] for c in fresh}, "批次与源不一致"
say("自检通过：%d 条全覆盖、无重复" % len(allids))

tl = sorted(len(c["truth"]) for c in fresh)
say("汤底长度 min=%d 中位=%d max=%d | 供应翻译总量 汤面%d 汤底%d 字"
    % (tl[0], tl[len(tl)//2], tl[-1],
       sum(len(c["surface"]) for c in fresh), sum(len(c["truth"]) for c in fresh)))

io.open(T("tools", "llt_k1_report.txt"), "w", encoding="utf-8").write("\n".join(L))
print("定稿 %d 条 | 剔除 %d 条 | 批次 %d 个" % (len(fresh), len(dropped), N))
print("report -> tools/llt_k1_report.txt")
