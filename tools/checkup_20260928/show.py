# -*- coding: utf-8 -*-
"""把 pollution.json 按规则分组打印，便于逐条人工判定。"""
import json, io, sys, collections, argparse

ap = argparse.ArgumentParser()
ap.add_argument('--code', default=None)
ap.add_argument('--limit', type=int, default=40)
a = ap.parse_args()

items = json.load(io.open('tools/checkup_20260928/pollution.json', encoding='utf-8'))
by = collections.defaultdict(list)
for it in items:
    for h in it['hits']:
        by[h['code']].append((it, h))

codes = [a.code] if a.code else sorted(by, key=lambda c: -len(by[c]))
for c in codes:
    print('\n######## %s  (%d 处) ########' % (c, len(by[c])))
    seen = set()
    n = 0
    for it, h in by[c]:
        k = (it['id'], h['field'], h['note'])
        if k in seen:
            continue
        seen.add(k)
        n += 1
        if n > a.limit:
            break
        print('- %s [%s] %s | %s' % (it['id'], h['field'], h['note'], h['ctx']))
