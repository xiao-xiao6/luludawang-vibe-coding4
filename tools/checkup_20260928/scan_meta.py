# -*- coding: utf-8 -*-
"""高精度的“源站脚手架/无关内容”扫描：只挑真正与谜题无关的段落。"""
import json, io, re, collections

ALL = json.load(io.open('tools/checkup_20260928/all.json', encoding='utf-8'))
FIELDS = ('title', 'surface', 'truth')

MARKERS = [
    ('GM_MANUAL', r'主持人手册|请主持人|本汤无上帝视角|主持人仅能|主持人为故事|主持人添加|主持人需按'),
    ('HOST_SIGNOFF', r'感谢各位参与|我是春雨|我是藤井|注册拉帖|拉帖拉帖服|今后请多关照'),
    ('IMAGE_CREDIT', r'图片来源|感谢 ?irasutoya|素材来源|图\s*片|icon'),
    ('URL', r'https?://|www\.|\.net/|\.jp/|\.com/'),
    ('REMAKE_CREDIT', r'重制原作|原作[:：]|参见补时投稿|投稿|致谢'),
    ('EXPLAIN_TAG', r'＜解说＞|<解说>|【解说】|〔解说〕|解说[:：]|解説'),
    ('ANSWER_TAG', r'【答案】|<答案>|答案[:：]\s*$'),
    ('TRANSLATE_NOTE', r'原文[:：]|原题[:：]|直译|意译|译注|译者|机翻|translation'),
    ('META_PS', r'(?:^|\n)\s*(?:ps|PS|P\.?S|附[:：]|备注|说明)[:：]'),
    ('MULTI_SOUP', r'故事[一二三四五六七八九十]\s*\n|汤面村|汤面[:：]\s*$|\n汤底[:：]'),
    ('VOTE_CTA', r'点赞|投币|收藏|关注|转发|三连|扫码'),
    ('SERIES_TAG', r'^【.{2,10}】'),
    ('OCR_NOISE', r'锟|烫烫|□{3,}|─{6,}|。{3,}|，{3,}'),
]

hits = collections.defaultdict(list)
rows = []
for o in ALL:
    for f in FIELDS:
        t = o.get(f) or ''
        for code, pat in MARKERS:
            for m in re.finditer(pat, t):
                s = max(0, m.start() - 30)
                frag = t[s:m.end() + 45].replace('\n', '\\n')
                rows.append((code, o['id'], f, o.get('src'), frag))
                hits[code].append(o['id'])

print('命中总数:', len(rows))
for code, _ in MARKERS:
    ids = set(hits.get(code, []))
    print('%-16s 处数=%3d 题数=%3d' % (code, sum(1 for r in rows if r[0] == code), len(ids)))

out = collections.defaultdict(list)
for code, id_, f, src, frag in rows:
    out[code].append({'id': id_, 'field': f, 'src': src, 'frag': frag})
json.dump(out, io.open('tools/checkup_20260928/meta_hits.json', 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)

for code, _ in MARKERS:
    if not out.get(code):
        continue
    print('\n======== %s ========' % code)
    seen = set()
    for r in out[code]:
        k = (r['id'], r['field'])
        if k in seen:
            continue
        seen.add(k)
        if len(seen) > 22:
            break
        print('%s %s | %s' % (r['id'][-8:], r['field'], r['frag']))
