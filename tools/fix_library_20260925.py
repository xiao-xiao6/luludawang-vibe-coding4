# -*- coding: utf-8 -*-
"""2026-09-25 题库清洗（保守规则，改动全部留痕到 tools/fix_library_20260925.json）：
① 删除确认污染条目（汤面/汤底是代码、AI 设定文本、玩法说明、带链接来源尾巴的）
② 中文之间夹空格 / 标点旁空格 / 全角空格：OCR 粘连统一清理
③ 汤底尾部残留：句号后孤立的「5、」式编号尾巴按模式截掉
④ 完全重复的汤面（规范化后同串）：保留第一条
只改母本 data/library/library.data.js，改完需重跑 node tools/build_worker_data.js 再生 public/worker 产物。"""
import re, json, io, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
SRC = r"data\library\library.data.js"

raw = open(SRC, encoding="utf-8").read()
print("file head:", raw[:120].replace("\n", " | "))

i = raw.index("SOUP_LIBRARY")
j = raw.index("[", i)
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
print("parsed:", len(arr))

DELETE = {
    "lib_313b1b1994da": "汤面=「给玩家看的谜题描述。」(导入模板残留)",
    "lib_d593c033cea2": "汤面混入玩法说明/对AI的指令文本",
    "lib_b1e9c85a7d03": "汤底混入 Python 代码",
    "lib_cd9ed1dacda9": "汤底混入「让我们开始游戏吧…发送开场白」AI 设定",
    "lib_ff0a78a2fd41": "汤底混入 JSON 测试代码",
    "lib_e217416dd21d": "汤面混入 JS 测试代码 expect(...)",
    "lib_c289acd5109e": "汤底混入「来源：[许二木S2-1](链接)」等多题拼接",
}

SP_PATS = [
    (re.compile("([\u4e00-\u9fff])[ \t\u3000]+(?=[\u4e00-\u9fff])"), r"\1"),
    (re.compile("([\u4e00-\u9fff])[ \t\u3000]+(?=[，。！？、；：])"), r"\1"),
    (re.compile("([，。！？、；：])[ \t\u3000]+(?=[\u4e00-\u9fff])"), r"\1"),
]
TAIL_JUNK = re.compile("[。！？]?(?:\\s*\\d{1,2}[、.．]\\s*[^。！？]{0,14})?\\s*$")

log = {"deleted": [], "space_fixed": [], "tail_fixed": [], "dedup_removed": []}

def norm_key(s):
    return re.sub(r"[^0-9A-Za-z\u4e00-\u9fff]", "", s)

out, seen = [], {}
for p in arr:
    pid = p.get("id")
    if pid in DELETE:
        log["deleted"].append({"id": pid, "why": DELETE[pid], "title": p.get("dispTitle") or p.get("title")})
        continue
    s = str(p.get("surface") or "")
    t = str(p.get("truth") or "")
    s2, t2 = s, t
    for pat, rep in SP_PATS:
        s2 = pat.sub(rep, s2)
        t2 = pat.sub(rep, t2)
    if s2 != s or t2 != t:
        log["space_fixed"].append({"id": pid, "title": p.get("dispTitle") or p.get("title")})
        p["surface"], p["truth"] = s2, t2
        s, t = s2, t2
    # 尾部编号残留：只在「…。」后跟孤立的「数字、短语」且极短时截断
    m = re.search("[。！？][ \t\u3000]*\\d{1,2}[\u3001.\uff0e][^\u3002]{0,10}$", t)
    if m:
        p["truth"] = t[:m.start() + 1]
        log["tail_fixed"].append({"id": pid, "cut": t[m.start():][:30]})
    key = norm_key(s)
    if len(key) >= 20 and key in seen:
        log["dedup_removed"].append({"id": pid, "keep": seen[key], "title": p.get("dispTitle")})
        continue
    if key:
        seen[key] = pid
    out.append(p)

body = raw[:j] + json.dumps(out, ensure_ascii=False) + raw[k+1:]
open(SRC, "w", encoding="utf-8").write(body)
json.dump(log, open(r"tools\fix_library_20260925.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"kept {len(out)} (was {len(arr)})")
print("deleted:", len(log["deleted"]), "| space_fixed:", len(log["space_fixed"]),
      "| tail_fixed:", len(log["tail_fixed"]), "| dedup:", len(log["dedup_removed"]))
