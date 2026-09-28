# -*- coding: utf-8 -*-
"""本轮 · Stage L-1：late-late.jp 新抓 768 候选的质量闸门 + 双重去重。

闸门全部沿用 2026-09-26 定稿的 D1~D12 规则（tools/stage_k1b_llt_finalize.py），
去重则做两层：
  N1 归一化汤面与现库（含上一轮已并入的 162 道日译中）完全相同 → 剔除
  N2 归一化汤面与上一轮抓过但被丢弃的 273 候选相同 → 剔除（同题变体/已被判过）
  N3 批内互相重复 → 只留第一条
产出：tools/llt2_fresh.json（定稿) + tools/llt2_dropped.json（剔除台账）
"""
import io, os, re, json, sys, collections
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
T = lambda *p: os.path.join(ROOT, "tools", *p) if p[0] != "data" else os.path.join(ROOT, *p)

dump = json.load(io.open(T("llt_dump2.json"), encoding="utf-8"))
items = dump["items"]
print("本轮抓取落地: %d 条（抓取失败 %d）" % (len(items), len(dump.get("failed", []))))

# ---- 现库 ----
src = io.open(os.path.join(ROOT, "data", "library", "library.data.js"), encoding="utf-8").read()
i = src.find("var SOUP_LIBRARY"); i = src.find("[", i)
end = src.find("\nvar SOUP_LIB_CATS", i)
lib = json.loads(src[i:end].rsplit("]", 1)[0] + "]")
print("母本现库:", len(lib))

PUNCT = re.compile(r"[\s　，。、！？；：·…—－\-_,\.\!\?\;:\"'“”‘’（）()\[\]【】《》<>{}|/\\~`@#$%^&*+=「」『』]")
def norm(s): return PUNCT.sub("", (s or "").lower())

lib_norm = {norm(e.get("surface", "")) for e in lib}
old_dump = json.load(io.open(T("llt_dump.json"), encoding="utf-8"))["items"]
old_norm = {norm(x.get("surface", "")) for x in old_dump}

PLACEHOLDER = re.compile(r"^(なし|無し|未定|秘密|ひみつ|不明|未解決|事故)$")
ANN_TITLE = re.compile(r"らてらておぶざいやー|月刊らてらて")
IMG_REF = re.compile(r"挿絵|イラスト|画像|写真|図|※|絵|シルエット")
FILL_MARK = re.compile(r"〇〇|◯◯|【\s*[A-ZＡ-Ｚ]?\s*】|に入る|を求めよ|補完せよ|空欄|何番|数字で|記号で|次の.{0,8}を")
D8_PAT = re.compile(r"らてクエ|ラトクエ|問題決定戦|無正解|结果发表|問題文募集|記念企画|投票会場|おぶざいやー|ビブリオバトル|カメオ・デ・イック|ウミガメダービー|闇バトル|正解を創りだすウミガメ")
D9_PAT = re.compile(r"亀夫君|亀夫問題|【\s*回答一覧\s*】|エンディング|《\s*ルール\s*》|ルール説明|宣言すると正解|ＹＥＳ|Y/N")
D11_PAT = re.compile(r"物当て|何者であるかを当ててください|誰でしょう|何でしょう")
D12_PAT = re.compile(r"回答権|相談欄|鬼の正体|失点|正解マーカー|参加宣言|お題がこっそり|思い浮かべています|質問は[１1]人[１1]回|【回答】")
HARD_DROP_TAGS = ("ウミガメ風クロスワード", "ラテクエリサイクル", "20の扉")
PREFIX_TRUTH = re.compile(r"^\s*[.·。]?\s*(?:【《\s*答え\s*》】|【\s*解説\s*】|【\s*答え\s*】|【\s*正解\s*】|《\s*答え\s*》|答え\s*[:：]|解答\s*[:：]|解説\s*[:：]|正解\s*[:：])\s*")
PREFIX_SURFACE = re.compile(r"^\s*[.·。]\s*")


def clean_text(s):
    s = PREFIX_TRUTH.sub("", s or "")
    s = PREFIX_SURFACE.sub("", s)
    s = re.sub(r"[ \t]{2,}", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


fresh, dropped = [], []
seen_norm = set()
for it in items:
    lid = it.get("id")
    title = (it.get("title") or "").strip()
    surface = clean_text(it.get("surface") or "")
    truth = clean_text(it.get("truth") or "")
    tags = it.get("tags") or []

    if not surface or not truth:
        dropped.append({"id": lid, "title": title[:24], "why": "D1 空字段"}); continue
    if len(truth) < 20 or PLACEHOLDER.match(truth):
        dropped.append({"id": lid, "title": title[:24], "why": "D2 汤底过短/占位(%d字)" % len(truth)}); continue
    bad = [t for t in tags if t in HARD_DROP_TAGS]
    if bad:
        dropped.append({"id": lid, "title": title[:24], "why": "D3 非标准品类:" + ",".join(bad)}); continue
    if ANN_TITLE.search(title) or ANN_TITLE.search(" ".join(tags)):
        dropped.append({"id": lid, "title": title[:24], "why": "D4 活动/投票公告帖"}); continue
    if "画像あり！" in tags:
        m = IMG_REF.search(surface + truth)
        if m:
            dropped.append({"id": lid, "title": title[:24], "why": "D5 离图不可玩(指涉「%s」)" % m.group(0)}); continue
    if D8_PAT.search(title) or D8_PAT.search(surface[:140]):
        dropped.append({"id": lid, "title": title[:24], "why": "D8 活动/企划会场帖"}); continue
    if D9_PAT.search(surface) or D9_PAT.search(truth):
        m9 = D9_PAT.search(surface) or D9_PAT.search(truth)
        dropped.append({"id": lid, "title": title[:24], "why": "D9 互动/攻略型(命中「%s」)" % m9.group(0)}); continue
    if D11_PAT.search(surface):
        dropped.append({"id": lid, "title": title[:24], "why": "D11 物当て型"}); continue
    if D12_PAT.search(surface):
        dropped.append({"id": lid, "title": title[:24], "why": "D12 多人互动游戏体"}); continue

    ns = norm(surface)
    if ns in lib_norm:
        dropped.append({"id": lid, "title": title[:24], "why": "N1 汤面与现库重复"}); continue
    if ns in old_norm:
        dropped.append({"id": lid, "title": title[:24], "why": "N2 与上一轮已判过的候选同题"}); continue
    if ns in seen_norm:
        dropped.append({"id": lid, "title": title[:24], "why": "N3 本批内重复"}); continue
    seen_norm.add(ns)

    it["surface"], it["truth"], it["title"] = surface, truth, title
    fresh.append(it)

print("定稿: %d 条 | 剔除: %d 条" % (len(fresh), len(dropped)))
c = collections.Counter(d["why"].split("(")[0] for d in dropped)
for k, v in c.most_common():
    print("   %-28s %d" % (k, v))
json.dump({"items": fresh}, io.open(T("llt2_fresh.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
json.dump(dropped, io.open(T("llt2_dropped.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
