# -*- coding: utf-8 -*-
"""第四轮收尾：定点处理复核确认的 OCR 脏题。
1) 笔仙脏版 lib_0adc47714500（「请再纸上画圈」+引号乱）→ 干净版 lib_cb5ea96c19db 在场则删除
2) lib_f8b00b40b3c4（「我要当和区爸啦」）→ 若确是噩梦重现的脏变体且干净版 lib_a8c01bd11872 在场则删；
   否则就地修「和区爸」→「爸爸」
3) 兜底：任何残留「请再纸上画圈」→「请在纸上画圈」
"""
import json, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
SRC = r"data\library\library.data.js"

def load(path, var):
    raw = open(path, encoding="utf-8").read()
    i = raw.index(var); j = raw.index("[", i)
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
    return json.loads(raw[j:k+1]), raw, j, k

arr, raw, j, k = load(SRC, "SOUP_LIBRARY")
byid = {p.get("id"): p for p in arr}
print("before:", len(arr))
changes = []

dirty = byid.get("lib_0adc47714500"); clean = byid.get("lib_cb5ea96c19db")
if dirty and clean:
    arr = [p for p in arr if p.get("id") != "lib_0adc47714500"]
    changes.append("删除笔仙脏版 lib_0adc47714500（保留干净版 lib_cb5ea96c19db）")

x = byid.get("lib_f8b00b40b3c4")
if x:
    title = str(x.get("dispTitle") or x.get("title") or "")
    print("f8b0 title:", title, "| surf:", str(x.get("surface"))[:55])
    if ("噩梦重现" in title or "辟梦" in title) and byid.get("lib_a8c01bd11872"):
        arr = [p for p in arr if p.get("id") != "lib_f8b00b40b3c4"]
        changes.append("删除噩梦重现脏版 lib_f8b00b40b3c4（保留干净版 lib_a8c01bd11872）")
    else:
        for p in arr:
            if p.get("id") == "lib_f8b00b40b3c4":
                s = str(p.get("surface") or "")
                s2 = s.replace("当和区爸啦", "当爸爸啦").replace("和区爸", "爸爸")
                if s2 != s:
                    p["surface"] = s2
                    changes.append("修正「和区爸」→「爸爸」lib_f8b00b40b3c4")

for p in arr:
    s = str(p.get("surface") or "")
    s2 = s.replace("请再纸上画圈", "请在纸上画圈")
    if s2 != s:
        p["surface"] = s2
        changes.append("修正「再纸上」→「在纸上」" + str(p.get("id")))

body = raw[:j] + json.dumps(arr, ensure_ascii=False) + raw[k+1:]
open(SRC, "w", encoding="utf-8").write(body)
print("after:", len(arr))
for c in changes:
    print(" *", c)
