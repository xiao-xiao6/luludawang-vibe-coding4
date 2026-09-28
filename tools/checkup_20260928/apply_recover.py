# -*- coding: utf-8 -*-
"""第三阶段：把网上/原库里找回的 8 道完整汤底写回母本，并删掉 3 道无法修复的题。
数据源全部是子代理抓回的原站页面与 GitHub 原库，脚本按“起始句→结束句”整段截取，避免手抄出错。"""
import json, io, os, re, html, shutil

D = 'tools/checkup_20260928'
MASTER = 'data/library/library.data.js'


def text_of(p):
    s = io.open(os.path.join(D, p), encoding='utf-8', errors='ignore').read()
    s = html.unescape(re.sub(r'<[^>]+>', ' ', s))
    return re.sub(r'\s+', ' ', s)


def span(t, a, b, inclusive=True):
    i, j = t.find(a), t.find(b, t.find(a))
    assert i >= 0 and j >= 0, (a[:12], b[:12])
    return t[i:j + len(b)] if inclusive else t[i:j]


GG = text_of('_tmp_gg1.html')
TS = text_of('_tmp_tski.html')
FEN = text_of('_tmp_fenshou.html')
MD = io.open(os.path.join(D, 'gh/haiguitang-php-master/data/soups/S3E13_双鱼.md'),
             encoding='utf-8', errors='ignore').read()
# 《双鱼》：取“汤底”之后、主持人玩法之前的全部正文
双鱼 = MD.split('\n汤底\n')[1].split('主持人玩法和扶车技巧')[0]
双鱼 = re.sub(r'\n{2,}', '\n', 双鱼).strip()
双鱼 = 双鱼[:双鱼.rfind('。') + 1] if 双鱼.count('\n') else 双鱼

RECOVER = [
    ('lib_05cbea68fd8f', '预言', span(GG, '从小性格内向的我', '便选择结束了自己。')),
    ('lib_715c8134e625', '广播', span(GG, '我被一个连环杀人犯绑架了', '我可能再也出不去了…')),
    ('lib_79d2875e016e', '寒冷的夜晚', span(GG, '士兵睡觉时梦游', '最后痛哭了。')),
    ('lib_43434f23746f', '医学院惨案', span(TS, '学校最近有一门解剖考试', '吓疯了。')),
    ('lib_60b7bf249d99', '敲门声', span(TS, '小王刚走不久就被守株', '再回弹撞很多次。')),
    ('lib_a077de08c109', '废旧古堡', span(TS, '我和小伙伴们约定好玩躲猫猫', '送进了真棺材……')),
    ('lib_c2f7a15f6c05', '分手', span(FEN, '因为雪崩有三人被困雪山', '通过吃掉第三个人幸存了下来')),
]

KILL = ['lib_161809c5dbab',    # 日记：汤底只剩两句，原答案全网无存档
        'lib_8d4f10ff2a9c',    # 少贴了一张邮票：汤底是别的题（鸟撞飞机），正确答案查不到
        'lib_d7bbd5509593']    # 猜拳：汤面与汤底来自两道题，正确配对查不到

raw = io.open(MASTER, encoding='utf-8').read()
H = 'var SOUP_LIBRARY = '
h = raw.index(H) + len(H)
data, ep = json.JSONDecoder().raw_decode(raw[h:])
tail = raw[h + ep:]
by = {o['id']: o for o in data}

for tid, name, full in RECOVER:
    o = by[tid]
    assert o['title'] == name or name in o['title'], (o['title'], name)
    if '双鱼' not in name:
        a, b = o['truth'][:8], full[:8]
        if a != b:
            print('   （措辞与旧档不同，以找回的完整版本为准：%s / %s）' % (a, b))
    print('补全 %-20s《%s》 %d → %d 字' % (tid, o['title'], len(o['truth']), len(full)))
    o['truth'] = full

# 双鱼单独处理（长文，含分节）
op = by['lib_f7f8399079c1']
print('补全 lib_f7f8399079c1《%s》 %d → %d 字' % (op['title'], len(op['truth']), len(双鱼)))
op['truth'] = 双鱼

for tid in KILL:
    print('删除 %s《%s》' % (tid, by[tid]['title']))
data = [o for o in data if o['id'] not in KILL]
assert all((o['truth'] or '').strip() for o in data)
assert len({o['id'] for o in data}) == len(data)

tail = re.sub(r'var SOUP_LIB_TOTAL = \d+;', 'var SOUP_LIB_TOTAL = %d;' % len(data), tail)
shutil.copyfile(MASTER, os.path.join('_local_backup', 'library.data.js.bak-checkup-20260928-preRecover'))
io.open(MASTER, 'w', encoding='utf-8').write(
    raw[:h] + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';' + tail)
print('母本条目数 →', len(data))
io.open(os.path.join(D, 'recovered.json'), 'w', encoding='utf-8').write(json.dumps(
    [{'id': t, 'title': n, 'truth': f} for t, n, f in RECOVER], ensure_ascii=False, indent=1))
