# -*- coding: utf-8 -*-
"""本轮 · Stage L-3：日译中定稿并入母本（沿用 Stage K-2 的入库纪律）。

输入：tools/llt2_fresh.json（闸门定稿，含日文原文与站内 tags/url）
      tools/llt_trans_out2/out_*.json（{id:{title,surface,truth}}）
规则：
 - id = lib_ + sha1("llt2:" + sid)[:12]，冲突加盐重算
 - _t="j2s"、cats = 自动题材 + ["日译中"]、quality="j2s"
 - src="late-late.jp"、srcNo=sid、srcUrl=原帖链接（可溯源纪律）
 - rawTags 保留站方标签（只进母本，构建器白名单不会带进发布档）
 - 入库前二次查重：归一化汤面撞现库者跳过
自检：翻译必须 100% 覆盖、三字段非空、假名占比 >30% 判未译、句尾不得裸结束
产出：data/library/library.data.js（写前备份）+ tools/stage_l3_log.json
"""
import io, os, re, json, hashlib, shutil, sys, glob, collections

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
T = lambda *p: os.path.join(ROOT, "tools", *p)
MASTER = os.path.join(ROOT, "data", "library", "library.data.js")
OUT_DIR = T("llt_trans_out2")

final = json.load(io.open(T("llt2_fresh.json"), encoding="utf-8"))["items"]
S = {str(it["id"]): it for it in final}
print("定稿待并入:", len(S))

trans, dupid = {}, []
# 优先吃“清理后的汇总译文”（tools/llt2_trans_clean.json），
# 它已由 collect_trans2.py 做过逐条体检与外壳剥离；找不到才回退到分批 out_*.json。
CLEAN = T("llt2_trans_clean.json")
if os.path.exists(CLEAN):
    trans = json.load(io.open(CLEAN, encoding="utf-8"))
    print("读入清理后译文:", len(trans), "条")
else:
    for p in sorted(glob.glob(os.path.join(OUT_DIR, "out_*.json"))):
        d = json.load(io.open(p, encoding="utf-8"))
        for k, v in d.items():
            if str(k) in trans:
                dupid.append(k)
            trans[str(k)] = v
    if dupid:
        print("跨批重复 id:", dupid[:10]); sys.exit(2)

errs = []
# 只对“已送译的这批”要求全覆盖；S 里未送译的（留到下轮）不参与
sent = set()
for p in sorted(glob.glob(os.path.join(T("llt_trans_in2"), "batch_*.json"))):
    sent |= {str(x["id"]) for x in json.load(io.open(p, encoding="utf-8"))["items"]}
missing = [sid for sid in sent if sid not in trans]
extra = [sid for sid in trans if sid not in S]
if missing: errs.append("漏译 %d 条: %s" % (len(missing), missing[:12]))
if extra: errs.append("多出 %d 条: %s" % (len(extra), extra[:12]))
S = {sid: S[sid] for sid in trans if sid in S}
print("本轮并入范围: %d 条（定稿共 %d，其余留下轮）" % (len(S), len(json.load(io.open(T("llt2_fresh.json"), encoding="utf-8"))["items"])))

KANA = re.compile(r"[\u3040-\u309f\u30a0-\u30ff]")
TERM = "。！？…”』」）)】>》~～!?.a-zA-Z０-９｝〉、…—-＞｣"
GLOS = re.compile(r"[（(][^）){｝]{0,14}[\u4e00-\u9fff]")          # 假名双关后带的中文括注
DECO_TAIL = re.compile(r"[^\s\u4e00-\u9fff。！？…”』」）)】>》~～!?.a-zA-Z０-９｝〉、…—-＞｣]+$")
warns = []
for sid, v in trans.items():
    for f in ("title", "surface", "truth"):
        s = (v.get(f) or "").strip()
        if not s:
            errs.append("#%s %s 为空" % (sid, f)); continue
        kn = len(KANA.findall(s)) / float(len(s)) if len(s) >= 12 else 0
        if kn > 0.30:
            if GLOS.search(s):
                warns.append("#%s %s 假名%.0f%%（有中文括注，按简报保留双关）" % (sid, f, 100 * kn))
            else:
                errs.append("#%s %s 疑似未译(假名%.0f%%)" % (sid, f, 100 * kn))
        if f in ("surface", "truth") and len(s) > 20 and s[-1] not in TERM:
            tail = DECO_TAIL.search(s)
            if tail and len(tail.group()) <= 30:
                warns.append("#%s %s 尾为颜文字/表情：%s" % (sid, f, tail.group()[:14]))
            else:
                errs.append("#%s %s 句尾裸结束: …%s" % (sid, f, s[-16:]))
if errs:
    print("自检失败 %d 项:" % len(errs))
    for e in errs[:30]: print("   ", e)
    sys.exit(2)
io.open(T("llt2_merge_warns.txt"), "w", encoding="utf-8").write("\n".join(warns))
print("翻译自检通过：%d/%d 全覆盖、无空字段、无未译残留（保留双关/颜文字 %d 处已登记）"
      % (len(trans), len(S), len(warns)))

