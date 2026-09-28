# -*- coding: utf-8 -*-
"""本轮 · Stage L-5：把 16 路复检判定里「逐条对过原文、确认成立」的问题落到母本上。

改法一律“改前先定位精确串”，任一条命中不了就整体中止，绝不盲改。
判定共 52 条，其中 41 条成立（改文字）+ 5 条成立（删不可玩 gimmick 题），
其余 6 条经核对原文属误报，不改（21496/21470/21471/21443/21467/21397/21562/21809）。
"""
import io, os, re, json, sys, shutil, collections

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MASTER = os.path.join(ROOT, "data", "library", "library.data.js")

raw = io.open(MASTER, encoding="utf-8").read()
HEAD = "var SOUP_LIBRARY = "
h = raw.index(HEAD) + len(HEAD)
data, ep = json.JSONDecoder().raw_decode(raw[h:])
tail = raw[h + ep:]
bysn = {str(o.get("srcNo")): o for o in data if o.get("src") == "late-late.jp"}

# ① 精确串替换（srcNo, 字段, 旧串, 新串）
FIX = [
    # — 错翻：关键词/人名/量词/指代 —
    ("21604", "surface", "躺着的天（まぶた，眼皮）是闭着的", "躺着的龟男闭着眼（瞼，まぶた）"),
    ("21614", "surface", "买回来的是知床（しること）甜酒酿", "买回来的是汁粉（しるこ，甜红豆汤）和甘酒"),
    ("21622", "surface", "特集，ついで（顺便／不禁）就失望了", "特集，つい（不由得）就失望了"),
    ("21811", "truth", "开始激烈地争抢那一只被用于实验的鞋子。", "开始激烈地争抢那一双被用于实验的鞋子。"),
    ("21835", "truth", "侦探把龟男和龟男的陈述", "侦探把龟男和龟女的陈述"),
    ("21634", "surface", "直美的女儿麻衣（アサギ）", "直美的女儿浅葱（アサギ）"),
    ("21634", "truth", "小女儿麻衣，", "小女儿浅葱，"),
    ("21446", "truth", "他本来进的不是田径部，我其实想让他进棒球部的",
     "我本来是不想让他进田径部、而想让他进棒球部的"),
    ("21555", "truth", "仿佛能看见佐藤本人的存在似的，对他如此说道——",
     "仿佛能看见田中自己的存在似的，如此对佐藤说道——"),
    ("21356", "truth", "“当然，说的不是你以外的那个。”", "“当然，那说的是你以外的人。”"),
    ("21544", "truth", "受初代勇者海男托付", "受上一代勇者海男托付"),
    ("21530", "truth", "海龟靠着长年累月在地上匍匐疾进，赢了跑得飞快的兔子",
     "海龟靠着长年累月在地上缓缓爬行，赢了跑得飞快的兔子"),
    ("21542", "surface", "可当他得知牢房的缝隙里另有玄机之后，却觉得自己能赢。",
     "可当他得知自己能从牢房的缝隙里钻出去之后，却觉得自己能赢。"),
    ("21497", "surface", "拍到了梅西奥选手和罗纳乌奥选手的两张同框合影",
     "拍到了梅西奥选手和罗纳乌奥选手的同框合影"),
    # 実家＝自己的爹娘家，汉语男性不说「回娘家」
    ("21722", "surface", "等天一亮就逃回娘家。", "等天一亮就逃回父母家。"),
    ("21722", "surface", "得知娘家的爹娘也已经变成异形怪物的我，", "得知连自己的爹娘也已经变成异形怪物的我，"),
    ("21722", "truth", "太吓人了，我要回自己家！", "太吓人了，我要回父母家！"),
    ("21722", "truth", "我不许你回娘家！！", "我不许你回父母家！！"),
    ("21722", "truth", "什么！？那岂不连自己家也回不成了！", "什么！？那岂不连父母家也回不成了！"),
    # 加戏（原文没有的情节）回删
    ("21523", "truth", "把被子的里子翻到外面、抖干净，整整齐齐叠到房间角落。", "把被子重新叠好放到房间角落。"),
    ("21526", "surface", "我不情不愿地和良平去看电影了。", "我不情不愿地和良平去约会了。"),
    ("21526", "truth", "听说她被暗恋的学长邀请去看电影了。", "听说她被暗恋的学长邀请去约会了。"),
    # 误导性括注修正
    ("21632", "truth", "（おんな=女子/妻子）", "（おんな＝女子，即被害的那名女性）"),
    ("21696", "truth", "「思って」→×「想って」（只是思念）",
     "「思って」→×「想って」（不是「思念」，是「为她着想」）"),
    # 漏字致句子不成词
    ("21313", "truth", "父亲让女儿绘本封面上的文字", "父亲让女儿读绘本封面上的文字"),
    ("21316", "surface", "然而下途中，两人遭遇了麻烦。", "然而在下山途中，两人遭遇了麻烦。"),
    ("21594", "surface", "拉特拉特自然公园里，正在给生活在里的动物身上扎小针的活动。",
     "拉特拉特自然公园里，正在进行一项给生活在那里的动物扎小针的活动。"),
    # 汤面设问缺半问 / 解题必需的出处说明
    ("21639", "surface", "死者赤木留下的死亡信息究竟是什么？",
     "犯人是谁，死者赤木留下的死亡信息又究竟是什么？"),
    ("21611", "surface", "（大家也来做做诊断吧！）",
     "※五人的职业·头衔均摘自『海龟汤16类型诊断』！\n\n（大家也来做做诊断吧！）"),
    ("21406", "surface", "于是我使用了｛能力低下｝的魔法。\n\n为什么？",
     "于是我使用了｛能力低下｝的魔法。\n\n为什么？\n\n【参加主题·说到最弱的怪物是？】"),
    ("21356", "truth", "“有男人的气味呢。”\n\n“那是　大叔的", "“有男人的气味呢。”\n\n【咔嚓！】\n\n“那是　大叔的"),
    # 站方「需要知识」提示属题面的一部分，补回
    ("21759", "surface", "顺便一提，龟女和龟男都是警察。",
     "顺便一提，龟女和龟男都是警察。\n\n（※这是一道需要知识的题目。）"),
    ("21600", "surface", "（前作在站内：\n\n", ""),
]

