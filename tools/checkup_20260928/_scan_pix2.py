# -*- coding: utf-8 -*-
import io, sys, re, html
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
h = open('_tmp_pix.html', encoding='utf-8', errors='replace').read()
t = re.sub(r'<(script|style).*?</\1>', '', h, flags=re.S)
t = html.unescape(re.sub(r'<[^>]+>', '\n', t))
t = re.sub(r'\n{2,}', '\n', t)
tt = re.sub(r'[ \t]+', ' ', t)
for kw in ['猜拳', '拳', '石头', '石頭', '剪刀', '日记', '日記', '舅舅', ' oxygen', '氧']:
    ms = list(re.finditer(kw, tt))
    if ms:
        print('==', kw, len(ms))
        for m in ms[:3]:
            print(tt[max(0, m.start() - 150):m.start() + 400].replace('\n', ' ')[:450])
            print('---')
print('======FULL======')
print(tt[:200])
