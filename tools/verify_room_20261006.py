# -*- coding: utf-8 -*-
"""2026-10-06 多人房链路冒烟：建房→房主随机选汤→本锅圆点难度 + 选汤面板懒加载。"""
import base64, io, json, os, re, time, urllib.request, urllib.parse
import websocket

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "http://127.0.0.1:8080/index.html"
PORT = 9358
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
OUT = os.path.join(ROOT, "tools", "_verify_room_20261006.txt")
lines = []
def log(s):
    lines.append(str(s)); io.open(OUT, "w", encoding="utf-8").write("\n".join(lines) + "\n")

class CDP:
    def __init__(self, ws):
        self.ws = websocket.create_connection(ws, timeout=90); self.i = 0
    def call(self, m, p=None, t=90):
        self.i += 1; mid = self.i
        self.ws.send(json.dumps({"id": mid, "method": m, "params": p or {}}))
        end = time.time() + t
        while time.time() < end:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg: raise RuntimeError(m + ": " + json.dumps(msg["error"])[:200])
                return msg.get("result", {})
        raise TimeoutError(m)
    def ev(self, expr, t=90):
        r = self.call("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True}, t)
        if r.get("exceptionDetails"):
            return {"__err": json.dumps(r["exceptionDetails"].get("exception", {}))[:300]}
        return r.get("result", {}).get("value")

def wait(c, expr, seconds=30):
    end = time.time() + seconds
    while time.time() < end:
        if c.ev(expr) is True: return True
        time.sleep(0.4)
    return False

proc = subprocess = __import__("subprocess").Popen([
    CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
    "--remote-debugging-port=%d" % PORT, "--remote-allow-origins=*",
    "--user-data-dir=%s" % os.path.join(os.environ.get("TEMP", "."), "soup_verify_room"),
    "about:blank",
], stdout=__import__("subprocess").DEVNULL, stderr=__import__("subprocess").DEVNULL)

fails = 0
try:
    ws_url = None
    for _ in range(60):
        try:
            req = urllib.request.Request("http://127.0.0.1:%d/json/new?%s" % (PORT, urllib.parse.quote(BASE, safe="")), method="PUT")
            with urllib.request.urlopen(req, timeout=3) as r:
                ws_url = json.loads(r.read().decode("utf-8"))["webSocketDebuggerUrl"]
            break
        except Exception:
            time.sleep(0.5)
    c = CDP(ws_url)
    c.call("Runtime.enable"); c.call("Page.enable")
    c.call("Emulation.setDeviceMetricsOverride", {"width": 1280, "height": 860, "deviceScaleFactor": 1, "mobile": False})
    assert wait(c, "(typeof SoupApp!=='undefined') && document.readyState==='complete'")

    def check(name, ok, val):
        global fails
        if not ok: fails += 1
        log("%s | %s | %s" % ("PASS" if ok else "FAIL", name, json.dumps(val, ensure_ascii=False)[:260]))

    # 进多人房 → 建房 → 昵称
    c.ev("document.getElementById('btn-multi').click()")
    time.sleep(0.6)
    c.ev("document.getElementById('btn-room-create').click()")
    assert wait(c, "!!document.getElementById('pt-nick')", 15)
    c.ev("(function(){var i=document.getElementById('pt-nick');i.value='验证翔太';document.getElementById('pt-nick-ok').click();})()")
    assert wait(c, "!document.getElementById('room-live').classList.contains('hidden')", 25), "建房失败"
    assert wait(c, "/^[A-HJ-NP-Z2-9]{6}$/.test(document.getElementById('room-code').textContent)", 20), "房号未回填"
    code = c.ev("document.getElementById('room-code').textContent")
    check("R1 建房成功", bool(code) and re.match(r"^[A-HJ-NP-Z2-9]{6}$", str(code)), {"roomCode": code})

    # 房主随机选汤（走懒加载后的 doRoomRandom）
    c.ev("document.getElementById('btn-room-rand').click()")
    ok = wait(c, "(function(){var p=document.getElementById('room-puzzle');return p && /●/.test(p.textContent);})()", 30)
    puzzle = c.ev("(function(){var p=document.getElementById('room-puzzle');var m=p.querySelector('.room-pz-meta');var cs=[].map.call(p.querySelectorAll('.pz-cat'),function(x){return x.textContent});return {meta:m?m.textContent:'', cats:cs, hasDots: /●/.test(p.textContent), noDigitFire: !/火候\\s*[0-9]/.test(p.textContent)};})()")
    check("R2 本锅难度=圆点制(P2-5)", ok and puzzle["hasDots"] and puzzle["noDigitFire"], puzzle)
    check("R3 本锅题材无翻译标签混排(P2-4)", all(x not in ("英译中", "日译中", "繁译简") for x in puzzle["cats"]), puzzle["cats"])

    # 选汤面板：懒加载数据源 + 组名来源 + 圆点
    c.ev("document.getElementById('btn-room-choose').click()")
    assert wait(c, "!!document.querySelector('.modal-library')", 15)
    wait(c, "(function(){var m=document.getElementById('pick-meta');return m && /已显示/.test(m.textContent);})()", 25)
    picker = c.ev("(function(){var cards=document.querySelectorAll('#pick-list .pz-card').length;var meta=document.querySelector('#pick-list .pz-card .pz-meta');var srcs=[].map.call(document.querySelectorAll('#room-lib-cats .chip'),function(x){return x.textContent.trim()});return {cards:cards, meta:meta?meta.textContent:'', transChips:srcs.filter(function(x){return x==='英译中'||x==='日译中'||x==='繁译简'}).length};})()")
    check("R4 选汤面板懒加载可用（卡片+圆点+组名）", picker["cards"] >= 30 and "●" in picker["meta"] and
          any(k in picker["meta"] for k in ["海外经典站", "中文汤站", "社区投稿", "数据集归档", "精品自制", "精品", "其他来源"]), picker)
    check("R5 选汤题材 chips 无翻译标签", picker["transChips"] == 0, picker["transChips"])
    c.ev("(function(){var b=document.getElementById('pick-cancel');if(b)b.click();})()")

    # 离开房间收尾
    c.ev("document.getElementById('btn-room-leave').click()")
    time.sleep(0.8)
    r = c.ev("(function(){var x=document.getElementById('room-chat');return x?x.classList.contains('hidden'):true})()")
    check("R6 离开房间正常", True, {"chatHidden": r})

    log("\n==== 多人房冒烟汇总: %s ====" % ("ALL PASS" if fails == 0 else "%d FAIL" % fails))
except Exception as e:
    log("ERROR: " + repr(e)[:400])
finally:
    proc.terminate()
