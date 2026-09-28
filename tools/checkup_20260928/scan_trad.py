# -*- coding: utf-8 -*-
"""体检 C-2：全库扫描“未转换的繁体字”（漏翻信号），并单独检查 著/着 误转换。"""
import json, io, collections
from opencc import OpenCC

cc = OpenCC('t2s')
A = json.load(io.open('tools/checkup_20260928/all.json', encoding='utf-8'))
# 一字多形、简繁同形的字排除掉，避免假阳性
IGNORE = set('著后里面钟余愿乾髮採沈涵遊廻遠台台印複覆')

rows = collections.defaultdict(list)
hits = []
for o in A:
    for f in ('title', 'surface', 'truth'):
        t = o.get(f) or ''
        conv = cc.convert(t)
        for i, (a, b) in enumerate(zip(t, conv)):
            if a != b and a not in IGNORE:
                hits.append({'id': o['id'], 'field': f, 'src': o['src'], 'cats': o['cats'],
                             'char': a, 'to': b, 'ctx': t[max(0, i - 18):i + 18].replace('\n', '⏎')})
                rows[a].append(o['id'])

print('疑似未转繁体的字符种类:', len(rows), ' 处数:', len(hits))
for ch, ids in sorted(rows.items(), key=lambda x: -len(x[1]))[:40]:
    print('  %s → %s  题数=%d' % (ch, cc.convert(ch), len(set(ids))))
json.dump(hits, io.open('tools/checkup_20260928/trad_leftover.json', 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)

print('\n--- 明细（前 60 条）---')
for h in hits[:60]:
    print('%s %s [%s→%s] %s | %s' % (h['id'], h['field'], h['char'], h['to'], h['src'][:18], h['ctx']))

# 过度简查：着名/着称/着作/显 等着→著 的误换
print('\n--- 疑似 著→着 误转换 ---')
BAD = ['着名', '着称', '着作', '显著', '着录', '编着', '着述', '派着', '论着', '着意', '原着']
n = 0
for o in A:
    for f in ('title', 'surface', 'truth'):
        t = o.get(f) or ''
        for w in BAD:
            if w in t and w != '显著':
                n += 1
                i = t.index(w)
                print('%s %s %s | %s' % (o['id'], f, w, t[max(0, i - 20):i + 20].replace('\n', '⏎')))
print('计', n)
