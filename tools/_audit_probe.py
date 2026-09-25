# -*- coding: utf-8 -*-
import json, io, re
from collections import Counter
d = json.load(io.open(r'tools\audit_full_20260925_report.json', encoding='utf-8'))
src = io.open(r'js\library.public.js', encoding='utf-8').read()
i = src.find('var SOUP_LIBRARY'); i = src.find('[', i)
data, _ = json.JSONDecoder().raw_decode(src[i:])
E = {e['id']: e for e in data}
PUNCT = re.compile(r"[^0-9A-Za-z\u4e00-\u9fff]")
def nlen(s): return len(PUNCT.sub('', s))

big = [c for c in d['clusters'] if c['size'] > 50]
print('big clusters:', [(c['size'], c['root']) for c in big])

tp = [p for p in d['strong_pairs'] if p['kind'] == 'truth']
short = [p for p in tp if min(nlen(E[p['a']]['truth']), nlen(E[p['b']]['truth'])) < 25]
print('truth pairs total', len(tp), '| with short side(<25):', len(short))
for p in short[:10]:
    print('  ', p['a'], repr(E[p['a']]['truth'][:38]), '||', p['b'], repr(E[p['b']]['truth'][:38]), 'ct', p['ct'])

sp = [p for p in d['strong_pairs'] if p['kind'] == 'surface']
short_s = [p for p in sp if min(nlen(E[p['a']]['surface']), nlen(E[p['b']]['surface'])) < 25]
print('surface pairs total', len(sp), '| with short side(<25):', len(short_s))
for p in short_s[:10]:
    print('  ', p['a'], repr(E[p['a']]['surface'][:38]), '||', p['b'], repr(E[p['b']]['surface'][:38]), 'cs', p['cs'])
