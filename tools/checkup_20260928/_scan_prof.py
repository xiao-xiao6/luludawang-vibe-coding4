# -*- coding: utf-8 -*-
import io, sys, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
h = open(r'_tmp_prof.html', encoding='utf-8', errors='replace').read()
t = re.sub(r'\\u([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), h)
for kw in ['郵票', '海龜湯']:
    ms = list(re.finditer(kw, t))
    print(kw, 'hits', len(ms))
seen = set()
for m in re.finditer('郵票', t):
    seg = re.sub(r'\s+', ' ', t[max(0, m.start() - 300):m.start() + 700])
    k = seg[:60]
    if k in seen:
        continue
    seen.add(k)
    print(seg[:600])
    print('---')
