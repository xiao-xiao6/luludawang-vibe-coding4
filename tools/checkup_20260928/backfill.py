# -*- coding: utf-8 -*-
"""严格补全：站内汤底是某条备份汤底的“前缀截断版”时，用更长的那条整段替换。"""
import json, io, re, sys, collections

sys.path.insert(0, 'tools/checkup_20260928')
from recovery import POOL, A, n

ids = json.load(io.open('tools/checkup_20260928/truncated_ids.json', encoding='utf-8'))
out = {}
for tid in ids:
    o = A[tid]
    ot = n(o['truth'])
    if len(ot) < 12:
        continue
    head = ot[:14]
    best = None
    for c in POOL:
        if c['id'] == tid:
            continue
        ct = n(c['truth'])
        if len(ct) <= len(ot) + 8:
            continue
        if head in ct or ct[:14] in ot:
            if best is None or len(ct) > len(n(best['truth'])):
                best = c
    if best:
        out[tid] = {'title': best['title'], 'file': best['f'], 'src': best.get('src'),
                    'truth': best['truth'], 'surface': best.get('surface'),
                    'old_len': len(o['truth']), 'new_len': len(best['truth'])}
print('可整段补全:', len(out))
for k, v in out.items():
    print('  %-22s %s → (%s)《%s》 %d→%d' % (k, A[k]['title'][:12], v['file'].split('/')[-1], v['title'][:16], v['old_len'], v['new_len']))
json.dump(out, io.open('tools/checkup_20260928/backfill.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
miss = [i for i in ids if i not in out]
print('仍缺:', len(miss), ' '.join(miss))
