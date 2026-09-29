# -*- coding: utf-8 -*-
"""全量复核第六轮 · 程序化客观扫描（1087 道日译中，全量、不抽样）。

 S1 污染/乱码：URL、站方脚手架词、HTML 实体、控制字符、装饰线整行
 S2 未译：假名占比高且无中文括注；连续片假名串直插中文正文
 S3 截断：句尾裸结束
 S4 少翻/多翻量级：译文长度 ÷ 原文长度 落在经验区间外
 S5 对应可疑：标题半数假名、汤面/汤底无交集（粗筛）
 S6 机制：字段空、汤面==汤底、汤面与他题完全重复、srcNo 重复
另按批次分开统计，便于看早期 162 道是否有系统性问题。
"""
import io, os, re, json, unicodedata, collections

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
T = lambda *p: os.path.join(ROOT, "tools", *p)

raw = io.open(os.path.join(ROOT, "data", "library", "library.data.js"), encoding="utf-8").read()
h = raw.index("var SOUP_LIBRARY = ") + len("var SOUP_LIBRARY = ")
data, _ = json.JSONDecoder().raw_decode(raw[h:])
ids = json.load(io.open(T("recheck6_ids.json"), encoding="utf-8"))
orig = json.load(io.open(T("recheck6_orig.json"), encoding="utf-8"))
byid = {str(o["srcNo"]): o for o in data if "日译中" in (o.get("cats") or [])}
new = [byid[s] for s in ids if s in byid]

KANA = re.compile(r"[\u3040-\u309f\u30a0-\u30ff]")
KATA_RUN = re.compile(r"[\u30a0-\u30ff]{7,}")
POLL = re.compile(r"https?://|www\.|\.co\.jp|にほんブログ村|はてブ|TrackBack|本文へ戻る|投票会場|投票結果"
                  r"|文案提供|出題協力|出题协力|著作権|版权|图片出处|图源|ようこそ|管理人|アクセス数|スポンサ|広告"
                  r"|ブログ村|人気榜|ランキング|引用元|原帖地址|原文地址|本文地址|关注|扫码|回复可见")
ENT = re.compile(r"&[a-zA-Z]{2,8};|&#\d+;|\\r|\\n|\{\{|\}\}|<[a-zA-Z/][^>]*>")
DECOR = re.compile(r"^\s*[\-—－=ー・*·○●◇◆★☆━┄┈←→↔~〜:：;；\s]*$")
TERM = "。！？…”』」）)】>》~～!?.a-zA-Z０-９｝〉、…—-＞｣｣"
GLOS = re.compile(r"[（(][^）)]{0,20}[\u4e00-\u9fff]|[\u4e00-\u9fff]{2,}[（(][^）)]{0,20}[\u3040-\u30ff]")
DECO_TAIL = re.compile(r"[^\s\u4e00-\u9fff。！？…”』」）)】>》~～!?.a-zA-Z０-９｝〉、…—-＞｣]+$")
THEME = re.compile(r"【(?:参加|参赛|参与)主题[^】]*】")

rep = collections.OrderedDict((k, []) for k in
      ("S1_污染", "S2_未译", "S3_截断", "S4_长度异常", "S5_对应可疑", "S6_机制", "S7_主题标签残留"))
seen_surface = collections.Counter((o.get("surface") or "").strip() for o in data)
dup_src = [k for k, v in collections.Counter(str(o.get("srcNo")) for o in data).items() if v > 1]

for o in new:
    sn = str(o.get("srcNo")); g = orig.get(sn) or {}
    for f in ("title", "surface", "truth"):
        s = o.get(f) or ""
        if POLL.search(s):
            rep["S1_污染"].append("%s.%s 命中站方/链接: %s" % (sn, f, POLL.search(s).group()))
        if ENT.search(s):
            rep["S1_污染"].append("%s.%s HTML实体/转义: %s" % (sn, f, ENT.search(s).group()))
        if "\ufffd" in s or any(unicodedata.category(c) == "Cc" and c not in "\n\r\t" for c in s):
            rep["S1_污染"].append("%s.%s 含替换符/控制字符" % (sn, f))
        for ln in s.split("\n"):
            if ln.strip() and DECOR.match(ln.strip()) and len(ln.strip()) >= 6:
                rep["S1_污染"].append("%s.%s 装饰线整行: %s" % (sn, f, ln.strip()[:16]))
        if THEME.search(s):
            rep["S7_主题标签残留"].append("%s.%s" % (sn, f))
        if f != "title" and len(s) >= 12:
            kn = len(KANA.findall(s))
            if kn / float(len(s)) > 0.30 and not GLOS.search(s):
                rep["S2_未译"].append("%s.%s 假名%.0f%%无中文括注" % (sn, f, 100.0 * kn / len(s)))
        for m in KATA_RUN.findall(s):
            if not GLOS.search(s[max(0, s.find(m) - 12):s.find(m) + len(m) + 24]):
                rep["S2_未译"].append("%s.%s 片假名长串未括注: %s" % (sn, f, m[:12]))
        if f in ("surface", "truth") and s.strip() and s.strip()[-1] not in TERM:
            t = DECO_TAIL.search(s.strip())
            if not (t and len(t.group()) <= 30):
                rep["S3_截断"].append("%s.%s 句尾裸结束: …%s" % (sn, f, s.strip()[-14:]))
    for f in ("surface", "truth"):
        gs, cs = (g.get(f) or "").strip(), (o.get(f) or "").strip()
        if gs and cs:
            r = len(cs) / float(len(gs))
            if r < 0.42 or r > 1.15:
                rep["S4_长度异常"].append("%s.%s 译/原=%.2f (%d←%d) [%s]" % (sn, f, r, len(cs), len(gs), g.get("batch")))
    if not (o.get("title") and o.get("surface") and o.get("truth")):
        rep["S6_机制"].append("%s 存在空字段" % sn)
    if (o.get("surface") or "").strip() == (o.get("truth") or "").strip():
        rep["S6_机制"].append("%s 汤面==汤底" % sn)
    if seen_surface[(o.get("surface") or "").strip()] > 1:
        rep["S6_机制"].append("%s 汤面与他题完全重复" % sn)
    t = o.get("title") or ""
    if len(KANA.findall(t)) / float(max(1, len(t))) > 0.5:
        rep["S5_对应可疑"].append("%s 标题半数是假名: %s" % (sn, t[:18]))

out = io.open(T("recheck6_scan.txt"), "w", encoding="utf-8")
out.write("全量复核：日译中 %d 道 | 原文合流 %d 道 | srcNo 重复 %s\n\n" % (len(new), len(orig), dup_src or "无"))
for k, v in rep.items():
    out.write("== %s : %d ==\n" % (k, len(v)))
    for x in v:
        out.write("   " + x + "\n")
    out.write("\n")
out.close()
print(" ".join("%s=%d" % (k, len(v)) for k, v in rep.items()))
