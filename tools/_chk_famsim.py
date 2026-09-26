# -*- coding: utf-8 -*-
"""train_8k 家族组内两两相似度（面+底），辅助去重决策"""
import io, os, re, json, sys
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
rows = json.load(io.open(T("tools", "checkup_all.json"), encoding="utf-8"))
PUNCT = re.compile(r"[\s\u3000，。、！？；：·…—－\-_,\.\!\?\;:\"'“”‘’（）()\[\]【】《》<>{}|/\\~`@#$%^&*+=「」『』※★☆●○■□◇♡？！]+")
def norm(s): return PUNCT.sub("", (s or "").lower())
def bg(s):
    s = norm(s)
    return set(s[i:i+2] for i in range(len(s)-1)) if len(s) > 1 else ({s} if s else set())
def jac(a, b): return (len(a & b) / len(a | b)) if (a and b) else 0.0
groups = {
 "消失的早餐": ["lib_3e731d8e6303","lib_1b87b25ec3f6","lib_ff8274c3b6a4","lib_15397666d0dc","lib_63cc13c14001"],
 "消失的晚餐": ["lib_cf4df2679f37","lib_f63fea0b8942","lib_bc9361702fe8"],
 "消失的鞋子": ["lib_87cf5cda72ec","lib_5a07724b936e","lib_b14834641b71","lib_6484e3174027"],
 "消失的脚印": ["lib_647ed957cb9b","lib_9e2ac3c33b31","lib_ce47f98df151"],
 "失控的电扇": ["lib_9eb904db0faa","lib_755a61744682"],
 "墙上的影子": ["lib_e471898bb935","lib_3226cac1692e"],
 "影子的异动": ["lib_9ca012813305","lib_f5a52dba652d"],
 "神秘的脚印": ["lib_8149a55c2cf7","lib_f5ffa3a3b5fe"],
 "神秘的门铃": ["lib_600c89e5687d","lib_9d1ba3a3e810","lib_586e3435151a"],
 "窗外的影子": ["lib_7386ca5835f0","lib_83fccebd826a"],
 "餐桌上的水渍": ["lib_765cb7b11b42","lib_b39525f95f19"],
 "马路上的鞋子": ["lib_36ce40c0673a","lib_7a8440e15796"],
 "楼梯上的脚印": ["lib_524e0a51b2d9","lib_531fe2908aac"],
 "浴室的水声": ["lib_004e5146594c","lib_6f9d41b86cb2"],
 "地板上的刮痕": ["lib_6c49004a65e7","lib_e37624aebb92"],
 "反复开关的灯": ["lib_1109722c5e9b","lib_04881146676a"],
}
byid = {r["id"]: r for r in rows}
for g, ids in groups.items():
    ids = [i for i in ids if i in byid]
    print("####", g)
    for a in range(len(ids)):
        for b in range(a+1, len(ids)):
            ra, rb = byid[ids[a]], byid[ids[b]]
            js = jac(bg(ra["surface"]), bg(rb["surface"]))
            jt = jac(bg(ra["truth"]), bg(rb["truth"]))
            print("   %s~%s 面%.2f 底%.2f" % (ids[a][4:12], ids[b][4:12], js, jt))
