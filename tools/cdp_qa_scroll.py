# -*- coding: utf-8 -*-
"""PC 端问答记录滚动现场复现探针。

用法: python tools/cdp_qa_scroll.py [mobile]
输出 tools/_cdp_qa_scroll.txt
"""
import json, os, subprocess, sys, time, urllib.request
import websocket

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = "http://127.0.0.1:8899/index.html"
PORT = 9347
MOBILE = len(sys.argv) > 1 and sys.argv[1] == "mobile"
OUT = os.path.join(ROOT, "tools", "_cdp_qa_scroll%s.txt" % ("_mobile" if MOBILE else ""))
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

lines = []
def log(s):
    lines.append(str(s))
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


class CDP:
    def __init__(self, wsurl):
        self.ws = websocket.create_connection(wsurl, timeout=90)
        self.i = 0

    def call(self, method, params=None, timeout=90):
        self.i += 1
        mid = self.i
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        end = time.time() + timeout
        while time.time() < end:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(method + " " + json.dumps(msg["error"], ensure_ascii=False))
                return msg.get("result", {})
        raise RuntimeError("timeout " + method)

    def ev(self, expr, timeout=90):
        r = self.call("Runtime.evaluate",
                      {"expression": expr, "returnByValue": True, "awaitPromise": True},
                      timeout=timeout)
        if r.get("exceptionDetails"):
            return "__ERR__ " + str(r["exceptionDetails"].get("exception", {}).get("description"))[:300]
        return r.get("result", {}).get("value")


SETUP = r"""
(function(){
  var box = document.getElementById('qa-log');
  var html = '';
  for (var i = 0; i < 40; i++) {
    html += '<div class="qa-item"><div class="qa-q"><span class="qa-k">Q' + (i+1) + '</span>这是第' + (i+1) + '个测试问题，问题内容比较长一点方便撑高容器撑出滚动空间</div>' +
            '<div class="qa-a"><span class="qa-k">A</span>这是第' + (i+1) + '个回答，回答也稍微长一点</div></div>';
  }
  box.innerHTML = html;
  var cs = getComputedStyle(box);
  // 小数 scrollTop 支持性测试
  box.scrollTop = 10.4;
  var frac = box.scrollTop;
  box.scrollTop = 0;
  return JSON.stringify({
    vw: innerWidth, vh: innerHeight,
    pointerFine: matchMedia('(pointer: fine)').matches,
    pointerCoarse: matchMedia('(pointer: coarse)').matches,
    mq861: matchMedia('(min-width: 861px)').matches,
    overflowY: cs.overflowY,
    touchAction: cs.touchAction,
    scrollHeight: box.scrollHeight,
    clientHeight: box.clientHeight,
    over: box.scrollHeight - box.clientHeight,
    fracSupported: (frac === 10.4),
    fracReadback: frac,
    hasSoupRoom: !!(window.SoupRoom && window.SoupRoom.ensureQaScroll)
  });
})()
"""

SAMPLE = r"""
(function(){
  var box = document.getElementById('qa-log');
  return JSON.stringify({
    scrollTop: box.scrollTop,
    t: Date.now()
  });
})()
"""

WHEEL_TEST = r"""
(function(){
  // 记录是否被 preventDefault
  var box = document.getElementById('qa-log');
  window.__wheelBlocked = null;
  box.addEventListener('wheel', function(e){ window.__wheelBlocked = e.defaultPrevented; }, { passive: true });
  return 'ok';
})()
"""


