# -*- coding: utf-8 -*-
"""汤底回收 v3 —— 全语料加强版
在 v2 基础上：
  1) 语料扩到 local-deploy / repos* / 全部 extracted*
  2) 增加 "question/answer" 中英文键、answerlist 等更多键位
  3) 增加 markdown 表格 / "汤面"无标签段落配对
  4) 记录未命中条目的 surface 长度分布，便于判断是否值得再挖
"""
import argparse, collections, glob, io, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
WS   = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace"

LIB = os.path.join(PROJ, "data", "library", "soups.json")
OUT = os.path.join(PROJ, "data", "library", "truth_recovery_v3.json")
REPORT = os.path.join(WS, "_soup-dev", "game-dev", "probe", "recover_report_v3.txt")

PUNCT = re.compile(r"""[\s，。！？、,.?!~·“”"'‘’「」『』（）()《》【】\[\]{}：:；;\-—_…/\\|+=*&^%$#@<>]""")
def norm(s):
    return PUNCT.sub("", str("" if s is None else s).lower())
def bigrams(k):
    return set(k[i:i+2] for i in range(len(k)-1))

Q_KEYS = ("surface","puzzle","question","汤面","题目","谜面","riddle","problem","story","prompt","q",
          "title","content")
A_KEYS = ("bottom","truth","answer","final_answer","solution","汤底","答案","谜底","explanation",
          "answertext","answer_text","reveal","result","a")

MAXF = 40*1024*1024
SKIP_DIRS = {"node_modules",".git","__pycache__","_backup","shots","shota_recheck",
             "_mole_review","_whack-audit","_box_isolation_20260919",".fetch"}
CORPUS = ["soup_db","extracted","extracted2","extracted3","extracted4","ghsearch","wayback",
          "rawpages","hgt_cache","net_api","top_api","hgt_crawl","local-deploy","repos",
          "repos2","repos3","repos4","_soup-dev"]

INDEX = {}
PREFIX40 = collections.defaultdict(set)
FUZZY_KEYS = []
INV = collections.defaultdict(list)

def add(q, a, src, how):
    if not isinstance(q, str) or not q.strip(): return False
    if isinstance(a, list):
        a = "\n".join(str(x) for x in a if isinstance(x, str))
    if not isinstance(a, str): return False
    k = norm(q)
    if len(k) < 12: return False
    a = re.sub(r"\s+", " ", a).strip()
    if len(a) < 10: return False
    if k in INDEX: return False
    INDEX[k] = (a, src, how)
    PREFIX40[k[:40]].add(k)
    if len(k) >= 24: FUZZY_KEYS.append(k)
    return True

def harvest_obj(obj, src, how, d=0):
    if d > 12: return
    if isinstance(obj, dict):
        q = None
        for k in Q_KEYS:
            v = obj.get(k)
            if isinstance(v, str) and len(v.strip()) >= 12: q = v; break
        a = None
        for k in A_KEYS:
            v = obj.get(k)
            if isinstance(v, str) and v.strip(): a = v; break
            if isinstance(v, list) and v and all(isinstance(x, str) for x in v):
                a = "\n".join(v); break
        if q and a: add(q, a, src, how)
        for v in obj.values(): harvest_obj(v, src, how, d+1)
    elif isinstance(obj, list):
        for v in obj: harvest_obj(v, src, how, d+1)

HEAD_RE = re.compile(r"^(\d+)\.(\d+)\.\s*(.*)$")
ANS_RE  = re.compile(r"^(\d+)\.(\d+)\s+answer:\s*(.*)$", re.I)

def parse_nm_text(text, src):
    puzzles, answers, cur, n = {}, {}, None, 0
    for raw in text.splitlines():
        line = raw.rstrip()
        m = ANS_RE.match(line)
        if m:
            cur = (m.group(1), m.group(2)); answers[cur] = [m.group(3).strip()]; continue
        m = HEAD_RE.match(line)
        if m:
            cur = None
            puzzles.setdefault((m.group(1), m.group(2)), []).append(m.group(3).strip()); continue
        if cur is not None:
            if line.strip(): answers[cur].append(line.strip())
        elif puzzles:
            last = list(puzzles.keys())[-1]
            if line.strip(): puzzles[last].append(line.strip())
    for key, ql in puzzles.items():
        if key in answers and add("\n".join(ql), "\n".join(answers[key]), src, "nm-text"): n += 1
    return n

