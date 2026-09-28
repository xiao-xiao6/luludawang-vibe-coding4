# -*- coding: utf-8 -*-
"""2026-09-28 体检修复 · 第二阶段：英译中/日译中 对照原文的错翻、漏翻修正。
用法： python tools/checkup_20260928/apply_trans_fixes.py [--dry]
"""
import json, io, re, sys, shutil

MASTER = 'data/library/library.data.js'
DRY = '--dry' in sys.argv
raw = io.open(MASTER, encoding='utf-8').read()
HEAD = 'var SOUP_LIBRARY = '
h = raw.index(HEAD) + len(HEAD)
data, endpos = json.JSONDecoder().raw_decode(raw[h:])
tail = raw[h + endpos:]
byid = {o['id']: o for o in data}

# (id, field, old, new, 说明)
SUBS = [
    ('lib_ca411d1cf9c1', 'truth', '被吸进了万米高空的喷气引擎', '被吸进了两万英尺高空的喷气引擎', '2万英尺≠万米'),
    ('lib_8c78c11c3fa1', 'truth', '此刻他被灌了水泥、穿着球鞋沉在水底', '此刻他穿着灌满水泥的球鞋沉在水底', 'cement shoes'),
    ('lib_f3b012b87734', 'truth', '雷雨袭来，飞机失控坠毁——那封没写完的信，成了她的遗书。',
     '雷雨里能见度极差，她的飞机与另一架飞机在空中相撞——那封没写完的信，成了她的遗书。', '死因：与他机相撞'),
    ('lib_fbb763606133', 'truth', '周五深夜他牙痛难忍去看牙', '周五傍晚五点他牙痛难忍去看牙', '5 p.m.'),
    ('lib_48503817c899', 'truth', '这条法律减少了车祸中的死亡人数。', '这条法律减少了车祸事故的发生数量。', 'accidents≠死亡数'),
    ('lib_73bb0f53041b', 'truth', '他们持有搜查令', '他们持有逮捕令', 'arrest warrant'),
    ('lib_89a8f078be96', 'truth', '海男「龟男老师迟到啦～！', '海男「龟女老师迟到啦～！', 'カメコ先生=龟女'),
    ('lib_1b56e1502ad8', 'truth', '「选哪个呢听天神的话哦」这句一共二十二个字', '「选哪个呢听天神的话哦」这句一共十个字', '译文本身10字'),
    ('lib_a600737d791a', 'truth', '（抬手比了个『拜拜』的手势）', '（踮起脚朝他凑过去，作势要亲）', 'セノビー=踮脚'),
    ('lib_8ebf9a65e333', 'surface', '箱子放在村口的祠堂里', '箱子放在村外的祠堂里', '村外れ'),
    ('lib_8ebf9a65e333', 'truth', '村口祠堂里那只龟甲形状的箱子', '村外祠堂里那只龟甲形状的箱子', '村外れ'),
    ('lib_8ebf9a65e333', 'truth', '总之 Various 原因，大家一直放着没管', '总之各有各的说法，大家一直放着没管', '何だかんだ 残留英文'),
    ('lib_31cf5fceb581', 'surface', '慌作一团的家里，王子却灵光一闪', '家臣们慌作一团，王子却灵光一闪', '家臣'),
    ('lib_daa35510c27f', 'surface', '但 plain 影响营业额', '但直接影响营业额', '単純に 残留英文'),
    ('lib_5acf8caf3584', 'truth', '他错把自己的伞拿成了她的伞？', '他把情人那把伞错当成自己的带回来了？', '方向译反'),
    ('lib_e0d6ce92565c', 'truth', '第一份工作在世界减肥中心', '第一份工作在一家减肥中心', 'a weight-loss clinic'),
    ('lib_3ec7a7147508', 'truth', '用的正是那条“早就寄出去”的手臂。',
     '用的正是那条“早就寄出去”的手臂。认出他的人当即明白他造假，动手杀了他。', '补回漏译结局'),
    ('lib_d456eec93fc4', 'truth', '在另一人的待洗衣物篮里发现了一件沾血的长袍',
     '在另一人的待洗衣物篮里发现了一件沾血的三K党长袍', 'KKK robe'),
    ('lib_80d533bed0b0', 'truth', '退出了牛郎，改演银河，在台下看着安娜与响演出',
     '退出了牛郎，改演银河（天河），看着就在眼前演出的安娜与响', '目の前で演じる'),
    ('lib_6c000ed8e0b7', 'truth', '车上所有乘客都会死。',
     '车上所有乘客都会死。（更玄的一点：若讲述者自己也在 35 岁死去，这段故事又是谁讲出来的？）', '补回原文反问'),
    ('lib_fb77315aaeee', 'truth', '知道答案的人，反而都被处死了。',
     '知道答案的人，反而都被处死了。\n（原典的答案更绕：首领问的是经典相声《Who\'s on First》里“三垒手叫什么名字”——那段相声中三垒手的名字正是“我不知道”。）', '补回主答案'),
    ('lib_5a98c7daedbb', 'surface', '的成员幕雅府院·隼人，让同为组合成员的瞳真真正正地坠入了爱河',
     '的成员幕雅府院·隼人，让瞳真真正正地坠入了爱河', '汤面剧透'),
]
# 通配替换（同一错译在该题里出现多次）
ALLS = [
    ('lib_a408dd91d645', 'surface', '山中先生', '田中先生', '人名田中误作山中'),
    ('lib_a408dd91d645', 'truth', '山中先生', '田中先生', '人名田中误作山中'),
]

errs, log = [], []
for pid, f, old, new, why in SUBS:
    o = byid.get(pid)
    if not o:
        errs.append('缺条目 %s' % pid)
    elif old not in o[f]:
        errs.append('%s %s 旧串不存在：%s' % (pid, f, old[:30]))
    else:
        log.append((pid, f, why))
        if not DRY:
            o[f] = o[f].replace(old, new)
for pid, f, old, new, why in ALLS:
    o = byid.get(pid)
    if not o:
        errs.append('缺条目 %s' % pid)
    elif old not in o[f]:
        errs.append('%s %s 旧串不存在：%s' % (pid, f, old[:30]))
    else:
        n = o[f].count(old)
        log.append((pid, f, '%s ×%d' % (why, n)))
        if not DRY:
            o[f] = o[f].replace(old, new)

if errs:
    print('预检失败 %d 项:' % len(errs))
    for x in errs:
        print('  ', x)
    sys.exit(2)
print('翻译修正 %d 处' % len(log))
for x in log:
    print('  %-20s %-8s %s' % x)
if DRY:
    print('（dry-run）')
    sys.exit(0)
shutil.copyfile(MASTER, '_local_backup/library.data.js.bak-checkup-20260928-preTrans')
tail = re.sub(r'var SOUP_LIB_TOTAL = \d+;', 'var SOUP_LIB_TOTAL = %d;' % len(data), tail)
out = raw[:h] + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';' + tail
io.open(MASTER, 'w', encoding='utf-8').write(out)
print('已写盘')
