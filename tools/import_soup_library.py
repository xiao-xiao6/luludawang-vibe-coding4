# -*- coding: utf-8 -*-
"""《海龟汤汤面大全》→ 汤库数据管线（构建期，字节级幂等）

用法
----
    python tools/import_soup_library.py            # 生成产物
    python tools/import_soup_library.py --check    # 只校验：产物与预期不一致则 exit 1

产出
----
    data/library/soups.json   中间产物（可 review / 可 diff，提交进仓库）
    js/library.data.js        var SOUP_LIBRARY = [...]（提交进仓库，运行时按需加载）
    _soup-dev/game-dev/probe/import_report.txt   导入报告（开发区，不进发布根目录）

设计约束（照施工单 §3 / §4 / §7.3）
----------------------------------
  * 只读 JSONL；不解析 markdown、不用 csv（表头带 BOM、汤底内含换行）
  * 禁止 importedAt：抓取日期只写进 import_report.txt 顶部，保证跨天重跑零 diff
  * 确定性：rawTags 排序、cats 排序、输出按 id 排序、LF 换行、无 BOM
  * 库层与精品层完全隔离：不碰 js/data.js、不碰 deepsea_soup_v1
"""

import argparse
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)                                   # 海龟汤小游戏/
WS = os.path.dirname(PROJ)                                     # workspace/

SRC_JSONL = os.path.join(WS, "海龟汤汤面大全", "海龟汤汤面大全.jsonl")
MAP_DIFF = os.path.join(HERE, "mapping", "difficulty.json")
MAP_TAGS = os.path.join(HERE, "mapping", "tags.json")
OUT_JSON = os.path.join(PROJ, "data", "library", "soups.json")
OUT_JS = os.path.join(PROJ, "js", "library.data.js")
REPORT = os.path.join(WS, "_soup-dev", "game-dev", "probe", "import_report.txt")

# 汤底覆盖层（可选，不存在则忽略）：
#   truth_recovery.json  路线1/2：从本地语料与老站缓存回收到的真实汤底
#   ai_truth.json        路线3：AI 根据汤面编的汤底（必须显式标记）
RECOVERY = os.path.join(PROJ, "data", "library", "truth_recovery.json")
AI_TRUTH = os.path.join(PROJ, "data", "library", "ai_truth.json")

PUZZLE_FILES = ("js/data.js", "js/data-more.js")

# 库受控词表：18 个项目受控词（= smoke_test.js 的 CAT_POOL，一字不改）
# + 8 个库扩展词 + 1 个兜底词 = 27
LIB_CATS = [
    "恐怖", "微恐", "惊悚", "温情", "催泪", "脑洞", "悬疑", "推理", "反转",
    "校园", "家庭", "都市", "都市传说", "怪谈", "旅途", "职场", "医院", "科幻",
    "犯罪", "猎奇", "日常", "搞笑", "亲情", "悲剧", "逻辑", "本格",
    "其他",
]
FALLBACK_CAT = "其他"

# 爬取残留（半截 JS / 模板串）：命中即剔除，不是「标记待审」
JUNK = ("${", "});", "this.", "<script", "<div",
        "z.string(", "console.log", "fullStory",
        "victorycondition", "getElementById", "soupface")

# 与 engine.js 完全一致的归一化（PUNCT 字符类逐字对齐）
PUNCT = re.compile(
    r"""[\s，。！？、,.?!~·“”"'‘’「」『』（）()《》【】\[\]{}：:；;\-—_…/\\|+=*&^%$#@<>]"""
)

# 从 js/data.js / js/data-more.js 抓 PUZZLES 的标题。
# 注意：整行一个题目对象，标题不在行首，所以不能按行首锚定。
TITLE_RE = re.compile(r'"title"\s*:\s*"((?:[^"\\]|\\.)*)"')


def normalize(text):
    return PUNCT.sub("", str("" if text is None else text).lower())


