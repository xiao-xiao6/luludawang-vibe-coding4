# -*- coding: utf-8 -*-
import io, os, json, re
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
rows = {r["id"]: r for r in json.load(io.open(T("tools", "checkup_all.json"), encoding="utf-8"))}
out = []
def w(s): out.append(s)

def ctx(pid, field, kw, span=70, label=""):
    r = rows[pid]; s = r[field]
    w("### %s %s [%s] kw=%s len=%d" % (pid, field, label, kw, len(s)))
    for m in list(re.finditer(re.escape(kw), s))[:6]:
        w("   …" + s[max(0, m.start()-span):m.end()+span].replace("\n", "⏎") + "…")
    w("")

ctx("lib_625339855804", "surface", "", 400, "面全文")
out[-2] = "   " + rows["lib_625339855804"]["surface"].replace("\n", "⏎")
ctx("lib_625339855804", "truth", "击", 60, "含击")
ctx("lib_16dfc330f802", "truth", "遮掉", 120, "颜文字起点")
ctx("lib_16dfc330f802", "truth", "前进", 120, "颜文字终点")
ctx("lib_90019f9e0732", "surface", "请指出", 300, "面尾BS")
ctx("lib_90019f9e0732", "truth", "在解说之前", 260, "底里外链")
ctx("lib_af5cd136a547", "surface", "魏森", 60, "店名")
ctx("lib_463d72d94150", "truth", "篠崎", 60, "人名")
ctx("lib_2ee8dbec8a06", "truth", "そばは", 120, "谜挂原文")
ctx("lib_b3e0c395299d", "surface", "Salted", 90, "引号")
ctx("lib_0695135164a2", "truth", "Do=1", 90, "重复段")
ctx("lib_9303cd77d99f", "truth", "局", 40, "审查残留")
w("### lib_1294ed2c0162 title=%s" % rows["lib_1294ed2c0162"]["title"])
w("### lib_1294ed2c0162 dispTitle=%s" % rows["lib_1294ed2c0162"]["dispTitle"])
io.open(T("tools", "_fix_view.txt"), "w", encoding="utf-8").write("\n".join(out))
print("written", len("\n".join(out)))
