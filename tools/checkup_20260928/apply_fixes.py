# -*- coding: utf-8 -*-
"""2026-09-28 全库体检修复（第一阶段：剥离无关内容 + 补全截断汤底 + 纠正标题 + 拆分/删除）。

用法：
  python tools/checkup_20260928/apply_fixes.py --dry   # 只预检
  python tools/checkup_20260928/apply_fixes.py         # 落盘（自动备份母本）
"""
import json, io, re, sys, os, hashlib, shutil, collections

MASTER = 'data/library/library.data.js'
DRY = '--dry' in sys.argv
raw = io.open(MASTER, encoding='utf-8').read()
HEAD = 'var SOUP_LIBRARY = '
hstart = raw.index(HEAD)
head = raw[:hstart]
off = hstart + len(HEAD)
data, endpos = json.JSONDecoder().raw_decode(raw[off:])
tail = raw[off + endpos:]  # 含 SOUP_LIB_CATS / SOUP_LIB_TOTAL 页脚
byid = {o['id']: o for o in data}
log = []
errs = []


def norm_ws(t):
    return re.sub(r'[ \t\u3000]+\n', '\n', t).strip()


def cut(pid, field, marker, keep_marker=False, label=''):
    o = byid.get(pid)
    if not o:
        errs.append('缺条目 %s' % pid)
        return
    t = o[field]
    i = t.find(marker)
    if i < 0:
        errs.append('%s %s 标记不存在: %s' % (pid, field, marker[:26]))
        return
    new = t[:i] if not keep_marker else t[:i] + marker
    new = new.rstrip(' \n　─-―—…，、：；。') if not keep_marker else new
    if not new.strip():
        errs.append('%s %s 剥离后为空' % (pid, field))
        return
    log.append(('CUT', pid, field, label or marker[:16], len(t) - len(new)))
    if not DRY:
        o[field] = norm_ws(new)
        if field == 'title':
            o['dispTitle'] = new


def drop(pid, field, old, new='', label=''):
    o = byid.get(pid)
    if not o:
        errs.append('缺条目 %s' % pid)
        return
    if old not in o[field]:
        errs.append('%s %s 旧串不存在: %s' % (pid, field, old[:26]))
        return
    log.append(('DROP' if not new else 'SUB', pid, field, label or old[:16], len(old) - len(new)))
    if not DRY:
        o[field] = o[field].replace(old, new)


def retitle(pid, new):
    o = byid.get(pid)
    if not o:
        errs.append('缺条目 %s' % pid)
        return
    log.append(('TITLE', pid, 'title', '%s→%s' % (o['title'], new), 0))
    if not DRY:
        o['title'] = new
        o['dispTitle'] = new


def setf(pid, field, val, label):
    o = byid.get(pid)
    if not o:
        errs.append('缺条目 %s' % pid)
        return
    log.append(('SET', pid, field, label, len(val) - len(o[field])))
    if not DRY:
        o[field] = norm_ws(val)


# ============ 1. 剥离与谜题无关的源站内容 ============
# 1a 主持人手册/玩法说明
for pid, mark in [('lib_007dafa7c9bf', '主持人手册'), ('lib_3fad9c3ff17b', '主持人手册'),
                  ('lib_7445ad740cb8', '主持人手册'), ('lib_7ba2fe196fb5', '主持人手册'),
                  ('lib_82eb6489ade9', '主持人手册'), ('lib_c86242207350', '主持人手册'),
                  ('lib_e925351d389a', '主持人手册')]:
    cut(pid, 'truth', mark, label='主持人手册')
drop('lib_0fdefd44364d', 'truth', '主持人需按”正-反-正-反“顺序回答问题。', '', '主持人指令句')
drop('lib_256cd09236f0', 'truth', 'ps：所有括号内的内容为主持人添加，方便观众理解，并未修改作者原意。\n', '', '主持人ps')
# 1b 作者致谢/署名/BS 公告/图片出处/URL
cut('lib_6863a9601ca8', 'truth', '●○●○●○●○', label='作者致谢')
cut('lib_983b7d7e9301', 'truth', '？？？？： 感谢各位参与', label='作者致谢')
cut('lib_220eec6b5346', 'truth', '呐，我说过的吧？？', label='作者致谢+URL')
cut('lib_a72e6741b9be', 'truth', '重制原作', label='转载URL')
cut('lib_379ca498d4a4', 'truth', '以上就是【第100题】的出题', label='出题致谢')
cut('lib_379ca498d4a4', 'surface', '出题开始后｛30分钟｝', label='BS公告')
cut('lib_d57db3489376', 'truth', '测试参与：巧手君', label='致谢名单')
cut('lib_dc1830048523', 'truth', '那么感谢各位的BS', label='BS致谢')
cut('lib_066b7dedef80', 'truth', '【『银河系』的问候】', label='作者问候块')
cut('lib_f58ac59a57f9', 'surface', '（题干来自 sugar', label='投稿署名')
cut('lib_6e94fb230c62', 'surface', '（SP：苹果们', label='SP署名')
cut('lib_086053fa989c', 'surface', '（SP：ruyo桑', label='SP致谢')
cut('lib_6fd3d228e4cf', 'surface', '啊，给大家的解答可能要花点时间', label='板块致谢')
cut('lib_54d4261c9f3e', 'truth', '※图片来源', label='图片出处')  # 该题随后被删
drop('lib_6de0d702d28a', 'truth', '\n混入了什么奇怪的东西啊喂！)', '', '源站吐槽')
drop('lib_acfe4ab75d5e', 'truth', '\n{什么感天动地的父子(女)情，卖排骨的狂喜 }', '', '作者吐槽')
drop('lib_0695135164a2', 'truth', '可是我不敢回头。Do=1，Re=2，Mi=3，Fa=4，Sol=5，La=6，Si=7，Do=8，Re=9。破解后是这样的一段对话：好怀念和你一起听歌，期待很久了，我们选择你喜欢的歌手，这次我有个主意，真希望你能与我分享谁，捡到这封信就杀谁，好期待。原来这竟然是两个变态留下的话，他们通过这种方式寻找受害者，并以听取受害者的尖叫为乐趣。我现在总感觉身后有人在盯着我，可是我不敢回头。',
     '可是我不敢回头。', '整段重复')
