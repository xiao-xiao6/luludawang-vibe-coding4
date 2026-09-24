# -*- coding: utf-8 -*-
"""深海汤屋 · 「已补底」健康体检
------------------------------------------------------------
对 data/library/soups.json 里 truthSource == "recovered" 的题做三件事：

  1) 污染检测：汤底尾部被爬虫粘上的「相关推荐 / 下篇标题 / 输出规则」等垃圾
  2) 对题检测：汤面 ↔ 汤底 是不是同一道题（字符 bigram 重合度）
  3) 交叉检测：汤底是否与另一题的面/底冲突（抓错答案）

只读不写，输出一份体检报告，供清理脚本按图索骥。

用法：python tools/audit_recovered.py
      python tools/audit_recovered.py --json   （额外导出机器可读结果）
"""
import argparse
import collections
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOUPS = os.path.join(ROOT, "data", "library", "soups.json")
OUT_JSON = os.path.join(ROOT, "data", "library", "recovered_audit.json")

# ---------------- 污染规则 ----------------
# 顺序敏感：先砍最长的尾巴，再收窄
POLLUTION = [
    # 爬虫页面的「下篇 / 相关」标题：## 56. 《两个哥哥》
    ("next-article", re.compile(r"\s*#{1,6}\s*\d{0,3}\s*[.．、]?\s*《[^》\n]{1,40}》\s*$")),
    # 提示词泄漏：整段「输出规则 / 主持人手册 / 规则说明」
    ("prompt-leak", re.compile(r"[\s\S]*?(?:【输出规则】|【回答格式】|主持人手册|主持人须知|规则说明|游戏规则|输出格式)\s*[\s\S]*$")),
    # 相关推荐列表：短促的「7、呜呜呜」「5、一起走」「11、赏罚分明」
    ("sidebar-list", re.compile(r"(?<=[。！？…】)])[0-9]{1,2}\s*[、.．]\s*[^\s。；\n]{1,14}\s*$")),
    # 英文题的交叉引用：(See also #1.31a, #1.59, and #1.75c.)
    ("see-also", re.compile(r"\s*[（(]\s*See also[\s\S]*?[)）]\s*$", re.I)),
    # 残留的玩家视角提示：「1. 根据汤底判断玩家…」
    ("player-hint", re.compile(r"(?<=[。！？\n])[0-9]{1,2}\s*[.．、]\s*(?:根据汤底判断|玩家[^\n]{0,6}[，,。]|小技巧|为避免)[\s\S]*$")),
]

# ---------------- 归一化 ----------------
DROP = re.compile(r"[\s，。！？、,.?!~·“”\"'‘’「」『』（）()《》【】\[\]{}：:；;\-—_…/\\|+=*&^%$#@<>]")
ASCII = re.compile(r"[a-z0-9]")


def norm(s):
    return DROP.sub("", str(s or "").lower())


def bigrams(s):
    return set(s[i:i + 2] for i in range(len(s) - 1))


def overlap(a, b):
    """a、b 的 bigram 包含度：交集 / min(|a|,|b|)，取 0~1。"""
    A, B = bigrams(a), bigrams(b)
    if not A or not B:
        return 0.0
    return len(A & B) / float(min(len(A), len(B)))


def jaccard(a, b):
    A, B = bigrams(a), bigrams(b)
    if not A or not B:
        return 0.0
    return len(A & B) / float(len(A | B))


def is_english(s):
    letters = len(ASCII.findall(s))
    return letters > len(s) * 0.5