PAIRS = [
    re.compile(r"汤面[：:]\s*(.{10,600}?)\s*汤底[：:]\s*(.{10,1500}?)(?=\s*(?:汤面[：:]|答案[：:]|题目[：:]|日期|阅\s?\d|$))", re.S),
    re.compile(r"【汤面】\s*(.{10,600}?)\s*【汤底】\s*(.{10,1500}?)(?=\s*(?:【汤面】|$))", re.S),
    re.compile(r"题目[：:]\s*(.{10,600}?)\s*答案[：:]\s*(.{10,1500}?)(?=\s*(?:题目[：:]|汤面[：:]|日期|阅\s?\d|$))", re.S),
    re.compile(r"谜面[：:]\s*(.{10,600}?)\s*答案[：:]\s*(.{10,1500}?)(?=\s*(?:谜面[：:]|$))", re.S),
    re.compile(r"(?:^|\n)#{1,4}\s*(.{6,80}?)\n+(.{10,600}?)\n+(?:汤底|答案|真相)[：:\s]*(.{10,1500}?)(?=\n#{1,4}\s|$)", re.S),
]

def strip_html(h):
    h = re.sub(r"<script.*?</script>", " ", h, flags=re.S|re.I)
    h = re.sub(r"<style.*?</style>", " ", h, flags=re.S|re.I)
    h = re.sub(r"<br\s*/?>", "\n", h, flags=re.I)
    h = re.sub(r"</(p|div|li|h[1-6]|section|td|tr)>", "\n", h, flags=re.I)
    h = re.sub(r"<[^>]+>", " ", h)
    for a,b in (("&nbsp;"," "),("&quot;",'"'),("&amp;","&"),("&lt;","<"),("&gt;",">"),
                ("&#39;","'"),("&#8221;",'"'),("&#8220;",'"')):
        h = h.replace(a,b)
    return re.sub(r"[ \t]+", " ", h)

def parse_html_pairs(raw, src):
    txt = re.sub(r"\n{2,}", "\n", strip_html(raw)); n = 0
    for i, pat in enumerate(PAIRS):
        for m in pat.finditer(txt):
            g = m.groups()
            if len(g) == 3:
                q = re.sub(r"\s+"," ", g[0]+" "+g[1]).strip(); a = re.sub(r"\s+"," ", g[2]).strip()
            else:
                q = re.sub(r"\s+"," ", g[0]).strip(); a = re.sub(r"\s+"," ", g[1]).strip()
            if add(q, a, src, "html-pair"): n += 1
    return n

def scan():
    st = collections.Counter()
    for t in CORPUS:
        root = os.path.join(WS, t)
        if not os.path.isdir(root): continue
        for dp, dns, fns in os.walk(root):
            dns[:] = [x for x in dns if x not in SKIP_DIRS]
            for fn in fns:
                low = fn.lower()
                if low.endswith(".puzzle.txt"): continue
                if not low.endswith((".json",".jsonl",".txt",".md",".html",".htm")): continue
                fp = os.path.join(dp, fn)
                try:
                    if os.path.getsize(fp) > MAXF: continue
                    txt = io.open(fp, encoding="utf-8", errors="replace").read()
                except Exception: continue
                rel = os.path.relpath(fp, WS); st["files"] += 1
                try:
                    if low.endswith(".jsonl"):
                        for line in txt.splitlines():
                            if line.strip():
                                try: harvest_obj(json.loads(line), rel, "jsonl")
                                except Exception: pass
                    elif low.endswith(".json"):
                        try: harvest_obj(json.loads(txt), rel, "json")
                        except Exception: pass
                    elif low.endswith((".html",".htm")):
                        if parse_html_pairs(txt, rel): st["html_files"] += 1
                    else:
                        if any(w in low for w in ("answer","puzzle","situation","soup","海龟","turtle","汤")):
                            parse_nm_text(txt, rel)
                except Exception: continue
    return st

def build_inv():
    for k in FUZZY_KEYS:
        for g in list(bigrams(k))[:80]:
            INV[g].append(k)

