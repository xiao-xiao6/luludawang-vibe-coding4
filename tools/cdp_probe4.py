# -*- coding: utf-8 -*-
"""真浏览器实测 · 第四轮：15 人满房 + 布局压力。

  1. 服务端真的允许 15 人满房，第 16 人被拒（ROOM_FULL）
  2. 15 人时玩家列表不溢出，按钮仍在视口内
  3. 玩家列表限高滚动已生效

输出写 tools/_cdp_report4.txt（UTF-8）。
"""
import json, os, subprocess, time, urllib.request, urllib.error
import websocket

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = "http://127.0.0.1:8899/index.html"
WORKER = "http://127.0.0.1:8791"
PORT = 9336
OUT = os.path.join(ROOT, "tools", "_cdp_report4.txt")
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

lines, fails = [], [0]

def log(s):
    lines.append(str(s))

def flush():
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

def ok(name, cond, extra=""):
    if cond:
        log("  [PASS] " + name + (("   [" + str(extra) + "]") if extra else ""))
    else:
        fails[0] += 1
        log("  [FAIL] " + name + (("   [" + str(extra) + "]") if extra else ""))
    flush()


def api(path, method="GET", body=None, origin="http://127.0.0.1:8899"):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(WORKER + path, data=data, method=method)
    if data:
        r.add_header("content-type", "application/json")
    r.add_header("Origin", origin)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}


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


def start_chrome():
    prof = os.path.join(os.environ.get("TEMP", "."), "chrome-cdp-soup4")
    subprocess.run(["cmd", "/c", "rmdir", "/s", "/q", prof], capture_output=True)
    p = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", "--no-first-run",
                          "--no-default-browser-check",
                          "--remote-debugging-port=%d" % PORT,
                          "--remote-allow-origins=*",
                          "--user-data-dir=" + prof,
                          "--window-size=1366,900", "about:blank"],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(80):
        time.sleep(0.5)
        try:
            with urllib.request.urlopen("http://127.0.0.1:%d/json/version" % PORT, timeout=2) as r:
                json.loads(r.read().decode())
            return p
        except Exception:
            continue
    raise RuntimeError("chrome 起不来")


def new_target(url):
    req = urllib.request.Request("http://127.0.0.1:%d/json/new?%s" % (PORT, url), method="PUT")
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode())


def main():
    proc = start_chrome()
    try:
        c = CDP(new_target("about:blank")["webSocketDebuggerUrl"])
        c.call("Runtime.enable")
        c.call("Page.enable")
        c.call("Page.navigate", {"url": PAGE})
        time.sleep(3.2)

        log("=== 第四轮：15 人满房 + 布局压力 ===")

        log("\n== 服务端容量：15 人满、第 16 人被拒 ==")
        st, room = api("/api/room/new", "POST", {"nickname": "房主", "layer": "all",
                                             "internalId": "host-internal-0001"})
        code = room.get("roomCode")
        ok("建房成功", st == 200 and bool(code), code)
        host_id = "host-internal-0001"
        # 建房时房主已占 1 席，再 join 是以 uid 2 入座
        joined = 1
        full_err = None
        for i in range(2, 22):
            st2, j = api("/api/room/%s/join" % code, "POST",
                         {"nickname": "客%d" % i, "internalId": "guest-internal-%03d" % i})
            if j.get("error"):
                full_err = j.get("error")
                break
            joined += 1
        log("   实际入座：%d 人，首个错误：%s" % (joined, full_err))
        ok("服务端允许坐满 15 人", joined == 15, "joined=%s" % joined)
        ok("第 16 人被拒且报 ROOM_FULL", full_err == "ROOM_FULL", full_err)

        st3, snap = api("/api/room/%s/state?me=%s" % (code, 1))
        n_players = len(snap.get("players") or [])
        log("   快照玩家数：%s" % n_players)
        ok("快照确实装下 15 人", n_players == 15, n_players)

        log("\n== 前端 15 人布局压力 ==")
        c.ev("SoupNet.setBase(%s)" % json.dumps(WORKER))
        # 让页面用房主身份恢复这间房，直接看 15 人布局
        c.ev("""(function(){
          try{
            localStorage.setItem('soupnet.v1', JSON.stringify({
              roomCode:%s, internalId:%s, nickname:'房主', solo:false, base:%s
            }));
          }catch(e){}
        })()""" % (json.dumps(code), json.dumps(host_id), json.dumps(WORKER)))
        c.call("Page.navigate", {"url": PAGE})
        time.sleep(4.0)
        # 不点「多人房间」：那会回到建房页。刷新后 resume() 会自动接回房内。
        live = c.ev("""(function(){
          var l=document.querySelector('#room-live');
          return JSON.stringify({live: l? !l.classList.contains('hidden'):false,
            screenRoom: !document.querySelector('#screen-room').classList.contains('hidden'),
            badge:(document.querySelector('#room-count')||{}).textContent||'',
            players:document.querySelectorAll('#room-players .room-player').length});
        })()""")
        log("   页面状态：" + str(live))
        ld = json.loads(live) if live and not str(live).startswith("__ERR__") else {}
        if not ld.get("live"):
            # 兜底：手动触发一次 resume
            c.ev("SoupRoom.resume()")
            time.sleep(3.5)
            live = c.ev("""(function(){
              var l=document.querySelector('#room-live');
              return JSON.stringify({live: l? !l.classList.contains('hidden'):false,
                badge:(document.querySelector('#room-count')||{}).textContent||'',
                players:document.querySelectorAll('#room-players .room-player').length});
            })()""")
            log("   手动 resume 后：" + str(live))
            ld = json.loads(live) if live and not str(live).startswith("__ERR__") else {}
        ok("刷新后自动接回满房", ld.get("live") is True, ld)
        ok("页面确实渲染 15 人", (ld.get("players") or 0) == 15 and ld.get("badge") == "15/15", ld)

        layout = c.ev("""(function(){
          var list=document.querySelector('#room-players');
          var ready=document.querySelector('#btn-room-ready');
          var chat=document.querySelector('#room-chat');
          if(!list) return JSON.stringify({found:false});
          var lr=list.getBoundingClientRect();
          var rr=ready? ready.getBoundingClientRect():null;
          var cs=getComputedStyle(list);
          return JSON.stringify({
            found:true,
            listH:Math.round(lr.height),
            scrollable: list.scrollHeight > list.clientHeight,
            overflowY: cs.overflowY,
            maxH: cs.maxHeight,
            readyTop: rr?Math.round(rr.top):null,
            readyVisible: rr? (rr.top>=0 && rr.bottom<=window.innerHeight):null,
            chatCollapsed: chat? chat.classList.contains('collapsed'):null,
            vh: window.innerHeight});
        })()""")
        log("   布局实测：" + str(layout))
        ly = json.loads(layout) if layout and not str(layout).startswith("__ERR__") else {}
        ok("玩家列表限高已生效", ly.get("maxH") not in (None, "none"), ly)
        ok("列表超出时可滚动", ly.get("scrollable") is not True or ly.get("overflowY") == "auto", ly)
        ok("「我准备好了」仍在视口内", ly.get("readyVisible") is True, ly)

        log("\n== 汇总 ==")
        log("失败项：%d" % fails[0])
        flush()
    finally:
        try:
            proc.terminate()
        except Exception:
            pass
        flush()


if __name__ == "__main__":
    main()
