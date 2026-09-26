# -*- coding: utf-8 -*-
"""
Stage H（2026-09-26）：下架 3 条「AI 重建汤底」的题
依据：玩家反馈 → 采集纪律「无底题不 AI 补底、不保留」，经主人裁定执行。
说明：全库另有约 100 条 truthSource=recovered 是历史上从存档真源补回的，
      属正常数据，**不得**按该标记批量删。本脚本仅按显式 ID 精确删除。
产出：data/library/library.data.js（写前备份）+ tools/stage_h_log.json
"""
import io, json, shutil

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
MASTER = ROOT + r"\data\library\library.data.js"
BACKUP = ROOT + r"\_local_backup\library.data.js.bak-stageh"

TARGETS = {
    "lib_0696ae22b31a",   # 白昼流星
    "lib_57e7c1800d44",   # 深渊情书
    "lib_1b5f8818a812",   # 一週還是兩年？
}

shutil.copyfile(MASTER, BACKUP)

src = io.open(MASTER, encoding="utf-8").read()
head = src[:src.find("var SOUP_LIBRARY")]
i = src.find("var SOUP_LIBRARY"); i = src.find("[", i)
end = src.find("\nvar SOUP_LIB_CATS", i)
tail = src[end:]
data = json.loads(src[i:end].rsplit("]", 1)[0] + "]")
before = len(data)

present = {e["id"] for e in data} & TARGETS
assert present == TARGETS, "目标缺失: %s" % sorted(TARGETS - present)

removed, kept = [], []
for e in data:
    if e["id"] in TARGETS:
        removed.append({"id": e["id"], "title": e.get("title"), "truthSource": e.get("truthSource"),
                        "surface": e.get("surface", "")[:40]})
    else:
        kept.append(e)

assert len(removed) == 3, "删除条数异常: %d" % len(removed)
assert len(kept) == before - 3, "保留条数异常"

# 仅记录：剩余的历史 recovered 条目数（本次不处理）
legacy_rec = sum(1 for e in kept if e.get("truthSource") == "recovered")

body = head + "var SOUP_LIBRARY = " + json.dumps(kept, ensure_ascii=False, separators=(",", ":")) + ";" + tail
io.open(MASTER, "w", encoding="utf-8").write(body)
io.open(ROOT + r"\tools\stage_h_log.json", "w", encoding="utf-8").write(json.dumps(
    {"before": before, "after": len(kept), "removed": removed, "legacy_recovered_left": legacy_rec},
    ensure_ascii=False, indent=1))
print("OK %d -> %d  removed=%s  legacy_recovered_left=%d" % (
    before, len(kept), [r["title"] for r in removed], legacy_rec))
