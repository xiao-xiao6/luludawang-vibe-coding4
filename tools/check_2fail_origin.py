# -*- coding: utf-8 -*-
"""诊断 verify_fixes.js 的两条红灯是否来自本轮改动（只读）：
对比 HEAD 与工作区中 room.js / room-ui.js 的相关断言模式，并列出 room.js diff 块归属。"""
import subprocess, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

def head(path):
    return subprocess.run(["git", "show", "HEAD:" + path], capture_output=True).stdout.decode("utf-8", "ignore")

room_w = open("worker/src/room.js", encoding="utf-8").read()
ui_w = open("js/room-ui.js", encoding="utf-8").read()
room_h = head("worker/src/room.js")
ui_h = head("js/room-ui.js")

P1 = 's.phase === "playing" && s.puzzleId && s.turnDeadline'
print("pat1 | HEAD:", P1 in room_h, "| WORK:", P1 in room_w)
j = room_w.find("async sweepTurn")
print("--- WORK sweepTurn def ---")
print(room_w[j:j + 300] if j >= 0 else "(无 async sweepTurn)")
jj = room_h.find("async sweepTurn")
print("--- HEAD sweepTurn def ---")
print(room_h[jj:jj + 300] if jj >= 0 else "(无 async sweepTurn)")
print("--- WORK turnDeadline 所在行 ---")
for ln in room_w.splitlines():
    if "turnDeadline" in ln and "sweep" not in ln.lower():
        print(repr(ln.strip())[:150])
print()
print("clue-list refs | HEAD:", ui_h.count("clue-list"), "| WORK:", ui_w.count("clue-list"))
for ln in ui_w.splitlines():
    if "clue-list" in ln:
        print("  UI-WORK:", ln.strip()[:140])
d = subprocess.run(["git", "diff", "HEAD", "--", "worker/src/room.js"],
                   capture_output=True).stdout.decode("utf-8", "ignore")
hunks = [ln for ln in d.splitlines() if ln.startswith("@@")]
print("room.js diff hunk 数:", len(hunks))
for ln in d.splitlines():
    if ln.startswith(("-", "+")) and ("turnDeadline" in ln or "puzzleId &&" in ln):
        print("DIFF:", ln[:160])
