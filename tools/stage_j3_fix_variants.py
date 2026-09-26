# -*- coding: utf-8 -*-
"""
Stage J3（2026-09-26）：修正 Stage J2 的误删
依据：采集纪律「同源变体不删、加 alsoIn 互链」（玩家反馈第 3 条，主人已采纳）
1) 复原 2 条「同题异解」变体：lib_b560a80af76b（铁肺停电）、lib_bb9b8da83f0b（三解合辑）
   —— 它们的「重复对象」lib_4195efaab01e 是钢丝演员版，答案是另一回事，不构成重复
   —— lib_d54c7f270c6d 与 b560 答案相同，维持删除
2) 给该家族三条加 alsoIn 互链
3) 消解新增条目唯一剩留撞名：lib_e4042204c3dc《无声的电话》改名
写盘前备份；产出 tools/stage_j3_log.json
"""
import io, json, os, shutil, sys, re
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
MASTER = T("data", "library", "library.data.js")
BACKUP = T("_local_backup", "library.data.js.bak-stagej3")
shutil.copyfile(MASTER, BACKUP)

DEC = json.JSONDecoder()

def load(p):
    s = io.open(p, encoding="utf-8").read()
    i = s.find("var SOUP_LIBRARY"); j = s.find("[", i)
    return DEC.raw_decode(s[j:])[0]

src = io.open(MASTER, encoding="utf-8").read()
head = src[:src.find("var SOUP_LIBRARY")]
i = src.find("var SOUP_LIBRARY"); i = src.find("[", i)
end = src.find("\nvar SOUP_LIB_CATS", i)
tail = src[end:]
data = json.loads(src[i:end].rsplit("]", 1)[0] + "]")
byid = {e["id"]: e for e in data}
before = len(data)

# 从 J2 前备份取回被误删的条目
old = load(T("_local_backup", "library.data.js.bak-stagej2"))
old_byid = {e["id"]: e for e in old}
old_index = {e["id"]: k for k, e in enumerate(old)}

RESTORE = ["lib_b560a80af76b", "lib_bb9b8da83f0b"]
log = {"before": before, "restored": [], "alsoIn": [], "renamed": None}

for rid in RESTORE:
    assert rid not in byid, "%s 已在库中，无需复原" % rid
    e = old_byid[rid]
    data.append(e)
    byid[rid] = e
    log["restored"].append({"id": rid, "title": e.get("title"), "surface": e.get("surface")[:40]})
    print("复原 %s《%s》" % (rid, e.get("title")))

# alsoIn 互链：音乐停止家族
FAMILY = ["lib_4195efaab01e", "lib_b560a80af76b", "lib_bb9b8da83f0b"]
for fid in FAMILY:
    e = byid.get(fid)
    if not e:
        print("  跳过 alsoIn（不存在）:", fid); continue
    others = [x for x in FAMILY if x != fid]
    e["alsoIn"] = others
    log["alsoIn"].append({"id": fid, "alsoIn": others})
    print("alsoIn %s -> %s" % (fid, others))

# 改名：消解撞名
RENAME = {"lib_e4042204c3dc": "打鼾的邻居"}
for rid, newtitle in RENAME.items():
    e = byid.get(rid)
    if not e:
        print("  跳过改名（不存在）:", rid); continue
    log["renamed"] = {"id": rid, "from": e.get("title"), "to": newtitle}
    print("改名 %s 《%s》 -> 《%s》" % (rid, e.get("title"), newtitle))
    e["title"] = newtitle
    e["dispTitle"] = newtitle

body = head + "var SOUP_LIBRARY = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";" + tail
io.open(MASTER, "w", encoding="utf-8").write(body)
io.open(T("tools", "stage_j3_log.json"), "w", encoding="utf-8").write(json.dumps(log, ensure_ascii=False, indent=1))

print("\nOK %d -> %d | 复原 %d | alsoIn %d | 改名 %d"
      % (before, len(data), len(log["restored"]), len(log["alsoIn"]), 1 if log["renamed"] else 0))
print("e2s 总数:", sum(1 for e in data if e.get("_t") == "e2s"))
