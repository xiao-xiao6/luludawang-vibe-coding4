# -*- coding: utf-8 -*-
import io, os, json, sys
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
rows = json.load(io.open(T("tools", "checkup_all.json"), encoding="utf-8"))
fam = ["消失的早餐", "消失的晚餐", "消失的鞋子", "消失的脚印", "失控的电扇", "墙上的影子",
       "影子的异动", "神秘的脚印", "神秘的门铃", "窗外的影子", "餐桌上的水渍", "马路上的鞋子",
       "楼梯上的脚印", "浴室的水声", "地板上的刮痕", "破碎的镜子", "生日快乐", "女明星", "好孩子", "海龟汤", "打不开的门"]
byid = {r["id"]: r for r in rows}
for f in fam:
    v = [r for r in rows if (r["title"] or "").strip() == f]
    if len(v) < 2: continue
    print("#### %s (x%d)" % (f, len(v)))
    for r in v:
        print("  %s [%s] 面:%s" % (r["id"][4:12], r["src"][:14], r["surface"][:46].replace("\n", " ")))
        print("       底:%s" % r["truth"][:60].replace("\n", " "))