def strip_pollution(truth):
    """返回 (清理后的汤底, 命中的规则名列表)。"""
    t = str(truth or "").strip()
    hits = []
    changed = True
    guard = 0
    while changed and guard < 8:
        changed = False
        guard += 1
        for name, rx in POLLUTION:
            new = rx.sub("", t).strip()
            if new != t and new:
                t = new
                hits.append(name)
                changed = True
    return t, hits


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    with open(SOUPS, encoding="utf-8") as f:
        soups = json.load(f)
    idx = {e["id"]: e for e in soups}
    rec = [e for e in soups if e.get("truthSource") == "recovered"]

    print("=" * 74)
    print("「已补底」健康体检 · 共 %d 题（源档 %d 题）" % (len(rec), len(soups)))
    print("=" * 74)

    # ---- 1) 污染 ----
    polluted = []
    rule_count = collections.Counter()
    for e in rec:
        raw = str(e.get("truth") or "")
        clean, hits = strip_pollution(raw)
        if hits:
            polluted.append((e, raw, clean, hits))
            for h in hits:
                rule_count[h] += 1

    print("\n【1】汤底污染：%d 题（占已补底 %.1f%%）" % (len(polluted), 100.0 * len(polluted) / max(1, len(rec))))
    for h, c in rule_count.most_common():
        print("      · %-14s %d 题" % (h, c))
    for e, raw, clean, hits in polluted[:8]:
        print("      - [%s] %s" % (",".join(hits), e["id"]))
        print("          原尾: …%s" % raw[-44:].replace("\n", "\\n"))
        print("          清理: …%s" % clean[-44:])

    # ---- 2) 汤面 ↔ 汤底 对不上 ----
    mism = []
    for e in rec:
        surf = norm(e.get("surface"))
        truth = norm(strip_pollution(str(e.get("truth") or ""))[0])
        if len(surf) < 8 or len(truth) < 8:
            continue
        ov = overlap(truth, surf)
        # 汤底通常会回述部分汤面要素；低于 6% 且双方都不短 → 高度可疑
        if ov < 0.06:
            mism.append((ov, e))

    mism.sort(key=lambda x: x[0])
    print("\n【2】汤面 ↔ 汤底 疑似对不上：%d 题" % len(mism))
    for ov, e in mism[:15]:
        print("      · %.3f  %s  %r" % (ov, e["id"], e.get("dispTitle")))
        print("          面: %s" % str(e.get("surface"))[:72])
        print("          底: %s" % str(e.get("truth"))[:72])

    # ---- 3) 一底多题（可能是抓错答案）----
    bytruth = collections.defaultdict(list)
    for e in soups:
        t = norm(strip_pollution(str(e.get("truth") or ""))[0])
        if len(t) >= 10:
            bytruth[t].append(e)

    print("\n【3】同一段汤底被多题共用：")
    cross = []
    for t, group in bytruth.items():
        if len(group) < 2:
            continue
        # 只看「汤面彼此也高度相似」的组（同一道题的多个来源，属正常）；
        # 汤面差异大却共用汤底 → 强烈提示抓错了
        bad = False
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                sa, sb = norm(group[i].get("surface")), norm(group[j].get("surface"))
                if sa and sb and jaccard(sa, sb) < 0.3:
                    bad = True
        if bad:
            cross.append(group)

    print("      跨题共用且汤面差异大：%d 组 / %d 题" % (len(cross), sum(len(g) for g in cross)))
    for g in cross[:10]:
        print("      ---")
        for e in g:
            print("        [%s] %-26r 面: %s" % (e["id"], e.get("dispTitle"), str(e.get("surface"))[:46]))

    # ---- 4) 空池/异常 ----
    print("\n【4】结构异常：")
    empt = [e for e in rec if len(str(e.get("truth") or "").strip()) < 12]
    print("      汤底过短（<12 字）：%d 题" % len(empt))
    for e in empt[:8]:
        print("        · %s %r → %r" % (e["id"], e.get("dispTitle"), e.get("truth")))

    nosurf = [e for e in rec if len(str(e.get("surface") or "").strip()) < 6]
    print("      汤面缺失/过短：%d 题" % len(nosurf))
    for e in nosurf[:8]:
        print("        · %s %r" % (e["id"], e.get("dispTitle")))

    if args.json:
        payload = {
            "polluted": [{"id": e["id"], "rules": h, "before": raw, "after": clean}
                         for e, raw, clean, h in polluted],
            "mismatch": [{"id": e["id"], "overlap": round(ov, 4)} for ov, e in mism],
            "cross_truth": [[x["id"] for x in g] for g in cross],
        }
        with open(OUT_JSON, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        print("\n✓ 机器可读结果 →", os.path.relpath(OUT_JSON, ROOT))

    return 0


if __name__ == "__main__":
    sys.exit(main())
