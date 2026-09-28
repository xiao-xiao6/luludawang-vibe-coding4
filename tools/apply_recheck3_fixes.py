# -*- coding: utf-8 -*-
"""第三轮复验 · Stage L-7：把 18 路复验判定里逐条对过原文、确认成立的问题落到母本。

共 47 条判定 → 采纳 31 条改文 + 20 道剥「参加/参赛/参与主题」站方活动标签 + 1 道剥诊断导流号召语。
驳回 16 条：其中 6 条指到的题不在现库（并入时已弃用），10 条经核对原文属误报。
改法一律「改前先定位精确串」，任一条命中不了或命中不唯一即整体中止。
"""
import io, os, re, json, sys, shutil, collections

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MASTER = os.path.join(ROOT, "data", "library", "library.data.js")
T = lambda *p: os.path.join(ROOT, "tools", *p)

raw = io.open(MASTER, encoding="utf-8").read()
HEAD = "var SOUP_LIBRARY = "
h = raw.index(HEAD) + len(HEAD)
data, ep = json.JSONDecoder().raw_decode(raw[h:])
tail = raw[h + ep:]
bysn = {str(o.get("srcNo")): o for o in data if o.get("src") == "late-late.jp"}
ids = set(json.load(io.open(T("recheck3_ids.json"), encoding="utf-8")))

FIX = [
    ("21367", "truth", "得有余震5强吧？", "得有震度5强吧？"),
    ("21378", "surface", "白田凝视着纱莉朵拉的照片，喃喃道：", "纱莉朵拉凝视着白田的照片，喃喃道："),
    ("21383", "surface", "锦织却让卡酱拿着一只球拍。", "卡酱却给锦织拿来一只球拍，让他举着。"),
    ("21383", "truth", "作为客人的锦织，让卡酱手持一只抽掉网线（弦）的网球拍，",
     "作为客人的锦织，被卡酱安排手持一只抽掉网线（弦）的网球拍，"),
    ("21383", "truth", "从卡酱举着的球拍中间穿了过去", "从锦织举着的球拍中间穿了过去"),
    ("21397", "truth", "艾米丽小姐和两人的合照。", "艾米丽小姐和王子的合影。"),
    ("21421", "truth", "按下去的一瞬间就察觉到自己失态的龟男绝望了。",
     "按下去的一瞬间就察觉到自己点错了的龟男绝望了。"),
    ("21441", "surface", "据说是因为她只是◯性。", "据说是因为唯有她是◯性。"),
    ("21464", "truth", "抵抗（抗告、上告）", "抵抗（上诉、上告）"),
    ("21474", "truth", "一只花斑鼠（ハツカネズミ）", "一只小家鼠（ハツカネズミ，家鼠）"),
    ("21475", "truth", "……今天就上到这里，按出席编号1号，请相田来做——",
     "……今天是1日（1号），就按出席编号1号，请相田来做——"),
    ("21477", "truth", "满怀期待点了新商品的女客人们齐声大吐槽", "满怀期待点了新商品的客人们齐声大吐槽"),
    ("21499", "truth", "人鱼公主来到海边魔女家", "人鱼公主来到海之魔女家"),
    ("21564", "truth", "（译注：伯方读「はくほう」，博多读「はかた」，音节相近。）",
     "（译注：伯方岛读作「はかた」，与福冈的「博多」同音，所以一简称就被听成博多。）"),
    ("21565", "truth", "和成群的罐头", "和成堆的空罐子"),
    ("21567", "surface", "判定龟女是成年人，才卖给我的", "判定龟女是成年人，才把酒卖出去的"),
    ("21601", "truth", "「哈？我不是说了吗？『また五日（いつか）な』——『五天后（再见）』。」",
     "「哈？我不是说了吗？『また五日（いつか）な』——是说『下个月5号再见』。」"),
    ("21601", "truth", "（五天后——下月5日再见）", "（下月5号再来）"),
    ("21603", "truth", "这道题是我高中体育祭的传统项目。", "这道题在一花的高中体育祭上是传统项目。"),
    ("21609", "surface", "请勿深究……才不是因为末端有猫爪就叫它剑也行的说……",
     "请勿深究……毕竟末端有猫爪，叫它剑不也挺好的嘛……"),
    ("21609", "truth", "昔日一辈子花不完的金山银山，如今连一张纸都不如。",
     "昔日一辈子花不完的金山银山，如今也只是一张废纸罢了。"),
    ("21629", "truth", "被浇筑在了1立方米的混凝土块里。", "【蟹座之蛋】被浇筑在了1立方米的混凝土块里。"),
    ("21638", "truth", "小安为了把蜜蜂引过来，在身上涂了带的蜂蜜，趁它大意时一击拿下。",
     "小安为了把蜜蜂引过来，把随身带的蜂蜜涂了起来，趁它大意时一击拿下。"),
    ("21648", "truth", "商品企划室的海龟田（龟田）", "商品企划室的龟田"),
    ("21720", "truth", "笔套的背面，写着", "橡皮套的背面，写着"),
    ("21731", "truth", "我和她的养父母一起料理了丧事", "我和她的公婆一起料理了丧事"),
    ("21820", "truth", "とんだ（飞起来）　やねまで（飞到屋顶）　とんで（飞过去）",
     "とんだ（飞起来）　やねまで（飞到屋顶）　とんだ（飞去）　とんで（飞过去）"),
]

