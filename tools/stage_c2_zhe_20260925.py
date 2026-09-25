# -*- coding: utf-8 -*-
"""Stage C2：修两个残留的「著」（助词）→「着」"""
import io, json
MASTER = r'data\library\library.data.js'
src = io.open(MASTER, encoding='utf-8').read()
i = src.find('var SOUP_LIBRARY'); i = src.find('[', i)
end = src.find('\nvar SOUP_LIB_CATS', i)
head = src[:src.find('var SOUP_LIBRARY')]
tail = src[end:]
data = json.loads(src[i:end].rsplit(']', 1)[0] + ']')
n = 0
for e in data:
    if e['id'] in ('lib_1b5f8818a812', 'lib_86ba85ac49fd'):
        s2 = e['surface'].replace('指著', '指着').replace('看著', '看着')
        if s2 != e['surface']:
            e['surface'] = s2; n += 1
io.open(MASTER, 'w', encoding='utf-8').write(head + 'var SOUP_LIBRARY = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';' + tail)
print('fixed', n)
