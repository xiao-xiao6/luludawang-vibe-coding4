# -*- coding: utf-8 -*-
"""体检 D-3：导出英译中/日译中 462 题的「原文 ↔ 站内译文」对照批次，供逐条核错翻/少翻/漏翻。"""
import json, io, os, glob, re

A = json.load(io.open('tools/checkup_20260928/all.json', encoding='utf-8'))
llt = {str(x['id']): x for x in json.load(io.open('tools/llt_dump.json', encoding='utf-8'))['items']}
yng = {str(x['id']): x for x in json.load(io.open('tools/yng_dump.json', encoding='utf-8'))['items']}
soups = json.load(io.open('data/library/soups.json', encoding='utf-8'))
raw_en = {}
for x in soups:
    if x.get('lang') == 'en' and x.get('src') in ('github:boop-yyt/situation_puzzle',
                                                  "Jed's List of Situation Puzzles (1999)", 'misc/repo-scan'):
        raw_en[(x['src'], x.get('srcNo'))] = x

os.makedirs('tools/checkup_20260928/trans_batches', exist_ok=True)
for f in glob.glob('tools/checkup_20260928/trans_batches/*'):
    os.remove(f)

CAP = 52000
blocks, size, n = [], 0, 0
files = []
missing = 0
for o in A:
    if not ({'英译中', '日译中'} & set(o.get('cats') or [])):
        continue
    src, no = o.get('src'), str(o.get('srcNo'))
    if src == 'late-late.jp':
        orig = llt.get(no)
    elif src == 'yesnogame.net':
        orig = yng.get(no)
    else:
        orig = raw_en.get((src, o.get('srcNo')))
    if not orig or not (orig.get('surface') or orig.get('truth')):
        missing += 1
        continue
    lang = '日文' if src == 'late-late.jp' else '英文'
    b = ('[%s] 《%s》 来源=%s #%s（原文为%s）\n' % (o['id'], o['title'], src, o.get('srcNo'), lang)
         + '原文汤面: %s\n' % re.sub(r'\s+', ' ', orig.get('surface') or '')[:1600]
         + '站内汤面: %s\n' % re.sub(r'\s+', ' ', o['surface'] or '')[:1200]
         + '原文汤底: %s\n' % re.sub(r'\s+', ' ', orig.get('truth') or '')[:2200]
         + '站内汤底: %s\n\n' % re.sub(r'\s+', ' ', o['truth'] or '')[:1800])
    if size + len(b) > CAP and blocks:
        n += 1
        p = 'tools/checkup_20260928/trans_batches/pair_%02d.txt' % n
        io.open(p, 'w', encoding='utf-8').write(''.join(blocks))
        files.append(p)
        blocks, size = [], 0
    blocks.append(b)
    size += len(b)
if blocks:
    n += 1
    p = 'tools/checkup_20260928/trans_batches/pair_%02d.txt' % n
    io.open(p, 'w', encoding='utf-8').write(''.join(blocks))
    files.append(p)
for p in files:
    print(p, os.path.getsize(p))
print('批数', len(files), '无原文可对照', missing)
