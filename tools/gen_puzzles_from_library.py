# -*- coding: utf-8 -*-
"""P7 · 汤库 → 精品层升级管线（**草稿阶段：只产出草稿，绝不注入 PUZZLES**）

为什么只到草稿为止
------------------
`_soup-dev/game-dev/test/smoke_test.js` 有一条硬断言 `PUZZLES.length === 100`，
而施工单 P7 要求把首批 20 道升级进 `PUZZLES`。两者直接冲突（详见
`docs/汤面大全融合方案.md` §8 ③）。因此本工具只把候选整理成**结构完整的草稿**，
放到 `data/library/puzzle_drafts.json` 暂存，等主人决定是否放宽该断言、以及草稿过闸。

本工具能自动做的
----------------
  * 选材：优先「汤底覆盖率 100%」的仓库来源（施工单 §1.3）
  * 生成 id / par / difficulty / cats（自动收窄到 18 词受控表）
  * 从汤底里**自动播种** truthKeywords（汤底中出现的、汤面里没有的中文 2~4 字词组）
  * 标出还缺什么（clues / hints / cats 通常都要人工或 LLM 补）

本工具**不能**自动做的（草稿会显式标 `_needs`）
------------------------------------------------
  * `clues`（≥6 条，每条要有判定类型 + 独占关键词）
  * `hints`（≥2 条）
  * 汤面里已有的受控题材被收窄后不足 2 个时的补标

用法
----
    python tools/gen_puzzles_from_library.py                # 默认 20 道
    python tools/gen_puzzles_from_library.py --limit 50
    python tools/gen_puzzles_from_library.py --check        # 只校验草稿是否与预期一致
"""

import argparse
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
WS = os.path.dirname(PROJ)

SOUPS = os.path.join(PROJ, "data", "library", "soups.json")
OUT = os.path.join(PROJ, "data", "library", "puzzle_drafts.json")
DATA_FILES = ("js/data.js", "js/data-more.js")

# 与 engine.js 逐字对齐的归一化
PUNCT = re.compile(
    r"""[\s，。！？、,.?!~·“”"'‘’「」『』（）()《》【】\[\]{}：:；;\-—_…/\\|+=*&^%$#@<>]"""
)

# 精品层受控题材（18 词，= smoke_test.js 的 CAT_POOL）。草稿的 cats 必须落在这里面。
CAT_POOL18 = [
    "恐怖", "微恐", "惊悚", "温情", "催泪", "脑洞", "悬疑", "推理", "反转",
    "校园", "家庭", "都市", "都市传说", "怪谈", "旅途", "职场", "医院", "科幻",
]

# 汤底覆盖率 100% 的仓库来源优先（施工单 §1.3）
TIER1 = [
    "github:KONpiGG/astrbot_plugin_soupai",
    "github:moxianbizi/haiguitang-php",
    "github:anchorAnc/astrbot_plugin_TurtleSoup",
    "github:wangyafu/haiguitangmcp",
    "github:lancelily6362-png/haiguitang",
    "github:17hczmsn/turtle_soup",
    "github:Tenzyoo/turtle_soup_game",
]
TIER2 = [
    "github:yinyyW/haiguitang",
    "github:bcefghj/rokid-collection",
    "许二木海龟汤合集(OCR)",
]

# 播种关键词时排掉的虚词/高频功能词
STOP = set(
    "的 了 是 在 有 和 与 就 都 而 及 或 一个 这 那 什么 怎么 为什么 因为 所以 "
    "但是 然后 他们 她们 它们 我们 你们 自己 时候 已经 还有 没有 不能 可以 就是 "
    "原来 其实 于是 因为 只能 只好 后来 开始 发现 知道 觉得 可能 应该 一直".split()
)

CN_RE = re.compile(r"^[\u4e00-\u9fff]+$")
ID_RE = re.compile(r'"id"\s*:\s*"([^"]*)"')
TAG_RE = re.compile(r'"tag"\s*:\s*"([^"]*)"')


def normalize(text):
    return PUNCT.sub("", str("" if text is None else text).lower())


