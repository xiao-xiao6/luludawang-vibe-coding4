# -*- coding: utf-8 -*-
"""汤底回收 v2 —— 路线1（网站题）+ 路线2（仓库题源）本地回收

相比 v1 的三处关键补强：
  1) 扫描 .html/.htm —— 老站 haiguitang.cn 以「汤面：…汤底：…」全文发布，
     之前完全没扫，是最大的一条漏网矿脉；
  2) 不再跳过 hgt_crawl/repos —— 内含大量带答案题库（ltda 系列等）；
  3) 三级匹配：精确 → 前 40 字前缀 → 字符二元组 Jaccard 模糊（高阈值）。

产出：
  data/library/truth_recovery.json   覆盖层（id -> {truth, src, how, score}）
  _soup-dev/game-dev/probe/recover_report.txt

用法：
    python tools/recover_truth.py            # 生成覆盖层
    python tools/recover_truth.py --dry      # 只报告
"""

import argparse
import collections
import glob
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
WS = os.path.dirname(PROJ)

LIB = os.path.join(PROJ, "data", "library", "soups.json")
OUT = os.path.join(PROJ, "data", "library", "truth_recovery.json")
REPORT = os.path.join(WS, "_soup-dev", "game-dev", "probe", "recover_report.txt")

PUNCT = re.compile(
    r"""[\s，。！？、,.?!~·“”"'‘’「」『』（）()《》【】\[\]{}：:；;\-—_…/\\|+=*&^%$#@<>]"""
)


def norm(s):
    return PUNCT.sub("", str("" if s is None else s).lower())


def bigrams(k):
    return set(k[i:i + 2] for i in range(len(k) - 1))


Q_KEYS = ("surface", "puzzle", "question", "汤面", "题目", "riddle", "problem")
A_KEYS = ("bottom", "truth", "answer", "final_answer", "solution", "汤底", "答案", "explanation")

MAXF = 20 * 1024 * 1024
SKIP_DIRS = {"node_modules", ".git", "__pycache__", "_backup", "shots", "shota_recheck",
             "_mole_review", "_whack-audit", "_box_isolation_20260919"}
CORPUS = ["soup_db", "extracted", "extracted2", "extracted3", "extracted4", "ghsearch",
          "wayback", "rawpages", "hgt_cache", "net_api", "top_api", "hgt_crawl", "_soup-dev"]

INDEX = {}                                    # normkey -> (truth, src, how)
PREFIX40 = collections.defaultdict(set)
FUZZY_KEYS = []                               # 长度 >= 24 的 key，供模糊匹配


def add(q, a, src, how):
    if not isinstance(q, str) or not q.strip():
        return False
    if isinstance(a, list):
        a = "\n".join(str(x) for x in a if isinstance(x, str))
    if not isinstance(a, str):
        return False
    k = norm(q)
    if len(k) < 12:
        return False
    a = re.sub(r"\s+", " ", a).strip()
    if len(a) < 10:
        return False
    if k in INDEX:
        return False
    INDEX[k] = (a, src, how)
    PREFIX40[k[:40]].add(k)
    if len(k) >= 24:
        FUZZY_KEYS.append(k)
    return True


def harvest_obj(obj, src, how, d=0):
    if d > 10:
        return
    if isinstance(obj, dict):
        q = None
        for k in Q_KEYS:
            v = obj.get(k)
            if isinstance(v, str) and len(v.strip()) >= 12:
                q = v
                break
        a = None
        for k in A_KEYS:
            v = obj.get(k)
            if isinstance(v, str) and v.strip():
                a = v
                break
            if isinstance(v, list) and v and all(isinstance(x, str) for x in v):
                a = "\n".join(v)
                break
        if q and a:
            add(q, a, src, how)
        for v in obj.values():
            harvest_obj(v, src, how, d + 1)
    elif isinstance(obj, list):
        for v in obj:
            harvest_obj(v, src, how, d + 1)


# ---- 纯文本 "N.M." 题集 ----------------------------------------------------
HEAD_RE = re.compile(r"^(\d+)\.(\d+)\.\s*(.*)$")
ANS_RE = re.compile(r"^(\d+)\.(\d+)\s+answer:\s*(.*)$", re.I)


