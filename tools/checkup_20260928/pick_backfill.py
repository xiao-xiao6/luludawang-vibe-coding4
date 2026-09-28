# -*- coding: utf-8 -*-
"""挑定“截断汤底”的补全来源，生成 backfill_final.json（供 apply_fixes.py 使用）。"""
import json, io, re

S = []
for p in ['data/library/soups.json', 'data/library/hold_ai_and_notruth.json',
          'data/library/puzzle_drafts.json', 'tools/untitled_dump.json']:
    obj = json.load(io.open(p, encoding='utf-8'))
    if isinstance(obj, dict):
        for v in obj.values():
            if isinstance(v, list):
                S.extend([x for x in v if isinstance(x, dict)])
    else:
        S.extend([x for x in obj if isinstance(x, dict)])

# target_id -> 选择条件（按备份的 src/srcNo 或 title 精确命中）
PICK = {
    'lib_4a68dd74f870': {'title_like': 'KONpiGG #80'},
    'lib_4bb30df46863': {'title_like': 'KONpiGG #109'},
    'lib_672b157d1754': {'src': 'github:moxianbizi/haiguitang-php', 'srcNo': 910},
    'lib_749507623b5d': {'title_like': 'KONpiGG #98'},
    'lib_7cf2a178d34a': {'src': 'github:anchorAnc/astrbot_plugin_TurtleSoup', 'srcNo': 52},
    'lib_9654d2967355': {'src': 'haiguitang.top', 'srcNo': 724},
    'lib_ab7525f53ba2': {'title_like': 'KONpiGG #113'},
    'lib_e10fef909345': {'title_eq': '半瓶香水', 'min_len': 140},
    'lib_ff82650c1faa': {'title_like': 'KONpiGG #10', 'min_len': 150},
    'lib_d5f2eb839af6': {'title_eq': '消失的姐姐', 'min_len': 140},
    'lib_3fad9c3ff17b': {'title_like': '织梦者', 'min_len': 700},
}
A = {o['id']: o for o in json.load(io.open('tools/checkup_20260928/all.json', encoding='utf-8'))}
out = {}
for tid, spec in PICK.items():
    hits = []
    for x in S:
        t = x.get('title') or ''
        if 'title_like' in spec and spec['title_like'] not in t:
            continue
        if 'title_eq' in spec and t != spec['title_eq']:
            continue
        if 'src' in spec and x.get('src') != spec['src']:
            continue
        if 'srcNo' in spec and x.get('srcNo') != spec['srcNo']:
            continue
        tr = x.get('truth') or ''
        if len(tr) < spec.get('min_len', 100):
            continue
        hits.append(x)
    if not hits:
        print('!! 没找到', tid, spec)
        continue
    hits.sort(key=lambda x: -len(x.get('truth') or ''))
    c = hits[0]
    tr = re.sub(r'\s*\n\s*', '\n', (c.get('truth') or '').strip())
    out[tid] = {'truth': tr, 'from': '%s#%s《%s》' % (c.get('src'), c.get('srcNo'), c.get('title')),
                'old_len': len(A[tid]['truth']), 'new_len': len(tr)}
    print('%-20s %-14s %4d→%4d  来自 %s' % (tid, A[tid]['title'][:12], len(A[tid]['truth']), len(tr), out[tid]['from']))
    print('     尾: …%s' % tr[-42:].replace('\n', '⏎'))
    print('     头: %s…' % tr[:42].replace('\n', '⏎'))
json.dump(out, io.open('tools/checkup_20260928/backfill_final.json', 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
print('\n共', len(out))
