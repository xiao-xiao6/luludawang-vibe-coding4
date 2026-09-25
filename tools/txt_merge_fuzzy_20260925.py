# -*- coding: utf-8 -*-
"""缺失题二次校验：与项目 972 题做 TF-IDF 余弦 + 稀有词指纹，找出"疑似已存在(换写法)"的题"""
import io, re, json, math
from collections import defaultdict, Counter
from zhconv import convert as zconvert

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
PUNCT = re.compile(r"[\s\u3000，。、！？；：·…—－\-_,\.\!\?\;:\"'“”‘’（）()\[\]【】《》<>{}|/\\~`@#$%^&*+=「」『』]")
def norm(s):
    s = zconvert(s or "", "zh-hans"); s = PUNCT.sub("", s); return s
def bgl(s): return [s[k:k+2] for k in range(len(s)-1)] if len(s)>=2 else ([s] if s else [])
def bgs(s): return set(bgl(s))

def load_js_array(path, marker):
    s = io.open(path, encoding="utf-8").read()
    i = s.find(marker); i = s.find("[", i)
    return json.JSONDecoder().raw_decode(s[i:])[0]

proj = []
for fn, marker, layer in [("js\\data.js","var PUZZLES","精品"),("js\\data-more.js","var PUZZLES_MORE","精品"),("js\\library.public.js","var SOUP_LIBRARY","汤库")]:
    for e in load_js_array(ROOT+"\\"+fn, marker):
        proj.append({"layer":layer,"id":e.get("id","?"),"title":e.get("dispTitle") or e.get("title") or "",
                     "doc": norm(e.get("surface",""))+norm(e.get("truth",""))})

d = json.load(io.open(ROOT+r"\tools\txt_merge_check_20260925_report.json",encoding="utf-8"))
miss = d["missing"]
mdocs = [norm(p["surface"]) + norm(p["bottoms"][0]) for p in miss]

alldocs = [p["doc"] for p in proj] + mdocs
tf = [Counter(bgl(t)) for t in alldocs]
df = Counter()
for c in tf:
    for g in c: df[g]+=1
NP = len(alldocs)
IDF = {g: math.log(NP/(1+v)) for g,v in df.items()}
nrm = [math.sqrt(sum((v*IDF.get(g,0))**2 for g,v in c.items())) for c in tf]
def cos(a,b):
    ca,cb=tf[a],tf[b]
    if len(ca)>len(cb): ca,cb=cb,ca
    s=sum(v*cb.get(g,0)*(IDF.get(g,0)**2) for g,v in ca.items())
    return s/(nrm[a]*nrm[b]) if nrm[a] and nrm[b] else 0.0
# rare gram fingerprint
NPJ=len(proj)
rare_proj=[set(x for x in bgs(alldocs[k]) if df[x]<=10 and re.fullmatch(r"[\u4e00-\u9fff]{2}",x)) for k in range(NPJ)]
inv=defaultdict(list)
for k,r in enumerate(rare_proj):
    for x in r: inv[x].append(k)
idxmap=defaultdict(list)
for k in range(NPJ):
    for g in tf[k]:
        if IDF.get(g,0)>=2.0: idxmap[g].append(k)

results=[]
for j,mt in enumerate(mdocs):
    cj=Counter(bgl(mt))
    rj=set(x for x in bgs(mt) if df[x]<=10 and re.fullmatch(r"[\u4e00-\u9fff]{2}",x))
    cand=set()
    for g in cj:
        if IDF.get(g,0)>=2.0:
            for k in idxmap.get(g,[]): cand.add(k)
    best=(0,None); sh=(0,None)
    for k in cand:
        ca,cb=cj,tf[k]
        if len(ca)>len(cb): ca,cb=cb,ca
        s=sum(v*cb.get(g,0)*(IDF.get(g,0)**2) for g,v in ca.items())
        c=s/(nrm[NPJ+j]*nrm[k]) if nrm[NPJ+j] and nrm[k] else 0
        if c>best[0]: best=(c,proj[k])
        ov=len(rj & rare_proj[k])
        if ov>sh[0]: sh=(ov,proj[k])
    results.append({"surface":miss[j]["surface"],"title":miss[j]["title"],
                    "cos":round(best[0],3),"hit":best[1],"rare":sh[0],"hit_rare":sh[1]})

sus=[r for r in results if r["cos"]>=0.45 or r["rare"]>=8]
sus.sort(key=lambda r:-max(r["cos"], r["rare"]/100))
truly=[r for r in results if r not in sus]
print("missing total:", len(results))
print("suspected already-in-project (cos>=0.55 or rare>=12):", len(sus))
print("truly new:", len(truly))
print()
print("== suspected samples (top 40) ==")
for r in sus[:40]:
    h=r["hit"] or {"id":"?","title":"?","layer":"?"}
    print(" cos%.2f rare%3d | %s | %s -> %s %s" % (r["cos"],r["rare"],r["title"][:10],r["surface"][:26],h["layer"],h["title"][:14]))
json.dump({"suspect_existing":[{"surface":r["surface"],"title":r["title"],"cos":r["cos"],"rare":r["rare"],
            "hit_layer":(r["hit"] or {}).get("layer"),"hit_id":(r["hit"] or {}).get("id"),"hit_title":(r["hit"] or {}).get("title")} for r in sus],
           "truly_new":[{"surface":r["surface"],"title":r["title"]} for r in truly]},
          io.open(ROOT+r"\tools\txt_merge_check_20260925_fuzzy.json","w",encoding="utf-8"),ensure_ascii=False,indent=1)
