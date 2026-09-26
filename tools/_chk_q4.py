# -*- coding: utf-8 -*-
import io, os, json, sys, re
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
pairs = {p["id"]: p for p in json.load(io.open(T("tools", "checkup_pairs.json"), encoding="utf-8"))}
o = pairs["lib_f30b578b106e"]["o_truth"]
k = o.find("次の瞬間")
print("原文（次の瞬間 起 400字）:\n" + o[k:k+400].replace("\n", "⏎"))
