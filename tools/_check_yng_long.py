# -*- coding: utf-8 -*-
"""检查 YesNoGame 超长汤面条目：是否解析串味（混入多题/相关推荐/评论区）"""
import io, os, json

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
d = json.load(io.open(os.path.join(ROOT, "tools", "yng_dump.json"), encoding="utf-8"))
items = d["items"] if isinstance(d, dict) else d

longs = sorted([x for x in items if len(x["surface"]) > 400], key=lambda x: -len(x["surface"]))
print("超长汤面(>400字符)条目数:", len(longs), "/", len(items))
print("=" * 70)
for x in longs:
    print("\n#### YNG#%s %s | surface=%d chars, truth=%d chars" % (x["id"], x["title"], len(x["surface"]), len(x["truth"])))
    print("--- SURFACE ---")
    print(x["surface"][:1500])
    print("--- TRUTH ---")
    print(x["truth"][:400])
    print("-" * 70)
