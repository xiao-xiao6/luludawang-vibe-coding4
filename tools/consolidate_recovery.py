# -*- coding: utf-8 -*-
"""回收数据清洗与合并（路线1 + 路线2 收口）

问题：从老站 HTML 抽取「汤面：…汤底：…」时，正则会把**下一条**的标题与
      「日期 2023-05-26 阅 998」这类列表元数据一起吞进汤底。

本工具：
  1) 合并 truth_recovery.json（v2，198 条）与 truth_recovery_oldsite.json（22 条）
  2) 对每条汤底做净化：在下一个条目边界（日期/阅/汤面/答案/题目/谜面/分隔线）截断
  3) 校验长度与残留，产出最终覆盖层 data/library/truth_recovery.json
  4) 输出清洗前后对照报告

用法：
    python tools/consolidate_recovery.py
    python tools/consolidate_recovery.py --dry
"""

import argparse
import collections
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
WS = os.path.dirname(PROJ)
LIBDIR = os.path.join(PROJ, "data", "library")

SRC_V2 = os.path.join(LIBDIR, "truth_recovery.json")
SRC_OLD = os.path.join(LIBDIR, "truth_recovery_oldsite.json")
LIB = os.path.join(LIBDIR, "soups.json")
OUT = os.path.join(LIBDIR, "truth_recovery.json")
REPORT = os.path.join(WS, "_soup-dev", "game-dev", "probe", "recover_consolidated.txt")

# 下一个条目的边界标记
CUT = re.compile(
    r"(日期\s*\d{4}|阅\s*\d{2,}|汤面[：:]|【汤面】|汤底[：:]|【汤底】|"
    r"答案[：:]|题目[：:]|谜面[：:]|={5,}|-{6,}|#{3,}|\*\*标题)"
)

LEAD = re.compile(r"^[\s>*·\-—=#]+")
TAIL = re.compile(r"[\s>*·\-—=#]+$")


def sanitize(t):
    """净化汤底：去装饰符、在条目边界截断、折叠空白。"""
    t = str(t or "").strip()
    t = LEAD.sub("", t)
    m = CUT.search(t)
    if m and m.start() >= 8:
        t = t[:m.start()]
    t = re.sub(r"\s+", " ", t).strip()
    t = TAIL.sub("", t)
    t = re.sub(r"\*\*", "", t).strip()
    return t


def load(p):
    if not os.path.exists(p):
        return {}
    with io.open(p, encoding="utf-8") as f:
        return json.load(f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()

    v2 = load(SRC_V2)
    old = load(SRC_OLD)
    lib = {e["id"]: e for e in json.load(io.open(LIB, encoding="utf-8"))}
    print("载入 v2=%d 条 | oldsite=%d 条" % (len(v2), len(old)))

    merged = {}
    order = {"old-site-match": 0, "exact": 0, "prefix40": 1, "fuzzy": 2, "json": 3}
    for src, tag in ((v2, "v2"), (old, "oldsite")):
        for eid, rec in src.items():
            t = sanitize(rec.get("truth"))
            if len(t) < 12:
                continue
            how = str(rec.get("how") or "")
            score = float(rec.get("score") or 0)
            prev = merged.get(eid)
            better = prev is None or score > prev["score"]
            if better:
                merged[eid] = {
                    "truth": t,
                    "src": rec.get("src") or "",
                    "how": how,
                    "score": score,
                    "truthSource": "recovered",
                }

    # 清洗前后对照
    changed, shortened = [], 0
    for eid, rec in list(merged.items()):
        raw = (v2.get(eid) or old.get(eid) or {}).get("truth") or ""
        if sanitize(raw) != str(raw).strip():
            shortened += 1
            if len(changed) < 12:
                changed.append((lib.get(eid, {}).get("dispTitle", eid), raw, rec["truth"]))

    # 校验：仍含元数据残留的
    residual = [eid for eid, r in merged.items()
                if re.search(r"日期\s*\d{4}|阅\s*\d{2,}|={5,}", r["truth"])]

    # 长度分布
    lens = sorted(len(r["truth"]) for r in merged.values())
    def pct(p):
        return lens[int(len(lens) * p)] if lens else 0

    lines = []
    lines.append("回收数据清洗与合并报告")
    lines.append("")
    lines.append("输入            : v2=%d 条, oldsite=%d 条" % (len(v2), len(old)))
    lines.append("合并去重后      : %d 条" % len(merged))
    lines.append("被截断净化      : %d 条" % shortened)
    lines.append("仍有元数据残留  : %d 条" % len(residual))
    lines.append("汤底长度 min/p25/中位/p75/max : %d / %d / %d / %d / %d"
                 % (lens[0] if lens else 0, pct(.25), pct(.5), pct(.75), lens[-1] if lens else 0))
    lines.append("")
    lines.append("== 回收方式分布 ==")
    for k, c in collections.Counter(r["how"].split("+")[-1] for r in merged.values()).most_common():
        lines.append("  %-14s %4d" % (k, c))
    lines.append("")
    lines.append("== 净化对照（前 12 条） ==")
    for title, raw, new in changed:
        lines.append("  [%s]" % title)
        lines.append("    清洗前: %s" % str(raw)[:150].replace("\n", " "))
        lines.append("    清洗后: %s" % new[:150])
    lines.append("")
    lines.append("== 仍无汤底、将进入路线3 的条目数 ==")
    remain = [e for e in lib.values() if e.get("mode") == "surface" and e["id"] not in merged]
    lines.append("  %d 条（占无汤底 %d 条的 %.1f%%）"
                 % (len(remain), sum(1 for e in lib.values() if e.get("mode") == "surface"),
                    100.0 * len(remain) / max(1, sum(1 for e in lib.values() if e.get("mode") == "surface"))))
    lines.append("  来源分布:")
    for s, c in collections.Counter(e.get("src") for e in remain).most_common(10):
        lines.append("    %-50s %4d" % (s, c))
    lines.append("")

    text = "\n".join(lines)
    print(text)

    if args.dry:
        print("[dry] 未写文件")
        return 0

    with io.open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(merged, ensure_ascii=False, sort_keys=True, indent=1) + "\n")
    d = os.path.dirname(REPORT)
    if not os.path.isdir(d):
        os.makedirs(d)
    with io.open(REPORT, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    print("== 写出 ==")
    print("  %-58s %9d B" % (os.path.relpath(OUT, WS), os.path.getsize(OUT)))
    print("  %-58s %9d B" % (os.path.relpath(REPORT, WS), os.path.getsize(REPORT)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