def main():
    prof = os.path.join(os.environ.get("TEMP", "."), "chrome-cdp-qascroll")
    subprocess.run(["cmd", "/c", "rmdir", "/s", "/q", prof], capture_output=True)
    args = [CHROME, "--headless=new", "--disable-gpu", "--no-first-run",
            "--remote-allow-origins=*",
            "--remote-debugging-port=%d" % PORT, "--user-data-dir=%s" % prof,
            "--window-size=1600,900", "about:blank"]
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        # 等 devtools 起来
        pages = None
        for _ in range(60):
            time.sleep(0.5)
            try:
                with urllib.request.urlopen("http://127.0.0.1:%d/json" % PORT, timeout=2) as r:
                    pages = json.loads(r.read().decode("utf-8"))
                if pages:
                    break
            except Exception:
                pass
        if not pages:
            log("FAIL: devtools not up")
            return
        ws = [p for p in pages if p.get("type") == "page"][0]["webSocketDebuggerUrl"]
        cdp = CDP(ws)
        cdp.call("Page.enable")
        cdp.call("Runtime.enable")
        if MOBILE:
            cdp.call("Emulation.setDeviceMetricsOverride",
                     {"width": 390, "height": 844, "deviceScaleFactor": 3, "mobile": True})
            cdp.call("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        cdp.call("Page.navigate", {"url": PAGE})
        time.sleep(3.5)
        # 进入单人对局屏（qaScrollWanted 需要 screen-game 可见）
        cdp.ev("(function(){var b=document.getElementById('btn-start');if(b){b.click();return 'clicked'}return 'nobtn'})()")
        time.sleep(1.5)
        info = json.loads(cdp.ev(SETUP))
        log("MODE: %s" % ("mobile" if MOBILE else "desktop"))
        for k, v in info.items():
            log("  %s = %s" % (k, v))
        # 启动自动滚动（模拟单人局：screen-game 可见性未知，直接调 ensureQaScroll 前先看看 wanted）
        cdp.ev(WHEEL_TEST)
        cdp.ev("(function(){ if(window.SoupRoom&&window.SoupRoom.ensureQaScroll){window.SoupRoom.ensureQaScroll();} return 1; })()")
        s0 = json.loads(cdp.ev(SAMPLE))
        time.sleep(2.0)
        s1 = json.loads(cdp.ev(SAMPLE))
        time.sleep(3.0)
        s2 = json.loads(cdp.ev(SAMPLE))
        log("auto-scroll samples: t0=%s t+2s=%s t+5s=%s" % (s0["scrollTop"], s1["scrollTop"], s2["scrollTop"]))
        moved = abs(s2["scrollTop"] - s0["scrollTop"]) > 2
        log("AUTO_SCROLL_MOVING: %s (expect ~%d px in 5s)" % (moved, 24 * 5))
        # 滚轮手动测试
        if not MOBILE:
            cdp.call("Input.dispatchMouseEvent", {"type": "mouseWheel", "x": 120, "y": 400,
                                                  "deltaX": 0, "deltaY": 120, "button": "none",
                                                  "clickCount": 0, "pointerType": "mouse"})
            time.sleep(0.4)
            s3 = json.loads(cdp.ev(SAMPLE))
            blocked = cdp.ev("String(window.__wheelBlocked)")
            log("wheel: defaultPrevented=%s scrollTop_after_wheel=%s" % (blocked, s3["scrollTop"]))
            # 等手动让位 4 秒过期，确认自动滚动从玩家停下的位置接管继续往下滚
            time.sleep(4.6)
            s3b = json.loads(cdp.ev(SAMPLE))
            log("wheel+4.6s: scrollTop=%s (expect > wheel pos %s, auto resumed)" % (s3b["scrollTop"], s3["scrollTop"]))
        # 到底回顶测试：先等让位过期，再跳到底部附近看停顿回顶逻辑
        time.sleep(0.6)
        cdp.ev("(function(){var b=document.getElementById('qa-log');b.scrollTop=b.scrollHeight;return 1;})()")
        time.sleep(2.4)
        s4 = json.loads(cdp.ev(SAMPLE))
        log("after jump-to-bottom + 2.4s: scrollTop=%s (expect small: 1.6s hold then restart from top)" % s4["scrollTop"])
        log("DONE")
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