def parse_nm_text(text, src):
    puzzles, answers, cur, n = {}, {}, None, 0
    for raw in text.splitlines():
        line = raw.rstrip()
        m = ANS_RE.match(line)
        if m:
            cur = (m.group(1), m.group(2))
            answers[cur] = [m.group(3).strip()]
            continue
        m = HEAD_RE.match(line)
        if m:
            cur = None
            puzzles.setdefault((m.group(1), m.group(2)), []).append(m.group(3).strip())
            continue
        if cur is not None:
            if line.strip():
                answers[cur].append(line.strip())
        elif puzzles:
            last = list(puzzles.keys())[-1]
            if line.strip():
                puzzles[last].append(line.strip())
    for key, ql in puzzles.items():
        if key in answers and add("\n".join(ql), "\n".join(answers[key]), src, "nm-text"):
            n += 1
    return n


# ---- HTML「汤面：…汤底：…」配对 -------------------------------------------
PAIRS = [
    re.compile(r"汤面[：:]\s*(.{10,600}?)\s*汤底[：:]\s*(.{10,1500}?)"
               r"(?=\s*(?:汤面[：:]|答案[：:]|题目[：:]|日期|阅\s?\d|$))", re.S),
    re.compile(r"【汤面】\s*(.{10,600}?)\s*【汤底】\s*(.{10,1500}?)(?=\s*(?:【汤面】|$))", re.S),
    re.compile(r"题目[：:]\s*(.{10,600}?)\s*答案[：:]\s*(.{10,1500}?)"
               r"(?=\s*(?:题目[：:]|汤面[：:]|日期|阅\s?\d|$))", re.S),
    re.compile(r"谜面[：:]\s*(.{10,600}?)\s*答案[：:]\s*(.{10,1500}?)(?=\s*(?:谜面[：:]|$))", re.S),
]


def strip_html(h):
    h = re.sub(r"<script.*?</script>", " ", h, flags=re.S | re.I)
    h = re.sub(r"<style.*?</style>", " ", h, flags=re.S | re.I)
    h = re.sub(r"<br\s*/?>", "\n", h, flags=re.I)
    h = re.sub(r"</(p|div|li|h[1-6]|section|td|tr)>", "\n", h, flags=re.I)
    h = re.sub(r"<[^>]+>", " ", h)
    for a, b in (("&nbsp;", " "), ("&quot;", '"'), ("&amp;", "&"), ("&lt;", "<"),
                 ("&gt;", ">"), ("&#39;", "'"), ("&#8221;", '"'), ("&#8220;", '"')):
        h = h.replace(a, b)
    return re.sub(r"[ \t]+", " ", h)


def parse_html_pairs(raw, src):
    txt = re.sub(r"\n{2,}", "\n", strip_html(raw))
    n = 0
    for pat in PAIRS:
        for m in pat.finditer(txt):
            q = re.sub(r"\s+", " ", m.group(1)).strip()
            a = re.sub(r"\s+", " ", m.group(2)).strip()
            if add(q, a, src, "html-pair"):
                n += 1
    return n


def parse_kg_annotation(root, src):
    n = 0
    for pf in sorted(glob.glob(os.path.join(root, "*.puzzle.txt"))):
        tf = pf.replace(".puzzle.txt", ".truth.txt")
        if not os.path.exists(tf):
            continue
        try:
            q = io.open(pf, encoding="utf-8", errors="replace").read()
            a = io.open(tf, encoding="utf-8", errors="replace").read()
        except Exception:
            continue
        if add(q, a, src, "kg-annotation"):
            n += 1
    return n


def scan():
    stats = collections.Counter()
    for t in CORPUS:
        root = os.path.join(WS, t)
        if not os.path.isdir(root):
            continue
        for dp, dns, fns in os.walk(root):
            dns[:] = [x for x in dns if x not in SKIP_DIRS]
            for fn in fns:
                low = fn.lower()
                if low.endswith(".puzzle.txt"):
                    continue
                if not low.endswith((".json", ".jsonl", ".txt", ".md", ".html", ".htm")):
                    continue
                fp = os.path.join(dp, fn)
                try:
                    if os.path.getsize(fp) > MAXF:
                        continue
                    txt = io.open(fp, encoding="utf-8", errors="replace").read()
                except Exception:
                    continue
                rel = os.path.relpath(fp, WS)
                stats["files"] += 1
                try:
                    if low.endswith(".jsonl"):
                        for line in txt.splitlines():
                            if line.strip():
                                try:
                                    harvest_obj(json.loads(line), rel, "jsonl")
                                except Exception:
                                    pass
                    elif low.endswith(".json"):
                        try:
                            harvest_obj(json.loads(txt), rel, "json")
                        except Exception:
                            pass
                    elif low.endswith((".html", ".htm")):
                        if parse_html_pairs(txt, rel):
                            stats["html_files"] += 1
                    else:
                        if ("answer" in low or "puzzle" in low or "situation" in low
                                or "soup" in low or "海龟" in low):
                            parse_nm_text(txt, rel)
                except Exception:
                    continue
    kg = os.path.join(WS, "extracted4", "boop-yyt__situation_puzzle__master",
                      "situation_puzzle-master", "situation-data", "KG_annotation")
    stats["kg"] = parse_kg_annotation(kg, "boop-yyt/KG_annotation") if os.path.isdir(kg) else 0
    return stats


