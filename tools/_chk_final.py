# -*- coding: utf-8 -*-
import io, os, json, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
rows = {r["id"]: r for r in json.load(io.open(T("tools", "checkup_all.json"), encoding="utf-8"))}
pairs = {p["id"]: p for p in json.load(io.open(T("tools", "checkup_pairs.json"), encoding="utf-8"))}

print("##### 挂断电话 中英对照")
p = pairs["lib_1605736a782b"]
print("原底:", p["o_truth"])
print("译底:", p["zh_truth"])
print()
print("##### 别过来 surface==truth前缀?")
r = rows["lib_6f860967a6c4"]
print("truth 以 surface 开头:", r["truth"].startswith(r["surface"]), "| surface长", len(r["surface"]), "truth长", len(r["truth"]))
print()
print("##### soups.json 里 _t 是否还是脏的")
soups = json.load(io.open(T("data", "library", "soups.json"), encoding="utf-8"))
bad = [s for s in soups if (s.get("_t") or "") not in ("", "t2s", "e2s", "j2s", "konpigg", "noTitle")]
print("soups.json _t 异常:", len(bad), "样例:", repr(bad[0]["_t"])[:60] if bad else "无")
lib = [r for r in rows.values()]
badm = [r for r in lib if r["_t"] not in ("", "t2s", "e2s", "j2s")]
print("母本 _t 异常:", len(badm))
print()
print("##### 乐谱 全文")
r = rows["lib_0695135164a2"]
print("面:", r["surface"])
print("底全文(%d):" % len(r["truth"]), r["truth"])
print()
print("##### 不能回来 全文")
r = rows["lib_9303cd77d99f"]
print("底:", r["truth"])
print()
print("##### 精品 o-clock")
r = rows.get("o-clock")
if r: print("面:", r["surface"][:200], "| 底:", r["truth"][:120])
print()
print("##### 需知识咖啡闲谈 全文")
r = rows["lib_af5cd136a547"]
print("面:", r["surface"])
print("底:", r["truth"][:300])
print()
print("##### 咸味Sam 汤底里的数字")
r = rows["lib_b3e0c395299d"]
import re
print("原底数字:", sorted(set(re.findall(r"\d+", pairs["lib_b3e0c395299d"]["o_truth"])))[:12])
print("译底片段:", r["truth"][:200])
print()
print("##### 照片拍得真好 尾部")
r = rows["lib_6fd3d228e4cf"]
print("底尾200:", r["truth"][-200:])
print()
print("##### 才不是抽烟 尾部")
r = rows["lib_16dfc330f802"]
print("底尾150:", r["truth"][-150:])
