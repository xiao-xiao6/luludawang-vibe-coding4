# -*- coding: utf-8 -*-
"""对截断/错配的题，在全本地原始备份里搜同题的其他版本（找更完整的汤底）。"""
import json, io, os, re, glob, sys

A = {o['id']: o for o in json.load(io.open('tools/checkup_20260928/all.json', encoding='utf-8'))}

CAND_FILES = [
    'data/library/soups.json',
    'data/library/hold_ai_and_notruth.json',
    'data/library/truth_recovery.json',
    'data/library/truth_recovery.json.bak-20260922-031452',
    'data/library/truth_recovery.json.bak2-20260922-031547',
    'data/library/truth_recovery_oldsite.json',
    'data/library/puzzle_drafts.json',
    'tools/untitled_dump.json',
    'tools/en_dump.json',
    'tools/llt_dump.json',
    'tools/yng_dump.json',
    'tools/checkup_all.json',
    '_local_backup/library.data.js.stale-1361-precleanup-20260926',
    '_local_backup/library.data.js.bak-checkup',
    '_local_backup/js-library.data.js.stale-1361-precleanup-20260926',
]

def load_items(p):
    try:
        raw = io.open(p, encoding='utf-8').read()
    except Exception:
        return []
    if p.endswith('.js'):
        m = re.search(r'var\s+(?:SOUP_LIBRARY|PUZZLES(?:_MORE)?)\s*=\s*', raw)
        if not m:
            return []
        raw = raw[m.end():]
        try:
            obj, _ = json.JSONDecoder().raw_decode(raw)
        except Exception:
            return []
        return obj if isinstance(obj, list) else []
    try:
        obj = json.loads(raw)
    except Exception:
        return []
    if isinstance(obj, list):
        return obj
    if isinstance(obj, dict):
        out = []
        for v in obj.values():
            if isinstance(v, list):
                out.extend([x for x in v if isinstance(x, dict)])
        return out
    return []

POOL = []
for p in CAND_FILES:
    if not os.path.exists(p):
        continue
    items = load_items(p)
    for x in items:
        if isinstance(x, dict) and (x.get('surface') or x.get('truth') or x.get('bottom')):
            POOL.append({'src_file': p, 'title': x.get('title') or x.get('dispTitle'),
                         'surface': x.get('surface') or '', 'truth': x.get('truth') or x.get('bottom') or '',
                         'id': x.get('id'), 'src': x.get('src'), 'srcNo': x.get('srcNo')})
print('本地备选题目池:', len(POOL))

targets = sys.argv[1:] or []
for tid in targets:
    o = A.get(tid)
    if not o:
        print('?? 未知 id', tid)
        continue
    key = (o['surface'] or '')[:16]
    print('\n######## %s 《%s》 src=%s 站内汤底长度=%d' % (tid, o['title'], o['src'], len(o['truth'] or '')))
    print('   站内汤底尾: …%s' % (o['truth'] or '')[-36:].replace('\n', '⏎'))
    seen = 0
    for c in POOL:
        if c['id'] == tid:
            continue
        s1, s2 = re.sub(r'\s', '', c['surface']), re.sub(r'\s', '', o['surface'])
        same = (key and key in c['surface']) or (s1 and s2 and (s1[:14] == s2[:14]))
        same_t = ((o['truth'] or '')[:14] and (o['truth'] or '')[:14] in c['truth'])
        if same or same_t:
            seen += 1
            if seen > 6:
                break
            print('   >>> 候选(%s) 《%s》 汤底长度=%d 尾: …%s' % (
                c['src_file'], c['title'], len(c['truth']), c['truth'][-46:].replace('\n', '⏎')))
    if not seen:
        print('   （本地无其他版本）')
