# -*- coding: utf-8 -*-
"""2026-09-28 全库体检 · 污染扫描（只读，输出带上下文的清单供逐条判定）。

用法: python tools/checkup_20260928/scan_pollution.py [--tier library|curated|all]
"""
import json, io, re, sys, argparse, collections

ALL = json.load(io.open('tools/checkup_20260928/all.json', encoding='utf-8'))
FIELDS = ('title', 'surface', 'truth')

# —— 允许的“非中文符号”白名单（题目本身需要，不算污染）——
ALLOWED_LATIN_TOKENS = {
    'a', 'an', 'b超', 'b超', 'b超', 'cd', 'dna', 'ppt', 'app', 'ai', 'boss', 'x光',
    'u盘', 'qq', 'we', 'tv', 'ktv', 'oled', 'vip', 'cm', 'mm', 'km', 'kg', 'ml', 'mg',
    'gdp', 'la', 'vs', 'no', 'yes', 'mr', 'mrs', 'ms', 'dr', 'pm', 'am', 'id',
    'a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7', 'x', 'y', 'z', 'n', 'v', 't', 's', 'p', 'q',
    'co2', 'h2o', 'ph', 'hr', 'ceo', 'ot', 'kpi', 'b站', 'a站', 'c位', 'vlog', 'wifi',
    'ps', 'cp', 'cpa', 'pua', 'diy', 'ip', 'ocr', 'json', 'utf', 'md5', 'yy', 'xx',
}

CTRL_RE = re.compile(r'[\x00-\x08\x0b-\x1f\x7f]')
ZW_RE = re.compile(r'[\u200b\u200c\u200d\u200e\u200f\ufeff\u2060\ufffc]')
MOJI_RE = re.compile(r'Ã[\x80-\xbf\xba-\xff]|â€|ï¼|锟斤拷|\ufffd|&#\d+;|\u25a1(?=\u25a1)')
HTML_RE = re.compile(r'<[a-zA-Z/!][^>]{0,40}>|&(?:amp|lt|gt|quot|nbsp|#\d+);')
MD_RE = re.compile(r'\*\*|~~|^#{1,6}\s|\]\(|(?<![A-Za-z0-9])`|^\s*[-*+]\s+', re.M)
BOILER_RE = re.compile(
    r'主持人|汤主说|楼主|层主|回复\s*\d+|点赞|投币|关注|扫码|公众号|资源|版权所有|©|出处[:：]'
    r'|答案\s*[:：]\s*$|解析\s*[:：]|备注\s*[:：]|未完待续|（完）$|第\s*\d+\s*页|目录'
    r'|https?://|www\.|\.com|\.jpg|\.png|\.gif|\bbaidu\b|百度百科|知乎|微博'
)
EMOJI_RE = re.compile(r'[\U0001F000-\U0001FAFF\u2B50\u2764\u2660-\u2667\u2665]')
DECOR_RE = re.compile(r'[\u2500-\u257f\u25a0-\u25ff\u2460-\u24ff\u25c7\u25c6\u25cb\u25cf\u25ef\u25d1]')
ODD_RE = re.compile(r'[\u0400-\u04FF\u0370-\u03FF\u2032\u2033]')  # 西里尔/希腊（多为 OCR 串字）
REPEAT_RE = re.compile(r'([。，、；：！？,.;:!?])\1{1,}|[…]{5,}|-{6,}|_{4,}|\.{4,}')
PLACEH_RE = re.compile(r'待补充|暂无汤底|（略）|\bTODO\b|\bXXX+\b|\?{2,}')
WS_RE = re.compile(r'\t| {2,}|(?<=[\u4e00-\u9fff，。！？；：、】）】])\s+(?=[\u4e00-\u9fff，。！？；：、【（])|^\s+|\s+$')
SPACE_BEFORE_PUNCT_RE = re.compile(r'\s+[，。！？；：、）】」』]')
CJK_SPACE_CJK = re.compile(r'[\u4e00-\u9fff]\s+[\u4e00-\u9fff]')
LATIN_RUN_RE = re.compile(r'[A-Za-z]{2,}')
HANGUL_RE = re.compile(r'[\uac00-\ud7af]')
KANA_RE = re.compile(r'[\u3040-\u30ff]')

