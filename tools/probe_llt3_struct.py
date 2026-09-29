# -*- coding: utf-8 -*-
"""看「无解説」帖子的真实结构：答案区到底存不存在、用什么标签。"""
import io, os, re, sys, urllib.request, collections

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"}
rid = sys.argv[1]
html = urllib.request.urlopen(urllib.request.Request("https://late-late.jp/mondai/show/%s" % rid, headers=UA), timeout=40).read().decode("utf-8", "ignore")
print("页长", len(html))
print("全部标签计数(前25):", collections.Counter(re.findall(r"<([a-zA-Z_][\w:-]*)", html)).most_common(25))
# 找含“回答/解説/解決”字样的片段
for kw in ("回答", "解説", "解決", "正解"):
    for m in list(re.finditer(kw, html))[:4]:
        seg = re.sub(r"<[^>]+>", " ", html[max(0, m.start() - 60):m.start() + 90])
        print("  [%s] …%s…" % (kw, re.sub(r"\s+", " ", seg)))
