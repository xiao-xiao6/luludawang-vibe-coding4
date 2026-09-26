# -*- coding: utf-8 -*-
"""
体检第 6 步：故事级重复扫描
A) 汤底 bigram Jaccard >= 0.30（不同措辞讲同一故事）
B) 经典题关键词家族
产出 tools/checkup_story_dups.txt
"""
import io, os, re, json, sys
from collections import defaultdict
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
rows = json.load(io.open(T("tools", "checkup_all.json"), encoding="utf-8"))
PUNCT = re.compile(r"[\s\u3000，。、！？；：·…—－\-_,\.\!\?\;:\"'“”‘’（）()\[\]【】《》<>{}|/\\~`@#$%^&*+=「」『』※★☆●○■□◇♡？！.]+")
def norm(s): return PUNCT.sub("", (s or "").lower())
def bg(s):
    s = norm(s)
    return set(s[i:i+2] for i in range(len(s)-1)) if len(s) > 1 else ({s} if s else set())
def jac(a, b): return (len(a & b) / len(a | b)) if (a and b) else 0.0

bt = [bg(r["truth"]) for r in rows]
inv = defaultdict(list)
for i, s in enumerate(bt):
    for t in s: inv[t].append(i)
seen = set(); pairs = []
for i, s in enumerate(bt):
    if len(norm(rows[i]["truth"])) < 14: continue
    cnt = defaultdict(int)
    for t in s:
        for j in inv[t]:
            if j > i: cnt[j] += 1
    for j, c in cnt.items():
        if (i, j) in seen: continue
        if len(norm(rows[j]["truth"])) < 14: continue
        u = len(s | bt[j])
        if not u: continue
        jt = c / u
        if jt >= 0.30:
            seen.add((i, j)); pairs.append((jt, i, j))
pairs.sort(key=lambda x: -x[0])
out = []
out.append("===== A) 汤底相似 >=0.30：%d 对 =====" % len(pairs))
for jt, i, j in pairs:
    a, b = rows[i], rows[j]
    out.append("=== 底%.2f" % jt)
    out.append(" A[%s|%s|%s] %s" % (a["id"], a["layer"], a["src"][:18], a["title"][:18]))
    out.append("   底:%s" % a["truth"][:90].replace("\n", " "))
    out.append(" B[%s|%s|%s] %s" % (b["id"], b["layer"], b["src"][:18], b["title"][:18]))
    out.append("   底:%s" % b["truth"][:90].replace("\n", " "))

# B) 关键词家族
FAMS = {
 "海龟汤本汤": ["海龟汤", "海龟肉"],
 "电梯侏儒": ["电梯", "按到"],
 "半根火柴": ["火柴"],
 "音乐停了": ["音乐停", "音乐一停", "乐曲停"],
 "山顶敲门": ["敲门"],
 "灯塔关灯": ["灯塔", "守灯"],
 "棺材没淋湿": ["棺材", "没有淋湿", "没湿"],
 "雨中女郎": ["雨中女郎", "雨中的女郎"],
 "小红裙": ["小红裙"],
 "笔仙": ["笔仙"],
 "洋娃娃嚎哭": ["洋娃娃", "嚎啕大哭"],
 "吹蜡烛杀友": ["吹完蜡烛", "吹蜡烛"],
 "牛吃草撞门": ["牛吃草"],
 "洗头室友死": ["洗了个头"],
 "乞丐碗中之物": ["碗里多了"],
 "小黑屋大雨": ["小黑屋"],
 "图书馆一百块": ["图书馆", "100块"],
 "美人鱼": ["美人鱼"],
 "卖火柴女孩": ["卖火柴"],
 "双胞胎替换": ["双胞胎"],
 "五兄弟祭坛": ["五个儿子", "五兄弟"],
 "他不喜欢我": ["相依为命"],
 "奇怪的声响数字": ["96924482622454", "沉闷的"],
 "房间黑点": ["黑点"],
 "因果日记": ["101日", "皮划艇"],
 "whoisliar": ["老六", "分赃不均"],
 "侠客穿越": ["侠客", "蓝衣壮汉"],
 "拔萝卜儿歌": ["拔萝卜"],
 "消失的姐姐": ["姐姐去哪"],
 "宿舍兄弟惨叫": ["老五一声惨叫"],
 "最完美的作品": ["落魄画家", "几口井"],
 "声音黑匣子": ["黑匣子"],
 "发夹隔壁": ["发夹"],
 "唱戏女人": ["唱戏", "唱戏曲"],
 "异食癖秘密": ["异食"],
 "比丘国净土": ["沙弥", "肉香"],
 "规则怪谈宿舍": ["寄生虫"],
 "红衣寿衣": ["寿衣"],
 "人肉火车车厢": ["最后一节车厢", "车硕"],
}
out.append("\n===== B) 关键词家族 =====")
for fam, kws in FAMS.items():
    hits = [r for r in rows if any(k in (r["surface"] + r["truth"]) for k in kws)]
    if len(hits) >= 2:
        out.append("---- %s (%d)" % (fam, len(hits)))
        for r in hits:
            out.append("   [%s|%s] %s | 面:%s" % (r["id"], r["src"][:16], r["title"][:16], norm(r["surface"])[:36]))
io.open(T("tools", "checkup_story_dups.txt"), "w", encoding="utf-8").write("\n".join(out))
print("对:", len(pairs), "家族:", len(FAMS), "已写 checkup_story_dups.txt")
