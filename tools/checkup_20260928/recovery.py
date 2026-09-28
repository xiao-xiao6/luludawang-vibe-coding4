# -*- coding: utf-8 -*-
"""为需修复的题生成“找回候选”报告：按标题/汤面/汤底前缀在本地池里找同题的其他版本。"""
import json, io, os, re, sys

A = {o['id']: o for o in json.load(io.open('tools/checkup_20260928/all.json', encoding='utf-8'))}
CAND_FILES = ['data/library/soups.json', 'data/library/hold_ai_and_notruth.json',
              'data/library/truth_recovery.json', 'data/library/puzzle_drafts.json',
              'tools/untitled_dump.json', 'data/library/library.data.js',
              '_local_backup/library.data.js.stale-1361-precleanup-20260926',
              '_local_backup/library.data.js.bak-checkup',
              '_local_backup/library.data.js.bak-checkup2',
              '_local_backup/library.data.js.bak-checkup3',
              '_local_backup/library.data.js.bak-checkup4']

def load_items(p):
    try:
        raw = io.open(p, encoding='utf-8').read()
    except Exception:
        return []
    if p.endswith('.js'):
        m = re.search(r'var\s+(?:SOUP_LIBRARY|PUZZLES(?:_MORE)?)\s*=\s*', raw)
        if not m:
            return []
        try:
            obj, _ = json.JSONDecoder().raw_decode(raw[m.end():])
        except Exception:
            return []
        return obj if isinstance(obj, list) else []
    try:
        obj = json.loads(raw)
    except Exception:
        return []
    if isinstance(obj, list):
        return [x for x in obj if isinstance(x, dict)]
    out = []
    if isinstance(obj, dict):
        for v in obj.values():
            if isinstance(v, list):
                out.extend([x for x in v if isinstance(x, dict)])
    return out

POOL = []
for p in CAND_FILES:
    for x in load_items(p):
        t = x.get('truth') or x.get('bottom') or ''
        s = x.get('surface') or ''
        if t or s:
            POOL.append({'f': p, 'id': x.get('id'), 'title': x.get('title') or x.get('dispTitle') or '',
                         'surface': s, 'truth': t})

# 繁体数据集（9456 条）也纳入找回池：截断的简体汤底常能在繁体原文里找到完整版
from opencc import OpenCC
cc = OpenCC('t2s')
for p, tag in ((r'D:\Downloads\train_8k.json', 'dataset:train_8k'), (r'D:\Downloads\test_1.5k.json', 'dataset:test_1.5k')):
    for x in load_items(p):
        POOL.append({'f': tag, 'id': 'ds_%s_%s' % (tag[-8:], x.get('id')),
                     'title': cc.convert(x.get('title') or ''),
                     'surface': cc.convert(x.get('surface') or ''),
                     'truth': cc.convert(x.get('bottom') or '')})

def n(t):
    return re.sub(r'\s', '', t or '')

import difflib

def sim(a, b):
    if not a or not b:
        return 0.0
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    if sm.real_quick_ratio() < 0.6:
        return 0.0
    if sm.quick_ratio() < 0.6:
        return 0.0
    return sm.ratio()

def find(tid):
    o = A[tid]
    os_, ot, otit = n(o['surface']), n(o['truth']), n(o['title'])
    res = []
    for c in POOL:
        cs, ct, cn = n(c['surface']), n(c['truth']), n(c['title'])
        if len(c['truth']) < 6:
            continue
        fs, ft = sim(os_, cs), sim(ot[:220], ct[:220])
        title_hit = bool(otit and cn and (otit == cn or otit in cn or cn in otit))
        if max(fs, ft) < 0.62 and not (title_hit and max(fs, ft) > 0.4):
            continue
        res.append((round(max(fs, ft), 3), title_hit, c))
    res.sort(key=lambda x: (-x[0], -len(x[2]['truth'])))
    return res

if __name__ == '__main__':
    ids = sys.argv[1:]
    out = io.open('tools/checkup_20260928/recovery.txt', 'w', encoding='utf-8')
    for tid in ids:
        o = A[tid]
        out.write('\n######## %s 《%s》 src=%s\n' % (tid, o['title'], o['src']))
        out.write('  站内汤面(%d): %s\n' % (len(o['surface']), n(o['surface'])[:200]))
        out.write('  站内汤底(%d): %s\n' % (len(o['truth']), n(o['truth'])[:300]))
        for sc, th, c in [x for x in find(tid) if x[2]['id'] != tid][:5]:
            out.write('   --[匹配%.2f%s] (%s) 《%s》 面%d/底%d\n' % (
                sc, 'T' if th else '-', c['f'].split('/')[-1], c['title'], len(c['surface']), len(c['truth'])))
            out.write('      面: %s\n' % n(c['surface'])[:200])
            out.write('      底: %s\n' % n(c['truth'])[:600])
    out.close()
    print('written recovery.txt', os.path.getsize('tools/checkup_20260928/recovery.txt'))
