# -*- coding: utf-8 -*-
"""核对专名统一后的可疑点：译文里出现 龟男/龟女 但原文是否真有 カメオ/カメコ；以及"小乌龟"被误改"""
import io, os, re, json, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
rows = json.load(io.open(T("tools", "checkup_all.json"), encoding="utf-8"))
llt = {str(it["id"]): it for it in json.load(io.open(T("tools", "llt_fresh_final.json"), encoding="utf-8"))["items"]}
# 重新读母本（已改过）
src = io.open(T("data", "library", "library.data.js"), encoding="utf-8").read()
i = src.find("var SOUP_LIBRARY"); i = src.find("[", i)
d = 0
for k in range(i, len(src)):
    if src[k] == "[": d += 1
    elif src[k] == "]":
        d -= 1
        if d == 0:
            data = json.loads(src[i:k+1]); break
sus = []
for e in data:
    if e.get("src") != "late-late.jp": continue
    o = llt.get(str(e.get("srcNo")))
    if not o: continue
    ja = (o.get("surface") or "") + (o.get("truth") or "")
    z = (e.get("surface") or "") + (e.get("truth") or "")
    # 反向：译文有龟男/龟女，但原文没有对应假名
    if "龟男" in z and "カメオ" not in ja: sus.append((e["id"], e.get("srcNo"), "龟男无カメオ", e.get("title","")[:16]))
    if "龟女" in z and "カメコ" not in ja: sus.append((e["id"], e.get("srcNo"), "龟女无カメコ", e.get("title","")[:16]))
    # 真·小乌龟 语境
    if "乌龟" in z or "小乌龟" in z: sus.append((e["id"], e.get("srcNo"), "含'乌龟'字样(核对是否误改)", e.get("title","")[:16]))
print("可疑点:", len(sus))
for s in sus[:25]: print("  #%s %s | %s" % (s[1], s[2], s[3]))
# 抽查 3 条改过的：打印原文与译文对照
import itertools
log = json.load(io.open(T("tools", "checkup_termfix_log.json"), encoding="utf-8"))
print("\n抽查前3条对照:")
for item in log[:3]:
    pid = item[0]
    e = next(x for x in data if x["id"] == pid)
    o = llt.get(str(e.get("srcNo")))
    print("###", e.get("srcNo"), e.get("title")[:20])
    print("  原面:", (o.get("surface") or "")[:110].replace("\n"," "))
    print("  译面:", (e.get("surface") or "")[:110].replace("\n"," "))
