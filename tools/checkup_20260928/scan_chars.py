# -*- coding: utf-8 -*-
"""2026-09-28 全库体检 · 第一步：字符层面的污染普查（只读，不改数据）。"""
import json, io, re, sys, unicodedata, collections

A = json.load(io.open('tools/checkup_20260928/all.json', encoding='utf-8'))
FIELDS = ('title', 'surface', 'truth')

# 1) 全字符频次，按 Unicode 区块归类
cnt = collections.Counter()
where = collections.defaultdict(set)
for o in A:
    for f in FIELDS:
        for ch in o.get(f) or '':
            cnt[ch] += 1
            where[ch].add((o['id'], f))

def bucket(ch):
    cp = ord(ch)
    if cp < 0x20 or cp == 0x7f: return 'control'
    if 0x80 <= cp <= 0x9f: return 'c1-control'
    if 0xa0 <= cp <= 0xbf: return 'latin1-punct'
    if 0x2000 <= cp <= 0x206f: return 'general-punct/zero-width'
    if 0x2190 <= cp <= 0x21ff: return 'arrows'
    if 0x2300 <= cp <= 0x27bf: return 'misc-symbols/dingbats'
    if 0x2b00 <= cp <= 0x2bff: return 'arrows-squares'
    if 0x3000 <= cp <= 0x303f: return 'cjk-punct'
    if 0x3040 <= cp <= 0x30ff: return 'kana'
    if 0x3400 <= cp <= 0x4dbf: return 'ext-a'
    if 0x4e00 <= cp <= 0x9fff: return 'cjk-uni'
    if 0xac00 <= cp <= 0xd7af: return 'hangul'
    if 0xf900 <= cp <= 0xfaff: return 'cjk-compat'
    if 0xfe00 <= cp <= 0xfe0f: return 'variation-selector'
    if 0xff00 <= cp <= 0xffef: return 'fullwidth'
    if 0x1f000 <= cp <= 0x1ffff: return 'emoji-astraling'
    if 0xe000 <= cp <= 0xf8ff: return 'private-use'
    if cp in (0x22, 0x27): return 'ascii-quote'
    if 0x20 <= cp <= 0x7e: return 'ascii'
    return 'other'

bb = collections.Counter()
for ch, n in cnt.items():
    bb[bucket(ch)] += n
print('=== 区块分布 ===')
for k, v in bb.most_common():
    print('%-24s %d' % (k, v))

print('\n=== 非 ASCII/中文/常规标点 的可疑字符（按出现次数） ===')
SUS_OK = set('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')
rows = []
for ch, n in cnt.items():
    b = bucket(ch)
    if b in ('cjk-uni', 'ascii', 'cjk-punct', 'fullwidth', 'ascii-quote', 'kana'):
        continue
    rows.append((n, b, ch, [hex(ord(ch))], len(where[ch])))
for n, b, ch, hp, ids in sorted(rows, reverse=True)[:120]:
    try:
        name = unicodedata.name(ch)
    except ValueError:
        name = '?'
    print('%6d  %-22s %-4s %-8s %s  涉及题数=%d' % (n, b, repr(ch), hp[0], name[:40], ids))
print('可疑字符种类合计:', len(rows))
