# -*- coding: utf-8 -*-
"""体检 B：汤题/汤面/汤底 匹配度启发式打分，产出待人工/语义复核的候选清单。"""
import json, io, re, math, collections, random

A = json.load(io.open('tools/checkup_20260928/all.json', encoding='utf-8'))

STOP = set('的了是在有和与就都而及或被把为我你他她它们这那之其以于对到从又也许一一不个中上下里')

def bigrams(t):
    t = re.sub(r'[\s，。、；：！？…—－·\-«»“”‘’「」『』【】（）()\[\]{}<>《》"\'’]', '', t or '')
    return set(t[i:i + 2] for i in range(len(t) - 1)), set(t)

def jac(a, b):
    if not a or not b:
        return 0.0
    return len(a & b) / float(len(a | b))

rows = []
for o in A:
    sb, sc = bigrams(o['surface'])
    tb, tc = bigrams(o['truth'])
    kb, kc = bigrams(o['title'])
    st = jac(sb, tb)                       # 汤面↔汤底 情节重合度
    tt = jac(kb, tb | sb)                  # 题名↔正文
    ctr = len(sc & tc) / float(max(1, len(sc)))   # 单字覆盖
    ltr = len(o['truth'] or '')
    lsf = len(o['surface'] or '')
    rows.append({'id': o['id'], 'tier': o['tier'], 'title': o['title'], 'src': o['src'],
                 'cats': o['cats'], 'st': round(st, 4), 'tt': round(tt, 4),
                 'ctr': round(ctr, 3), 'ltruth': ltr, 'lsurf': lsf,
                 'surface': o['surface'], 'truth': o['truth']})

vals = sorted(r['st'] for r in rows)
print('surface↔truth jaccard 分位: p1=%.4f p5=%.4f p10=%.4f median=%.4f' % (
    vals[int(len(vals) * .01)], vals[int(len(vals) * .05)],
    vals[int(len(vals) * .10)], vals[len(vals) // 2]))

flag = []
for r in rows:
    why = []
    if r['st'] < 0.055:
        why.append('LOW_ST=%.3f' % r['st'])
    if r['tt'] < 0.03 and r['ltruth'] > 40:
        why.append('TITLE_ORPHAN=%.3f' % r['tt'])
    if r['ltruth'] < 12:
        why.append('TRUTH_SHORT=%d' % r['ltruth'])
    if r['lsurf'] > 0 and r['ltruth'] > 0 and (r['ltruth'] < 25 and r['lsurf'] > 120):
        why.append('TINY_TRUTH')
    if why:
        flag.append((why, r))

flag.sort(key=lambda x: x[1]['st'])
json.dump([{'why': w, **r} for w, r in flag],
          io.open('tools/checkup_20260928/align_candidates.json', 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
print('候选 %d / %d' % (len(flag), len(rows)))

out = io.open('tools/checkup_20260928/align_candidates.txt', 'w', encoding='utf-8')
for w, r in flag:
    out.write('#### %s  %s  [%s] st=%.3f tt=%.3f lenT=%d\n' % (r['id'], r['title'], ','.join(w), r['st'], r['tt'], r['ltruth']))
    out.write('  SURF: %s\n' % r['surface'][:260].replace('\n', ' '))
    out.write('  TRUT: %s\n\n' % r['truth'][:320].replace('\n', ' '))
out.close()
print('written align_candidates.txt')