src = io.open(MASTER, encoding="utf-8").read()
h = src.find("var SOUP_LIBRARY")
i = src.find("[", h)
end = src.find("\nvar SOUP_LIB_CATS", i)
head = src[:h]
tail = src[end:]
data = json.loads(src[i:end].rsplit("]", 1)[0] + "]")
before = len(data)
print("母本现库:", before)

PUNCT = re.compile(r"[\s\u3000，。、！？；：·…—－\-_,\.\!\?\;:\"'“”‘’（）()\[\]【】《》<>{}|/\\~`@#$%^&*+=「」『』]")
def norm(s): return PUNCT.sub("", (s or "").lower())
def clean_text(s):
    return re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]{2,}", " ", (s or "").strip())).strip()

RULES = [
    ("校园", re.compile(r"学校|同学|老师|教室|宿舍|大学|毕业|高考|班主任|放学|考试|社团|图书馆")),
    ("家庭", re.compile(r"妈妈|爸爸|母亲|父亲|婆婆|老公|老婆|妻子|丈夫|女儿|儿子|姐姐|哥哥|弟弟|妹妹|家里|祖父|祖母|儿子")),
    ("都市", re.compile(r"手机|电梯|外卖|直播|出租车|地铁|公司|老板|同事|快递|微信|公交|列车|飞机|超市|便利店")),
    ("犯罪", re.compile(r"警察|侦探|凶手|案件|绑架|抢劫|杀人|越狱|法庭|律师|坐牢|劫匪|凶器|尸体|虐待")),
    ("恐怖", re.compile(r"鬼|尸|血|坟|墓|杀死|闹鬼|幽灵|诅咒|怪物")),
    ("脑洞", re.compile(r"梦|超能力|外星人|时间旅行|穿越|虚拟|系统|游戏|僵尸|异能|虫洞|许愿|精灵|机器人|动物视角|蜘蛛|猫|狗")),
    ("悬疑", re.compile(r"失踪|监控|线索|真相|疑|秘密|遗书|日记|照片|录像")),
    ("猎奇", re.compile(r"吃人|人肉|器官|肢解|骨|剥皮|毒|蛊|吞噬")),
    ("温情", re.compile(r"爱着|守护|温暖|感动|表白|婚礼|承诺|喜欢")),
    ("反转", re.compile(r"其实|没想到|反过来|真相是")),
]
def auto_cats(text):
    hit = [name for name, pat in RULES if pat.search(text)]
    return hit[:2] or ["其他"]

existing_ids = {e["id"] for e in data}
existing_norm = {norm(e.get("surface", "")) for e in data}
added, skipped = [], []
for sid, t in trans.items():
    s = S.get(sid)
    if not s:
        skipped.append({"sid": sid, "why": "源中不存在"}); continue
    surface, truth, title = clean_text(t["surface"]), clean_text(t["truth"]), clean_text(t["title"])
    if not surface or not truth or not title:
        skipped.append({"sid": sid, "why": "空字段"}); continue
    if norm(surface) in existing_norm:
        skipped.append({"sid": sid, "why": "汤面与现库重复"}); continue
    base = "llt2:" + str(sid)
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
        "rawTags": s.get("tags") or [], "src": "late-late.jp", "srcNo": int(sid),
        "srcUrl": s.get("url") or ("https://late-late.jp/mondai/show/%s" % sid),
        "surface": surface, "title": title, "truth": truth, "truthSource": "original",
    })

data.extend(added)
tail = re.sub(r"var SOUP_LIB_TOTAL = \d+;", "var SOUP_LIB_TOTAL = %d;" % len(data), tail)
shutil.copyfile(MASTER, os.path.join(ROOT, "_local_backup", "library.data.js.bak-stageL3"))
io.open(MASTER, "w", encoding="utf-8").write(
    head + "var SOUP_LIBRARY = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";" + tail)

assert all((e.get("truth") or "").strip() for e in data), "出现空汤底"
assert all((e.get("title") or "").strip() for e in data), "出现空标题"
assert len({e["id"] for e in data}) == len(data), "id 冲突"
cc = collections.Counter()
for e in data:
    for t in e.get("cats") or []:
        cc[t] += 1
log = {"before": before, "added": len(added), "after": len(data), "skipped": skipped,
       "j2s_total": sum(1 for e in data if e.get("_t") in ("j2s", "lt2")),
       "cat_counts": dict(cc)}
io.open(T("stage_l3_log.json"), "w", encoding="utf-8").write(json.dumps(log, ensure_ascii=False, indent=1))
print("OK %d -> %d | 新增 %d | 跳过 %d" % (before, len(data), len(added), len(skipped)))
for x in skipped[:20]: print("   跳过:", x)
print("日译中累计:", cc.get("日译中"), "| 繁译简:", cc.get("繁译简"), "| 英译中:", cc.get("英译中"))
