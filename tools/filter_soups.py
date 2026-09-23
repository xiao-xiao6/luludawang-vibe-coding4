#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
深海汤屋 · 汤库过滤（本地保留 + 推送瘦身）
------------------------------------------------------------
作用：
  从源档 data/library/soups.json 里，把下面两类「不适合公开推送」的题
  抽出来单独留档，并从构建链里剔除：

    1) AI 编底题   ：truthSource == "ai"     （前端徽章：AI根据汤面编汤底 / AI编底）
    2) 无汤底题    ：mode == "surface" 或 truth 为空（前端徽章：无汤底）

  正常题（remain）会被写成 data/Library/library.data.js —— 这正是
  tools/build_worker_data.js 优先读取的路径，重跑构建即可让网站只剩正常题。

本地留档：
  data/library/hold_ai_and_notruth.json  ← 被剔除的题，一条不少，随时可用
  （data/library/ 在 .gitignore 里，不会进仓库）

用法：
  python tools/filter_soups.py            # 执行过滤 + 写盘
  python tools/filter_soups.py --dry-run  # 只看统计，不写盘
"""

import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_SOUPS = os.path.join(ROOT, "data", "library", "soups.json")
HOLD_OUT = os.path.join(ROOT, "data", "library", "hold_ai_and_notruth.json")
BUILD_SRC = os.path.join(ROOT, "data", "Library", "library.data.js")
PUBLIC_JS = os.path.join(ROOT, "js", "library.public.js")

BANNER = """/* ============================================================
 * 深海汤屋 · 汤库层（构建源档 · 已过滤版）
 * ------------------------------------------------------------
 * 自动生成，请勿手改 —— 由 tools/filter_soups.py 产出
 * 来源：data/library/soups.json
 *
 * 已剔除：{n_ai} 题 AI 编底（truthSource=ai）+ {n_nt} 题无汤底（mode=surface）
 * 留档：data/library/hold_ai_and_notruth.json（本地，不进仓库）
 *
 * 重跑命令：python tools/filter_soups.py && node tools/build_worker_data.js
 * ============================================================ */
"""


def drop_reason(item):
    """返回剔除原因；None 表示保留。"""
    if item.get("truthSource") == "ai":
        return "ai"
    if item.get("mode") == "surface" or not str(item.get("truth") or "").strip():
        return "no-truth"
    return None


def load_public_header():
    """读现有 library.public.js 的头部，沿用 CATS 等元信息。"""
    cats, total = None, None
    if not os.path.exists(PUBLIC_JS):
        return cats, total
    with open(PUBLIC_JS, encoding="utf-8") as f:
        text = f.read()
    for line in text.splitlines():
        if line.startswith("var SOUP_LIB_CATS"):
            cats = line.split("=", 1)[1].strip().rstrip(";").strip()
        elif line.startswith("var SOUP_LIB_TOTAL"):
            total = None  # 总数由实际保留条数决定，不沿用旧 header
    return cats, total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="只统计，不写盘")
    args = ap.parse_args()

    if not os.path.exists(SRC_SOUPS):
        print("✗ 找不到源档：" + SRC_SOUPS)
        return 1

    with open(SRC_SOUPS, encoding="utf-8") as f:
        soups = json.load(f)

    keep, hold_ai, hold_nt = [], [], []
    for item in soups:
        r = drop_reason(item)
        if r == "ai":
            hold_ai.append(item)
        elif r == "no-truth":
            hold_nt.append(item)
        else:
            keep.append(item)

    held = hold_ai + hold_nt
    print(f"源档总计        : {len(soups)}")
    print(f"  ✗ AI 编底     : {len(hold_ai)}")
    print(f"  ✗ 无汤底      : {len(hold_nt)}")
    print(f"  ✓ 保留可推送  : {len(keep)}")

    # 自检：保留的题必须都有真汤底
    bad = [p for p in keep if not str(p.get("truth") or "").strip()]
    if bad:
        print(f"✗ 自检失败：保留集里仍有 {len(bad)} 题 truth 为空")
        return 1
    # 自检：去重校验
    ids = [p.get("id") for p in keep]
    if len(ids) != len(set(ids)):
        print("✗ 自检失败：保留集有重复 id")
        return 1
    # 自检：剔除集 + 保留集 == 源档
    if len(keep) + len(held) != len(soups):
        print("✗ 自检失败：数量不守恒")
        return 1
    print("✓ 自检通过：总数守恒 / 无空汤底 / 无重复 id")

    if args.dry_run:
        print("（--dry-run：未写盘）")
        return 0

    os.makedirs(os.path.dirname(HOLD_OUT), exist_ok=True)
    with open(HOLD_OUT, "w", encoding="utf-8") as f:
        json.dump(
            {
                "_note": "被过滤掉的题：ai = AI 编底，no-truth = 无汤底。本地留档，不进仓库。",
                "ai": hold_ai,
                "no-truth": hold_nt,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )
    print("✓ 留档 " + os.path.relpath(HOLD_OUT, ROOT))

    # 构建源档：data/Library/library.data.js（build_worker_data.js 优先读它）
    os.makedirs(os.path.dirname(BUILD_SRC), exist_ok=True)
    cats, total = load_public_header()
    body = (
        BANNER.format(n_ai=len(hold_ai), n_nt=len(hold_nt))
        + "var SOUP_LIBRARY = "
        + json.dumps(keep, ensure_ascii=False, separators=(",", ":"))
        + ";\n"
        + ("var SOUP_LIB_CATS = " + cats + ";\n" if cats else "")
        + ("var SOUP_LIB_TOTAL = " + total + ";\n" if total else
           "var SOUP_LIB_TOTAL = " + str(len(keep)) + ";\n")
        + 'if (typeof module !== "undefined" && module.exports) {\n'
        + "  module.exports = { SOUP_LIBRARY: SOUP_LIBRARY, SOUP_LIB_CATS: SOUP_LIB_CATS, SOUP_LIB_TOTAL: SOUP_LIB_TOTAL };\n"
        + "}\n"
    )
    with open(BUILD_SRC, "w", encoding="utf-8") as f:
        f.write(body)
    print("✓ 构建源 " + os.path.relpath(BUILD_SRC, ROOT) + f" | {len(keep)} 题 | {len(body)/1024:.1f} KB")
    print("\n下一步：node tools/build_worker_data.js")
    return 0


if __name__ == "__main__":
    sys.exit(main())