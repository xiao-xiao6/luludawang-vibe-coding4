# -*- coding: utf-8 -*-
"""英译中高频人名 → 中文译法一致性统计"""
import io, os, re, json, sys
from collections import defaultdict, Counter
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
pairs = json.load(io.open(T("tools", "checkup_pairs.json"), encoding="utf-8"))
en = [p for p in pairs if p["tag"] == "英译中"]
# 已知常见英文人名
NAMES = ["Bill", "John", "Michael", "Jack", "George", "Joe", "Eugene", "Kirill", "Charlie", "Bruce",
         "Tim", "Greg", "Linda", "Susan", "Mary", "Tom", "Mike", "David", "Robert", "James", "Sarah",
         "Anna", "Peter", "Paul", "Mark", "Steve", "Kevin", "Nancy", "Alice", "Bob", "Fred", "Harry"]
# 每个名字对应的中文音译候选（用于统计实际用了哪种）
ZH = {
 "Bill": ["比尔", "比爾"], "John": ["约翰", "约翰", "强恩"], "Michael": ["迈克尔", "麦克", "米高"],
 "Jack": ["杰克", "贾克"], "George": ["乔治", "佐治"], "Joe": ["乔", "乔伊"],
 "Eugene": ["尤金", "尤真"], "Kirill": ["基里尔", "基尔", "西里尔"], "Charlie": ["查理", "查利", "查理斯"],
 "Bruce": ["布鲁斯", "布魯斯"], "Tim": ["蒂姆", "提姆", "蒂莫西"], "Greg": ["格雷格", "格里格", "格雷戈"],
 "Linda": ["琳达", "林达"], "Susan": ["苏珊", "苏珊娜"], "Mary": ["玛丽", "玛丽亚", "玛利亚"],
 "Tom": ["汤姆", "托姆"], "Mike": ["迈克", "麦克"], "David": ["大卫", "戴维"],
 "Robert": ["罗伯特", "罗勃"], "James": ["詹姆斯", "杰姆"], "Sarah": ["莎拉", "萨拉", "苏珊"],
 "Anna": ["安娜", "安妮"], "Peter": ["彼得", "皮特"], "Paul": ["保罗", "鲍尔"],
 "Mark": ["马克", "马库斯"], "Steve": ["史蒂夫", "斯蒂夫", "史提夫"], "Kevin": ["凯文", "凯文"],
 "Nancy": ["南希", "南茜"], "Alice": ["爱丽丝", "艾丽斯"], "Bob": ["鲍勃", "鲍伯"],
 "Fred": ["弗雷德", "弗里德"], "Harry": ["哈里", "哈利"],
}
stat = {}
for n in NAMES:
    ids = []; cnt = Counter()
    for p in en:
        o = (p["o_surface"] or "") + " " + (p["o_truth"] or "")
        if not re.search(r"\b%s\b" % re.escape(n), o): continue
        z = (p["zh_surface"] or "") + " " + (p["zh_truth"] or "")
        found = [c for c in ZH[n] if c in z]
        if found:
            for f in set(found): cnt[f] += 1
        else:
            cnt["(未出现音译)"] += 1
        ids.append(p["id"])
    if len(ids) >= 2:
        stat[n] = (len(ids), cnt)
print("人名  条数  译法分布")
for n, (c, cnt) in sorted(stat.items(), key=lambda x: -x[1][0]):
    flag = "  ⚠️多译法" if len([k for k in cnt if k != "(未出现音译)"]) > 1 else ""
    print("  %-9s x%-3d %s%s" % (n, c, dict(cnt), flag))
