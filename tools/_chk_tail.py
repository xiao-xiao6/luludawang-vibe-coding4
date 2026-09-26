# -*- coding: utf-8 -*-
import io, json, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
rows = {r["id"]: r for r in json.load(io.open(ROOT + r"\tools\checkup_all.json", encoding="utf-8"))}
r = rows["lib_6f860967a6c4"]
print("别过来 truth 尾部200字:")
print(r["truth"][-200:])
print()
r2 = rows["lib_0695135164a2"]
print("乐谱 truth 全文:")
print(r2["truth"])
print()
# 宿舍 OCR 条全文
r3 = rows["lib_ea01667538b7"]
print("宿舍 surface:", r3["surface"])
print("宿舍 truth:", r3["truth"][:200])