# 原文有、译文整行缺失：按锚点插回
INSERT_BEFORE = [
    ("21344", "truth", "起了这个疑心的我买了防盗摄像机", "【｛有人在闯进来？｝】\n\n"),
    ("21563", "truth", "朝加奈逼近的绘美璃。", "【（不妙啊）】\n\n"),
    ("21563", "truth", "「不。那个。…………那，那只做烫染", "【（不妙啊！！！）】\n\n"),
    ("21648", "truth", "-补充-\n",
     "（因时间所限，「提问的含义」「由此而来的背景」这类要素不作要求。）\n\n"),
    ("21681", "truth", "", ""),      # 占位，见 APPEND / SURFACE_INSERT
]
SURFACE_INSERT = [
    ("21681", "一动不动地盯着镜子。\n\n", "【窗外雷光如闪电般划过。】\n\n"),
    ("21681", "消失的影子。\n\n", "【窗外依旧是那场暴雨。】\n\n"),
]
APPEND = [
    ("21426", "truth", "\n\n【承蒙大家平日关照！】"),
    ("21619", "truth", "\n\n【「嘿嘿嘿！」】"),
    ("21709", "truth", "\n\n解说：鬼屋里的鬼怪演员就算倒在地上，也不会有人报警的嘛。"),
]
FIX_TITLE = [("21633", "ドクパ。（Doctor Pepper）")]

# 站方活动标签：参加/参赛/参与主题 —— 中文玩家无从参与，统一从汤面剥除
TAG = re.compile(r"\s*\n*\n*【(?:参加|参赛|参与)主题[^】]*】\s*\n*")
TAG_SN = []
for sn in sorted(ids, key=lambda x: int(x)):
    o = bysn.get(sn)
    if o and TAG.search(o.get("surface") or ""):
        new = TAG.sub("\n\n", o["surface"]).strip()
        if not new or new != o["surface"]:
            TAG_SN.append((sn, TAG.search(o["surface"]).group().strip()[:34]))
EXTRA_STRIP = [("21611", "surface", "\n\n（大家也来做做诊断吧！）", "")]

errs = []
for sn, f, old, new in FIX:
    o = bysn.get(sn)
    if not o:
        errs.append("缺条目 %s" % sn); continue
    if old not in o[f]:
        errs.append("%s %s 旧串未命中: %s" % (sn, f, old[:26])); continue
    if o[f].count(old) > 1:
        errs.append("%s %s 旧串不唯一: %s" % (sn, f, old[:26])); continue
    o[f] = o[f].replace(old, new, 1)
    print("修 %s %s → %s" % (sn, f, new[:24]))
for sn, f, anchor, extra in INSERT_BEFORE:
    if not anchor:
        continue
    o = bysn.get(sn)
    if not o:
        errs.append("缺条目 %s" % sn); continue
    if anchor not in o[f]:
        errs.append("%s %s 锚点未命中: %s" % (sn, f, anchor[:20])); continue
    if o[f].count(anchor) > 1:
        errs.append("%s %s 锚点不唯一: %s" % (sn, f, anchor[:20])); continue
    if extra.strip() and extra.strip() in o[f]:
        errs.append("%s %s 已插过" % (sn, f)); continue
    o[f] = o[f].replace(anchor, extra + anchor, 1)
    print("插行 %s %s ← %s" % (sn, f, extra.strip()[:20]))
for sn, anchor, extra in SURFACE_INSERT:
    o = bysn.get(sn)
    if anchor not in o["surface"]:
        errs.append("%s surface 锚点未命中: %s" % (sn, anchor[:16])); continue
    o["surface"] = o["surface"].replace(anchor, anchor + extra, 1)
    print("补汤面 %s ← %s" % (sn, extra.strip()[:20]))
for sn, f, extra in APPEND:
    o = bysn.get(sn)
    if not o:
        errs.append("缺条目 %s" % sn); continue
    if extra.strip() in o[f]:
        errs.append("%s %s 已补过" % (sn, f)); continue
    o[f] = o[f].rstrip() + extra
    print("补末行 %s %s ← %s" % (sn, f, extra.strip()[:22]))
for sn, t in FIX_TITLE:
    o = bysn.get(sn)
    if not o:
        errs.append("缺条目 %s" % sn); continue
    print("改标题 %s 《%s》→《%s》" % (sn, o["title"], t))
    o["title"] = o["dispTitle"] = t
for sn, f, old, new in EXTRA_STRIP:
    o = bysn.get(sn)
    if not o or old not in o[f]:
        errs.append("%s %s 导流句未命中" % (sn, f)); continue
    o[f] = o[f].replace(old, new, 1)
    print("剥导流 %s %s" % (sn, f))
for sn, frag in TAG_SN:
    bysn[sn]["surface"] = TAG.sub("\n\n", bysn[sn]["surface"]).strip()
print("剥活动标签 %d 道" % len(TAG_SN))

bad = []
for sn in ids:
    o = bysn.get(sn)
    if not o:
        continue
    for f in ("title", "surface", "truth"):
        s = (o.get(f) or "").strip()
        if not s:
            bad.append("%s %s 被清空" % (sn, f))
    if len((o.get("surface") or "").strip()) < 8 or len((o.get("truth") or "").strip()) < 8:
        bad.append("%s 字段过短" % sn)
if bad:
    errs.extend(bad)
if errs:
    print("预检失败 %d 项:" % len(errs))
    for e in errs[:40]:
        print("  ", e)
    sys.exit(2)

bak = os.path.join(ROOT, "_local_backup", "library.data.js.bak-before-L7")
if not os.path.exists(bak):
    shutil.copyfile(MASTER, bak)
tail = re.sub(r"var SOUP_LIB_TOTAL = \d+;", "var SOUP_LIB_TOTAL = %d;" % len(data), tail)
io.open(MASTER, "w", encoding="utf-8").write(
    raw[:h] + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";" + tail)
cc = collections.Counter()
for o in data:
    for t in o.get("cats") or []:
        cc[t] += 1
print("已写盘：母本 %d 条（题数不变）| 日译中 %d" % (len(data), cc["日译中"]))
