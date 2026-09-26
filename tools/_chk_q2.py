# -*- coding: utf-8 -*-
import io, os, re, json, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
rows = {r["id"]: r for r in json.load(io.open(T("tools", "checkup_all.json"), encoding="utf-8"))}
pairs = {p["id"]: p for p in json.load(io.open(T("tools", "checkup_pairs.json"), encoding="utf-8"))}

def unmatched(s, op, cl):
    stack = []; extra_close = []
    for k, ch in enumerate(s):
        if ch == op: stack.append(k)
        elif ch == cl:
            if stack: stack.pop()
            else: extra_close.append(k)
    return stack, extra_close

for pid, op, cl in (("lib_f30b578b106e", "「", "」"), ("lib_90019f9e0732", "『", "』")):
    r = rows[pid]
    for f in ("surface", "truth"):
        s = r[f]
        uo, uc = unmatched(s, op, cl)
        if uo or uc:
            print("###", pid, f, "未闭合%s:" % op, uo, "多余%s:" % cl, uc)
            for k in uo:
                print("   [open ] …%s…" % s[max(0,k-45):k+45].replace("\n", "⏎"))
            for k in uc:
                print("   [close] …%s…" % s[max(0,k-45):k+45].replace("\n", "⏎"))
    # 原文对照
    p = pairs.get(pid)
    if p:
        o = p["o_truth"]
        print("   原文 %s%s 计数:" % (op, cl), o.count(op), o.count(cl))
        if pid == "lib_f30b578b106e":
            k = o.find("你说什么")
            print("   原文该处:", o[max(0,k-30):k+60].replace("\n", "⏎") if k>=0 else "(未找到)")
        else:
            for m in re.finditer("『", o):
                print("   原『:", o[m.start():m.start()+40].replace("\n","⏎"))
    print()
