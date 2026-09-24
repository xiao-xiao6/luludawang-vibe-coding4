# -*- coding: utf-8 -*-
"""测量多人房内聊天框与其他元素的几何关系，判断是否有遮挡。

输出 tools/_cdp_measure.txt
"""
import json, os, subprocess, time, urllib.request
import websocket

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = "http://127.0.0.1:8899/index.html"
WORKER = "http://127.0.0.1:8791"
PORT = 9338
OUT = os.path.join(ROOT, "tools", "_cdp_measure.txt")
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
            return "__ERR__ " + str(r["exceptionDetails"].get("exception", {}).get("description"))[:200]
        return r.get("result", {}).get("value")


MEASURE = r"""
(function(){
  function R(sel){ var e=document.querySelector(sel); if(!e) return null;
    var r=e.getBoundingClientRect();
    return {x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),
            r:Math.round(r.right),b:Math.round(r.bottom)}; }
  function inter(a,b){
    if(!a||!b) return 0;
    var w=Math.min(a.r,b.r)-Math.max(a.x,b.x);
    var h=Math.min(a.b,b.b)-Math.max(a.y,b.y);
    return (w>0&&h>0)? Math.round(w*h):0;
  }
  var chat=R('#room-chat'), qa=R('#btn-room-qa'), clue=R('.col-clue'),
      clueList=R('.col-clue .clue-list'), askbar=R('#room-askbar')||R('.askbar'),
      mid=R('.col-stage'), ready=R('#btn-room-ready');
  return JSON.stringify({
    vw: window.innerWidth, vh: window.innerHeight,
    chat:chat, qa:qa, clue:clue, clueList:clueList, askbar:askbar, mid:mid, ready:ready,
    overlap_qa_chat: inter(qa,chat),
    overlap_clueList_chat: inter(clueList,chat),
    overlap_askbar_chat: inter(askbar,chat),
    chatRightGap: chat? window.innerWidth-chat.r : null
  });
})()
"""


def main():
    prof = os.path.join(os.environ.get("TEMP", "."), "chrome-cdp-measure")
    subprocess.run(["cmd", "/c", "rmdir", "/s", "/q", prof], capture_output=True)
    proc = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", "--no-first-run",
                             "--no-default-browser-check",
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

        # 选一锅，让线索板与问答都有内容，暴露真实遮挡
        c.ev("document.querySelector('#btn-room-choose').click()")
        time.sleep(2.5)
        c.ev("document.querySelector('#pick-list .pz-card').click()")
        time.sleep(5.0)
        log("1366x900：")
        log(str(c.ev(MEASURE)))

        # 换个更高的窗口再测一次
        c.call("Emulation.setDeviceMetricsOverride",
               {"width": 1600, "height": 1000, "deviceScaleFactor": 1, "mobile": False})
        time.sleep(1.0)
        log("\n1600x1000：")
        log(str(c.ev(MEASURE)))

        c.call("Emulation.setDeviceMetricsOverride",
               {"width": 1180, "height": 820, "deviceScaleFactor": 1, "mobile": False})
        time.sleep(1.0)
        log("\n1180x820（窄桌面，应切单列）：")
        log(str(c.ev(MEASURE)))
    finally:
        try:
            proc.terminate()
        except Exception:
            pass


if __name__ == "__main__":
    main()