# ---- 模糊匹配 --------------------------------------------------------------
INV = collections.defaultdict(list)


def build_inv():
    for k in FUZZY_KEYS:
        for g in list(bigrams(k))[:70]:
            INV[g].append(k)


def lookup(surface):
    k = norm(surface)
    if k in INDEX:
        return INDEX[k][0], INDEX[k][1], INDEX[k][2], 1.0
    if len(k) >= 40:
        c = PREFIX40.get(k[:40])
        if c and len(c) == 1:
            kk = next(iter(c))
            t, s, h = INDEX[kk]
            return t, s, h + "+prefix40", 0.97
    if len(k) >= 24:
        cand = collections.Counter()
        for g in bigrams(k):
            for kk in INV.get(g, ()):
                cand[kk] += 1
        A = bigrams(k)
        best, bs = None, 0.0
        for kk, _ in cand.most_common(8):
            B = bigrams(kk)
            j = len(A & B) / float(len(A | B) or 1)
            if j > bs:
                best, bs = kk, j
        if best and bs >= 0.80:
            t, s, h = INDEX[best]
            return t, s, h + "+fuzzy", round(bs, 3)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()

    lib = json.load(io.open(LIB, encoding="utf-8"))
    for e in lib:
        if e.get("mode") == "truth" and (e.get("truth") or "").strip():
            add(e.get("surface"), e.get("truth"), "LIBRARY", "library")

    stats = scan()
    build_inv()

    surfaces = [e for e in lib if e.get("mode") == "surface"]

    def is_web(e):
        return any(d in (e.get("src") or "") for d in ("haiguitang.net", "haiguitang.top",
                                                       "haiguitang.cn"))

    hits, misses = [], []
    for e in surfaces:
        got = lookup(e.get("surface"))
        (hits if got else misses).append((e, got))

    overlay = {}
    for e, (t, s, h, sc) in hits:
        overlay[e["id"]] = {"truth": t, "src": s, "how": h, "score": sc}

    web = [e for e in surfaces if is_web(e)]
    web_hit = [(e, g) for e, g in hits if is_web(e)]

    lines = []
    lines.append("汤底回收报告 v2（路线1 网站题 + 路线2 仓库题源）")
    lines.append("")
    lines.append("扫描文本文件      : %d（其中含汤面+汤底的 HTML %d 个）"
                 % (stats["files"], stats["html_files"]))
    lines.append("KG_annotation 配对: %d" % stats["kg"])
    lines.append("truth 索引条目    : %d" % len(INDEX))
    lines.append("")
    lines.append("无汤底条目        : %d" % len(surfaces))
    lines.append("回收成功          : %d (%.1f%%)" % (len(hits), 100.0 * len(hits) / max(1, len(surfaces))))
    lines.append("  其中网站题      : %d / %d" % (len(web_hit), len(web)))
    lines.append("仍无汤底          : %d  → 进入路线3（AI 生成）" % len(misses))
    lines.append("")
    lines.append("== 回收方式分布 ==")
    for s, c in collections.Counter(g[2] for _, g in hits).most_common():
        lines.append("  %-22s %4d" % (s, c))
    lines.append("")
    lines.append("== 回收来源 top15 ==")
    for s, c in collections.Counter(g[1] for _, g in hits).most_common(15):
        lines.append("  %-72s %4d" % (s, c))
    lines.append("")
    lines.append("== 网站题回收明细（全部） ==")
    for e, (t, s, h, sc) in web_hit:
        lines.append("  [%s] %s <- %s (%s %.2f)" % (e.get("dispTitle"), e["id"], s, h, sc))
        lines.append("      %s" % t[:110])
    lines.append("")
    lines.append("== 仍无汤底来源分布 ==")
    for s, c in collections.Counter(m[0].get("src") for m in misses).most_common(15):
        lines.append("  %-52s %4d" % (s, c))
    lines.append("")
    lines.append("== 仍无汤底 id（前 60） ==")
    lines.append("  " + ", ".join(m[0]["id"] for m in misses[:60]))
    lines.append("")

    text = "\n".join(lines)
    print(text)

    if args.dry:
        print("[dry] 未写文件")
        return 0

    with io.open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(overlay, ensure_ascii=False, sort_keys=True, indent=1) + "\n")
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
