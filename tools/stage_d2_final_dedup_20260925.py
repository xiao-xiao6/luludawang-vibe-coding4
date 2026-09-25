# -*- coding: utf-8 -*-
"""
Stage D2：并入后的全库终检去重（只删新题 _t=="t2s"，不动老题）
边规则与校准版一致：E1/E2 完全相同、E3 余弦>=0.72（英文>=0.85）、E4 稀有指纹、E5 同名+中文
"""
import io, re, json, math
from collections import Counter, defaultdict
from zhconv import convert as zc

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
MASTER = ROOT + r"\data\library\library.data.js"
src = io.open(MASTER, encoding="utf-8").read()
head = src[:src.find("var SOUP_LIBRARY")]
i = src.find("var SOUP_LIBRARY"); i = src.find("[", i)
end = src.find("\nvar SOUP_LIB_CATS", i)
tail = src[end:]
data = json.loads(src[i:end].rsplit("]", 1)[0] + "]")
N = len(data)

PUNCT = re.compile(r"[\s\u3000，。、！？；：·…—－\-_,\.\!\?\;:\"'“”‘’（）()\[\]【】《》<>{}|/\\~`@#$%^&*+=「」『』]")
def norm(s): return PUNCT.sub("", zc(s or "", "zh-hans"))
def bg(s): return set(s[k:k+2] for k in range(len(s)-1)) if len(s)>=2 else (set([s]) if s else set())
def is_en(s):
    lat=sum(1 for ch in s if ch.isascii() and ch.isalpha()); cjk=sum(1 for ch in s if "\u4e00"<=ch<="\u9fff")
    return lat>0 and lat>=cjk*2

nsurf=[norm(e.get("surface","")) for e in data]
nbot=[norm(e.get("truth","")) for e in data]
comb=[a+"#"+b for a,b in zip(nsurf,nbot)]
en=[is_en(e.get("surface","")+" "+e.get("truth","")) for e in data]
new=[e.get("_t")=="t2s" for e in data]

tv=[Counter(bg(t)) for t in comb]
df=Counter()
for g in tv:
    for x in g: df[x]+=1
idf={g: math.log(N/(1+v)) for g,v in df.items()}
nrm=[math.sqrt(sum((v*idf.get(g,0))**2 for g,v in c.items())) for c in tv]
def cos(a,b):
    ca,cb=tv[a],tv[b]
    if len(ca)>len(cb): ca,cb=cb,ca
    s=sum(v*cb.get(g,0)*(idf.get(g,0)**2) for g,v in ca.items())
    return s/(nrm[a]*nrm[b]) if nrm[a] and nrm[b] else 0.0
rare=[set(x for x in bg(comb[k]) if df[x]<=8 and re.fullmatch(r"[\u4e00-\u9fff]{2}",x)) for k in range(N)]

def clean_title(e):
    t=(e.get("title") or "").strip()
    t=re.sub(r"^\d+\s*[·.、]\s*","",t)
    return norm(t)

# candidates
cand=set()
inv=defaultdict(list)
for k,r in enumerate(rare):
    for x in r: inv[x].append(k)
for x,lst in inv.items():
    if len(lst)>60: continue
    for a in range(len(lst)):
        for b in range(a+1,len(lst)): cand.add((lst[a],lst[b]))
inv2=defaultdict(list)
for k,c in enumerate(tv):
    for g in c:
        if df[g]<=60: inv2[g].append(k)
for g,lst in inv2.items():
    if len(lst)>60: continue
    for a in range(len(lst)):
        for b in range(a+1,len(lst)): cand.add((lst[a],lst[b]))
pairshare=Counter()
for x,lst in inv.items():
    if len(lst)>60: continue
    for a in range(len(lst)):
        for b in range(a+1,len(lst)): pairshare[(lst[a],lst[b])]+=1

edges=set()
for key,arr,ml in (("S",nsurf,8),("T",nbot,15)):
    g=defaultdict(list)
    for k,s in enumerate(arr):
        if len(s)>=ml: g[s].append(k)
    for s,lst in g.items():
        for a in range(len(lst)):
            for b in range(a+1,len(lst)): edges.add((lst[a],lst[b]))
for (a,b) in cand:
    if a==b: continue
    c=cos(a,b); r=pairshare.get((a,b),0)
    hit=False
    if en[a] or en[b]: hit = c>=0.85
    else: hit = c>=0.72 or (c>=0.30 and r>=5)
    if not hit and clean_title(data[a]) and clean_title(data[a])==clean_title(data[b]) and not (en[a] or en[b]) and (c>=0.45 or r>=5):
        hit=True
    if hit: edges.add((min(a,b),max(a,b)))

parent=list(range(N))
def find(x):
    while parent[x]!=x:
        parent[x]=parent[parent[x]]; x=parent[x]
    return x
for a,b in edges:
    ra,rb=find(a),find(b)
    if ra!=rb: parent[rb]=ra
groups=defaultdict(list)
for k in range(N): groups[find(k)].append(k)

drop=set()
for r,c in groups.items():
    if len(c)<2: continue
    olds=[k for k in c if not new[k]]
    news=[k for k in c if new[k]]
    if olds:
        for k in news: drop.add(k)      # 新题撞老题 → 删新
    else:
        best=max(c,key=lambda k:(len(nbot[k]), len(nsurf[k])))
        for k in c:
            if k!=best: drop.add(k)
    # 纯老题簇理论上不该存在（A 阶段已清），若出现只报告不删
removed=[{"id":data[k]["id"],"title":data[k].get("title"),"surface":data[k]["surface"][:40],"dup_with":[data[x]["id"] for x in groups[find(k)] if x!=k and x in (set(c)-drop)][:3]} for k in sorted(drop)]
old_old=[{"ids":[data[x]["id"] for x in c]} for c in groups.values() if len(c)>1 and all(not new[k] for k in c)]
data2=[e for k,e in enumerate(data) if k not in drop]
body=head+"var SOUP_LIBRARY = "+json.dumps(data2,ensure_ascii=False,separators=(",",":"))+";"+tail
io.open(MASTER,"w",encoding="utf-8").write(body)
io.open(ROOT+r"\tools\stage_d2_log.json","w",encoding="utf-8").write(json.dumps(
    {"before":N,"after":len(data2),"dropped_new":removed,"old_old_clusters":old_old},ensure_ascii=False,indent=1))
print("OK %d -> %d  dropped_new_dups=%d  old_old_clusters=%d" % (N,len(data2),len(removed),len(old_old)))
