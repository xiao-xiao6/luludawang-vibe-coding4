# -*- coding: utf-8 -*-
"""庆祝前景层 + 二级确认面板 回归探针（桌面视口）。"""
import json, os, subprocess, time, urllib.request
import websocket

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = "http://127.0.0.1:8899/index.html"
PORT = 9348
OUT = os.path.join(ROOT, "tools", "_cdp_fixes.txt")
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


CELEBRATE_TEST = r"""
(function(){
  // 模拟揭底弹窗在场时放庆祝
  var wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.id = 'probe-modal';
  wrap.innerHTML = '<div class="modal"><h3>汤底揭晓</h3><div class="truth-box"><p>测试汤底</p></div></div>';
  document.body.appendChild(wrap);
  window.SoupFx.celebrate();
  return 'ok';
})()
"""

CANVAS_CHECK = r"""
(function(){
  var c = document.getElementById('fx-front');
  if (!c) return JSON.stringify({exists:false});
  var ctx = c.getContext('2d');
  var w = c.width, h = c.height;
  var img = ctx.getImageData(0, 0, w, h).data;
  var lit = 0;
  for (var i = 3; i < img.length; i += 4) { if (img[i] > 8) lit++; }
  var cs = getComputedStyle(c);
  var modal = document.getElementById('probe-modal');
  var mcs = modal ? getComputedStyle(modal) : null;
  return JSON.stringify({
    exists: true, litPixels: lit,
    zIndex: cs.zIndex, pointerEvents: cs.pointerEvents,
    modalZ: mcs ? mcs.zIndex : null,
    modalBlur: mcs ? (mcs.backdropFilter || mcs.webkitBackdropFilter) : null,
    frontAboveModal: (parseInt(cs.zIndex,10) > parseInt(mcs ? mcs.zIndex : '0', 10))
  });
})()
"""

CONFIRM_TEST = r"""
(function(){
  var out = {};
  var b = document.getElementById('btn-room-giveup');
  if (!b) return JSON.stringify({error:'no giveup btn'});
  b.click();
  var wrap = document.getElementById('confirm-wrap');
  out.shown = !!wrap;
  if (wrap) {
    out.hasYes = !!document.getElementById('cf-yes');
    out.hasNo = !!document.getElementById('cf-no');
    out.title = (document.querySelector('#confirm-wrap h3')||{}).textContent || '';
    document.getElementById('cf-no').click();
    out.closedAfterNo = !document.getElementById('confirm-wrap');
  }
  // 再开一次，点遮罩空白处也应关闭
  b.click();
  var w2 = document.getElementById('confirm-wrap');
  if (w2) {
    var ev = new MouseEvent('click', {bubbles:true});
    w2.dispatchEvent(ev);
    out.closedAfterBackdrop = !document.getElementById('confirm-wrap');
  }
  return JSON.stringify(out);
})()
"""


def main():
    prof = os.path.join(os.environ.get("TEMP", "."), "chrome-cdp-fixes")
    subprocess.run(["cmd", "/c", "rmdir", "/s", "/q", prof], capture_output=True)
    args = [CHROME, "--headless=new", "--disable-gpu", "--no-first-run",
            "--remote-allow-origins=*",
            "--remote-debugging-port=%d" % PORT, "--user-data-dir=%s" % prof,
            "--window-size=1600,900", "about:blank"]
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
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
        ws = [p for p in pages if p.get("type") == "page"][0]["webSocketDebuggerUrl"]
        cdp = CDP(ws)
        cdp.call("Page.enable")
        cdp.call("Runtime.enable")
        cdp.call("Page.navigate", {"url": PAGE})
        time.sleep(3.5)
        # 特效总开关确认开着
        log("fx enabled = " + str(cdp.ev("window.SoupFx.isEnabled()")))
        # 庆祝前景层
        log("celebrate: " + str(cdp.ev(CELEBRATE_TEST)))
        time.sleep(1.0)
        log("canvas@1s: " + str(cdp.ev(CANVAS_CHECK)))
        time.sleep(2.5)
        log("canvas@3.5s: " + str(cdp.ev(CANVAS_CHECK)))
        cdp.ev("(function(){var m=document.getElementById('probe-modal');if(m)m.remove();return 1;})()")
        # 二级确认面板
        log("confirm: " + str(cdp.ev(CONFIRM_TEST)))
        log("DONE")
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
