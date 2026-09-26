# -*- coding: utf-8 -*-
"""
Stage I-8：把 YesNoGame 净新增切成翻译批次（只读源 + 产出批次文件）
输入：tools/yng_fresh_final.json（218 条）
产出：tools/yng_trans_in/batch_01.json ... batch_06.json
"""
import io, os, json, sys
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
IN_DIR = T("tools", "yng_trans_in")
os.makedirs(IN_DIR, exist_ok=True)

data = json.load(io.open(T("tools", "yng_fresh_final.json"), encoding="utf-8"))
items = sorted(data["items"], key=lambda x: int(x["sid"]))
print("待翻译总数:", len(items))
print("已排除：高置信重复 %s | 待判 %s | 超长暂缓 %s"
      % (data["excluded"]["high_conf_dup"], data["excluded"]["pending"], data["excluded"]["flagged_long"]))

N = 6
base = len(items) // N
rem = len(items) % N
chunks, pos = [], 0
for k in range(N):
    size = base + (1 if k < rem else 0)
    chunks.append(items[pos:pos + size]); pos += size

for k, ch in enumerate(chunks, 1):
    payload = {"batch": k, "count": len(ch),
               "items": [{"sid": it["sid"], "title": it["title"], "surface": it["surface"], "truth": it["truth"]}
                         for it in ch]}
    p = os.path.join(IN_DIR, "batch_%02d.json" % k)
    io.open(p, "w", encoding="utf-8").write(json.dumps(payload, ensure_ascii=False, indent=1))
    print("  batch_%02d.json  %2d 条  (%s ~ %s)" % (k, len(ch), ch[0]["sid"], ch[-1]["sid"]))

# 完整性自检：并集 == 全量、无重复、无空缺
all_sids = [it["sid"] for ch in chunks for it in ch]
assert len(all_sids) == len(items), "批次总数不符"
assert len(set(all_sids)) == len(all_sids), "批次间有重复"
assert set(all_sids) == set(it["sid"] for it in items), "批次与源不一致"
print("自检通过：%d 条全覆盖、无重复" % len(all_sids))
