# -*- coding: utf-8 -*-
import io, sys, re, codecs
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
h = open(r'_tmp_threads.html', encoding='utf-8', errors='replace').read()
# decode any \uXXXX sequences globally
def dec(m):
    return chr(int(m.group(1), 16))
t = re.sub(r'\\u([0-9a-fA-F]{4})', dec, h)
# find contexts around 邮/郵票 to see replies
for kw in ['邮票', '郵票']:
    ms = list(re.finditer(kw, t))
    print(kw, len(ms))
    seen = set()
    for m in ms:
        i = m.start()
        seg = re.sub(r'\s+', ' ', t[max(0, i-250):i+600])
        key = seg[:80]
        if key in seen: continue
        seen.add(key)
        print('  >>', seg[:500])
        print()
