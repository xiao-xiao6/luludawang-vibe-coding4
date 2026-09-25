# -*- coding: utf-8 -*-
"""
深海汤屋 · 大清洗 Stage A+B+C（写盘）
A. 去重：按 tools/dedup_clusters_calibrated.json 每簇留 1 条（含 2 处人工覆盖）
   + 删除 2 条非题模板垃圾
B. 污染手术：截断拼接垃圾 / 剥 HTML 残留 / 重建 3 条丢失汤底
C. 全局清洗：繁→简（zhconv）、零宽/控制字符、引用标记、空白规范、dispTitle 同步
产出：data/library/library.data.js（覆盖前已备份）+ tools/stage_abc_log.json
"""
import io, re, json, sys
from zhconv import convert as zc

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
MASTER = ROOT + r"\data\library\library.data.js"

src = io.open(MASTER, encoding="utf-8").read()
head = src[:src.find("var SOUP_LIBRARY")]
i = src.find("var SOUP_LIBRARY"); i = src.find("[", i)
end = src.find("\nvar SOUP_LIB_CATS", i)
tail = src[end:]
data = json.loads(src[i:end].rsplit("]", 1)[0] + "]")
byid = {e["id"]: e for e in data}
log = {"input": len(data)}

# ---------- A. 去重 ----------
cal = json.load(io.open(ROOT + r"\tools\dedup_clusters_calibrated.json", encoding="utf-8"))
drops = set()
for o in cal["clusters"]:
    for x in o["drop"]:
        drops.add(x["id"])
# 人工覆盖 1：给三兄弟的信 —— 保留下标版 cc9e2fec9557，删 OCR 乱码版 6db4d37cfcbb
drops.discard("lib_cc9e2fec9557"); drops.add("lib_6db4d37cfcbb")
# 人工覆盖 2：墓碑上的文字 —— 保留简体版 86ba85ac49fd，删繁体版 410b5ac434f2
drops.discard("lib_86ba85ac49fd"); drops.add("lib_410b5ac434f2")
# 非题模板垃圾（整条删除）
drops |= {"lib_df556d06686a", "lib_b0a7e1bf8727"}
log["dedup_drops"] = sorted(drops)
data = [e for e in data if e["id"] not in drops]
log["after_dedup"] = len(data)

# ---------- B. 污染手术 ----------
def cut(s, pat):
    m = re.search(pat, s)
    return s[:m.start()].rstrip() if m else s

SURG = {}
# zhuqingxu 系 7 条 + 其它：汤底截断 markdown 分隔线/表格之后的下一题
for x in ["lib_23febc756976","lib_69d3afcb8d68","lib_70e667af0b9b","lib_c08749d6852f",
          "lib_d213c4660270","lib_f237de4176aa","lib_f3b4ea050546"]:
    SURG[x] = ("cut_next", r"\n\s*\n-{3,}")
# White-stone36 两条：''' 案例残留
SURG["lib_77f7e2dd70c8"] = ("cut", "'''")
# MZKT89 #981：游戏日志/AI提示词残留 → 直接给干净的面与底
SURG["lib_f814c03d1664"] = ("set", {
    "surface": "小明在学校的图书馆里发现了一本破旧的日记，从那以后他每天晚上都会做噩梦。",
    "truth": "小明发现的日记是曾经在图书馆自杀的学生留下的，日记中的怨念导致小明做噩梦。"})
# 088·失踪的孩子：删去“另一版汤底”
SURG["lib_e17a195e10d0"] = ("set", {
    "truth": "那个小女孩是他女儿，每天站在那里等他回家。今天是她的小学入学第一天，她终于不再需要在家等爸爸了，有了自己的生活。而他，有点空落落的，又为她感到高兴。"})
# 村中诡事 / 学院规则怪谈 / 倒计时7天：剥 span 标签与 ** 残留
for x in ["lib_1245207e575c", "lib_2a1ddcd0a374", "lib_bafb21fa5402"]:
    SURG[x] = ("strip_html", None)
# D·r·e·a·m：xxx 占位符 → 某某
SURG["lib_7a306afeee05"] = ("set", {
    "surface": byid["lib_7a306afeee05"]["surface"].replace("xxx", "某某")})
# 给三兄弟的信（保留版）：修好被引号吃掉的汤底
SURG["lib_cc9e2fec9557"] = ("set", {
    "surface": "H₂O+SiO₂+Fe₃O₄+CO₂→∅，x2+y2−13=x2y3+∞",
    "truth": "化学公式「H₂O+SiO₂+Fe₃O₄+CO₂→∅」的含义是「即使地球毁灭」；数学公式「x2+y2−13=x2y3+∞」的含义是「我也会一直爱你」。"})