drop('lib_34638b5cab45', 'surface', '【题】 ', '', '题解标签')
drop('lib_34638b5cab45', 'truth', '【解】 ', '', '题解标签')

# ============ 2. 补全截断汤底（全部取自本地备份同题完整版） ============
BF = json.load(io.open('tools/checkup_20260928/backfill_final.json', encoding='utf-8'))
for pid, spec in BF.items():
    if pid == 'lib_3fad9c3ff17b':
        continue  # 该题只需剥离主持人手册，故事本身完整
    setf(pid, 'truth', spec['truth'], '补全(%s)' % spec['from'][:34])

# ============ 3. 标题纠正 ============
retitle('lib_7ba2fe196fb5', '生日循环')
retitle('lib_82eb6489ade9', '不许超过20次提问')
retitle('lib_464b313662f2', '057 · 预知寿命')
retitle('lib_7962073cf911', '装电话的龟男')
retitle('lib_34638b5cab45', '百元店的笔筒')
retitle('lib_4bb30df46863', '电梯')
retitle('lib_4a68dd74f870', '蝴蝶结')

# ============ 4. 一格多汤：拆分 / 收敛 ============
# 4a 村中诡事 → 三道独立汤
src = byid['lib_1245207e575c']
full = src['truth']
parts = re.split(r'\n故事([二三])\n', full)
new_items = []
if len(parts) != 5:
    errs.append('村中诡事拆分失败: 段数=%d' % len(parts))
else:
    def peel(block, tag):
        m = re.search(tag, block)
        if not m:
            errs.append('村中诡事 %s 段无汤面/汤底标记' % tag)
            return block[:40], block
        surf = re.sub(r'^汤面', '', block[:m.start()])
        return norm_ws(surf), norm_ws(block[m.end():])
    s2f, s2t = peel(parts[2], "汤底")          # 故事二：汤面…汤底…
    s3f, s3t = peel(parts[4], "真正汤底")      # 故事三：汤面…真正汤底…
    src['surface'] = norm_ws(src['surface'])
    src['truth'] = norm_ws(parts[0])
    src['title'] = src['dispTitle'] = '村中诡事·故事一'
    for name, surf, tr in [('村中诡事·故事二', s2f, s2t), ('村中诡事·故事三', s3f, s3t)]:
        nid = 'lib_' + hashlib.sha1((name + surf).encode('utf-8')).hexdigest()[:12]
        e = dict(src)
        e.update({'id': nid, 'title': name, 'dispTitle': name, 'surface': norm_ws(surf),
                  'truth': norm_ws(tr), 'quality': 'needs-review'})
        e.pop('_t', None)
        new_items.append(e)
        log.append(('SPLIT', nid, 'all', name, len(norm_ws(tr))))

# 4b 小由的一周：汤面只问星期一，汤底收敛到星期一
src = byid['lib_ac2172cfc83a']
m = re.search(r'(小由天生几乎看不见.*?)星期一', src['truth'])
mon = re.search(r'星期一(.+?)星期二', src['truth'], re.S)
if mon:
    intro = src['truth'][:src['truth'].index('星期一')]
    setf('lib_ac2172cfc83a', 'truth', intro + '星期一' + mon.group(1), '只留星期一')
    retitle('lib_ac2172cfc83a', '小由的一周·星期一')
else:
    errs.append('小由的一周 星期一 段落未定位')

# ============ 5. 删除无法作为谜题使用的条目 ============
KILL = ['lib_614ee93f352b',   # 444寝室：汤底与汤面一字不差，全库无答案
        'lib_84b36d48082d',   # 人生游戏：原站活动玩法公告+结果
        'lib_2ee8dbec8a06',   # 谜挂比拼大会：原站投稿企划公告+评选
        'lib_54d4261c9f3e']   # 会走路的衣服：汤底只剩图片出处说明
for pid in KILL:
    if pid not in byid:
        errs.append('待删条目不存在 %s' % pid)
    else:
        log.append(('KILL', pid, 'all', byid[pid]['title'], 0))

if errs:
    print('预检失败 %d 项:' % len(errs))
    for x in errs:
        print('  ', x)
    sys.exit(2)

print('操作 %d 项 | ' % len(log) + str(collections.Counter(x[0] for x in log)))
for x in log:
    print('  %-6s %-20s %-7s %s (%+d)' % (x[0], x[1], x[2], x[3], x[4]))
if DRY:
    print('（dry-run，未写盘）')
    sys.exit(0)

if new_items:
    data.extend(new_items)
data = [o for o in data if o['id'] not in KILL]
assert all((o.get('title') or '').strip() for o in data), '空标题'
assert all((o.get('surface') or '').strip() for o in data), '空汤面'
assert all((o.get('truth') or '').strip() for o in data), '空汤底'
shutil.copyfile(MASTER, '_local_backup/library.data.js.bak-checkup-20260928-pre')
tail = re.sub(r'var SOUP_LIB_TOTAL = \d+;', 'var SOUP_LIB_TOTAL = %d;' % len(data), tail)
out = head + HEAD + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';' + tail
io.open(MASTER, 'w', encoding='utf-8').write(out)
print('已写盘：母本条目数 %d' % len(data))
json.dump(log, io.open('tools/checkup_20260928/apply_log1.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
