# -*- coding: utf-8 -*-
"""
深海汤屋 · Stage G：英译中回写 + 无题命名回写（写盘）
1) 删除 en_drop 26 条英文垃圾/重复题
2) 应用 en_trans p1~p7：中文面/底/标题，cats 加「英译中」，lang=zh，quality=e2s
3) 应用 untitled_titles p1/p3/p4/p5：121 道无题老题命名（2~9 字）
4) 全面自检后写回 data/library/library.data.js + tools/stage_g_log.json
"""
import io, re, json, shutil
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
MASTER = ROOT + r"\data\library\library.data.js"

# 备份
shutil.copyfile(MASTER, ROOT + r"\_local_backup\library.data.js.bak-stageg")

src = io.open(MASTER, encoding="utf-8").read()
head = src[:src.find("var SOUP_LIBRARY")]
i = src.find("var SOUP_LIBRARY"); i = src.find("[", i)
end = src.find("\nvar SOUP_LIB_CATS", i)
tail = src[end:]
data = json.loads(src[i:end].rsplit("]", 1)[0] + "]")
log = {"before": len(data)}

# ---------- 1) 删除 en_drop ----------
drop = set(json.load(io.open(ROOT + r"\tools\en_drop.json", encoding="utf-8"))["drop"])
data = [e for e in data if e["id"] not in drop]
log["en_drop_removed"] = len(drop)

# ---------- 2) 应用英译中 ----------
tr = {}
for p in range(1, 8):
    for k, v in json.load(io.open(ROOT + r"\tools\en_trans_p%d.json" % p, encoding="utf-8")).items():
        tr[k] = v
byid = {e["id"]: e for e in data}
applied = 0
for k, v in tr.items():
    e = byid.get(k)
    if e is None or k in drop:
        continue
    e["title"] = v["title"]
    e["dispTitle"] = v["title"]
    e["surface"] = v["surface"]
    e["truth"] = v["truth"]
    e["lang"] = "zh"
    e["quality"] = "e2s"
    e["_t"] = "e2s"
    e["truthSource"] = "original"
    if "英译中" not in e.get("cats", []):
        e.setdefault("cats", []).append("英译中")
    applied += 1
log["e2s_applied"] = applied

# ---------- 3) 应用无题命名 ----------
tm = {}
for p in ["p1", "p3", "p4", "p5"]:
    for k, v in json.load(io.open(ROOT + r"\tools\untitled_titles_%s.json" % p, encoding="utf-8")).items():
        tm[k] = v
named = 0
for k, title in tm.items():
    e = byid.get(k)
    if e is None:
        continue
    e["title"] = title
    e["dispTitle"] = title
    named += 1
log["titled"] = named

# ---------- 4) 自检 ----------
def is_en(s):
    lat = sum(1 for ch in s if ch.isascii() and ch.isalpha())
    cjk = sum(1 for ch in s if "\u4e00" <= ch <= "\u9fff")
    return lat > 0 and lat >= cjk * 2
errs = []
ids = [e["id"] for e in data]
if len(ids) != len(set(ids)):
    errs.append("duplicate ids")
for e in data:
    t = (e.get("title") or "").strip()
    if not t:
        errs.append("empty title %s" % e["id"])
    elif re.match(r"^Jed\b", t) or t.startswith("无题") or t.startswith("無題") or re.fullmatch(r"[\d#\.\s]+", t):
        errs.append("junk title %s %r" % (e["id"], t))
    if not (e.get("truth") or "").strip():
        errs.append("empty truth %s" % e["id"])
    if is_en(e.get("surface", "") + " " + e.get("truth", "")):
        errs.append("still english %s" % e["id"])
    if e.get("_t") == "t2s" and "繁译简" not in e.get("cats", []):
        errs.append("t2s missing tag %s" % e["id"])
    if e.get("_t") == "e2s" and "英译中" not in e.get("cats", []):
        errs.append("e2s missing tag %s" % e["id"])
for k, v in tm.items():
    if not (2 <= len(v) <= 9):
        errs.append("title len %s %r" % (k, v))
log["after"] = len(data)
log["t2s"] = sum(1 for e in data if e.get("_t") == "t2s")
log["e2s"] = sum(1 for e in data if e.get("_t") == "e2s")
log["errors"] = errs[:40]
assert not errs, "自检失败: %s" % errs[:40]

# ---------- 写回 ----------
body = head + "var SOUP_LIBRARY = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";" + tail
io.open(MASTER, "w", encoding="utf-8").write(body)
io.open(ROOT + r"\tools\stage_g_log.json", "w", encoding="utf-8").write(json.dumps(log, ensure_ascii=False, indent=1))
print("OK %d -> %d  e2s_applied=%d  titled=%d  t2s=%d  e2s=%d  errors=%d" %
      (log["before"], log["after"], applied, named, log["t2s"], log["e2s"], len(errs)))
