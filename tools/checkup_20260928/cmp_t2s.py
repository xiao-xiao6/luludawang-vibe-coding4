# -*- coding: utf-8 -*-
"""体检 C：繁译简 436 题逐条对照原文（train_8k / test_1.5k）。

判定口径：把繁体原文做 t2s 转换 + 标点归一后，与站内简体文本做字符级 diff。
- 完全一致            -> OK
- 站内更短 / 有缺字    -> 少翻、漏翻
- 站内多出的片段       -> 加戏或污染
- 大段不一致           -> 疑似错翻（需要人工看）
"""
import json, io, re, difflib, collections
from opencc import OpenCC

cc = OpenCC('t2s')
PUNC = {'「': '“', '」': '”', '『': '‘', '』': '’', '（': '(', '）': ')',
        '［': '(', '］': ')', '｛': '{', '｝': '}', '【': '[', '】': ']',
        '！': '!', '？': '?', '：': ':', '；': ';', '，': ',', '。': '.',
        '、': ',', '…': '.', '—': '-', '－': '-', '．': '.', '％': '%',
        '～': '~', '~': '-', '“': '"', '”': '"', '‘': "'", '’': "'",
        '＂': '"', '　': '', ' ': '', '\t': '', '\n': '', '\u3000': '',
        '＝': '=', '×': 'x', '＃': '#', '＋': '+', '／': '/', '＇': "'",
        '･': '.', '‧': '.', '·': '.', '●': '', '○': '', '◆': '', '◇': '',
        '■': '', '□': '', '☆': '', '★': '', '─': '-', '‐': '-', '‑': '-',
        '﹑': ',', '﹔': ';', '﹕': ':', '﹖': '?', '﹗': '!', '〈': '<', '〉': '>'}

def norm(t):
    t = cc.convert(t or '')
    out = []
    idx = []
    for i, ch in enumerate(t):
        ch = PUNC.get(ch, ch)
        if ch in '!"\'(),{}[]<>-=:;,.?+%/*x':
            continue
        out.append(ch)
        idx.append(i)
    return ''.join(out), (t, idx)

A = json.load(io.open('tools/checkup_20260928/all.json', encoding='utf-8'))
tr = json.load(io.open(r'D:\Downloads\train_8k.json', encoding='utf-8'))
te = json.load(io.open(r'D:\Downloads\test_1.5k.json', encoding='utf-8'))
D = {'dataset:train_8k': {x['id']: x for x in tr}, 'dataset:test_1.5k': {x['id']: x for x in te}}

stats = collections.Counter()
rows = []
for o in A:
    if o['src'] not in D:
        continue
    r = D[o['src']].get(o['srcNo'])
    if not r:
        stats['no_original'] += 1
        continue
    pairs = [('title', o['title'], r['title']), ('surface', o['surface'], r['surface']),
             ('truth', o['truth'], r['bottom'])]
    for field, mine, orig in pairs:
        nm, (cm, im) = norm(mine)
        no, (co, io_) = norm(orig)
        if nm == no:
            stats[field + '_exact'] += 1
            continue
        sm = difflib.SequenceMatcher(None, no, nm, autojunk=False)
        ratio = sm.ratio()
        diff_kinds = []
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            # i→原文（繁体归一后），j→站内；展示用未归一的原串切片
            oraw = orig[io_[i1]:io_[i2 - 1] + 1] if i2 > i1 else ''
            mraw = mine[im[j1]:im[j2 - 1] + 1] if j2 > j1 else ''
            if tag == 'delete':
                diff_kinds.append('漏:%s' % oraw[:20])
            elif tag == 'insert':
                diff_kinds.append('多:%s' % mraw[:20])
            elif tag == 'replace':
                diff_kinds.append('换:%s→%s' % (oraw[:20], mraw[:20]))
        stats[field + '_diff' if ratio < 0.995 else field + '_minor'] += 1
        # 分类：繁简一字多形（opencc 保守不转）与纯标点差异不算问题
        AMBIG = set('著后里面钟余愿乾髮採沈涵遊廻遠' )
        def is_variant(a, b):
            a, b = a.strip('「」『』“”‘’（）()<>《》 　'), b.strip('「」『』“”‘’（）()<>《》 　')
            if a == b == '':
                return True
            if len(a) == 1 and len(b) == 1 and (a in AMBIG or b in AMBIG or cc.convert(a) == b):
                return True
            return a != '' and b != '' and cc.convert(a) == b and len(a) == len(b)
        kinds = []
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag == 'equal':
                continue
            oraw = orig[io_[i1]:io_[i2 - 1] + 1] if i2 > i1 else ''
            mraw = mine[im[j1]:im[j2 - 1] + 1] if j2 > j1 else ''
            if tag == 'delete':
                kinds.append(('漏', oraw, '', is_variant(oraw, '')))
            elif tag == 'insert':
                kinds.append(('多', '', mraw, is_variant('', mraw)))
            else:
                kinds.append(('换', oraw, mraw, is_variant(oraw, mraw)))
        real = [k for k in kinds if not k[3]]
        stats['real_' + field if real else 'variantonly_' + field] += 1
        if real:
            rows.append({'id': o['id'], 'src': o['src'], 'srcNo': o['srcNo'], 'field': field,
                         'ratio': round(ratio, 4), 'len_site': len(nm), 'len_orig': len(no),
                         'title': o['title'], 'site': (mine or '')[:400],
                         'orig': (orig or '')[:400],
                         'diff': ['%s[%s→%s]' % (t, a, b) for t, a, b, _ in real]})

json.dump(rows, io.open('tools/checkup_20260928/t2s_diff.json', 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
print('统计:', dict(stats))
print('待看条目:', len(rows))
by = collections.Counter((r['field'], r['src']) for r in rows)
print(by.most_common(20))
worst = sorted(rows, key=lambda r: r['ratio'])[:12]
with io.open('tools/checkup_20260928/t2s_diff.txt', 'w', encoding='utf-8') as f:
    for r in sorted(rows, key=lambda r: r['ratio']):
        f.write('==== %s %s/%s ratio=%.4f len(站内)=%d len(原文)=%d 《%s》\n' % (
            r['id'], r['src'], r['srcNo'], r['ratio'], r['len_site'], r['len_orig'], r['title']))
        f.write('  站内: %s\n  原文: %s\n  差异: %s\n\n' % (
            r['site'].replace('\n', '⏎'), r['orig'].replace('\n', '⏎'), ' | '.join(r['diff'][:8])))
print('written t2s_diff.txt')
print('\n--- 最差的 12 条 ---')
for r in worst:
    print('%s %s ratio=%.4f %s' % (r['id'], r['field'], r['ratio'], ' | '.join(r['diff'][:3])))
