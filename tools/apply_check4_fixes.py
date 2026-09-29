# -*- coding: utf-8 -*-
"""第三轮 · 并库前把关修正器：把 22 路判定里逐条对过原文、确认成立的问题落到候选译文
tools/llt3_trans_clean.json 上，并写出淘汰名单 tools/llt3_exclude.json。

行级操作（找行/插行/删行/前缀），避免多行空格差异导致误替换；每条子串要求在字段内唯一。
不成立的判定（对过原文后）一律不动，最后打印 miss 清单供人工复核。
"""
import io, os, re, json, sys, collections

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
T = lambda *p: os.path.join(ROOT, "tools", *p)
P = T("llt3_trans_clean.json")
tr = json.load(io.open(P, encoding="utf-8"))
log = collections.Counter()
misses = []


def txt_of(sid, fs):
    return tr[sid][fs]


def line_idx(lines, sub, want=1):
    hits = [i for i, l in enumerate(lines) if sub in l]
    if len(hits) != want:
        return None
    return hits[0]


def rep(sid, fs, old, new, all_=False):
    s = txt_of(sid, fs)
    n = s.count(old)
    if n == 0 or (not all_ and n != 1):
        misses.append(("rep", sid, fs, old[:26], "命中%d次" % n)); return
    tr[sid][fs] = s.replace(old, new) if all_ else s.replace(old, new, 1)
    log["替换"] += 1


def ins_before_line(sid, fs, sub, text):
    lines = txt_of(sid, fs).split("\n")
    i = line_idx(lines, sub)
    if i is None:
        misses.append(("ins_before", sid, fs, sub[:26], "锚点不唯一/缺失")); return
    lines.insert(i, text)
    lines.insert(i + 1, "")
    tr[sid][fs] = "\n".join(lines)
    log["前插行"] += 1


def ins_after_line(sid, fs, sub, text):
    lines = txt_of(sid, fs).split("\n")
    i = line_idx(lines, sub)
    if i is None:
        misses.append(("ins_after", sid, fs, sub[:26], "锚点不唯一/缺失")); return
    lines.insert(i + 1, "")
    lines.insert(i + 2, text)
    tr[sid][fs] = "\n".join(lines)
    log["后插行"] += 1


def prepend(sid, fs, text):
    tr[sid][fs] = text + "\n\n" + txt_of(sid, fs).lstrip()
    log["补首行"] += 1


def append(sid, fs, text):
    tr[sid][fs] = txt_of(sid, fs).rstrip() + "\n\n" + text
    log["补末行"] += 1


def drop_line(sid, fs, sub):
    lines = txt_of(sid, fs).split("\n")
    i = line_idx(lines, sub)
    if i is None:
        misses.append(("drop", sid, fs, sub[:26], "锚点不唯一/缺失")); return
    del lines[i]
    while lines and not lines[-1].strip():
        lines.pop()
    tr[sid][fs] = "\n".join(lines).strip()
    log["剥站方行"] += 1


def prefix_line(sid, fs, sub, marker):
    lines = txt_of(sid, fs).split("\n")
    i = line_idx(lines, sub)
    if i is None:
        misses.append(("prefix", sid, fs, sub[:26], "锚点不唯一/缺失")); return
    if lines[i].lstrip().startswith(marker):
        misses.append(("prefix", sid, fs, sub[:16], "已加过")); return
    lines[i] = re.sub(r"^[ \t]*", marker, lines[i], count=1)
    tr[sid][fs] = "\n".join(lines)
    log["补行首标记"] += 1


def set_first_line(sid, fs, text):
    lines = txt_of(sid, fs).split("\n")
    if lines[0].strip() == text:
        misses.append(("first", sid, fs, text[:16], "已改过")); return
    lines[0] = text
    tr[sid][fs] = "\n".join(lines)
    log["改首行"] += 1


