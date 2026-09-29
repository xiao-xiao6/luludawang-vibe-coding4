# -*- coding: utf-8 -*-
"""第三轮 · Stage L-7：把自查通过后的日译中新题并入母本，**恰好 458 道**。

与上一轮的差别：这轮把「自查/复验」放在并库之前做，并用 TARGET 硬约束收口，
这样删除坏题、跳过撞库都不会让最终数字偏离主人要的 458（汤库 1942 → 2400，总数 2500）。

纪律（沿用上一轮）：
 - id = lib_ + sha1("llt3:" + srcNo)[:12]，冲突加盐重算
 - _t/quality = "j2s"，cats = 自动题材 + ["日译中"]，lang=zh、mode=truth、truthSource=original
 - src="late-late.jp"、srcNo=站内帖子 id、srcUrl 可溯源；rawTags 只进母本不进发布档
 - 按定稿顺序（好评降序）逐条取，归一化汤面撞现库者跳过并继续往下补，直到凑满 TARGET
 - 自检不过（空字段/未译/句尾裸结束）者直接排除，不带病入库
用法：python tools/merge_llt3.py [TARGET=458]
"""
import io, os, re, json, hashlib, shutil, sys, collections

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
T = lambda *p: os.path.join(ROOT, "tools", *p)
MASTER = os.path.join(ROOT, "data", "library", "library.data.js")
TARGET = int(sys.argv[1]) if len(sys.argv) > 1 else 458

CLEAN = T("llt3_trans_clean.json")
if os.path.exists(CLEAN):
    trans = json.load(io.open(CLEAN, encoding="utf-8"))
    print("读入清理后译文:", len(trans))
else:
    sys.exit("先跑 collect_trans3.py / clean_trans3.py 产出 llt3_trans_clean.json")

order = [str(it["id"]) for it in json.load(io.open(T("llt3_fresh.json"), encoding="utf-8"))["items"]]
# 并库前把关淘汰名单（自查判定确认成立、无法修复的坏题）：一律跳过，由后面的候选补位
EXCL = set()
exf = T("llt3_exclude.json")
if os.path.exists(exf):
    EXCL = {str(x) for x in json.load(io.open(exf, encoding="utf-8"))}
    print("把关淘汰名单:", len(EXCL), "条")
    order = [x for x in order if x not in EXCL]
S = {str(it["id"]): it for it in json.load(io.open(T("llt3_fresh.json"), encoding="utf-8"))["items"]}
print("定稿顺序:", len(order), "| 目标收录:", TARGET)

KANA = re.compile(r"[\u3040-\u309f\u30a0-\u30ff]")
TERM = "。！？…”』」）)】>》~～!?.a-zA-Z０-９｝〉、…—-＞｣"
GLOS = re.compile(r"[（(][^）){｝]{0,14}[\u4e00-\u9fff]")
DECO_TAIL = re.compile(r"[^\s\u4e00-\u9fff。！？…”』」）)】>》~～!?.a-zA-Z０-９｝〉、…—-＞｣]+$")
PUNCT = re.compile(r"[\s\u3000，。、！？；：·…—－\-_,\.\!\?\;:\"“”‘’（）()\[\]【】《》<>{}|/\\~`@#$%^&*+=「」『』]")
norm = lambda s: PUNCT.sub("", (s or "").lower())


def clean_text(s):
    return re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]{2,}", " ", (s or "").strip())).strip()


def qa(sid, v):
    """返回 (ok, 原因)。空字段/未译/句尾裸结束一律不入库。"""
    for f in ("title", "surface", "truth"):
        s = (v.get(f) or "").strip()
        if not s:
            return False, "%s 为空" % f
        if len(s) >= 12 and len(KANA.findall(s)) / float(len(s)) > 0.30 and not GLOS.search(s):
            return False, "%s 疑似未译(假名%.0f%%)" % (f, 100.0 * len(KANA.findall(s)) / len(s))
        if f in ("surface", "truth") and len(s) > 20 and s[-1] not in TERM:
            tail = DECO_TAIL.search(s)
            if not (tail and len(tail.group()) <= 30):
                return False, "%s 句尾裸结束" % f
    return True, ""


