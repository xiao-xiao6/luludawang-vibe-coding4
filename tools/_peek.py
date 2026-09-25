# -*- coding: utf-8 -*-
import io, json, re
src = io.open(r'data\library\library.data.js', encoding='utf-8').read()
i = src.find('var SOUP_LIBRARY'); i = src.find('[', i)
end = src.find('\nvar SOUP_LIB_CATS', i)
data = json.loads(src[i:end].rsplit(']', 1)[0] + ']')
byid = {e['id']: e for e in data}

cal = json.load(io.open(r'tools\dedup_clusters_calibrated.json', encoding='utf-8'))
for o in cal['clusters']:
    if any(d['id'] == 'lib_440544dff8ed' for d in o['drop']):
        k = byid[o['keep']]
        print('爱犬 cluster keep:', o['keep'], repr(k.get('title')))
        print('  面:', k['surface'][:80])
        print('  底:', k['truth'][:80])

print()
print('== 残留「著」扫描 ==')
for e in data:
    for f in ('title', 'surface', 'truth'):
        for m in re.finditer('著', e.get(f, '') or ''):
            s = max(0, m.start() - 6)
            print(e['id'], f, repr(e[f][s:m.start() + 7]))
