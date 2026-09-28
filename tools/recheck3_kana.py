# -*- coding: utf-8 -*-
"""细粒度日文残留扫描：孤立假名串（前后 16 字内无汉字）+ 日语谓语尾巴残留。"""
import io, os, re, json

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
T = lambda *p: os.path.join(ROOT, "tools", *p)

raw = io.open(os.path.join(ROOT, "data", "library", "library.data.js"), encoding="utf-8").read()
h = raw.index("var SOUP_LIBRARY = ") + len("var SOUP_LIBRARY = ")
data, _ = json.JSONDecoder().raw_decode(raw[h:])
ids = set(json.load(io.open(T("recheck3_ids.json"), encoding="utf-8")))
new = [o for o in data if str(o.get("srcNo") or "") in ids]

KANARUN = re.compile(r"[\u3040-\u30ff]{4,}")
HAN = re.compile(r"[\u4e00-\u9fff]")
ENDJA = re.compile(r"(?:です|ます|でした|ません|だろ|である|ていた|ている|ましょう|ください|だね|だよ|だな)")

hits = []
for o in new:
    sn = str(o.get("srcNo"))
    for f in ("title", "surface", "truth"):
        s = o.get(f) or ""
        for m in KANARUN.finditer(s):
            win = s[max(0, m.start() - 16):min(len(s), m.end() + 16)]
            if not HAN.search(win.replace(m.group(), "")):
                hits.append("%s.%s 孤立假名串: %s" % (sn, f, m.group()[:16]))
        for mm in ENDJA.finditer(s):
            ctx = s[max(0, mm.start() - 10):mm.end() + 4]
            hits.append("%s.%s 日语谓语残留: %s" % (sn, f, ctx.replace("\n", "⏎")))

io.open(T("_kana_fine.txt"), "w", encoding="utf-8").write("\n".join(hits))
print("细扫命中:", len(hits))
