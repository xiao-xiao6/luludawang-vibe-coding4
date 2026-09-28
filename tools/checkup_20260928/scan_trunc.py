# -*- coding: utf-8 -*-
"""体检 D-2：汤底截断排查（站内文本以句中结束 / 明显比原文短一截）。"""
import json, io, re, collections

A = json.load(io.open('tools/checkup_20260928/all.json', encoding='utf-8'))
llt = {str(x['id']): x for x in json.load(io.open('tools/llt_dump.json', encoding='utf-8'))['items']}
yng = {str(x['id']): x for x in json.load(io.open('tools/yng_dump.json', encoding='utf-8'))['items']}

FINAL = '。！？…”』）)】>》…!.'
Scaffold = re.compile(
    r'(?:※?この問題は.*?よろしくお願いいたします[！!]?|この問題はBS問題.*?エンジョイ|'
    r'------------------------|ー{5,}|※この問題は)', re.S)

def strip_jp_noise(t):
    t = Scaffold.sub('', t or '')
    t = re.sub(r'[（(][^（）()]{0,40}[)）]', '', t)
    t = re.sub(r'\s', '', t)
    return t

tr_rows, len_rows = [], []
for o in A:
    if not ({'英译中', '日译中'} & set(o.get('cats') or [])):
        continue
    t = (o['truth'] or '').strip()
    if t and t[-1] not in FINAL:
        tr_rows.append((o['id'], o['src'], o['title'], t[-38:]))
    src = llt.get(str(o['srcNo'])) if o['src'] == 'late-late.jp' else yng.get(str(o['srcNo']))
    if src and o['src'] == 'late-late.jp':
        a, b = len(t), len(strip_jp_noise(src['truth']))
        if b and a / float(b) < 0.62 and b > 160:
            len_rows.append((o['id'], o['title'], a, b, t[-30:], strip_jp_noise(src['truth'])[-40:]))

print('=== 汤底以句中结尾（疑似截断）：%d 题 ===' % len(tr_rows))
for r in tr_rows:
    print('%-22s %-16s %-18s …%s' % (r[0], r[1][:16], (r[2] or '')[:16], r[3].replace('\n', '⏎')))
print('\n=== 日译中：汤底明显短于原文（去掉BS脚手架后仍短 38%%以上）：%d 题 ===' % len(len_rows))
for r in sorted(len_rows, key=lambda x: x[2] / float(x[3])):
    print('%-22s %-16s 站内%d/原文%d …%s || 原文结尾…%s' % (r[0], (r[1] or '')[:16], r[2], r[3],
                                                            r[4].replace('\n', '⏎'), r[5].replace('\n', '⏎')))
