# -*- coding: utf-8 -*-
"""把关判定自动对照器：把每条判定的 quote 在原文/译文里定位，打印两侧窗口，供逐条定性。
用法：python -X utf8 tools/verify_check4.py
产出：tools/_v4_drop.txt（拟淘汰清单） + tools/_v4_fix.txt（拟修复对照）
"""
import io, os, json, glob

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
T = lambda *p: os.path.join(ROOT, "tools", *p)
FL = lambda s: (s or "").replace("\n", "⏎")

tr = json.load(io.open(T("llt3_trans_clean.json"), encoding="utf-8"))
orig = {str(x["id"]): x for x in json.load(io.open(T("llt_dump3.json"), encoding="utf-8"))["items"]}

verd = []
for f in sorted(glob.glob(T("check4_verdicts", "*.jsonl"))):
    for ln in io.open(f, encoding="utf-8"):
        ln = ln.strip()
        if ln:
            d = json.loads(ln)
            if d.get("kind") != "none":
                d["_from"] = os.path.basename(f)[:-6]
                verd.append(d)

DROPK = ("unplayable", "truth_empty", "mismatch")
drop = [d for d in verd if d["kind"] in DROPK]
keep = [d for d in verd if d["kind"] not in DROPK]


def block(d):
    sid = d["id"]
    field = d.get("field") or "all"
    quote = d.get("quote") or ""
    v, g = tr.get(sid) or {}, orig.get(sid) or {}
    fs = field if field in ("surface", "truth") else "truth"
    cur, ori = v.get(fs) or "", g.get(fs) or ""
    i = ori.find(quote[:12]) if quote else -1
    lines = ["### #%s %s.%s ← %s" % (sid, d["kind"], field, v.get("title", "?"))]
    if i >= 0:
        lines.append("  ORI: " + FL(ori[max(0, i - 80): i + len(quote) + 140]))
    else:
        lines.append("  ORI: " + FL(ori)[:260])
    lines.append("  CUR: " + FL(cur)[:300])
    lines.append("  长度 译/原 = %d/%d ｜ 依据: %s" % (len(cur), len(ori), d.get("note")))
    return "\n".join(lines) + "\n\n"


with io.open(T("_v4_drop.txt"), "w", encoding="utf-8") as f:
    f.write("拟淘汰 %d 条\n" % len(drop))
    for d in drop:
        f.write("× %s %s.%s | %s | %s\n" % (d["id"], d["kind"], d.get("field"), d.get("note"), (d.get("quote") or "")[:46]))
with io.open(T("_v4_fix.txt"), "w", encoding="utf-8") as f:
    f.write("拟修复 %d 条\n\n" % len(keep))
    for d in keep:
        f.write(block(d))

print("判定 %d ｜ 修复类 %d ｜ 淘汰类 %d" % (len(verd), len(keep), len(drop)))
