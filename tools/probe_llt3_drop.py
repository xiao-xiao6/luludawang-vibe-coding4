# -*- coding: utf-8 -*-
"""抽查被记为「无解説」的帖子：确认正文/答案到底在哪个标签里，避免解析方式系统性丢题。"""
import io, os, re, sys, json, urllib.request

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"}
ids = sys.argv[1:] or ["21792"]

for rid in ids:
    req = urllib.request.Request("https://late-late.jp/mondai/show/%s" % rid, headers=UA)
    html = urllib.request.urlopen(req, timeout=40).read().decode("utf-8", "ignore")
    tags = sorted(set(re.findall(r"<(text_[a-z_]+)>", html)))
    print("### #%s 页长 %d | text_ 标签: %s" % (rid, len(html), tags))
    for t in ("text_title", "text_content", "text_kaisetu", "text_comment", "text_answer"):
        m = re.search("<" + t + ">([\\s\\S]{0,140}?)</" + t + ">", html)
        print("   %-13s → %s" % (t, (m.group(1).replace("\n", " ")[:90] if m else "（无此标签）")))
    for kw in ("未解決", "解決ずみ", "解決済み", "この問題の回答", "回答はまだありません", "kaisetu", "解説"):
        if kw in html:
            print("   命中关键词:", kw)