def ascii_ratio(text):
    s = str(text or "")
    if not s:
        return 0.0
    return sum(1 for c in s if ord(c) < 128) / float(len(s))


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def read_text(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def write_text(path, text):
    d = os.path.dirname(path)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    # newline="\n"：禁 CRLF；encoding="utf-8"：无 BOM
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def load_rows():
    rows = []
    with open(SRC_JSONL, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def load_puzzle_titles():
    """从 js/data.js + js/data-more.js 里取现有 100 题的标题（归一化后），用于排除重叠。"""
    titles = set()
    for rel in PUZZLE_FILES:
        p = os.path.join(PROJ, rel)
        if not os.path.exists(p):
            continue
        for m in TITLE_RE.finditer(read_text(p)):
            try:
                val = json.loads('"' + m.group(1) + '"')
            except Exception:
                val = m.group(1)
            n = normalize(val)
            if n:
                titles.add(n)
    return titles


def is_junk(row):
    blob = (row.get("title") or "") + (row.get("surface") or "") + (row.get("bottom") or "")
    for j in JUNK:
        if j in blob:
            return True
    return False


def src_label(src):
    s = str(src or "").strip()
    if not s:
        return "misc"
    if s.startswith("github:"):
        owner = s[len("github:"):].split("/")[0]
        return owner or "misc"
    if s.startswith("haiguitang.cn"):
        return "海龟浓汤"
    if s.startswith("haiguitang.net"):
        return "haiguitang.net"
    if s.startswith("haiguitang.top"):
        return "haiguitang.top"
    if s.startswith("许二木"):
        return "许二木"
    if s.startswith("Jed's"):
        return "Jed's List"
    if s.startswith("misc"):
        return "misc"
    return s.split("/")[0] or "misc"


def clean_text(text):
    """折叠所有空白（顺带修掉 2 条标题里的换行）。"""
    return re.sub(r"\s+", " ", str(text or "")).strip()


def map_difficulty(raw, diff_map):
    v = str(raw or "").strip()
    if v in (diff_map.get("blacklist") or []):
        return int(diff_map.get("default", 2)), True
    if not v:
        return int(diff_map.get("default", 2)), True
    for level, names in (diff_map.get("to") or {}).items():
        if v in names:
            return int(level), False
    return int(diff_map.get("default", 2)), True


def map_cats(raw_tags, tag_map):
    table = tag_map.get("to") or {}
    out = []
    for t in raw_tags:
        for c in table.get(t.strip(), []):
            if c in LIB_CATS and c not in out:
                out.append(c)
    out.sort()
    return out


def build_entry(row, src_no, diff_map, tag_map, puzzle_titles, recovery=None, ai_truth=None):
    recovery = recovery or {}
    ai_truth = ai_truth or {}
    surface = str(row.get("surface") or "")
    truth = str(row.get("bottom") or "").strip()
    truth_source = "original" if truth else ""
    title = clean_text(row.get("title"))
    src = str(row.get("source") or "")

    eid = "lib_" + hashlib.sha1(normalize(surface).encode("utf-8")).hexdigest()[:12]
    if not truth:
        rec = recovery.get(eid) or {}
        if str(rec.get("truth") or "").strip():
            truth = str(rec["truth"]).strip()
            truth_source = "recovered"
        else:
            ai = ai_truth.get(eid) or {}
            if str(ai.get("truth") or "").strip():
                truth = str(ai["truth"]).strip()
                truth_source = "ai"

    raw_tags = []
    for t in (row.get("tags") or []):
        t = clean_text(t)
        if t and t not in raw_tags:
            raw_tags.append(t)
    raw_tags.sort()                                    # 字典序，保证字节级幂等

    cats = map_cats(raw_tags, tag_map)
    cat_fallback = not cats
    if cat_fallback:
        cats = [FALLBACK_CAT]

    difficulty, diff_defaulted = map_difficulty(row.get("difficulty"), diff_map)

    lang = "zh"
    if src in (tag_map.get("langTags_src") or []) or \
       src in ("github:boop-yyt/situation_puzzle", "Jed's List of Situation Puzzles (1999)") or \
       any(t in (tag_map.get("langTags") or []) for t in raw_tags) or \
       ascii_ratio(surface) > 0.7:
        lang = "en"

    if not truth.strip():
        quality = "no-truth"
    elif truth_source == "ai":
        # 路线3：AI 根据汤面编的汤底。
        # 库层 quality 是受控三态（clean / needs-review / no-truth，自检断言守着），
        # 所以这里不新增状态，来源标记交给 truthSource="ai"（UI 按它渲染徽章），
        # quality 归入 needs-review —— 机器草稿，待人复核。
        quality = "needs-review"
    elif diff_defaulted or cat_fallback or len(truth.strip()) < 20:
        # 汤底短于 20 字：AI 没法拿它当对战依据，标出来等人工补
        quality = "needs-review"
    else:
        quality = "clean"

    label = src_label(src)
    disp = title if title else ("无题 · " + label + " #" + str(src_no))

    return {
        "id": eid,
        "srcNo": src_no,
        "title": title,
        "dispTitle": disp,
        "surface": surface,
        "truth": truth,
        "truthSource": truth_source,
        "mode": "truth" if truth.strip() else "surface",
        "cats": cats,
        "rawTags": raw_tags,
        "difficulty": difficulty,
        "src": src,
        "srcUrl": str(row.get("url") or "").strip(),
        "lang": lang,
        "quality": quality,
        "_t": normalize(disp + "\n" + surface),
    }


def run_pipeline(verbose=True):
    diff_map = load_json(MAP_DIFF)
    tag_map = load_json(MAP_TAGS)
    rows = load_rows()
    puzzle_titles = load_puzzle_titles()
    recovery = load_json(RECOVERY) if os.path.exists(RECOVERY) else {}
    ai_truth = load_json(AI_TRUTH) if os.path.exists(AI_TRUTH) else {}

    raw_total = len(rows)
    junk_idx, junk_rows = [], 0
    kept = []
    for i, r in enumerate(rows, 1):
        if is_junk(r):
            junk_idx.append(i)
            junk_rows += 1
            continue
        kept.append((i, r))

    merged = 0
    overlap = 0
    seen = set()
    entries = []
    for i, r in kept:
        n_surface = normalize(r.get("surface"))
        n_title = normalize(clean_text(r.get("title")))
        if n_title and n_title in puzzle_titles:
            overlap += 1
            continue
        if n_surface in seen:
            merged += 1
            continue
        seen.add(n_surface)
        entries.append(build_entry(r, i, diff_map, tag_map, puzzle_titles, recovery, ai_truth))

    entries.sort(key=lambda e: e["id"])

    stats = {
        "raw_total": raw_total,
        "junk": junk_rows,
        "junk_idx": junk_idx,
        "merged": merged,
        "overlap": overlap,
        "final": len(entries),
        "truth": sum(1 for e in entries if e["mode"] == "truth"),
        "surface_only": sum(1 for e in entries if e["mode"] == "surface"),
        "truth_original": sum(1 for e in entries if e.get("truthSource") == "original"),
        "truth_recovered": sum(1 for e in entries if e.get("truthSource") == "recovered"),
        "truth_ai": sum(1 for e in entries if e.get("truthSource") == "ai"),
        "playable": sum(1 for e in entries if len(e["surface"]) > 20 and len(e["truth"]) > 40),
        "empty_title": sum(1 for e in entries if not e["title"]),
        "multiline": sum(1 for e in entries if "\n" in e["surface"]),
        "needs_review": sum(1 for e in entries if e["quality"] == "needs-review"),
        "no_truth": sum(1 for e in entries if e["quality"] == "no-truth"),
        "short_truth": sum(1 for e in entries if e["truth"].strip() and len(e["truth"]) < 20),
        "clean": sum(1 for e in entries if e["quality"] == "clean"),
        "en": sum(1 for e in entries if e["lang"] == "en"),
        "cats_fallback": sum(1 for e in entries if e["cats"] == [FALLBACK_CAT]),
        "has_controlled_cat": sum(1 for e in entries if e["cats"] != [FALLBACK_CAT]),
        "sources": len(set(e["src"] for e in entries)),
        "puzzle_titles": len(puzzle_titles),
        # 原始口径（1397 行，施工单 §1.3 的对照基准）
        "raw_empty_title": sum(1 for r in rows if not clean_text(r.get("title"))),
        "raw_multiline": sum(1 for r in rows if "\n" in (r.get("surface") or "")),
        "raw_empty_diff": sum(1 for r in rows if not str(r.get("difficulty") or "").strip()),
        "raw_no_tags": sum(1 for r in rows if not r.get("tags")),
        "raw_en": sum(1 for r in rows if ascii_ratio(r.get("surface")) > 0.7),
        "raw_sources": len(set(str(r.get("source") or "") for r in rows)),
        "raw_playable": sum(1 for r in rows if len(r.get("surface") or "") > 20
                             and len(r.get("bottom") or "") > 40),
        "raw_controlled_cat": sum(1 for r in rows if map_cats(
            [clean_text(t) for t in (r.get("tags") or [])], tag_map)),
    }
    if verbose:
        for k in ("raw_total", "junk", "merged", "overlap", "final",
                  "truth", "surface_only", "truth_original", "truth_recovered",
                  "truth_ai", "playable", "empty_title",
                  "multiline", "needs_review", "no_truth", "clean", "en",
                  "cats_fallback", "has_controlled_cat", "sources"):
            print("  {:<20} {}".format(k, stats[k]))
    return entries, stats


def render_json(entries):
    return json.dumps(entries, ensure_ascii=False, sort_keys=True, indent=2) + "\n"


def render_js(entries):
    head = [
        "/* ============================================================",
        " * 深海汤屋 · 汤库数据（自动生成，请勿手改）",
        " * ------------------------------------------------------------",
        " * 由 tools/import_soup_library.py 从《海龟汤汤面大全.jsonl》生成。",
        " * 条数：" + str(len(entries)) + "　受控题材：" + str(len(LIB_CATS)) + " 个",
        " * 重跑命令：python tools/import_soup_library.py",
        " * ============================================================ */",
        "var SOUP_LIB_CATS = " + json.dumps(LIB_CATS, ensure_ascii=False) + ";",
        "var SOUP_LIB_TOTAL = " + str(len(entries)) + ";",
        "var SOUP_LIBRARY = [",
    ]
    body = [json.dumps(e, ensure_ascii=False, separators=(",", ":")) + "," for e in entries]
    tail = [
        "];",
        "if (typeof module !== \"undefined\" && module.exports) {",
        "  module.exports = { SOUP_LIBRARY: SOUP_LIBRARY, SOUP_LIB_CATS: SOUP_LIB_CATS, SOUP_LIB_TOTAL: SOUP_LIB_TOTAL };",
        "}",
        "",
    ]
    return "\n".join(head + body + tail)


def render_report(entries, stats):
    lines = []
    lines.append("《海龟汤汤面大全》→ 汤库 导入报告")
    lines.append("生成时间（只写在这里，不进产物）：见文件系统时间戳")
    lines.append("")
    lines.append("== 流水线计数（施工单 §9 ④ 验收值） ==")
    for k, want in (("raw_total", 1397), ("junk", 13), ("merged", 16),
                    ("overlap", 7), ("final", 1361), ("truth", 681),
                    ("surface_only", 680), ("playable", 609)):
        got = stats[k]
        lines.append("  {:<14} {:<6} {}".format(k, got, "OK" if got == want else "≠ 期望 " + str(want)))
    lines.append("")
    lines.append("== 产物分布（1361 条口径） ==")
    for k in ("empty_title", "multiline", "short_truth", "needs_review", "no_truth", "clean",
              "en", "cats_fallback", "has_controlled_cat", "sources", "puzzle_titles"):
        lines.append("  {:<18} {}".format(k, stats[k]))
    lines.append("")
    lines.append("== 原始口径（1397 行，对照施工单 §1.3） ==")
    for k, want in (("raw_empty_title", 309), ("raw_multiline", 249),
                    ("raw_empty_diff", 805), ("raw_no_tags", 732),
                    ("raw_en", 188), ("raw_sources", 35), ("raw_playable", 620)):
        got = stats[k]
        lines.append("  {:<18} {:<6} {}".format(k, got, "OK" if got == want else "≠ 施工单写 " + str(want)))
    lines.append("")
    lines.append("== 垃圾条目行号（实测 13 条） ==")
    lines.append("  " + ", ".join(str(i) for i in stats["junk_idx"]))
    lines.append("")
    lines.append("== 样例 5 条 ==")
    for e in entries[:5]:
        lines.append("  " + json.dumps({k: e[k] for k in ("id", "srcNo", "dispTitle", "mode", "cats", "difficulty", "src", "lang", "quality")},
                                       ensure_ascii=False))
    lines.append("")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只校验产物是否与预期一致")
    args = ap.parse_args()

    print("== 读取 " + SRC_JSONL)
    entries, stats = run_pipeline()
    js_text = render_js(entries)
    json_text = render_json(entries)
    report_text = render_report(entries, stats)

    if args.check:
        bad = []
        for path, want in ((OUT_JSON, json_text), (OUT_JS, js_text)):
            if not os.path.exists(path):
                bad.append(path + " (缺失)")
                continue
            with open(path, encoding="utf-8", newline="") as f:
                got = f.read()
            if got != want:
                bad.append(path + " (内容不一致)")
        if bad:
            print("CHECK FAILED:")
            for b in bad:
                print("  " + b)
            return 1
        print("CHECK OK：两个产物均与预期字节级一致")
        return 0

    write_text(OUT_JSON, json_text)
    write_text(OUT_JS, js_text)
    write_text(REPORT, report_text)
    print("== 写出 ==")
    for p in (OUT_JSON, OUT_JS, REPORT):
        print("  {:<58} {:>9} B".format(os.path.relpath(p, WS), os.path.getsize(p)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
