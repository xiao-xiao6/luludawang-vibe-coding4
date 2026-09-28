# -*- coding: utf-8 -*-
"""对仍在本地找不到完整版的截断题，用低阈值在繁体数据集(9456) + 全本地池里模糊搜。"""
import json, io, re, sys, difflib

sys.path.insert(0, 'tools/checkup_20260928')
from recovery import POOL, A, n  # 复用已加载的候选池

def top(tid, k=3):
    o = A[tid]
    os_, ot = n(o['surface']), n(o['truth'])
    scored = []
    for c in POOL:
        if c['id'] == tid or len(c['truth']) < max(10, len(ot) // 2):
            continue
        cs, ct = n(c['surface']), n(c['truth'])
        fs = difflib.SequenceMatcher(None, os_, cs, autojunk=False).quick_ratio()
        if fs < 0.55:
            fs = 0
        ft = difflib.SequenceMatcher(None, ot, ct, autojunk=False).quick_ratio()
        if ft < 0.5:
            ft = 0
        best = max(fs, ft)
        if best > 0.5:
            scored.append((round(best, 3), c))
    scored.sort(key=lambda x: (-x[0], -len(x[1]['truth'])))
    return o, scored[:k]

for tid in sys.argv[1:]:
    o, sc = top(tid)
    print('\n#### %s 《%s》 站内底%d字 …%s' % (tid, o['title'], len(o['truth']), n(o['truth'])[-24:]))
    if not sc:
        print('   无候选')
    for s, c in sc:
        print('   [%.2f] (%s)《%s》面%d/底%d' % (s, c['f'].split('/')[-1], c['title'], len(c['surface']), len(c['truth'])))
        print('     底: %s' % n(c['truth'])[:260])
