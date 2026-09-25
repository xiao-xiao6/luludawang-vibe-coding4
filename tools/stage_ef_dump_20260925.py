# -*- coding: utf-8 -*-
"""导出：①英文题（分字段标记）②无题题 ③顺手删除 Jed1.74 孪生之一"""
import io, json, re

MASTER = r'data\library\library.data.js'
src = io.open(MASTER, encoding='utf-8').read()
head = src[:src.find('var SOUP_LIBRARY')]
i = src.find('var SOUP_LIBRARY'); i = src.find('[', i)
end = src.find('\nvar SOUP_LIB_CATS', i)
tail = src[end:]
data = json.loads(src[i:end].rsplit(']', 1)[0] + ']')

# 删除重复的 Jed 1.74（保留题面更完整的 9ab11870482d）
data = [e for e in data if e['id'] != 'lib_97994180fa32']

def lat_cjk(s):
    lat = sum(1 for ch in s if ch.isascii() and ch.isalpha())
    cjk = sum(1 for ch in s if '\u4e00' <= ch <= '\u9fff')
    return lat, cjk

def en_field(s):
    lat, cjk = lat_cjk(s)
    return lat > 0 and lat >= cjk * 2

def untitled(e):
    t = (e.get('title') or '').strip()
    return (not t) or t.startswith('无题') or bool(re.match(r'^(Jed|misc)\b', t, re.I))

en_list = []
for e in data:
    if en_field(e['surface']) or en_field(e['truth']):
        en_list.append({'id': e['id'], 's_en': en_field(e['surface']), 't_en': en_field(e['truth']),
                        'title': e.get('title') or '', 'surface': e['surface'], 'truth': e['truth']})
ut_list = []
for e in data:
    if untitled(e):
        ut_list.append({'id': e['id'], 'surface': e['surface'][:120], 'truth': e['truth'][:160]})
io.open(r'tools\en_dump.json', 'w', encoding='utf-8').write(json.dumps(en_list, ensure_ascii=False, indent=1))
io.open(r'tools\untitled_dump.json', 'w', encoding='utf-8').write(json.dumps(ut_list, ensure_ascii=False, indent=1))
body = head + 'var SOUP_LIBRARY = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';' + tail
io.open(MASTER, 'w', encoding='utf-8').write(body)
print('master=%d  en=%d  untitled=%d' % (len(data), len(en_list), len(ut_list)))