# ② 整行漏译的答案/标题行，补回字段开头
PREPEND = [
    ("21718", "truth", "【A.炸弹】\n\n"),        # 原文汤底首行【A.爆弾】
    ("21687", "truth", "【｛明天｝】\n\n"),      # 原文汤底首行【｛明日｝】＝谜底
    ("21517", "truth", "【飞在空中的面】\n\n"),  # 原文汤底首行【空を飛ぶ麺】
    ("21336", "truth", "【“不可以看——！”】\n\n"),  # 原文汤底首行台词
    ("21456", "truth", "（文末附有摘要）\n\n"),  # 原文汤底首行提示
]

# ③ 段中漏行，按锚点插回
INSERT = [
    ("21522", "truth", "呼哇啊……睡得好香……。\n\n", "【……睡得真好？】\n\n"),
    ("21332", "truth", "▽解说\n", "凄井“好，我就是｛面试官｝凄井。今天请多关照。”\n"),
    ("21468", "truth", "龟男是个忙到极点的上班族。", "【蛇足】\n\n"),
]

FIX_TITLE = [("21379", "「ジャ」的音色")]

# ④ 站方玩法 gimmick：中文玩家无法当作海龟汤游玩
KILL_SN = ["21697", "21699", "21591", "21521", "21484"]

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
    print("修 %s %s → %s" % (sn, f, (new[:26] or "（删除引导语）")))
for sn, f, pre in PREPEND:
    o = bysn.get(sn)
    if not o:
        errs.append("缺条目 %s" % sn); continue
    if o[f].startswith(pre.strip()):
        errs.append("%s %s 已补过" % (sn, f)); continue
    o[f] = pre + o[f]
    print("补首行 %s %s ← %s" % (sn, f, pre.strip()[:20]))
for sn, f, anchor, extra in INSERT:
    o = bysn.get(sn)
    if not o:
        errs.append("缺条目 %s" % sn); continue
    if anchor not in o[f]:
        errs.append("%s %s 锚点未命中: %s" % (sn, f, anchor[:20])); continue
    o[f] = o[f].replace(anchor, anchor + extra, 1)
    print("插行 %s %s ← %s" % (sn, f, extra.strip()[:20]))
for sn, t in FIX_TITLE:
    o = bysn.get(sn)
    if not o:
        errs.append("缺条目 %s" % sn); continue
    print("改标题 %s 《%s》→《%s》" % (sn, o["title"], t))
    o["title"] = o["dispTitle"] = t
for sn in KILL_SN:
    if sn not in bysn:
        errs.append("待删条目不存在 %s" % sn)
if errs:
    print("预检失败 %d 项:" % len(errs))
    for e in errs:
        print("  ", e)
    sys.exit(2)

for sn, o in bysn.items():
    for f in ("title", "surface", "truth"):
        s = (o.get(f) or "").strip()
        if not s:
            print("字段被清空 %s %s" % (sn, f)); sys.exit(2)

kill = {bysn[sn]["id"] for sn in KILL_SN}
before = len(data)
data = [o for o in data if o["id"] not in kill]
assert all((o.get("truth") or "").strip() and (o.get("surface") or "").strip() for o in data)
assert len({o["id"] for o in data}) == len(data)
tail = re.sub(r"var SOUP_LIB_TOTAL = \d+;", "var SOUP_LIB_TOTAL = %d;" % len(data), tail)
bak = os.path.join(ROOT, "_local_backup", "library.data.js.bak-before-L5")
if not os.path.exists(bak):
    shutil.copyfile(MASTER, bak)
io.open(MASTER, "w", encoding="utf-8").write(
    raw[:h] + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";" + tail)
cc = collections.Counter()
for o in data:
    for t in o.get("cats") or []:
        cc[t] += 1
print("已写盘：母本 %d → %d（删除 %d）| 日译中 %d" % (before, len(data), before - len(data), cc["日译中"]))
