# -*- coding: utf-8 -*-
import io, sys, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
h = open(r'_tmp_threads.html', encoding='utf-8', errors='replace').read()

def esc(s):
    return ''.join('\\' + 'u%04x' % ord(c) for c in s)

for kw in ['答案', '湯底', '其实', '揭曉', '揭晓']:
    e = esc(kw)
    ms = list(re.finditer(re.escape(e), h))
    print(kw, len(ms))
    for m in ms[:8]:
        i = m.start()
        seg = h[max(0, i - 150):i + 900]
        try:
            dec = seg.encode('latin1', 'ignore').decode('unicode_escape', 'ignore')
        except Exception:
            dec = seg
        print('  >>', re.sub(r'\s+', ' ', dec)[:400])
        print()
