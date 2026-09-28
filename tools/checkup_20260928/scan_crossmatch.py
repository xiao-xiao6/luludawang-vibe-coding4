# -*- coding: utf-8 -*-
"""体检 B-1：交叉错配扫描（机制层面，高准确率）。

1) 同一 surface / 同一 truth 出现在多题（去重手术留下的错配温床）
2) 某题的 truth 与另一题的 surface 高度重合（汤面/汤底被互换）
3) 精品层：truthKeywords / coreKeywords / clues 的词是否落在 truth 里（改底后关键词失配）
"""
import json, io, re, collections

A = json.load(io.open('tools/checkup_20260928/all.json', encoding='utf-8'))
RAW = json.load(io.open('data/library/library.data.js_raw.json', encoding='utf-8')) if False else None

def norm(t):
    return re.sub(r'[\s，。、；：！？…—－·\-«»“”‘’「」『』【】（）()\[\]{}<>《》"\'’’,\.;:!?]', '', t or '')

K = 12
def shingles(t, k=K):
    n = norm(t)
    return set(n[i:i + k] for i in range(max(0, len(n) - k + 1)))

surf_map = collections.defaultdict(list)
truth_map = collections.defaultdict(list)
surf_sh = {}
for o in A:
    if len(norm(o['surface'])) >= K:
        surf_map[norm(o['surface'])].append(o['id'])
    if len(norm(o['truth'])) >= K:
        truth_map[norm(o['truth'])].append(o['id'])
    surf_sh[o['id']] = (shingles(o['surface']), norm(o['surface']))

print('=== 1) 完全相同的汤面（不同题共用一句汤面） ===')
n = 0
for k, ids in surf_map.items():
    if len(ids) > 1:
        n += 1
        print(' %s -> %s | %s' % (k[:40], ids, [next(o['title'] for o in A if o['id'] == i) for i in ids]))
print('小计:', n)

print('\n=== 2) 完全相同的汤底（不同题共用一段汤底） ===')
n = 0
for k, ids in truth_map.items():
    if len(ids) > 1:
        n += 1
        print(' %s -> %s' % (k[:48], ids))
print('小计:', n)

print('\n=== 3) 汤底 ≈ 另一题的汤面（疑似互换/串题） ===')
post = collections.defaultdict(set)
for oid, (ss, sn) in surf_sh.items():
    for sh in ss:
        post[sh].add(oid)
n = 0
for o in A:
    ts = shingles(o['truth'])
    if not ts:
        continue
    cand = collections.Counter()
    for sh in ts:
        for oid in post.get(sh, ()):
            if oid != o['id']:
                cand[oid] += 1
    best = (0, None)
    for oid, inter in cand.most_common(6):
        score = inter / float(len(ts))
        if score > best[0]:
            best = (score, oid)
    if best[0] >= 0.55 and best[1]:
        other = next(x for x in A if x['id'] == best[1])
        n += 1
        print(' %s(%s) 汤底 与 %s(%s) 汤面 重合 %.0f%%' % (
            o['id'], o['title'][:14], best[1], other['title'][:14], best[0] * 100))
        print('    本汤汤面: %s' % o['surface'][:70].replace('\n', ' '))
        print('    本汤汤底: %s' % o['truth'][:70].replace('\n', ' '))
        print('    那题汤面: %s' % other['surface'][:70].replace('\n', ' '))
print('小计:', n)
