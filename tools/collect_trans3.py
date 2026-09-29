# -*- coding: utf-8 -*-
"""本轮 · Stage L-3ar3：回收各批译文，容错解析 + 逐条体检，汇总成一份 llt3_trans_all.json。

体检项：key 与批次清单一致、三字段非空、假名占比、句尾完整、疑似未剥净的站方脚手架。
用法：python tools/collect_trans3.py
"""
import io, os, re, json, glob, sys, collections

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
T = lambda *p: os.path.join(ROOT, "tools", *p)
IN_DIR, OUT_DIR = T("llt_trans_in3"), T("llt_trans_out3")

def tolerant(s):
    try:
        return json.loads(s), None
    except Exception as e0:
        c = re.sub(r",(\s*[}\]])", r"\1", s)
        c = re.sub(r"(?m)^\s*//.*$", "", c)
        c = c.replace("，", ",") if False else c
        try:
            return json.loads(c), "已修尾逗号/注释"
        except Exception as e:
            return None, "解析失败: %s" % str(e)[:80]


KANA = re.compile(r"[\u3040-\u309f\u30a0-\u30ff]")
TERM = "。！？…”』」）)】>》~～!?.a-zA-Z０-９｝〉、…—-＞｣』」』"
JUNK = re.compile(r"文案提供|出題協力|出题协力|よろしくお願いします|ご参加|ありがとう"
                  r"|BSタイム|bsタイム|※この問題は|ブログ村|ランキング|投票会場|拍手|コメント|"
                  r"お題|参加者募集|～しています。$")

all_tr, problems = {}, []
for p in sorted(glob.glob(os.path.join(IN_DIR, "batch_*.json"))):
    b = json.load(io.open(p, encoding="utf-8"))
    nn = os.path.basename(p).split("_")[1].split(".")[0]
    fp = os.path.join(OUT_DIR, "out_%s.json" % nn)
    if not os.path.exists(fp):
        problems.append(("batch_%s" % nn, "未交回", ""))
        continue
    d, note = tolerant(io.open(fp, encoding="utf-8").read())
    if d is None:
        problems.append(("batch_%s" % nn, "坏文件", note)); continue
    if note:
        problems.append(("batch_%s" % nn, "已容错", note))
        io.open(fp, "w", encoding="utf-8").write(json.dumps(d, ensure_ascii=False, indent=1))
    want = {str(x["id"]) for x in b["items"]}
    got = {str(k) for k in d}
    for miss in sorted(want - got):
        problems.append((miss, "漏译", "batch_%s" % nn))
    for extra in sorted(got - want):
        problems.append((extra, "多出id", "batch_%s" % nn))
    for sid in sorted(want & got):
        v = d[sid] or {}
        src = next(x for x in b["items"] if str(x["id"]) == sid)
        for f in ("title", "surface", "truth"):
            s = (v.get(f) or "").strip()
            if not s:
                problems.append((sid, f + " 空", "batch_%s" % nn)); continue
            if len(s) >= 12 and len(KANA.findall(s)) / float(len(s)) > 0.30:
                problems.append((sid, "%s 假名%.0f%%" % (f, 100.0 * len(KANA.findall(s)) / len(s)), "batch_%s" % nn))
            if f in ("surface", "truth") and len(s) > 24 and s[-1] not in TERM:
                problems.append((sid, "%s 裸结尾 …%s" % (f, s[-14:]), "batch_%s" % nn))
            m = JUNK.search(s)
            if m and f in ("surface", "truth"):
                problems.append((sid, "%s 残留脚手架「%s」" % (f, m.group(0)[:12]), "batch_%s" % nn))
        # 汤底长度比例异常（疑似摘要/漏译）：中文一般 ≥ 原文的 25%
        lt, ls = len((v.get("truth") or "").strip()), len(src["truth"])
        if ls >= 120 and lt < ls * 0.22:
            problems.append((sid, "汤底疑似过短 %d/%d" % (lt, ls), "batch_%s" % nn))
        all_tr[sid] = {"title": (v.get("title") or "").strip(),
                       "surface": (v.get("surface") or "").strip(),
                       "truth": (v.get("truth") or "").strip()}

json.dump(all_tr, io.open(T("llt3_trans_all.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
fresh = json.load(io.open(T("llt3_fresh.json"), encoding="utf-8"))["items"]
need = {str(x["id"]) for x in fresh[:490]}
print("回收译文: %d 条 | 送译需求: %d 条 | 缺: %d" % (len(all_tr), len(need), len(need - set(all_tr))))
print("问题条目: %d" % len(problems))
c = collections.Counter(k if not p[1].startswith("batch_") else p[1] for p in problems for k in [p[1] if p[0].startswith("batch") else "逐条"])
for cat, items in sorted(collections.Counter(p[1].split(" ")[0] for p in problems).items(), key=lambda x: -x[1]):
    print("   %-14s %d" % (cat, items))
io.open(T("llt3_trans_problems.json"), "w", encoding="utf-8").write(
    json.dumps([{"key": a, "issue": b, "where": c2} for a, b, c2 in problems], ensure_ascii=False, indent=1))
for p in problems[:25]:
    print("   -", p)
