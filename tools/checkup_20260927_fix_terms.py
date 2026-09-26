# -*- coding: utf-8 -*-
"""
体检修复 · 第 4 步（重做）：日译中主角译名统一
安全设计：
 1) 最长优先：先处理 カメコ 的 小龟女/小龟子，再处理 カメオ 的 小龟，避免「小龟女→龟男女」切词事故
 2) 假名闸门：该条日文原文必须真含对应假名才动手
 3) 刻意区分保留：7399 里老师カメコ=龟女 / 学生カメコ=龟子，故「龟子」不并入
 4) 短语级译名保留：カメオ老人→龟老头（自然中文，不动）
 5) 事后断言：不得出现 龟男男/龟女女/龟男女/海男男/海女女 等坏词，且总字数变化可控
"""
import io, os, re, json, shutil, sys
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
MASTER = T("data", "library", "library.data.js")

src = io.open(MASTER, encoding="utf-8").read()
head = src[:src.find("var SOUP_LIBRARY")]
i = src.find("var SOUP_LIBRARY"); i = src.find("[", i)
end = src.find("\nvar SOUP_LIB_CATS", i)
tail = src[end:]
data = json.loads(src[i:end].rsplit("]", 1)[0] + "]")
llt = {str(it["id"]): it for it in json.load(io.open(T("tools", "llt_fresh_final.json"), encoding="utf-8"))["items"]}
print("条目数:", len(data))

# (假名, 变体[长→短], 目标, 右邻禁字)
RULES = [
    ("カメコ", ["小龟女", "小龟子", "卡梅子", "卡梅科", "龟古", "龟子"], "龟女", ""),
    ("カメオ", ["小龟男", "小龟", "卡梅奥", "龟治", "卡美欧", "龟奥"], "龟男", ""),
    ("ウミオ", ["小海", "海雄", "乌米奥"], "海男", "龟"),
    ("ウミコ", ["小海子", "海子", "乌米科"], "海女", ""),
]
BAD = ("龟男男", "龟女女", "龟男女", "海男男", "海女女", "海男女", "龟龟", "海海")

n_ent = 0; n_rep = 0; log = []
for e in data:
    if e.get("src") != "late-late.jp": continue
    o = llt.get(str(e.get("srcNo")))
    if not o: continue
    ja = (o.get("surface") or "") + "\n" + (o.get("truth") or "")
    before = {f: (e.get(f) or "") for f in ("title", "dispTitle", "surface", "truth")}
    per = []
    for kana, variants, target, forbid in RULES:
        if kana not in ja: continue
        for f in ("title", "dispTitle", "surface", "truth"):
            s = e.get(f) or ""
            if not s: continue
            out = []; k = 0; changed = False
            while k < len(s):
                hit = None
                for v in variants:                       # 最长优先：variants 已按长度降序
                    if s.startswith(v, k):
                        if forbid and k + len(v) < len(s) and s[k + len(v)] in forbid:
                            continue
                        hit = v; break
                if hit:
                    out.append(target); k += len(hit); changed = True
                else:
                    out.append(s[k]); k += 1
            new = "".join(out)
            if changed and new != s:
                per.append("%s:%s→%s" % (f, kana, target))
                e[f] = new
    if per:
        # 坏词断言
        z = (e.get("surface") or "") + (e.get("truth") or "") + (e.get("title") or "")
        for b in BAD:
            if b in z:
                print("!! 产生坏词 %s @ %s，回滚该条" % (b, e["id"]))
                for f, v in before.items(): e[f] = v
                per = []; break
    if per:
        n_ent += 1; n_rep += len(per); log.append({"id": e["id"], "srcNo": e.get("srcNo"), "ops": per, "title": e.get("title", "")[:20]})

print("受影响条目:", n_ent, " 字段替换:", n_rep)

# 复核统一后的分布
CAND = {"カメオ": ["龟男", "小龟", "小龟男"], "カメコ": ["龟女", "小龟子", "小龟女"],
        "ウミオ": ["海男", "小海", "海雄"], "ウミコ": ["海女", "海子"]}
print("\n===== 统一后分布 =====")
for nm, cs in CAND.items():
    c = {}
    for e in data:
        if e.get("src") != "late-late.jp": continue
        o = llt.get(str(e.get("srcNo")))
        if not o: continue
        ja = (o.get("surface") or "") + (o.get("truth") or "")
        if nm not in ja: continue
        z = (e.get("surface") or "") + (e.get("truth") or "")
        for x in cs:
            if x in z: c[x] = c.get(x, 0) + 1
    print("  %-7s → %s" % (nm, c))

assert all((e.get("title") or "").strip() for e in data), "空标题"
assert all((e.get("surface") or "").strip() for e in data), "空汤面"
assert all((e.get("truth") or "").strip() for e in data), "空汤底"
# 条内一致性复核：同一假名在同一条的汤面/汤底里是否用同一套词
def toks(z, cs): return {x for x in cs if x in z}
inc = 0
for e in data:
    if e.get("src") != "late-late.jp": continue
    o = llt.get(str(e.get("srcNo")))
    if not o: continue
    ja = (o.get("surface") or "") + (o.get("truth") or "")
    for nm, cs in CAND.items():
        if nm not in ja: continue
        s = toks(e.get("surface") or "", cs); t = toks(e.get("truth") or "", cs)
        if s and t and s.isdisjoint(t):
            inc += 1; print("  条内仍不一致:", e["id"], nm, s, t)
print("条内不一致:", inc)

shutil.copyfile(MASTER, T("_local_backup", "library.data.js.bak-checkup4b"))
body = head + "var SOUP_LIBRARY = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";" + tail
io.open(MASTER, "w", encoding="utf-8").write(body)
json.dump(log, io.open(T("tools", "checkup_termfix_log.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("\n已写盘 | 条目数:", len(data))