# 墓碑上的文字（保留的简体版）：把繁体版更完整的汤面（含 2988 年/星际）搬过来并转简
SURG["lib_86ba85ac49fd"] = ("set", {
    "surface": zc(byid["lib_410b5ac434f2"]["surface"], "zh-hans")})
# 汤底被汤面复读吞掉、原文丢失的 3 条 → 依据汤面重建（标 recovered，UI 显示“已补底”）
SURG["lib_0696ae22b31a"] = ("set", {   # 白昼流星
    "truth": "我是一名天文台观测员，早已算出那颗小行星会在白昼划过、撞击哪座城市——那正是她带着孩子新搬去的方向。APP的灾难预警亮起时，我疯狂拨打她的电话想让她快逃，可电话那头的她只当这是分手后我又一次纠缠撒疯，冷冷丢下一句“你真是个疯子”就挂了。流星准时划过，坠落的碎片夷平了整座城市，也彻底摧毁了我的世界。",
    "truthSource": "recovered"})
SURG["lib_57e7c1800d44"] = ("set", {   # 深渊情书
    "truth": "那个“失踪”的人其实早已死在我父亲手里，被一铲一铲埋进了老家院子的泥土下。我以身饲虎去套那个男人的话，以为真相在天涯海角，可父亲至死不肯开口。我要找的答案，一直都在自己家里。",
    "truthSource": "recovered"})
SURG["lib_1b5f8818a812"] = ("set", {   # 一週還是兩年？
    "truth": "死者两年前就遇害了，但尸体一直被封存在低温环境里，腐败几乎停滞。凶手是一周前才移走尸体、布置现场的，所以法医看到的，只是解冻后一周的腐败程度——科学没有骗人，它回答的是“解冻时间”，不是“死亡时间”。",
    "truthSource": "recovered"})
# 爱犬：汤底开头被标签吃掉（“‌：小偷杀狗…”）
SURG["lib_440544dff8ed"] = ("set", {
    "truth": "小偷杀死了狗，把尸体吊在天花板上，女孩听到的滴水声是狗的血在滴；黑夜里舔她手的不是狗，是那个小偷。"})

touched = []
for e in data:
    op = SURG.get(e["id"])
    if not op:
        continue
    kind, arg = op
    if kind == "cut_next":
        e["truth"] = cut(e["truth"], arg)
    elif kind == "cut":
        e["truth"] = cut(e["truth"], re.escape(arg))
    elif kind == "set":
        for k, v in arg.items():
            e[k] = v
    elif kind == "strip_html":
        for f in ("surface", "truth"):
            e[f] = re.sub(r"</?span[^>]*>", "", e[f]).replace("**", "")
    touched.append(e["id"])
log["surgery"] = sorted(touched)

# ---------- C. 全局清洗 ----------
ZW = re.compile(u"[\u200b\u200c\u200d\ufeff\u00a0]")
QUOTE_MARK = re.compile(r"^\s*>\s?", re.M)
MULTI_SP = re.compile(r"[ \t]{2,}")
def clean_text(s):
    if not s:
        return s
    s = zc(s, "zh-hans")
    s = ZW.sub("", s)
    s = QUOTE_MARK.sub("", s)
    s = MULTI_SP.sub(" ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()

conv = 0
for e in data:
    before = (e.get("title",""), e.get("surface",""), e.get("truth",""))
    e["surface"] = clean_text(e.get("surface", ""))
    e["truth"] = clean_text(e.get("truth", ""))
    e["title"] = clean_text(e.get("title", "") or "")
    if "cats" in e:
        e["cats"] = [clean_text(c) for c in e["cats"]]
    if (e.get("title",""), e.get("surface",""), e.get("truth","")) != before:
        conv += 1
    e["dispTitle"] = e.get("title") or e.get("dispTitle") or ""
log["cleaned_entries"] = conv

# 空汤底自检：手术/截断后不允许出现空 truth
empty = [e["id"] for e in data if not (e.get("truth") or "").strip()]
log["empty_truth"] = empty
assert not empty, "截断后出现空汤底: %s" % empty

# ---------- 写回 ----------
body = head + "var SOUP_LIBRARY = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";" + tail
io.open(MASTER, "w", encoding="utf-8").write(body)
io.open(ROOT + r"\tools\stage_abc_log.json", "w", encoding="utf-8").write(json.dumps(log, ensure_ascii=False, indent=1))
print("OK master=%d  dedup_drop=%d  surgery=%d  cleaned=%d  empty_truth=%d" %
      (len(data), len(drops), len(touched), conv, len(empty)))