# ————————————————————————————— 漏译补回 —————————————————————————————
ins_before_line("20838", "truth", "＜劳子｛「你回来了啊", "【｛丈夫就在那里｝】")
prepend("20840", "truth", "【答案：『六角形』】")
ins_before_line("20841", "truth", "糟……该死！不过应该就掉在附近吧", "【结婚戒指，丢了。】")
ins_before_line("20854", "truth", "那边不是赛道！", "【啊！？】")
ins_before_line("20878", "truth", "呃啊！恶心！", "【头发在里面。】")
ins_before_line("20884", "surface", "路没有变。", "【他没有走那条路。】")
ins_before_line("20917", "surface", "（提示：△中会填入正文中出现过的文字。）", "【问：◯△是什么？】")
append("20920", "truth", "余谈：似乎也有人是反过来的……顺便一说，在下把自己抽到的御神签放进冷冻库里。")
ins_before_line("20921", "truth", "入室抢劫的那户人家", "【我们刚刚，杀了人。】")
ins_before_line("20922", "truth", "龟政冲出营帐想去迎接爱马", "「是鹤龟号。」")
ins_before_line("20927", "truth", "能实现愿望的恶魔，收取寿命作为代价。", "【小结】")
prepend("20979", "truth", "【真相】")
set_first_line("21027", "truth", "【カ】龟女")
ins_before_line("21069", "truth", "＜｛舞台侧幕｝＞", "【答案】")
ins_before_line("21102", "surface", "一、首先，检讨甲是否成立损坏尸体罪", "【我提交的论文】")
ins_before_line("21124", "surface", "西岛早苗当场身亡", "※照片就是当时拍的那张")
prepend("21182", "truth", "【※后味偏苦，请留意】")
append("21195", "truth", "▽解说的解说\n乡间便利店一到夏天，趋光的虫子便纷纷聚拢过来。\n幸运的是似乎总能捕到不错的虫子，于是夜里常有一家人来捕虫。")
ins_before_line("21281", "truth", "①确认昴打开的是奈月的鞋柜。", "【FA条件】")
append("21284", "surface", "【怎么回事？】")
ins_before_line("20775", "truth", "啊，糟了。上次课上跟一年3班说过", "【嗯？测验？】")
ins_before_line("20795", "surface", "为什么？", "【非常不妙】")
ins_before_line("20801", "truth", "（……啧，又是楼上的笨蛋……！", "【身体猛地一僵！！！！】")

# ————————————————————————————— 错翻改回 —————————————————————————————
rep("20820", "truth", "……爸爸，出题之前请认真看一眼题目啊。", "……爸爸，请先好好看过题目，再来调侃人家呀。")
rep("20875", "truth", "公主甩掉的万宝槌", "公主挥动的万宝槌")
rep("20882", "truth", "迎来了米寿（伞寿，80岁）", "迎来了伞寿（80岁）")
rep("20914", "truth", "察觉「他对我的感情冷掉了」并不难。", "察觉「她对我的感情冷掉了」并不难。")
rep("20964", "surface", "修着摆设的龟男＜你＞在怨恨着。", "修着摆设的龟男，怨恨着＜你＞。")
rep("20976", "truth", "察龟男「那边的Umigameラテ", "【警】察官龟男「那边的Umigameラテ")
rep("20977", "truth", "女「呐～，想要盘子～」", "【カ】龟女「呐～，想要盘子～」")
rep("20979", "truth", "这是附属小学的同学对吧。", "这是4组（同班分组）的同学对吧。")
rep("20983", "surface", "可我一生气大家就缩成一片", "可我一对大家搭话，大家就缩成一片")
rep("20983", "truth", "｛爱してるよ｝（我爱你）", "｛愛してるよ｝（我爱你）")
rep("21033", "truth", "特意重新烧水煮蛋，时间效率不差吗？", "特意重新烧水煮蛋，时间效率不是很差吗？")
rep("21042", "truth", "这时，她看到窗外那棵树上", "这时，他看到窗外那棵树上")
rep("21042", "truth", "她赶忙看了一眼美希的脸", "他赶忙看了一眼美希的脸")
rep("21042", "truth", "趁美希睡得正香，她爬上梯子", "趁美希睡得正香，他爬上梯子")
rep("21045", "truth", "（冷冻秋鲑＝シシャモ", "（冷冻多春鱼＝シシャモ")
rep("21053", "surface", "今东西，选举就是一场印象战。", "【古】今东西，选举就是一场印象战。")
rep("21074", "surface", "天下午。", "【あ】某日（ある日）的午后。")
rep("21074", "truth", "——正吉，水烧开了哦——！", "【「お】喂——正吉，水烧开了哦——！")
rep("21092", "surface", "某天，和班主任龟男单独相处时", "某天，和龟男老师单独相处时")
rep("21095", "surface", "某天早上，两人看着电视节目", "某天早上，两人看着天气预报")
rep("21101", "truth", "名叫「丰丸」的", "名叫「まる豊」的")
rep("21152", "truth", "那句「要多办更多的案子！」", "那句「要变得更出名啊！」")
rep("21185", "surface", "都相信她从小说过谎，一次都没有过", "都相信她从小到大从没说过一次谎")
rep("21190", "truth", "9号球没进，白球反倒先落了袋", "9号球连同白球一起被打落了袋")
rep("21234", "truth", "这里视野开阔。", "这里四面都被玻璃围着一整圈。")
rep("21291", "truth", "什么，你想玩捉迷藏？", "什么，你想玩抓人游戏？")
rep("20976", "surface", "男为了分数", "【カ】龟男为了分数")
rep("20977", "surface", "男为了分数", "【カ】龟男为了分数")

