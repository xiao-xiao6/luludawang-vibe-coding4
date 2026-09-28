# -*- coding: utf-8 -*-
import io, sys, re, html, glob
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
for f in sys.argv[1:]:
    h = open(f, encoding='utf-8', errors='replace').read()
    t = re.sub(r'<(script|style).*?</\1>', '', h, flags=re.S)
    t = html.unescape(re.sub(r'<[^>]+>', '\n', t))
    tt = re.sub(r'\s+', ' ', t)
    print('#####', f, len(tt))
    for kw in ['猜拳', '石头', '剪刀', '婆婆', '舅舅', '日记', '敲门', '广播']:
        ms = list(re.finditer(kw, tt))
        if ms:
            print('==', kw, len(ms))
            for m in ms[:2]:
                print('   ', tt[max(0, m.start() - 120):m.start() + 350][:430])
