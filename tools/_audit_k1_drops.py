# -*- coding: utf-8 -*-
"""核查 D4（活动/投票公告帖）与 D3（20の扉）剔除是否误杀 —— 只读 dump"""
import io, os, json, sys, re
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)

d = json.load(io.open(T("tools", "llt_dump.json"), encoding="utf-8"))
its = {i["id"]: i for i in d["items"]}

fresh = json.load(io.open(T("tools", "llt_fresh_final.json"), encoding="utf-8"))
drop = fresh["dropped"]

def show(ids, label):
    print("")
    print("=" * 74)
    print("### %s  n=%d" % (label, len(ids)))
    print("=" * 74)
    for lid in ids:
        it = its.get(lid)
        if not it: continue
        print("--- #%s《%s》 bm=%s T=%d" % (lid, it["title"][:34], it.get("bookmarks"), len(it["truth"] or "")))
        print("    tags: " + ", ".join((it.get("tags") or [])[:12]))
        print("    面: " + (it["surface"] or "").replace("\n", " ")[:150])
        print("    底: " + (it["truth"] or "").replace("\n", " ")[:150])

d4 = [x["id"] for x in drop if x["why"].startswith("D4")]
d3 = [x["id"] for x in drop if x["why"].startswith("D3")]
show(d4, "D4 被剔除（活动/投票公告帖）")
show(d3[:20], "D3 被剔除前 20（非标准品类）")