def lookup(surface):
    k = norm(surface)
    if k in INDEX:
        return INDEX[k][0], INDEX[k][1], INDEX[k][2], 1.0
    if len(k) >= 40:
        c = PREFIX40.get(k[:40])
        if c and len(c) == 1:
            kk = next(iter(c)); t,s,h = INDEX[kk]; return t,s,h+"+prefix40",0.97
    if len(k) >= 24:
        cand = collections.Counter()
        for g in bigrams(k):
            for kk in INV.get(g, ()): cand[kk] += 1
        A = bigrams(k); best, bs = None, 0.0
        for kk,_ in cand.most_common(10):
            B = bigrams(kk); j = len(A&B)/float(len(A|B) or 1)
            if j > bs: best, bs = kk, j
        if best and bs >= 0.78:
            t,s,h = INDEX[best]; return t,s,h+"+fuzzy", round(bs,3)
    return None

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()
    lib = json.load(io.open(LIB, encoding="utf-8"))
    for e in lib:
        if e.get("mode")=="truth" and (e.get("truth") or "").strip():
            add(e.get("surface"), e.get("truth"), "LIBRARY", "library")
    st = scan(); build_inv()
    surfaces = [e for e in lib if e.get("mode")=="surface"]
    def is_web(e): return any(d in (e.get("src") or "") for d in ("haiguitang.net","haiguitang.top","haiguitang.cn"))
    hits, misses = [], []
    for e in surfaces:
        got = lookup(e.get("surface"))
        (hits if got else misses).append((e, got))
    overlay = {e["id"]: {"truth": t, "src": s, "how": h, "score": sc} for e,(t,s,h,sc) in hits}
    web = [e for e in surfaces if is_web(e)]
    web_hit = [(e,g) for e,g in hits if is_web(e)]
    L = []
    L.append("汤底回收报告 v3（全语料加强版）")
    L.append("扫描文本文件: %d (HTML %d)" % (st["files"], st["html_files"]))
    L.append("truth 索引条目: %d" % len(INDEX))
    L.append("无汤底条目: %d" % len(surfaces))
    L.append("回收成功: %d (%.1f%%)" % (len(hits), 100.0*len(hits)/max(1,len(surfaces))))
    L.append("  其中网站题: %d / %d" % (len(web_hit), len(web)))
    L.append("仍无汤底: %d" % len(misses))
    L.append("")
    L.append("== 回收方式 ==")
    for s,c in collections.Counter(g[2] for _,g in hits).most_common(): L.append("  %-24s %4d" % (s,c))
    L.append("")
    L.append("== 来源 top20 ==")
    for s,c in collections.Counter(g[1] for _,g in hits).most_common(20): L.append("  %-70s %4d" % (s,c))
    L.append("")
    L.append("== 仍无汤底来源 ==")
    for s,c in collections.Counter(m[0].get("src") for m in misses).most_common(20): L.append("  %-52s %4d" % (s,c))
    L.append("")
    L.append("== 仍无汤底 长度中位 ==")
    lens = sorted(len(m[0].get("surface") or "") for m in misses)
    if lens: L.append("  min %d / p25 %d / 中位 %d / p75 %d / max %d" % (lens[0],lens[len(lens)//4],lens[len(lens)//2],lens[len(lens)*3//4],lens[-1]))
    text = "\n".join(L); print(text)
    if args.dry: print("[dry]"); return 0
    with io.open(OUT,"w",encoding="utf-8",newline="\n") as f:
        f.write(json.dumps(overlay, ensure_ascii=False, sort_keys=True, indent=1)+"\n")
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with io.open(REPORT,"w",encoding="utf-8",newline="\n") as f: f.write(text)
    json.dump([m[0]["id"] for m in misses], io.open(os.path.join(WS,"_soup-dev","misses_v3.json"),"w",encoding="utf-8"))
    print("== 写出 ==")
    print("  %-60s %9d B" % (os.path.relpath(OUT,WS), os.path.getsize(OUT)))
    print("  %-60s %9d B" % (os.path.relpath(REPORT,WS), os.path.getsize(REPORT)))
    return 0

if __name__ == "__main__":
    sys.exit(main())