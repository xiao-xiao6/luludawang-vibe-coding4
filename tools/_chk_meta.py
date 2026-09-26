# -*- coding: utf-8 -*-
import io, os, re, json, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
rows = {r["id"]: r for r in json.load(io.open(T("tools", "checkup_all.json"), encoding="utf-8"))}
# R2 条目：看汤面里的 ※/BS 段
ids_r2 = ["lib_247a5da9ccb8","lib_1b8d3d9b2518","lib_7b7e59065807","lib_c523f2698204","lib_f30b578b106e",
          "lib_dc1830048523","lib_066b7dedef80","lib_92294fdcf566","lib_65c3747dc4cb","lib_c3953b7027ec",
          "lib_89d554a18a6b","lib_38d7b35b4671","lib_a72e6741b9be","lib_a7eea5d563b0","lib_fd7b08ee78c9",
          "lib_88b2abdae709","lib_16dfc330f802","lib_ff7f074e1147"]
print("##### R2 汤面里的元话术")
for i in ids_r2:
    r = rows.get(i)
    if not r: continue
    s = r["surface"]
    m = re.search(r"[※␣ ]?\s*(本题|如果出题|自出题|正解|回答を|BS)", s)
    pos = s.find("※")
    tail = s[pos-6:] if pos > 0 else (s[m.start()-6:] if m else "")
    print("--", i, r["title"][:18])
    print("   …%s" % tail.replace("\n", "⏎")[:150])
print()
print("##### 拉特·拉特冒险者 全文")
r = rows["lib_625339855804"]
print("面:", r["surface"].replace("\n", "⏎"))
print("底:", r["truth"][:700].replace("\n", "⏎"))
print()
print("##### 万代不易的命运")
r = rows["lib_90019f9e0732"]
print("面:", r["surface"][:200].replace("\n", "⏎"))
print("底:", r["truth"][:400].replace("\n", "⏎"))
print()
print("##### 咸味Sam 引号")
r = rows["lib_b3e0c395299d"]
s = r["surface"]
for m in re.finditer(r"[「」『』“”‘’]", s):
    print("   ", s[max(0,m.start()-15):m.end()+15].replace("\n","⏎"))
print()
print("##### 雨乃人之妄念 引号")
r = rows["lib_f30b578b106e"]
t = r["truth"]
for m in re.finditer(r"[「」『』]", t):
    print("   ", t[max(0,m.start()-15):m.end()+15].replace("\n","⏎"))
