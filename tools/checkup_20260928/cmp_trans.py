# -*- coding: utf-8 -*-
"""体检 D：英译中 / 日译中 对照原文的机制层预扫描（漏翻残留、体量失衡、数字丢失）。"""
import json, io, re, collections

A = json.load(io.open('tools/checkup_20260928/all.json', encoding='utf-8'))
llt = {str(x['id']): x for x in json.load(io.open('tools/llt_dump.json', encoding='utf-8'))['items']}
yng = {str(x['id']): x for x in json.load(io.open('tools/yng_dump.json', encoding='utf-8'))['items']}
soups = json.load(io.open('data/library/soups.json', encoding='utf-8'))
raw_en = {}
for x in soups:
    if x.get('lang') == 'en' and x.get('src') in ('github:boop-yyt/situation_puzzle',
                                                  "Jed's List of Situation Puzzles (1999)", 'misc/repo-scan'):
        raw_en.setdefault((x['src'], x.get('srcNo')), x)

KANA = re.compile(r'[\u3040-\u30ff]{4,}')
KANJI_RUN = re.compile(r'[\u3040-\u30ff\u4e00-\u9fff]{12,}(?=[、。!?]|\u300c)')
NUM = re.compile(r'\d+(?:\.\d+)?')
JDATE = re.compile(r'(?:平成|昭和|令和|昭和|大正)\s*\d+')

def numset(t):
    return set(NUM.findall(t or ''))

rows = []
for o in A:
    if not ({'英译中', '日译中'} & set(o.get('cats') or [])):
        continue
    src, no = o.get('src'), str(o.get('srcNo'))
    orig = None
    if src == 'late-late.jp':
        orig = llt.get(no)
    elif src == 'yesnogame.net':
        orig = yng.get(no)
    elif (src, o.get('srcNo')) in raw_en:
        orig = raw_en[(src, o.get('srcNo'))]
    if not orig:
        rows.append({'id': o['id'], 'src': src, 'issue': 'NO_ORIGINAL', 'title': o['title']})
        continue
    feats = []
    for field, mine, theirs in (('surface', o['surface'], orig.get('surface')),
                                ('truth', o['truth'], orig.get('truth'))):
        if not theirs:
            continue
        lm, lt = len(mine or ''), len(re.sub(r'\s', '', theirs))
        if not lm:
            feats.append('%s:EMPTY' % field)
            continue
        is_ja = src == 'late-late.jp'
        ratio = lm / float(lt or 1)
        lo, hi = (0.45, 2.2) if is_ja else (0.14, 0.95)
        if ratio < lo:
            feats.append('%s:SHORT ratio=%.2f 站内%d/原文%d' % (field, ratio, lm, lt))
        elif ratio > hi:
            feats.append('%s:LONG ratio=%.2f 站内%d/原文%d' % (field, ratio, lm, lt))
        kana = KANA.findall(mine or '')
        if is_ja and kana:
            feats.append('%s:KANA_LEFT %s' % (field, ' / '.join(k[:22] for k in kana[:3])))
        # 数字丢失（原文有数字、站内没有）
        on, mn = numset(theirs), numset(mine)
        lost = on - mn
        if len(on) >= 2 and len(lost) >= max(2, len(on) // 2):
            feats.append('%s:NUM_LOST %s' % (field, ','.join(sorted(lost))[:40]))
    if feats:
        rows.append({'id': o['id'], 'src': src, 'srcNo': o.get('srcNo'), 'title': o['title'],
                     'feats': feats,
                     'surf': (o['surface'] or '')[:120], 'truth': (o['truth'] or '')[:120]})

json.dump(rows, io.open('tools/checkup_20260928/trans_pre.json', 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
print('译文预扫描待看:', len(rows))
c = collections.Counter()
for r in rows:
    for f in r.get('feats', []) or [r['issue']]:
        c[f.split(':')[0] if ':' in f else f] += 1
print(c.most_common())
for r in rows[:60]:
    print('%s %s %s | %s' % (r['id'], r['src'][:16], r.get('title', '')[:16], ' ‖ '.join(r.get('feats', []))))
