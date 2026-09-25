# -*- coding: utf-8 -*-
"""
深海汤屋 · 去重簇重算（校准版，只读）
修正复检报告里英文题被模板句链成巨型簇的 bug。
边规则：
  E1 归一化汤面完全相同
  E2 归一化汤底完全相同且长度>=15
  E3 全文 TF-IDF 余弦 >= 0.72（双方均为中文）/ >= 0.85（任一方为英文）
  E4 中文：余弦>=0.30 且共享稀有词(DF<=8 纯中文二元)>=5
  E5 同名标题（剥编号前缀）且中文且(余弦>=0.30 或 稀有>=3)
输出 tools/dedup_clusters_calibrated.json
"""
import io, re, json, math
from collections import Counter, defaultdict
from zhconv import convert as zc

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
src = io.open(ROOT + r"\data\library\library.data.js", encoding="utf-8").read()
i = src.find("var SOUP_LIBRARY"); i = src.find("[", i)
end = src.find("\nvar SOUP_LIB_CATS", i)
data = json.loads(src[i:end].rsplit("]", 1)[0] + "]")
N = len(data)

PUNCT = re.compile(r"[\s\u3000，。、！？；：·…—－\-_,\.\!\?\;:\"'“”‘’（）()\[\]【】《》<>{}|/\\~`@#$%^&*+=「」『』]")
def norm(s):
    return PUNCT.sub("", zc(s or "", "zh-hans"))
def bg(s): return set(s[k:k+2] for k in range(len(s)-1)) if len(s)>=2 else (set([s]) if s else set())
def is_en(s):
    lat=sum(1 for ch in s if ch.isascii() and ch.isalpha()); cjk=sum(1 for ch in s if "\u4e00"<=ch<="\u9fff")
    return lat>0 and lat>=cjk*2

def clean_title(e):
    t = (e.get("title") or e.get("dispTitle") or "").strip()
    t = re.sub(r"^\d+\s*[·.、]\s*", "", t)
    return norm(t)

nsurf=[norm(e.get("surface","")) for e in data]
nbot=[norm(e.get("truth","")) for e in data]
comb=[a+"#"+b for a,b in zip(nsurf,nbot)]
en=[is_en(e.get("surface","")+" "+e.get("truth","")) for e in data]

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

edges=set()
# E1 / E2
for key,arr,tag in (("S",nsurf,"E1"),("T",nbot,"E2")):
    g=defaultdict(list)
    for k,s in enumerate(arr):
        if len(s)>=(15 if tag=="E2" else 8): g[s].append(k)
    for s,lst in g.items():
        for a in range(len(lst)):
            for b in range(a+1,len(lst)): edges.add((lst[a],lst[b]))
# candidate pairs via rare grams + surface grams
cand=set()
inv=defaultdict(list)
for k,r in enumerate(rare):
    for x in r: inv[x].append(k)
for x,lst in inv.items():
    if len(lst)>60: continue
    for a in range(len(lst)):
        for b in range(a+1,len(lst)): cand.add((lst[a],lst[b]))
# candidate via comb grams for cos (skip super common grams)
inv2=defaultdict(list)
for k,c in enumerate(tv):
    for g in c:
        if df[g]<=60: inv2[g].append(k)
for g,lst in inv2.items():
    if len(lst)>60: continue
    for a in range(len(lst)):
        for b in range(a+1,len(lst)): cand.add((lst[a],lst[b]))
# title candidates
tg=defaultdict(list)
for k,e in enumerate(data):
    t=clean_title(e)
    if len(t)>=2 and not re.match(r"^(无题|jed|misc)", t): tg[t].append(k)
for t,lst in tg.items():
    if len(lst)>20: continue
    for a in range(len(lst)):
        for b in range(a+1,len(lst)): cand.add((lst[a],lst[b]))

