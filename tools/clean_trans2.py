# -*- coding: utf-8 -*-
"""本轮 · Stage L-3b（保守版）：译文收尾清理。

原则：宁可不切，也绝不伤到故事正文。
 S1 强信号整行剥除（站方专有字符串，正文里不可能出现）
 S2 弱信号（请多关照、求赞、人气投票…）只在**首 2 行或末 3 行且 <30 字**时剥
 S3 装饰线只剥首尾的、或紧挨已剥除行的；正文中间的分节线保留
 S4 行首「【题】/Q：/问题：」只去掉标签本身；「【解说】【解答】【答案】【摘要】」一律保留
 S5 标题不补句号；surface/truth 裸汉字结尾补句号
产出：tools/llt2_trans_clean.json + tools/llt2_clean_log.txt
"""
import io, os, re, json, sys, collections

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
T = lambda *p: os.path.join(ROOT, "tools", *p)
SRC = json.load(io.open(T("llt2_trans_all.json"), encoding="utf-8"))

TERM = "。！？…”』」）)】>》~～!?.a-zA-Z０-９｝〉、…—-"
STRONG = re.compile(r" にほんブログ村|はてブ|Hatena|TrackBack|トラックバック|本文へ戻る|投票会場"
                    r"|文案提供|出題協力|出题协力|問題提供|画像提供|イラスト提供|著作権|All Rights Reserved"
                    r"|ランキングに参加|コメント欄へ|免責事項|利用規約|プライバシー|图片出处|图片来源")
WEAK = re.compile(r"请多关照|多多指教|よろしくお願いします|お疲れ様|感谢参与|谢谢参与|欢迎补充|求个赞|点个赞"
                  r"|人气投票|点击.{0,6}投票|标签[:：]|难度[:：]|出自[:：]|来源[:：]|原文地址|本文地址")
DECOR = re.compile(r"^[\-—－=ー・..·*○●◇◆★☆━┄┈〜~]{3,}$")
ANSWER_LABEL = re.compile(r"^(?:【[^】]{0,8}(?:解说|解答|答案|要約|摘要)[^】]{0,4}】|〔[^〕]{0,8}(?:解说|解答)[^〕]{0,4}〕"
                          r"|<[^>]{0,8}(?:解说|解答)[^>]{0,3}>|＜[^＞]{0,8}(?:解说|解答)[^＞]{0,3}＞"
                          r"|《\s*(?:解说|解答)\s*》|解说的解说|简易解说|简易解答|解说[:：]|解答[:：]|答案[:：]|摘要[:：])")
SIGNOFF = re.compile(r"感谢(各位)?的?参与|感谢各位的参加|请多多关照|请多关照|到此结束|下次(再见|再会)"
                     r"|这是一道需要知识|需要「知识」|出题编号|投稿编号|awaiting|お待ちしています")
LEAD_TAG = re.compile(r"^\s*(?:【[^】]{1,8}】|\[\s*(?:问题|题)\s*\]|问题[:：]|题目[:：]|Q[:：])\s*")


def clean(s, field):
    notes = []
    s = (s or "").replace("⏎", "\n")
    s = re.sub(r"[ \t\u3000]+\n", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s).strip()
    if not s:
        return s, notes
    s = re.sub(r"https?://\S+|www\.\S{4,}", "", s)   # 正文里的裸链接：只删链接，不删整行
    s = re.sub(r"\n{3,}", "\n\n", s).strip()
    lines = [l.rstrip() for l in s.split("\n")]
    n = len(lines)
    drop = [False] * n
    for i, l in enumerate(lines):
        t = l.strip()
        if not t:
            continue
        if ANSWER_LABEL.match(t):
            continue                                  # 答案分层标签：保留
        if STRONG.search(t):
            drop[i] = True; notes.append("S1"); continue
        edge = (i <= 1) or (i >= n - 4)
        if WEAK.search(t) and edge and len(t) < 30:
            drop[i] = True; notes.append("S2"); continue
        if i >= n - 3 and len(t) < 60 and SIGNOFF.search(t):
            drop[i] = True; notes.append("S2b署名尾注"); continue
        if DECOR.match(t) and (i <= 1 or i >= n - 3 or (i and drop[i - 1])):
            drop[i] = True; notes.append("S3"); continue
        if field != "title" and LEAD_TAG.match(t) and len(t) < 40:
            lines[i] = LEAD_TAG.sub("", l)
            notes.append("S4")
    s = "\n".join(l for i, l in enumerate(lines) if not drop[i])
    s = re.sub(r"\n{3,}", "\n\n", s).strip()
    if field == "title":
        s = re.sub(r"\s+", " ", s).strip()
        if len(s) > 20:
            s = s[:20].rstrip(); notes.append("标题截20")
    elif s and s[-1] not in TERM and re.match(r"[一-鿿]", s[-1]):
        s += "。"; notes.append("S5")
    return s, notes


out, log = {}, []
for sid, v in SRC.items():
    item, notes = {}, []
    for f in ("title", "surface", "truth"):
        s, nl = clean(v.get(f), f)
        item[f] = s
        notes += ["%s:%s" % (f, x) for x in nl]
    if not all(item.values()):
        item = {k: (v.get(k) or "").strip() for k in ("title", "surface", "truth")}
        notes.append("回退原译文")
    out[sid] = item
    if notes:
        log.append((sid, ",".join(notes)))

json.dump(out, io.open(T("llt2_trans_clean.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
io.open(T("llt2_clean_log.txt"), "w", encoding="utf-8").write("\n".join("%s %s" % x for x in log))
c = collections.Counter(k for _, m in log for k in re.findall(r"S\d|标题截20|回退原译文", m))
print("译文清理: %d 条 | 有改动 %d 条 | %s" % (len(out), len(log), dict(c)))
