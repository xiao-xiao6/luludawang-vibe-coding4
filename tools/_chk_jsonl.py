# -*- coding: utf-8 -*-
"""验证繁体原文 jsonl 可用性：字段、条数、繁译简覆盖率、能否按 id/src 对齐"""
import io, os, json, sys, re
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass
WS = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace"
SRC = os.path.join(WS, "海龟汤汤面大全", "海龟汤汤面大全.jsonl")
print("exists:", os.path.exists(SRC), os.path.getsize(SRC) if os.path.exists(SRC) else 0)
rows = [json.loads(l) for l in io.open(SRC, encoding="utf-8") if l.strip()]
print("条数:", len(rows))
print("字段:", list(rows[0].keys()))
print("样例:", json.dumps(rows[0], ensure_ascii=False)[:400])
from collections import Counter
print("source 分布:", Counter(str(r.get("source"))[:30] for r in rows).most_common(10))
# 繁简占比
def has_trad(s):
    from opencc import OpenCC
    return False
# 统计 train_8k 的繁简
train = [r for r in rows if "train_8k" in str(r.get("source"))]
print("train_8k 条数:", len(train))
if train:
    print("样例:", json.dumps(train[0], ensure_ascii=False)[:400])