def read_text(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def write_text(path, text):
    d = os.path.dirname(path)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def load_puzzle_meta():
    """从 js/data.js + js/data-more.js 取现有 id / tag。"""
    ids, tags = set(), []
    for rel in DATA_FILES:
        p = os.path.join(PROJ, rel)
        if not os.path.exists(p):
            continue
        src = read_text(p)
        ids.update(ID_RE.findall(src))
        for t in TAG_RE.findall(src):
            t = t.strip()
            if t and t not in tags:
                tags.append(t)
    return ids, tags


def tier_of(src):
    if src in TIER1:
        return 0
    if src in TIER2:
        return 1
    return 2


def seed_keywords(surface, truth, cap=24):
    """从汤底里播种「汤面里没有的」中文 2~4 字词组。

    只是给人工/LLM 一个起点，不是最终答案——`check_puzzle_drafts.js` 会如实报告
    哪些草稿因此还没准备好。
    """
    s = normalize(surface)
    t = normalize(truth)
    cand = {}
    for n in (4, 3, 2):
        for i in range(len(t) - n + 1):
            g = t[i:i + n]
            if not CN_RE.match(g):
                continue
            if g in s or g in STOP:
                continue
            cand[g] = cand.get(g, 0) + 1
    # 长词优先，再按字典序，保证确定性；被更长词包含的短词丢掉
    ordered = sorted(cand.keys(), key=lambda k: (-len(k), k))
    out = []
    for k in ordered:
        if any(k in o for o in out):
            continue
        out.append(k)
        if len(out) >= cap:
            break
    return out


def build_draft(entry, tag):
    surface = entry["surface"]
    truth = entry["truth"]

    lib_cats = entry.get("cats") or []
    cats = [c for c in lib_cats if c in CAT_POOL18]
    needs = []

    if len(cats) < 2:
        needs.append("cats")          # 精品层要求 cats ≥ 2，且必须落在 18 词表里

    kws = seed_keywords(surface, truth)
    cores = kws[:6]

    if len(kws) < 8:
        needs.append("truthKeywords")
    if len(cores) < 2:
        needs.append("coreKeywords")

    needs += ["clues", "hints"]       # 这两样必须人工/LLM 写，本工具不伪造

    diff = int(entry.get("difficulty") or 2)
    if diff not in (1, 2, 3):
        diff = 2
    par = max(4, min(14, 4 + diff * 2 + (1 if len(surface) > 120 else 0)))

    h = hashlib.sha1(normalize(surface).encode("utf-8")).hexdigest()[:12]

    return {
        "id": "px_" + h,               # 与库层 id（lib_*）刻意不同，避免与 SOUP_LIBRARY 撞 id
        "fromLibId": entry["id"],      # 回溯来源；升级进 PUZZLES 时须把它从库层剔除
        "srcNo": entry["srcNo"],
        "title": entry["dispTitle"],   # 永远非空
        "tag": tag,
        "cats": cats,
        "_libCats": lib_cats,          # 原始（含库扩展词），供人工补标参考
        "difficulty": diff,
        "par": par,
        "surface": surface,
        "truth": truth,
        "truthKeywords": kws,
        "coreKeywords": cores,
        "hints": [],
        "clues": [],
        "src": entry["src"],
        "srcUrl": entry["srcUrl"],
        "lang": entry["lang"],
        "_needs": sorted(set(needs)),
        "_auto": ["id", "par", "difficulty", "cats", "truthKeywords", "coreKeywords"],
    }


def select_entries(soups, puzzle_ids, limit):
    cand = []
    for e in soups:
        if e.get("mode") != "truth":
            continue
        if e.get("lang") != "zh":
            continue
        if e.get("id") in puzzle_ids:
            continue
        if len(e.get("surface") or "") < 40:
            continue
        if len(e.get("truth") or "") < 60:
            continue
        cand.append(e)
    cand.sort(key=lambda e: (tier_of(e["src"]), e["srcNo"]))
    return cand[:limit]


def build(soups, puzzle_ids, existing_tags, limit):
    tag = "经典谜题" if "经典谜题" in existing_tags else (
        sorted(existing_tags)[0] if existing_tags else "汤库精选")
    picked = select_entries(soups, puzzle_ids, limit)
    drafts = [build_draft(e, tag) for e in picked]
    drafts.sort(key=lambda d: d["id"])
    meta = {
        "_note": "草稿阶段产物：clues / hints 需人工或 LLM 补齐后，方可注入 js/data.js",
        "tag_used": tag,
        "limit": limit,
        "count": len(drafts),
        "from_sources": sorted(set(d["src"] for d in drafts)),
        "need_clues_hints": sum(1 for d in drafts if "clues" in d["_needs"]),
        "need_cats": sum(1 for d in drafts if "cats" in d["_needs"]),
        "need_keywords": sum(1 for d in drafts if "truthKeywords" in d["_needs"]),
    }
    return {"_meta": meta, "drafts": drafts}


def render(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, indent=2) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--check", action="store_true", help="只校验草稿是否与预期一致")
    args = ap.parse_args()

    if not os.path.exists(SOUPS):
        print("找不到 " + SOUPS + "，请先跑 python tools/import_soup_library.py")
        return 1

    with open(SOUPS, encoding="utf-8") as f:
        soups = json.load(f)
    puzzle_ids, existing_tags = load_puzzle_meta()
    obj = build(soups, puzzle_ids, existing_tags, args.limit)
    text = render(obj)

    if args.check:
        if not os.path.exists(OUT):
            print("CHECK FAILED: " + OUT + " 缺失")
            return 1
        with open(OUT, encoding="utf-8", newline="") as f:
            got = f.read()
        if got != text:
            print("CHECK FAILED: 草稿与预期不一致")
            return 1
        print("CHECK OK：草稿与预期字节级一致")
        return 0

    write_text(OUT, text)
    m = obj["_meta"]
    print("== 草稿已生成 ==")
    print("  {:<22} {}".format("count", m["count"]))
    print("  {:<22} {}".format("tag_used", m["tag_used"]))
    print("  {:<22} {}".format("need_clues_hints", m["need_clues_hints"]))
    print("  {:<22} {}".format("need_cats", m["need_cats"]))
    print("  {:<22} {}".format("need_keywords", m["need_keywords"]))
    print("  {:<22} {}".format("out", os.path.relpath(OUT, WS)))
    print("  {:<22} {} B".format("size", os.path.getsize(OUT)))
    print()
    print("下一步：node tools/check_puzzle_drafts.js 看每道草稿还差什么")
    return 0


if __name__ == "__main__":
    sys.exit(main())
