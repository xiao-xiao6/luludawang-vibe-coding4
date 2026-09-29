# -*- coding: utf-8 -*-
"""存两份页面到本地做离线结构对比：一份「解析成功」的、一份「被误判无解説」的。"""
import io, os, re, sys, time, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
T = lambda *p: os.path.join(ROOT, "tools", *p)
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"}

for rid in sys.argv[1:]:
    html = urllib.request.urlopen(urllib.request.Request(
        "https://late-late.jp/mondai/show/%s" % rid, headers=UA), timeout=45).read().decode("utf-8", "ignore")
    io.open(T("_p%s.html" % rid), "w", encoding="utf-8").write(html)
    has = bool(re.search(r"<text_content>", html))
    print("#%s 存盘 %d 字节 | 有 text_content 标签: %s" % (rid, len(html), has))
    time.sleep(6.5)