RULES = [
    ("校园", re.compile(r"学校|同学|老师|教室|宿舍|大学|毕业|高考|班主任|放学|考试|社团|图书馆")),
    ("家庭", re.compile(r"妈妈|爸爸|母亲|父亲|婆婆|老公|老婆|妻子|丈夫|女儿|儿子|姐姐|哥哥|弟弟|妹妹|家里|祖父|祖母")),
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
    return [n for n, p in RULES if p.search(text)][:2] or ["其他"]


src = io.open(MASTER, encoding="utf-8").read()
h = src.find("var SOUP_LIBRARY")
i = src.find("[", h)
end = src.find("\nvar SOUP_LIB_CATS", i)
head, tail = src[:h], src[end:]
data = json.loads(src[i:end].rsplit("]", 1)[0] + "]")
before = len(data)
print("母本现库:", before)

existing_ids = {e["id"] for e in data}
existing_norm = {norm(e.get("surface", "")) for e in data}
added, skipped = [], collections.Counter()
for sid in order:
    if len(added) >= TARGET:
        break
    v = trans.get(sid)
    if not v:
        skipped["未送译/无译文"] += 1; continue
    ok, why = qa(sid, v)
    if not ok:
        skipped["自检不过:" + why] += 1; continue
    s = S[sid]
    surface, truth, title = clean_text(v["surface"]), clean_text(v["truth"]), clean_text(v["title"])
    if norm(surface) in existing_norm:
        skipped["汤面撞现库"] += 1; continue
    base = "llt3:" + sid
    nid = "lib_" + hashlib.sha1(base.encode("utf-8")).hexdigest()[:12]
    n = 0
    while nid in existing_ids:
        n += 1
        nid = "lib_" + hashlib.sha1((base + "#" + str(n)).encode("utf-8")).hexdigest()[:12]
    existing_ids.add(nid); existing_norm.add(norm(surface))
    added.append({
        "_t": "j2s", "cats": auto_cats(surface + truth) + ["日译中"], "difficulty": 2,
        "dispTitle": title, "id": nid, "lang": "zh", "mode": "truth", "quality": "j2s",
        "rawTags": s.get("tags") or [], "src": "late-late.jp", "srcNo": int(sid),
        "srcUrl": s.get("url") or ("https://late-late.jp/mondai/show/%s" % sid),
        "surface": surface, "title": title, "truth": truth, "truthSource": "original",
    })

if len(added) != TARGET:
    print("差 %d 道才到 %d（跳过明细: %s）" % (TARGET - len(added), TARGET, dict(skipped)))
    print("→ 需补译补抓，未写盘")
    sys.exit(2)

data.extend(added)
tail = re.sub(r"var SOUP_LIB_TOTAL = \d+;", "var SOUP_LIB_TOTAL = %d;" % len(data), tail)
bakdir = os.path.join(ROOT, "_local_backup")
if not os.path.isdir(bakdir):
    os.makedirs(bakdir)
shutil.copyfile(MASTER, os.path.join(bakdir, "library.data.js.bak-stageL7"))
io.open(MASTER, "w", encoding="utf-8").write(
    head + "var SOUP_LIBRARY = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";" + tail)

assert all((e.get("truth") or "").strip() and (e.get("surface") or "").strip() and (e.get("title") or "").strip() for e in data)
assert len({e["id"] for e in data}) == len(data)
assert len({(e.get("src"), e.get("srcNo")) for e in data if e.get("src") == "late-late.jp"}) == \
    sum(1 for e in data if e.get("src") == "late-late.jp")
cc = collections.Counter()
for e in data:
    for t in e.get("cats") or []:
        cc[t] += 1
log = {"before": before, "added": len(added), "after": len(data), "target": TARGET,
       "skipped": dict(skipped), "cat_counts": dict(cc)}
io.open(T("stage_l7_log.json"), "w", encoding="utf-8").write(json.dumps(log, ensure_ascii=False, indent=1))
print("OK %d -> %d | 恰好新增 %d | 跳过明细 %s" % (before, len(data), len(added), dict(skipped)))
print("日译中:", cc.get("日译中"), "| 汤库目标 2400 →", "达成" if len(data) == 2400 else "未达成")