# ————————————————————————————— 未译补注 —————————————————————————————
rep("20903", "surface", "レイタ把汉字换成平假名时", "蕾太（レイタ）把汉字换成平假名时")
rep("20903", "surface", "アツミ却开始抱头", "敦美（アツミ）却开始抱头")
rep("20903", "truth", "レイタ和アツミ在下将棋", "蕾太（レイタ）和敦美（アツミ）在下将棋")
rep("20903", "truth", "所以アツミ才会抱头", "所以敦美才会抱头")
rep("21198", "surface", "跨国公司“ビシビシ商事”接受面试", "跨国公司“比比商事”（ビシビシ商事）接受面试")
rep("21198", "surface", "听完她的自我推销，ビシビシ商事的干部们", "听完她的自我推销，比比商事的干部们")
rep("21273", "surface", "「fighting—いーっす！」", "「fighting—いーっす！（加油——好嘞！）」")

# ————————————————————————————— 站方残留剥除 —————————————————————————————
rep("20772", "truth", "防瞌睡预警警报（拉特问答33期主题式表述：防止驾驶途中「睡着」的警报装置）被设置在国道上",
    "防瞌睡预警警报被设置在国道上")
drop_line("20948", "surface", "我在这个站的注册年份都是2018年")
drop_line("21058", "surface", "※本题有出处（元ネタ）")
drop_line("21058", "truth", "出处：某Twitter前用户的投稿")
drop_line("21062", "surface", "（本题转自某处）")

# 21249 竖读机关：把原文每句首字标回译文句首（ア行＋カ行）
for sub, mark in [("承蒙各位一直参与", "【イ】"), ("有开心的、快乐的回忆", "【ウ】"),
                  ("愿以这值得庆贺的节点", "【オ】"), ("要继续给照拂我的各位", "【オ】"),
                  ("一定不负期待", "【カ】"), ("一定会的", "【キ】"),
                  ("翻来覆去的感谢", "【ク】"), ("敬上", "【ケ】")]:
    prefix_line("21249", "surface", sub, mark)

# 标题
tr["20857"]["title"] = tr["20857"]["dispTitle"] = "游乐园归途的夜"
log["改标题"] += 1
tr["21295"]["title"] = tr["21295"]["dispTitle"] = "GABAN不就是咖喱粉吗？"
log["改标题"] += 1

# 淘汰名单（不可玩 / 无谜底 / 站方活动帖）
EXCLUDE = ["21265", "21031", "21020", "20982", "20958", "20767"]
io.open(T("llt3_exclude.json"), "w", encoding="utf-8").write(json.dumps(EXCLUDE))

for sid in list(tr):
    for fs in ("title", "surface", "truth"):
        s = (tr[sid][fs] or "").strip()
        if not s:
            misses.append(("空字段", sid, fs, "", ""))
        tr[sid][fs] = re.sub(r"\n{3,}", "\n\n", s)

io.open(P, "w", encoding="utf-8").write(json.dumps(tr, ensure_ascii=False, indent=1))
print("已应用:", dict(log))
print("淘汰:", EXCLUDE)
print("未命中/待定 %d 项:" % len(misses))
for m in misses:
    print("   ", m)
