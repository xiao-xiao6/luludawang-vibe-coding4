# -*- coding: utf-8 -*-
"""在子代理留下的 GitHub 原库/网页缓存里，搜那 11 道截断/错配题的更完整版本。"""
import json, io, os, re, sys

sys.path.insert(0, 'tools/checkup_20260928')
from recovery import A, n

TARGETS = ['lib_05cbea68fd8f', 'lib_161809c5dbab', 'lib_43434f23746f', 'lib_60b7bf249d99',
           'lib_715c8134e625', 'lib_79d2875e016e', 'lib_a077de08c109', 'lib_c2f7a15f6c05',
           'lib_f7f8399079c1', 'lib_8d4f10ff2a9c', 'lib_d7bbd5509593']
ROOTS = ['tools/checkup_20260928/gh']
EXTRA = ['tools/checkup_20260928/' + f for f in os.listdir('tools/checkup_20260928')
         if f.startswith('_tmp')]

BLOB = {}
for r in ROOTS:
    for dirpath, _, files in os.walk(r):
        for fn in files:
            p = os.path.join(dirpath, fn)
            if os.path.getsize(p) > 12 * 1024 * 1024:
                continue
            try:
                BLOB[p] = io.open(p, encoding='utf-8', errors='ignore').read()
            except Exception:
                pass
for p in EXTRA:
    if os.path.isdir(p):
        continue
    if os.path.getsize(p) > 12 * 1024 * 1024:
        continue
    try:
        BLOB[p] = io.open(p, encoding='utf-8', errors='ignore').read()
    except Exception:
        pass
print('载入文件', len(BLOB))

def find_snip(text, keys):
    for k in keys:
        i = text.find(k)
        if i >= 0:
            return k, i
    return None, None

for tid in TARGETS:
    o = A[tid]
    ot = n(o['truth'])
    os_ = n(o['surface'])
    keys = []
    if len(ot) >= 10:
        keys += [ot[:10], ot[6:16], ot[-10:]]
    keys += [os_[:10]]
    keys = [k for k in dict.fromkeys(keys) if len(k) >= 8]
    hits = []
    for p, txt in BLOB.items():
        t = n(txt)
        for k in keys:
            if k in t:
                hits.append((p, k))
                break
    print('\n#### %s《%s》 %s 站内底%d字' % (tid, o['title'], o['src'][:16], len(o['truth'])))
    if not hits:
        print('   缓存里无命中')
    for p, k in hits[:6]:
        print('   命中 %s  关键词「%s」 文件大小%d' % (p, k, len(BLOB[p])))
