# -*- coding: utf-8 -*-
"""展开 R1/R5/R9/LEN_DIFF 明细，逐条看原文 vs 译文"""
import io, os, json, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
iss = json.load(io.open(T("tools", "checkup_trans_issues.json"), encoding="utf-8"))
pairs = {p["id"]: p for p in json.load(io.open(T("tools", "checkup_pairs.json"), encoding="utf-8"))}
t2s = json.load(io.open(T("tools", "checkup_t2s_diff.json"), encoding="utf-8"))

def show(pid, note):
    p = pairs.get(pid)
    if not p:
        print("  (无对齐)", pid, note); return
    print("  ### %s [%s|%s] %s" % (pid, p["tag"], p.get("o_lab"), p["zh_title"][:20]))
    print("   ", note)
    print("   原面:", (p["o_surface"] or "")[:170].replace("\n", "⏎"))
    print("   译面:", (p["zh_surface"] or "")[:170].replace("\n", "⏎"))
    print("   原底:", (p["o_truth"] or "")[:200].replace("\n", "⏎"))
    print("   译底:", (p["zh_truth"] or "")[:200].replace("\n", "⏎"))

for rule in ("R1_UNDERTRANSLATE", "R5_NUM_LOST", "R9_KANA_RATIO"):
    print("\n==========", rule, "==========")
    for i in iss:
        if i["rule"] == rule:
            print("- id=%s %s" % (i["id"], i["detail"]))
            show(i["id"], i["detail"])

print("\n========== 繁译简 LEN_DIFF ==========")
for s in t2s:
    if s["kind"] == "LEN_DIFF":
        print("- id=%s %s" % (s["id"], s["detail"]))
        show(s["id"], s["detail"])