PAIRS = [('“', '”'), ('‘', '’'), ('《', '》'), ('「', '」'), ('『', '』'),
         ('（', '）'), ('(', ')'), ('【', '】'), ('‘', '’')]
TERMINALS = '。！？…”）)】》」』'


def ctx(text, pos, w=28):
    return text[max(0, pos - w): pos].replace('\n', '\\n') + '⟪' + text[pos:pos + w].replace('\n', '\\n') + '⟫'


def scan_field(o, f, text):
    hits = []

    def add(code, pos, note=''):
        hits.append((code, ctx(text, pos), note))

    for label, rx in (('CTRL', CTRL_RE), ('ZERO_WIDTH', ZW_RE), ('MOJIBAKE', MOJI_RE),
                      ('HTML', HTML_RE), ('MARKDOWN', MD_RE), ('BOILERPLATE', BOILER_RE),
                      ('EMOJI', EMOJI_RE), ('DECOR', DECOR_RE), ('ODD_SCRIPT', ODD_RE),
                      ('HANGUL', HANGUL_RE), ('REPEAT_PUNCT', REPEAT_RE), ('PLACEHOLDER', PLACEH_RE),
                      ('TAB', re.compile(r'\t')), ('CJK_SPACE_CJK', CJK_SPACE_CJK),
                      ('SPACE_BEFORE_PUNCT', SPACE_BEFORE_PUNCT_RE)):
        for m in rx.finditer(text):
            add(label, m.start(), m.group()[:12])

    if text != text.strip():
        add('EDGE_SPACE', 0, repr(text[:6]) + '/' + repr(text[-6:]))
    if '\n' in text:
        add('NEWLINE', text.index('\n'), '共 %d 处' % text.count('\n'))

    # 拉丁串：不在白名单里的整词挑出来
    for m in LATIN_RUN_RE.finditer(text):
        w = m.group().lower()
        if w in ALLOWED_LATIN_TOKENS:
            continue
        if w in ('ovow',):
            continue
        add('LATIN_RUN', m.start(), m.group()[:20])

    # 引号/括号配对
    for a, b in PAIRS:
        ca, cb = text.count(a), text.count(b)
        if ca != cb:
            add('QUOTE_UNBALANCE', text.find(a), '%s%d/%s%d' % (a, ca, b, cb))

    # 疑似截断
    tail = text.rstrip()
    if f in ('surface', 'truth') and len(tail) > 12 and tail[-1] not in TERMINALS:
        if tail[-1] not in '0123456789':
            add('NO_END_PUNCT', max(0, len(text) - 12), tail[-24:])

    if f == 'title' and (len(text) > 24 or re.search(r'[。！？!?]', text)):
        add('TITLE_ODD', 0, text[:40])
    return hits


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tier', default='all')
    ap.add_argument('--out', default='tools/checkup_20260928/pollution.json')
    args = ap.parse_args()

    report = collections.defaultdict(list)
    items = []
    for o in ALL:
        if args.tier != 'all' and o['tier'] != args.tier:
            continue
        rec = []
        for f in FIELDS:
            t = o.get(f) or ''
            for code, snippet, note in scan_field(o, f, t):
                rec.append({'field': f, 'code': code, 'ctx': snippet, 'note': note})
                report[code].append('%s/%s' % (o['id'], f))
        if rec:
            items.append({'id': o['id'], 'tier': o['tier'], 'title': o.get('title'),
                          'src': o.get('src'), 'cats': o.get('cats'), 'hits': rec})

    json.dump(items, io.open(args.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(' flagged items: %d / %d' % (len(items), len(ALL)))
    print('=== 按规则汇总 ===')
    for k, v in sorted(report.items(), key=lambda x: -len(x[1])):
        print('%-18s %5d  例: %s' % (k, len(v), v[0]))


if __name__ == '__main__':
    main()
