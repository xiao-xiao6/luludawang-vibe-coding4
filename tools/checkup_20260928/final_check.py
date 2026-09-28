# -*- coding: utf-8 -*-
"""收尾核对：还剩下哪些“汤底句中结束”的题（真截断），以及全库体量。"""
import json, io, re

A = json.load(io.open('tools/checkup_20260928/all.json', encoding='utf-8'))
FIN = '。！？…”』）)】>》…*!'


def bare(t):
    return bool(t) and t[-1] not in FIN and re.match(r'[一-鿿]', t[-1])


rows = [o for o in A if bare(o['truth'])]
print('汤库条目数: %d（精品 100 + 汤库 %d）' % (len(A), sum(1 for o in A if o['tier'] == 'library')))
print('汤底仍疑似截断: %d 题' % len(rows))
for o in rows:
    print('  %-20s《%s》%s …%s' % (o['id'], o['title'][:12], o['src'][:14], o['truth'][-26:].replace('\n', '⏎')))
