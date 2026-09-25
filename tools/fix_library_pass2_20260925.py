# -*- coding: utf-8 -*-
"""第二轮清洗：
A. 汤面尾部混入的「友情提醒：…」帖子尾巴，截掉
B. 近似重复的 OCR 脏题（如 笔仙 3 个版本、444寝室/444究室、噩梦/辟梦重现）：
   规范化相似度 >= 0.90 归一簇，簇内按「全角标点密度 - 半角引号」评分，留最干净的一条
C. 人工复核确认的汤面/汤底完全错配（神奇娃娃、儿童餐两条），删除
留痕 tools/fix_library_pass2_20260925.json；改完需重跑 node tools/build_worker_data.js
"""
import re, json, io, sys, difflib

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
SRC = r"data\library\library.data.js"

raw = open(SRC, encoding="utf-8").read()
i = raw.index("SOUP_LIBRARY"); j = raw.index("[", i)
depth, k, instr, esc = 0, j, False, False
while True:
    c = raw[k]
    if instr:
        if esc: esc = False
        elif c == "\\": esc = True
        elif c == '"': instr = False
    else:
        if c == '"': instr = True
        elif c == "[": depth += 1
        elif c == "]":
            depth -= 1
            if depth == 0: break
    k += 1
arr = json.loads(raw[j:k+1])
print("input:", len(arr))

MISPAIR = {
    "lib_712a831d7292": "汤面(神奇娃娃许愿规则)与汤底(暗恋闺蜜)完全对不上",
    "lib_83b00372a93d": "汤面(儿童餐痛哭)配的是海龟汤本传的错底，人物场景全不接",
}
log = {"tail_fixed": [], "mispair_deleted": [], "dup_removed": []}

def clean_surface(s):
    idx = s.find("友情提醒")
    if idx > 10:
        return s[:idx].rstrip("．。.，,、； \t"), True
    return s, False

kept = []
for p in arr:
    pid = p.get("id")
    if pid in MISPAIR:
        log["mispair_deleted"].append({"id": pid, "why": MISPAIR[pid], "title": p.get("dispTitle") or p.get("title")})
        continue
    s = str(p.get("surface") or "")
    s2, cut = clean_surface(s)
    if cut:
        log["tail_fixed"].append({"id": pid, "title": p.get("dispTitle"), "cut": s[len(s2):][:40]})
        p["surface"] = s2
    kept.append(p)

CJK = "\u4e00-\u9fff"
def norm(s): return re.sub("[^0-9A-Za-z" + CJK + "]", "", s)
PUNCT = re.compile("[。，！？：；“”]")
def score(p):
    s = str(p.get("surface") or "")
    return len(PUNCT.findall(s)) - s.count('"') - s.count("'") * 0.5

keys = [norm(str(p.get("surface") or "")) for p in kept]
parent = list(range(len(kept)))
def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]; x = parent[x]
    return x
def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb: parent[rb] = ra

for a in range(len(kept)):
    if len(keys[a]) < 25: continue
    for b in range(a + 1, len(kept)):
        if len(keys[b]) < 25: continue
        la, lb = len(keys[a]), len(keys[b])
        if abs(la - lb) / max(la, lb) > 0.18: continue
        r = difflib.SequenceMatcher(None, keys[a], keys[b]).ratio()
        if r >= 0.90: union(a, b)

from collections import defaultdict
clusters = defaultdict(list)
for idx in range(len(kept)):
    clusters[find(idx)].append(idx)

drop = set()
for root, members in clusters.items():
    if len(members) < 2: continue
    best = max(members, key=lambda x: (score(kept[x]), len(keys[x])))
    for m in members:
        if m != best:
            drop.add(m)
            log["dup_removed"].append({
                "removed_id": kept[m].get("id"), "removed_title": kept[m].get("dispTitle"),
                "kept_id": kept[best].get("id"), "kept_title": kept[best].get("dispTitle"),
                "sim": round(difflib.SequenceMatcher(None, keys[m], keys[best]).ratio(), 3)
            })

out = [p for idx, p in enumerate(kept) if idx not in drop]
body = raw[:j] + json.dumps(out, ensure_ascii=False) + raw[k+1:]
open(SRC, "w", encoding="utf-8").write(body)
json.dump(log, open(r"tools\fix_library_pass2_20260925.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("kept:", len(out))
print("tail_fixed:", len(log["tail_fixed"]), "| mispair_deleted:", len(log["mispair_deleted"]), "| dup_removed:", len(log["dup_removed"]))
for d in log["dup_removed"]:
    print("  DUP", d["removed_title"], "→", d["kept_title"], "sim", d["sim"])
for p in out:
    if "笔仙" in str(p.get("surface") or "") and "续缘" in str(p.get("surface") or ""):
        print("笔仙 kept:", p["id"], "|", str(p.get("surface"))[:60])
