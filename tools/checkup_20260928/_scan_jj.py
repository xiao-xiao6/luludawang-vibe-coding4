# -*- coding: utf-8 -*-
import io, sys, re, html
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
for f, enc in [('_tmp_jj.html', 'utf-8'), ('_tmp_pix.html', 'utf-8')]:
    h = open(f, encoding=enc, errors='replace').read()
    t = re.sub(r'<(script|style).*?</\1>', '', h, flags=re.S)
    t = html.unescape(re.sub(r'<[^>]+>', '\n', t))
    t = re.sub(r'\n{2,}', '\n', t)
    tt = re.sub(r'\s+', ' ', t)
    print('#####', f, len(tt))
    for kw in ['郵票', '邮票', '包裹']:
        ms = list(re.finditer(kw, tt))
        print(kw, len(ms))
        for m in ms[:4]:
            print('  >>', tt[max(0, m.start() - 200):m.start() + 500][:600])
            print()
