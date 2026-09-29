# -*- coding: utf-8 -*-
"""第四轮修后复验 · 落盘：把 23 条确认成立的判定改到母本上（题数不变，只改文字）。

一律「改前定位精确串」，命中不了或不唯一即整体中止，绝不盲改。
"""
import io, os, re, json, sys, shutil

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MASTER = os.path.join(ROOT, "data", "library", "library.data.js")
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

raw = io.open(MASTER, encoding="utf-8").read()
HEAD = "var SOUP_LIBRARY = "
h = raw.index(HEAD) + len(HEAD)
data, ep = json.JSONDecoder().raw_decode(raw[h:])
tail = raw[h + ep:]
bysn = {str(o.get("srcNo")): o for o in data if o.get("src") == "late-late.jp"}

# (srcNo, 字段, 旧串, 新串, 是否全文替换)
FIX = [
    ("20974", "truth", "▽解说\n参照图片。因为海野龟女辞职了", "▽解说\n因为海野龟女辞职了", False),
    ("20801", "surface", "夜不归宿的龟男，把行李随手一扔扔进了屋子正中间。",
     "夜不归宿的海男，把行李随手一扔扔进了屋子正中间。", False),
    ("20804", "surface", "她被邀到她独居的公寓，对方说今天想做亲手做的料理招待他共进午餐。",
     "他受邀去了她独居的公寓，对方说今天想做亲手做的料理招待他共进午餐。", False),
    ("20856", "truth", "带着爱情灵药的宣传语｛「我想做出能救○○○的药」｝，安田博士一跃成为风云人物。",
     "带着爱情灵药的宣传语｛「我想做出能救人鱼公主的药」｝，安田博士一跃成为风云人物。", False),
    ("20875", "truth", "一寸法师用公主挥动的万宝槌变大了身体",
     "一寸法师用公主挥动（振った）的万宝槌变大了身体（日语「振る」既能表示「甩掉/分手」，也能表示「挥动」，题面的「甩了」与这里的「挥动」正是同一个词）", False),
    ("20915", "truth", "お（感叹词）+味噌（名词）+か（终助词）→おおみそか（大晦日）",
     "おお（感叹词）+みそ（味噌，名词）+か（终助词）→おおみそか（大晦日）", False),
    ("20921", "truth", "为了一万日元左右的一点钱而惜命被捕，太蠢了——同伙语气强硬地说。",
     "为了舍不得区区一万日元左右的小钱而被抓，实在太蠢了——同伙语气强硬地说。", False),
    ("20977", "truth", "稍微弄些面包糠，做成炸虾排（ウミカツ）怎么样？",
     "稍微弄些面包糠，做成炸猪排（ウミカツ）怎么样？", False),
    ("20987", "surface", "戚家的小学生龟男说", "【親】戚家的小学生龟男说", False),
    ("20994", "surface", "那是我以前的爸爸（前のパパ）。", "那是我面前的爸爸（前のパパ）。", False),
    ("20994", "surface", "啊，我以前的爸爸也在吐舌头呢。", "啊，我面前的爸爸也在吐舌头呢。", False),
    ("20975", "truth", "拉泰子君的奶奶刚刚因为急病被送走了！？", "拉泰子君的奶奶刚刚因为急病被送去医院了！？", False),
    ("21027", "surface", "分派对刚结束。", "【節】分派对刚结束。", False),
    ("21114", "truth", "以前她用「姐姐」这种生分的叫法凑过来时",
     "以前她没话找话、故意用「姐姐」这种叫法凑过来时", False),
    ("21136", "title", "イエッ、タイガー", "耶，老虎（イエッ、タイガー）", False),
    ("21136", "dispTitle", "イエッ、タイガー", "耶，老虎（イエッ、タイガー）", False),
    ("21139", "truth", "因为是｛粉色专属摄像师（粉色担当）｝的哈露娜摔得四脚朝天",
     "因为是｛粉色专属摄像师（粉色担当）｝的春名（ハルナ）摔得四脚朝天", False),
    ("21139", "truth", "龟尾in内场", "龟男in内场", False),
    ("21139", "truth", "海田", "海太（ウミタ）", True),
    ("21146", "surface", "就想来给学弟们打打气、送点慰问品，来看他们训练啦！",
     "就想给学弟们送点慰问品、让他们给我打打气，特意来看他们训练啦！", False),
    ("21166", "surface", "一行人类终于抵达了地图上不存在的新大陆。", "一行人终于抵达了地图上不存在的新大陆。", False),
    ("21175", "truth", "在这个窝点装上传感器藏摄像机（hidden camera），从那两个家伙嘴里套出情报。",
     "在这个窝点装上隐藏摄像机（hidden camera），从那两个家伙嘴里套出情报。", False),
    ("21109", "title", "新题：吃香蕉的呜呼", "吃香蕉的呜呼", False),
    ("21109", "dispTitle", "新题：吃香蕉的呜呼", "吃香蕉的呜呼", False),
    ("21297", "truth", "原样留着中意，离开店里。", "连杯里的咖啡都原样留着，离开店里。", False),
]

