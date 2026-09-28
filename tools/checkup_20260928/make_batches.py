# -*- coding: utf-8 -*-
"""按体量均分批次（每批 ≤ ~50KB），交子代理做汤题/汤面/汤底对应性语义复核。"""
import json, io, os, glob

A = json.load(io.open('tools/checkup_20260928/all.json', encoding='utf-8'))
CAP = 46000  # 字符上限/批

for f in glob.glob('tools/checkup_20260928/batches/*'):
    os.remove(f)
os.makedirs('tools/checkup_20260928/batches', exist_ok=True)

def render(o):
    return '[%s] 《%s》\n汤面: %s\n汤底: %s\n\n' % (
        o['id'], o.get('dispTitle') or o.get('title'),
        (o.get('surface') or '').replace('\n', '⏎'),
        (o.get('truth') or '').replace('\n', '⏎'))

b, size, n = [], 0, 0
files = []
for o in A:
    t = render(o)
    if size + len(t) > CAP and b:
        n += 1
        p = 'tools/checkup_20260928/batches/batch_%02d.txt' % n
        io.open(p, 'w', encoding='utf-8').write(''.join(b))
        files.append((p, len(b)))
        b, size = [], 0
    b.append(t); size += len(t)
if b:
    n += 1
    p = 'tools/checkup_20260928/batches/batch_%02d.txt' % n
    io.open(p, 'w', encoding='utf-8').write(''.join(b))
    files.append((p, len(b)))
for p, c in files:
    print(p, c)
print('批数:', len(files), '总题数:', sum(c for _, c in files))
