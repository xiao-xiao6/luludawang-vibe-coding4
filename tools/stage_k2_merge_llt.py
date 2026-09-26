# -*- coding: utf-8 -*-
"""
Stage K-2（2026-09-26 · Phase 2 日文源）：late-late.jp 净新增「日译中」并入母本
输入：tools/llt_fresh_final.json（定稿 165 条）
      tools/llt_trans_out/out_01..06.json（{id:{title,surface,truth}}）
规则（沿用 Stage J 成熟流程）：
 - id = lib_ + sha1("llt:" + sid)[:12]，冲突则加盐重算
 - _t="j2s"、cats = 自动题材 + ["日译中"]、quality="j2s"
 - src="late-late.jp"、srcNo=sid、srcUrl=原站链接（可溯源纪律）
 - 入库前二次去重：归一化汤面与现库完全相同者跳过
自检：翻译必须 165/165 全覆盖、三字段非空、无日文假名残留（>30% 判违例）
产出：data/library/library.data.js（写前备份）+ tools/stage_k2_log.json
"""
import io, os, re, json, hashlib, shutil, sys
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
MASTER = T("data", "library", "library.data.js")
OUT_DIR = T("tools", "llt_trans_out")

# ---------- 1) 读定稿 ----------
final = json.load(io.open(T("tools", "llt_fresh_final.json"), encoding="utf-8"))
S = {str(it["id"]): it for it in final["items"]}
print("定稿待并入:", len(S))

# ---------- 2) 读翻译并自检 ----------
trans = {}
for k in range(1, 7):
    p = os.path.join(OUT_DIR, "out_%02d.json" % k)
    if not os.path.exists(p):
        print("缺文件:", p); sys.exit(2)
    d = json.load(io.open(p, encoding="utf-8"))
    for kk, vv in d.items():
        if kk in trans:
            print("跨批重复 id:", kk); sys.exit(2)
        trans[str(kk)] = vv

errs = []
missing = [sid for sid in S if sid not in trans]
extra = [sid for sid in trans if sid not in S]
if missing: errs.append("漏译 %d 条: %s" % (len(missing), missing[:12]))
if extra: errs.append("多出 %d 条: %s" % (len(extra), extra[:12]))

KANA = re.compile(r"[\u3040-\u309f\u30a0-\u30ff]")
for sid, v in trans.items():
    for f in ("title", "surface", "truth"):
        s = (v.get(f) or "").strip()
        if not s:
            errs.append("#%s %s 为空" % (sid, f)); continue
        if len(s) >= 12 and len(KANA.findall(s)) / len(s) > 0.30:
            errs.append("#%s %s 疑似未译(假名占比%.0f%%)" % (sid, f, 100.0*len(KANA.findall(s))/len(s)))
if errs:
    print("自检失败 %d 项:" % len(errs))
    for e in errs[:25]: print("   ", e)
    sys.exit(2)
print("翻译自检通过：%d/%d 全覆盖、无空字段、无假名残留" % (len(trans), len(S)))

# ---------- 3) 载入母本 ----------
shutil.copyfile(MASTER, T("_local_backup", "library.data.js.bak-stagek"))
src = io.open(MASTER, encoding="utf-8").read()
head = src[:src.find("var SOUP_LIBRARY")]
i = src.find("var SOUP_LIBRARY"); i = src.find("[", i)
end = src.find("\nvar SOUP_LIB_CATS", i)
tail = src[end:]
data = json.loads(src[i:end].rsplit("]", 1)[0] + "]")
before = len(data)
print("母本现库:", before)

PUNCT = re.compile(r"[\s\u3000，。、！？；：·…—－\-_,\.\!\?\;:\"'“”‘’（）()\[\]【】《》<>{}|/\\~`@#$%^&*+=「」『』]")
def norm(s): return PUNCT.sub("", (s or "").lower())
def clean_text(s):
    s = (s or "").strip()
    s = re.sub(r"[ \t]{2,}", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()

RULES = [
    ("校园", re.compile(r"学校|同学|老师|教室|宿舍|大学|毕业|高考|班主任")),
    ("家庭", re.compile(r"妈妈|爸爸|母亲|父亲|婆婆|老公|老婆|妻子|丈夫|女儿|儿子|姐姐|哥哥|弟弟|妹妹|家里")),
    ("都市", re.compile(r"手机|电梯|外卖|直播|出租车|地铁|公司|老板|同事|快递|微信|公交|列车")),
    ("犯罪", re.compile(r"警察|侦探|凶手|案|绑架|抢劫|杀人|越狱|法庭|律师|坐牢|劫匪|凶器")),
    ("恐怖", re.compile(r"鬼|尸|血|坟|墓|死|杀|命案|闹鬼")),
    ("脑洞", re.compile(r"梦|超能力|外星人|时间旅行|穿越|虚拟|系统|游戏|僵尸|异能|虫洞|许愿|精灵")),
    ("悬疑", re.compile(r"失踪|监控|线索|真相|疑|秘密|遗书|日记")),
    ("猎奇", re.compile(r"吃人|人肉|器官|肢解|骨|剥皮|毒|蛊")),
    ("温情", re.compile(r"爱着|守护|温暖|感动|表白|婚礼|承诺")),
]
def auto_cats(text):
    for name, pat in RULES:
        if pat.search(text):
            return [name]
    return ["其他"]

existing_ids = {e["id"] for e in data}
existing_norm = {norm(e.get("surface", "")) for e in data}

added, skipped = [], []
for sid, t in trans.items():
    s = S.get(sid)
    if not s:
        skipped.append({"sid": sid, "why": "源中不存在"}); continue
    surface = clean_text(t["surface"])
    truth = clean_text(t["truth"])
    title = clean_text(t["title"])
    if not surface or not truth or not title:
        skipped.append({"sid": sid, "why": "空字段"}); continue
    if norm(surface) in existing_norm or norm(surface) == norm(s["surface"]):
        skipped.append({"sid": sid, "why": "汤面与现库重复"}); continue

    base = "llt:" + str(sid)
    nid = "lib_" + hashlib.sha1(base.encode("utf-8")).hexdigest()[:12]
    n = 0
    while nid in existing_ids:
        n += 1
        nid = "lib_" + hashlib.sha1((base + "#" + str(n)).encode("utf-8")).hexdigest()[:12]
    existing_ids.add(nid)
    existing_norm.add(norm(surface))

    added.append({
        "_t": "j2s", "cats": auto_cats(surface + truth) + ["日译中"], "difficulty": 2,
        "dispTitle": title, "id": nid, "lang": "zh", "mode": "truth", "quality": "j2s",
        "rawTags": [], "src": "late-late.jp", "srcNo": int(sid),
        "srcUrl": s.get("url", "https://late-late.jp/mondai/show/%s" % sid),
        "surface": surface, "title": title, "truth": truth, "truthSource": "original",
    })

data.extend(added)
body = head + "var SOUP_LIBRARY = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";" + tail
io.open(MASTER, "w", encoding="utf-8").write(body)

empty = [e["id"] for e in data if not (e.get("truth") or "").strip()]
assert not empty, "出现空汤底"
assert all((e.get("title") or "").strip() for e in data), "出现空标题"
log = {"before": before, "added": len(added), "after": len(data),
       "skipped": skipped, "j2s_total": sum(1 for e in data if e.get("_t") == "j2s")}
io.open(T("tools", "stage_k2_log.json"), "w", encoding="utf-8").write(json.dumps(log, ensure_ascii=False, indent=1))
print("OK %d -> %d | 新增 %d | 跳过 %d" % (before, len(data), len(added), len(skipped)))
for x in skipped: print("   跳过:", x)
