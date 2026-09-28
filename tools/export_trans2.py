# -*- coding: utf-8 -*-
"""本轮 · Stage L-2：把闸门定稿按“好评降序 + 定长 30 条一批”切成日译中批次。

要点：切批必须是**顺序定长**，不随总数重新配平 ——
这样抓取边跑、翻译边开工，后面新增的题只会追加新批次，已译好的批次内容不变。
输出：tools/llt_trans_in2/batch_NN.json（沿用上一轮格式）
      tools/llt2_reserve.json（送译上限之外的定稿，留给下一轮）
"""
import io, os, re, json, sys, math

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
T = lambda *p: os.path.join(ROOT, "tools", *p)
IN_DIR = T("llt_trans_in2")
os.makedirs(IN_DIR, exist_ok=True)

TAKE = int(sys.argv[1]) if len(sys.argv) > 1 else 480
PER = 30
fresh = json.load(io.open(T("llt2_fresh.json"), encoding="utf-8"))["items"]


def nz(s):
    return re.sub(r"\r\n?", "\n", (s or "")).strip()


take = fresh[:TAKE]
for i in range(0, len(take), PER):
    ch = take[i:i + PER]
    k = i // PER + 1
    payload = {"batch": k, "lang": "ja", "src": "late-late.jp", "count": len(ch),
               "items": [{"id": c["id"], "title": nz(c["title"]), "surface": nz(c["surface"]),
                          "truth": nz(c["truth"])} for c in ch]}
    io.open(os.path.join(IN_DIR, "batch_%02d.json" % k), "w", encoding="utf-8").write(
        json.dumps(payload, ensure_ascii=False, indent=1))

keep = set("batch_%02d.json" % (i + 1) for i in range(math.ceil(len(take) / PER)))
for f in os.listdir(IN_DIR):
    if f.startswith("batch_") and f not in keep:
        os.remove(os.path.join(IN_DIR, f))

ids = [c["id"] for c in take]
assert len(ids) == len(set(ids)), "送译清单里有重复 id"
n = len(keep)
tot = sum(os.path.getsize(os.path.join(IN_DIR, "batch_%02d.json" % k)) for k in range(1, n + 1))
print("定稿 %d 条 | 送译 %d 条 → %d 批（每批 30 条，末批 %d 条，共 %.0fKB）"
      % (len(fresh), len(take), n, len(take) % PER or PER, tot / 1024.0))