# 剥掉的站方/作者附注（与谜题无关）
DROP_LINE = [
    ("21028", "truth", "※顺便说，我是12月中旬去佐贺县旅行"),
    ("21047", "surface", "※已在辛迪（Cindythink）出过"),
]
# 补回的整行
INS_BEFORE = [
    ("21089", "truth", "……看不出来。\n\n医生「龟男先生，辛苦了。", "【◯】\n\n"),
    ("21110", "truth", "哎呀呀，画面里拍到的怎么是我的脸。", "【👵🏻】\n\n"),
]

errs = []
for sn, f, old, new, all_ in FIX:
    o = bysn.get(sn)
    if not o:
        errs.append("缺条目 %s" % sn); continue
    if old not in o[f]:
        errs.append("%s %s 旧串未命中: %s" % (sn, f, old[:24])); continue
    if not all_ and o[f].count(old) > 1:
        errs.append("%s %s 旧串不唯一: %s" % (sn, f, old[:24])); continue
    o[f] = o[f].replace(old, new) if all_ else o[f].replace(old, new, 1)
    print("修 %s %s → %s" % (sn, f, new[:22]))

for sn, f, sub in DROP_LINE:
    o = bysn.get(sn)
    if not o:
        errs.append("缺条目 %s" % sn); continue
    lines = o[f].split("\n")
    hit = [i for i, l in enumerate(lines) if sub in l]
    if len(hit) != 1:
        errs.append("%s %s 删除锚点命中 %d 次" % (sn, f, len(hit))); continue
    del lines[hit[0]]
    o[f] = "\n".join(lines).strip()
    print("剥附注 %s %s" % (sn, f))

for sn, f, anchor, extra in INS_BEFORE:
    o = bysn.get(sn)
    if not o:
        errs.append("缺条目 %s" % sn); continue
    if o[f].count(anchor) != 1:
        errs.append("%s %s 插入锚点命中 %d 次" % (sn, f, o[f].count(anchor))); continue
    if extra.strip() in o[f]:
        errs.append("%s %s 已插过" % (sn, f)); continue
    o[f] = o[f].replace(anchor, extra + anchor, 1)
    print("补行 %s %s ← %s" % (sn, f, extra.strip()[:16]))

if errs:
    print("预检失败 %d 项:" % len(errs))
    for e in errs:
        print("   ", e)
    sys.exit(2)

bad = [(o.get("srcNo"), f) for o in data for f in ("title", "surface", "truth") if not (o.get(f) or "").strip()]
if bad:
    print("出现空字段:", bad[:8]); sys.exit(2)
assert len({o["id"] for o in data}) == len(data)

bak = os.path.join(ROOT, "_local_backup", "library.data.js.bak-recheck5")
if not os.path.isdir(os.path.dirname(bak)):
    os.makedirs(os.path.dirname(bak))
if not os.path.exists(bak):
    shutil.copyfile(MASTER, bak)
io.open(MASTER, "w", encoding="utf-8").write(
    raw[:h] + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";" + tail)
print("已写盘：母本 %d 条（题数不变，仅改 23 处 / 剥 3 处附注 / 补 2 处整行）" % len(data))
