# -*- coding: utf-8 -*-
"""给“句子本身完整、只是缺句号”的汤底补上结尾标点（跳过确认被截断的题）。"""
import json, io, re, shutil

MASTER = 'data/library/library.data.js'
SKIP = {'lib_05cbea68fd8f', 'lib_161809c5dbab', 'lib_43434f23746f', 'lib_60b7bf249d99',
        'lib_715c8134e625', 'lib_79d2875e016e', 'lib_a077de08c109', 'lib_c2f7a15f6c05',
        'lib_f7f8399079c1', 'lib_c1ec5b9605c6', 'lib_8d4f10ff2a9c', 'lib_d7bbd5509593',
        'lib_8e3ab9e40712', 'lib_580b68c8f90a'}
FIN = '。！？…”』）)】>》…*!'
raw = io.open(MASTER, encoding='utf-8').read()
H = 'var SOUP_LIBRARY = '
h = raw.index(H) + len(H)
data, ep = json.JSONDecoder().raw_decode(raw[h:])
tail = raw[h + ep:]
n = 0
for o in data:
    if o['id'] in SKIP:
        continue
    for f in ('surface', 'truth'):
        t = o[f]
        if t and t[-1] not in FIN and re.match(r'[一-鿿]', t[-1]) and len(t) > 12:
            o[f] = t + '。'
            n += 1
            if f == 'truth':
                print('补句号 %s《%s》…%s' % (o['id'], o['title'][:12], t[-16:].replace('\n', '⏎')))
print('共补', n, '处')
if n:
    shutil.copyfile(MASTER, '_local_backup/library.data.js.bak-checkup-20260928-preDot')
    io.open(MASTER, 'w', encoding='utf-8').write(
        raw[:h] + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';' + tail)
