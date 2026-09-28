# -*- coding: utf-8 -*-
"""按“汤面相似度”补全截断汤底：站内汤面与备份汤面高度一致时，取备份里更长的汤底。"""
import json, io, sys, difflib

sys.path.insert(0, 'tools/checkup_20260928')
from recovery import POOL, A, n

ids = json.load(io.open('tools/checkup_20260928/truncated_ids.json', encoding='utf-8'))
res = {}
for tid in ids:
    o = A[tid]
    os_, ot = n(o['surface']), n(o['truth'])
    cands = []
    for c in POOL:
        ct, cs = n(c['truth']), n(c['surface'])
        if c['id'] == tid or len(ct) < len(ot) + 8:
            continue
        fs = difflib.SequenceMatcher(None, os_, cs, autojunk=False)
        if fs.real_quick_ratio() < 0.7 or fs.quick_ratio() < 0.7:
            continue
        r = fs.ratio()
        if r >= 0.78:
            cands.append((r, c))
    if not cands:
        continue
    cands.sort(key=lambda x: (-x[0], -len(n(x[1]['truth']))))
    r, c = cands[0]
    res[tid] = {'sim': round(r, 3), 'file': c['f'], 'cand_title': c['title'],
                'old': o['truth'], 'new': c['truth']}
    print('%-20s 《%s》 sim=%.2f (%s)《%s》 %d→%d' % (
        tid, o['title'], r, c['f'].split('/')[-1], c['title'][:14], len(o['truth']), len(c['truth'])))
    print('    新底: %s' % n(c['truth'])[:190])
    print('    旧底尾: …%s' % ot[-26:])
    print()
json.dump(res, io.open('tools/checkup_20260928/backfill2.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('可补全:', len(res))