pairshare=Counter()
for x,lst in inv.items():
    if len(lst)>60: continue
    for a in range(len(lst)):
        for b in range(a+1,len(lst)): pairshare[(lst[a],lst[b])]+=1

reasons=defaultdict(list)
for (a,b) in cand:
    if a==b: continue
    c=cos(a,b)
    r=pairshare.get((a,b),0)
    hit=None
    if en[a] or en[b]:
        if c>=0.85: hit="E3en"
    else:
        if c>=0.72: hit="E3"
        elif c>=0.30 and r>=5: hit="E4"
    if not hit and clean_title(data[a])==clean_title(data[b]) and clean_title(data[a]) and not (en[a] or en[b]) and (c>=0.45 or r>=5):
        hit="E5"
    if hit:
        edges.add((min(a,b),max(a,b)))
        reasons[(min(a,b),max(a,b))].append("%s@%.2f/%d" % (hit,c,r))

# union-find
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
clusters=[v for v in groups.values() if len(v)>1]
clusters.sort(key=lambda c:-len(c))

# keep selection score
BAD_IDS=set()  # filled from recheck report true-contamination list
rep=json.load(io.open(ROOT+r"\tools\audit_recheck_20260925_report.json",encoding="utf-8"))
taint_hard={"lib_df556d06686a","lib_f814c03d1664","lib_d17e476aeabd","lib_1245207e575c","lib_2a1ddcd0a374",
 "lib_e17a195e10d0","lib_7a306afeee05"}
zhu=[r["id"] for r in rep["contaminated"] if any(f[1]=="junk_repeat" and "------" in "".join(f[2] for f in r["flags"]) or "zhuqingxu" in r["title"] for f in r["flags"])]
zhu=[r["id"] for r in rep["contaminated"] if "zhuqingxu" in r["title"]]
taint_hard.update(zhu)
def score(k):
    e=data[k]; s=0
    t=(e.get("title") or "").strip()
    if t and not re.match(r"^(无题|Jed|misc|\d+\s*[·.、])",t) and not re.match(r"^\d",t): s+=10
    if e.get("id") in taint_hard: s-=50
    if en[k]: s-=8
    if zc(t+e.get("surface","")+e.get("truth",""),'zh-hans')!=(t+e.get("surface","")+e.get("truth","")): s-=4
    if (e.get("cats") or ["其他"])!=["其他"]: s+=3
    L=len(nbot[k]); s+= 3 if 30<=L<=500 else (1 if L>500 else -2)
    if e.get("src","").startswith("haiguitang"): s+=2
    return s

out=[]
removable=0
for c in clusters:
    c2=sorted(c,key=score,reverse=True)
    keep=c2[0]; drop=c2[1:]
    removable+=len(drop)
    out.append({"keep":data[keep]["id"],"keep_title":data[keep].get("title") or data[keep].get("dispTitle"),
                "size":len(c),"drop":[{"id":data[k]["id"],"title":(data[k].get("title") or data[k].get("dispTitle") or "")[:20],
                "surface":data[k]["surface"][:40]} for k in drop],
                "edges":[reasons.get((min(a,b),max(a,b)),[]) for ai,a in enumerate(c) for b in c[ai+1:]]})
io.open(ROOT+r"\tools\dedup_clusters_calibrated.json","w",encoding="utf-8").write(json.dumps({
    "N":N,"clusters":out,"n_clusters":len(clusters),"involved":sum(len(c) for c in clusters),"removable":removable,
    "en_count":sum(1 for x in en if x)},ensure_ascii=False,indent=1))
print("N=%d clusters=%d involved=%d removable=%d en=%d" % (N,len(clusters),sum(len(c) for c in clusters),removable,sum(1 for x in en if x)))
for o in out[:15]:
    print("[size %d] keep=%s(%s)" % (o["size"],o["keep"][:16],o["keep_title"][:14]))
    for d in o["drop"][:6]:
        print("    drop %s | %s | %s" % (d["id"][4:12], d["title"], d["surface"]))
