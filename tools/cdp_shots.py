# -*- coding: utf-8 -*-
"""真浏览器截图：目视确认本轮视觉改动。

输出 tools/shots/*.png
"""
import base64, json, os, subprocess, time, urllib.request
import websocket

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = "http://127.0.0.1:8899/index.html"
WORKER = "http://127.0.0.1:8791"
PORT = 9337
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
SHOTS = os.path.join(ROOT, "tools", "shots")


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
            return "__ERR__ " + str(r["exceptionDetails"].get("exception", {}).get("description"))[:200]
        return r.get("result", {}).get("value")

    def shot(self, name):
        r = self.call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})
        data = base64.b64decode(r["data"])
        path = os.path.join(SHOTS, name)
        with open(path, "wb") as f:
            f.write(data)
        print("saved", name, len(data))


def main():
    os.makedirs(SHOTS, exist_ok=True)
    prof = os.path.join(os.environ.get("TEMP", "."), "chrome-cdp-shots")
    subprocess.run(["cmd", "/c", "rmdir", "/s", "/q", prof], capture_output=True)
    proc = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", "--no-first-run",
                             "--no-default-browser-check", "--hide-scrollbars",
                             "--remote-debugging-port=%d" % PORT,
                             "--remote-allow-origins=*",
                             "--user-data-dir=" + prof,
                             "--window-size=1366,900", "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(80):
            time.sleep(0.5)
            try:
                with urllib.request.urlopen("http://127.0.0.1:%d/json/version" % PORT, timeout=2) as r:
                    json.loads(r.read().decode())
                break
            except Exception:
                continue
        req = urllib.request.Request("http://127.0.0.1:%d/json/new?%s" % (PORT, "about:blank"), method="PUT")
        with urllib.request.urlopen(req, timeout=10) as r:
            t = json.loads(r.read().decode())
        c = CDP(t["webSocketDebuggerUrl"])
        c.call("Runtime.enable")
        c.call("Page.enable")
        c.call("Page.navigate", {"url": PAGE})
        time.sleep(3.5)

        # 1) 单人汤库 + 绿勾（先勾两个）
        c.ev("document.querySelector('#btn-library').click()")
        time.sleep(1.8)
        c.ev("""(function(){
          var cks=document.querySelectorAll('#lib-list .pz-check');
          cks[0].click(); cks[1].click(); cks[3].click();
        })()""")
        time.sleep(0.8)
        c.shot("01-library-check.png")

        # 2) 单人汤面 + 密码看汤底（权区）独立按钮
        c.ev("document.querySelector('#lib-list .pz-card').click()")
        time.sleep(2.5)
        c.shot("02-solo-askbar-unlock.png")

        # 3) 权区弹窗
        c.ev("document.querySelector('#btn-unlock').click()")
        time.sleep(0.9)
        c.ev("""(function(){
          var i=document.querySelector('#unlock-code');
          i.value='608521';
          document.querySelector('#unlock-ok').click();
        })()""")
        time.sleep(1.0)
        c.shot("03-unlock-modal.png")
        c.ev("document.querySelector('#unlock-cancel').click()")
        time.sleep(0.5)

        # 4) 汤库里的 tag 标签特写（十二楼）
        c.ev("""(function(){
          var b=document.querySelector('#btn-library'); if(b) b.click();
        })()""")
        time.sleep(1.5)
        c.ev("""(function(){
          var kw=document.querySelector('#lib-search');
          kw.value='十二楼'; kw.dispatchEvent(new Event('input',{bubbles:true}));
        })()""")
        time.sleep(1.8)
        c.shot("04-library-tag.png")

        # 5) 多人房：选汤面板（tag + 绿勾）
        c.ev("SoupNet.setBase(%s)" % json.dumps(WORKER))
        c.ev("document.querySelector('#btn-multi').click()")
        time.sleep(1.0)
        c.ev("document.querySelector('#btn-room-create').click()")
        time.sleep(1.2)
        c.ev("""(function(){
          var i=document.querySelector('#pt-nick');
          if(i){ i.value='翔太'; document.querySelector('#pt-nick-ok').click(); }
        })()""")
        time.sleep(4.5)
        c.shot("05-room-chat-expanded.png")
        c.ev("document.querySelector('#btn-room-choose').click()")
        time.sleep(2.5)
        c.shot("06-room-pick-tags.png")
        c.ev("document.querySelector('#pick-cancel').click()")
        time.sleep(0.6)

        # 6) 多人房弹窗 + 独立按钮
        c.ev("document.querySelector('#btn-room-unlock').click()")
        time.sleep(0.9)
        c.shot("07-room-unlock-modal.png")
    finally:
        try:
            proc.terminate()
        except Exception:
            pass


if __name__ == "__main__":
    main()
