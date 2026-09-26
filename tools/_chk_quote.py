# -*- coding: utf-8 -*-
import io, os, json, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
pairs = {p["id"]: p for p in json.load(io.open(T("tools", "checkup_pairs.json"), encoding="utf-8"))}
rows = {r["id"]: r for r in json.load(io.open(T("tools", "checkup_all.json"), encoding="utf-8"))}
for i in ("lib_f30b578b106e", "lib_90019f9e0732"):
    p = pairs.get(i); r = rows[i]
    def cnt(s):
        return {c: s.count(c) for c in "「」『』“”‘’"}
    print("###", i, r["title"][:14])
    print("  原文底:", cnt(p["o_truth"]), " 译底:", cnt(r["truth"]))
    print("  原文面:", cnt(p["o_surface"]), " 译面:", cnt(r["surface"]))
# 姥姥的葬礼 surface
r = rows["lib_bf6dc1df19ca"]
print("\n### 姥姥的葬礼 surface 引号:", {c: r["surface"].count(c) for c in "“”‘’「」"})
print(r["surface"])
# 8 条 title==surface 前缀
print("\n### 标题与汤面同前缀的 8 条")
for i in ("lib_17e2192e6554","lib_1fe394f0087d","lib_23fc37d891c1","lib_61b54a070bab",
          "lib_72d3434bc4c8","lib_afa727cde8c6","lib_cd1400cb152f","lib_db119146416d"):
    r = rows[i]
    print("--", i, "|", r["src"][:22], "|", r["title"][:24])
    print("   面:", r["surface"][:110].replace("\n", " "))
    print("   底:", r["truth"][:110].replace("\n", " "))
