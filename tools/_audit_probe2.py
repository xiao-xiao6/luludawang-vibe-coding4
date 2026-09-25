# -*- coding: utf-8 -*-
import json, io, re
src = io.open(r'js\library.public.js', encoding='utf-8').read()
i = src.find('var SOUP_LIBRARY'); i = src.find('[', i)
data, _ = json.JSONDecoder().raw_decode(src[i:])
PUNCT = re.compile(r"[^0-9A-Za-z\u4e00-\u9fff]")
def norm(s): return PUNCT.sub('', s)
def bg(s): return set(s[k:k+2] for k in range(len(s)-1)) if len(s)>=2 else set()
def jac(a,b): return len(a&b)/len(a|b) if a and b else 0
def cont(a,b): return len(a&b)/min(len(a),len(b)) if a and b else 0

huo = [e for e in data if '火柴' in norm(e.get('surface','')) or '火柴' in norm(e.get('truth',''))]
print('match-family entries:', len(huo))
for a in range(len(huo)):
    for b in range(a+1, len(huo)):
        sa, sb = norm(huo[a]['surface']), norm(huo[b]['surface'])
        ta, tb = norm(huo[a]['truth']), norm(huo[b]['truth'])
        js, cs = jac(bg(sa),bg(sb)), cont(bg(sa),bg(sb))
        jt, ct = jac(bg(ta),bg(tb)), cont(bg(ta),bg(tb))
        if max(js,cs,jt,ct) > 0.30:
            print('%s|%s  %s|%s  S j%.2f c%.2f  T j%.2f c%.2f' % (
                huo[a]['id'][-6:], huo[a].get('dispTitle','')[:12],
                huo[b]['id'][-6:], huo[b].get('dispTitle','')[:12], js, cs, jt, ct))

# also probe the mega-cluster: what does it link
ids = set(e['id'] for e in huo)
