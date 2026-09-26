# -*- coding: utf-8 -*-
"""核对残留旧库文件 js/library.data.js 与母本的关系（只读）"""
import io, re, json, os

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"

def ids_of(path):
    s = io.open(path, encoding="utf-8").read()
    return set(re.findall(r'"id":"(lib_[0-9a-f]+)"', s)), s

old_p = os.path.join(ROOT, "js", "library.data.js")
new_p = os.path.join(ROOT, "data", "library", "library.data.js")
old_ids, old_s = ids_of(old_p)
new_ids, new_s = ids_of(new_p)

print("旧 js/library.data.js      :", len(old_ids), "条 | 含 truth:", '"truth"' in old_s, "| t2s:", '"t2s"' in old_s, "| e2s:", '"e2s"' in old_s)
print("母本 data/library/*.data.js:", len(new_ids), "条 | 含 truth:", '"truth"' in new_s, "| t2s:", '"t2s"' in new_s, "| e2s:", '"e2s"' in new_s)
print("旧文件是否被 index.html 引用:", "js/library.data.js" in io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read())
print("旧文件是母本子集:", new_ids.issuperset(old_ids), "| 旧文件独有:", len(old_ids - new_ids))
print("母本独有(新增):", len(new_ids - old_ids))
