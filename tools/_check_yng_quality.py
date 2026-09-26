# -*- coding: utf-8 -*-
"""YesNoGame 抓取质量体检（只读）：找出汤底过短/疑似解析不全/多问题混杂的条目"""
import io, json, os, re

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
d = json.load(io.open(os.path.join(ROOT, "tools", "yng_dump.json"), encoding="utf-8"))
items = d["items"]

print("总数:", len(items), "| 失败:", len(d.get("failed", [])))
short_t = [x for x in items if len(x["truth"]) < 40]
short_s = [x for x in items if len(x["surface"]) < 30]
multi_q = [x for x in items if x["surface"].count("?") > 1]
print("汤底<40字符:", len(short_t), "| 汤面<30字符:", len(short_s), "| 汤面含多个问句:", len(multi_q))

print("\n--- 汤底过短样本（需人工复核是否解析不全）---")
for x in short_t[:15]:
    print("  #%s %-28s | T(%d): %s" % (x["id"], x["title"][:28], len(x["truth"]), x["truth"].replace("\n", " ")[:70]))

print("\n--- 汤面过短样本 ---")
for x in short_s[:8]:
    print("  #%s %-28s | S(%d): %s" % (x["id"], x["title"][:28], len(x["surface"]), x["surface"].replace("\n", " ")[:70]))

print("\n--- 多问句样本 ---")
for x in multi_q[:8]:
    print("  #%s %-28s | %s" % (x["id"], x["title"][:28], x["surface"].replace("\n", " ")[:90]))

# 长度分布
import statistics
print("\n汤面长度 中位数:", int(statistics.median([len(x["surface"]) for x in items])),
      "| 汤底长度 中位数:", int(statistics.median([len(x["truth"]) for x in items])))
print("汤底 >100 字符占比: %.0f%%" % (100 * sum(1 for x in items if len(x["truth"]) > 100) / len(items)))
