# -*- coding: utf-8 -*-
"""经典题变体家族检索：电梯矮子 / 半根火柴 / 没淋湿 / 热气球 / 灯塔守 / 关灯自杀 等"""
import io, os, json, sys
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
rows = json.load(io.open(T("tools", "checkup_all.json"), encoding="utf-8"))
FAMS = {
 "电梯矮子": ["够不到", "按不到", "只坐到", "坐到7楼", "坐到11楼", "17楼", "踮"],
 "半根火柴": ["半根火柴", "火柴盒", "沙漠中", "头朝下"],
 "没淋湿": ["没有淋湿", "一点也没湿", "一人未湿", "干干爽爽", "没有打伞"],
 "关灯自杀": ["把灯关上", "关了灯", "随手把灯关", "灯关上继续睡"],
 "海龟汤餐厅": ["海龟汤"],
 "水草自杀": ["水草"],
 "机场/热气球": ["热气球"],
}
for fam, kws in FAMS.items():
    print("####", fam)
    for r in rows:
        blob = r["surface"] + "␟" + r["truth"]
        if any(k in blob for k in kws):
            print("  %s [%s|%s|%s] %s" % (r["id"], r["layer"], r["src"][:16], "/".join(r["cats"][:2]), r["title"][:16]))
            print("     面:%s" % r["surface"][:66].replace("\n", " "))
            print("     底:%s" % r["truth"][:66].replace("\n", " "))
