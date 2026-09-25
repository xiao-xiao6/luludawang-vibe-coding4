# -*- coding: utf-8 -*-
"""庆祝前景层截图验收：弹窗遮罩在场时礼炮/烟花是否清晰压在上面。"""
import base64, json, os, subprocess, time, urllib.request
import websocket

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = "http://127.0.0.1:8899/index.html"
PORT = 9349
SHOT = os.path.join(ROOT, "tools", "shots", "celebrate_front.png")
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"


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

    def ev(self, expr):
        r = self.call("Runtime.evaluate", {"expression": expr, "returnByValue": True})
        return r.get("result", {}).get("value")


def main():
    prof = os.path.join(os.environ.get("TEMP", "."), "chrome-cdp-shot")
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
        cdp.ev("""
        (function(){
          var box = document.getElementById('qa-log');
          var html = '';
          for (var i = 0; i < 12; i++) {
            html += '<div class="qa-item"><div class="qa-q"><span class="qa-k">Q' + (i+1) + '</span>测试问题</div><div class="qa-a"><span class="qa-k">A</span>测试回答</div></div>';
          }
          box.innerHTML = html;
          var wrap = document.createElement('div');
          wrap.className = 'modal-wrap';
          wrap.innerHTML = '<div class="modal" role="dialog"><h3>汤底揭晓</h3><p class="end-note">🎉 噜噜大王 说破了汤底 · 共 12 问</p><div class="truth-box"><p style="margin:0">这是一段用来验收遮罩模糊效果的示例汤底文字，汤底揭晓时背景会被这层遮罩压暗并模糊。</p></div><div class="modal-actions"><button type="button" class="btn ghost">知道了</button></div></div>';
          document.body.appendChild(wrap);
          document.body.classList.add('modal-open');
          window.SoupFx.celebrate();
          return 1;
        })()
        """)
        time.sleep(1.15)
        r = cdp.call("Page.captureScreenshot", {"format": "png"})
        with open(SHOT, "wb") as f:
            f.write(base64.b64decode(r["data"]))
        print("saved", SHOT)
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
