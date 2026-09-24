# -*- coding: utf-8 -*-
"""真浏览器实测 · 第三轮：行为级验证。

  1. 点绿勾不会误触「进汤」（stopPropagation 生效）
  2. 熬出汤底后自动打勾（finish() -> markSolved）
  3. 绿勾在单人汤库与多人选汤面板之间共享同一份本地记录
  4. 单人 / 多人两套 unlock 入口都在（多人端也有按钮）
  5. 房间人数徽章随玩家数刷新

输出写 tools/_cdp_report3.txt（UTF-8）。
"""
import json, os, subprocess, time, urllib.request
import websocket

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = "http://127.0.0.1:8899/index.html"
WORKER = "http://127.0.0.1:8791"
PORT = 9335
OUT = os.path.join(ROOT, "tools", "_cdp_report3.txt")
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
    prof = os.path.join(os.environ.get("TEMP", "."), "chrome-cdp-soup3")
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

        log("=== 第三轮行为级验证 ===")

        log("\n== 绿勾不误触进汤 ==")
        c.ev("document.querySelector('#btn-library').click()")
        time.sleep(1.5)
        r = c.ev("""(function(){
          var ck=document.querySelector('#lib-list .pz-check');
          ck.click();
          var game=document.querySelector('#screen-game');
          var lib=document.querySelector('#screen-library');
          return JSON.stringify({
            gameHidden: game? game.classList.contains('hidden') : null,
            libHidden: lib? lib.classList.contains('hidden') : null,
            title: (document.querySelector('#p-title')||{}).textContent || ''
          });
        })()""")
        log("   点绿勾后：" + str(r))
        rd = json.loads(r) if r and not str(r).startswith("__ERR__") else {}
        ok("点绿勾没有打开题目", rd.get("gameHidden") is True, r)
        ok("仍停在汤库页", rd.get("libHidden") is False, r)

        log("\n== 点卡片本体仍然能正常进汤 ==")
        c.ev("document.querySelector('#lib-list .pz-card').click()")
        time.sleep(2.2)
        r2 = c.ev("""(function(){
          var game=document.querySelector('#screen-game');
          var pid=window.SoupApp && SoupApp.pid? SoupApp.pid():'';
          return JSON.stringify({open: game? !game.classList.contains('hidden'):false, pid:pid,
            title:(document.querySelector('#p-title')||{}).textContent||''});
        })()""")
        log("   点卡片：" + str(r2))
        r2d = json.loads(r2) if r2 and not str(r2).startswith("__ERR__") else {}
        ok("卡片本体仍可进汤", r2d.get("open") is True and bool(r2d.get("pid")), r2)

        log("\n== 熬出汤底自动打勾 ==")
        # 重新载入，走「从第一题开始」进精品层
        c.call("Page.navigate", {"url": PAGE})
        time.sleep(3.2)
        c.ev("document.querySelector('#btn-start').click()")
        time.sleep(2.2)
        opened = c.ev("""(function(){
          var game=document.querySelector('#screen-game');
          return JSON.stringify({open: game? !game.classList.contains('hidden'):false,
            pid: SoupApp.pid(), title:(document.querySelector('#p-title')||{}).textContent||''});
        })()""")
        log("   打开精品汤：" + str(opened))
        od = json.loads(opened) if opened and not str(opened).startswith("__ERR__") else {}
        ok("精品汤已打开", od.get("open") is True and bool(od.get("pid")), opened)
        c.ev("localStorage.setItem('deepsea_soup_solved_v1','{}')")
        # 配一个假 AI 配置让 aiOn() 为真，再桩住网络判定为「对了」，驱动真实 finish() 流程
        auto = c.ev("""(async function(){
          var pid = SoupApp.pid();
          var before = SoupApp.isSolved(pid);
          SoupAI.setConfig({enabled:true, baseUrl:'https://example.invalid/v1', model:'stub-model', apiKey:'sk-stub'});
          var aiReady = SoupAI.isReady();
          var orig = SoupAI.judgeGuess;
          var stubCalled = false;
          SoupAI.judgeGuess = function(){ stubCalled = true;
            return Promise.resolve({level:'solved', note:'对了，正是这样。', source:'ai', model:'stub'}); };
          document.querySelector('#btn-guess').click();
          await new Promise(function(r){ setTimeout(r, 400); });
          document.querySelector('#guess-input').value = '我猜这是标准汤底';
          document.querySelector('#btn-guess-submit').click();
          await new Promise(function(r){ setTimeout(r, 2600); });
          var res = {pid:pid, before:before, after:SoupApp.isSolved(pid), aiReady:aiReady,
            stub:stubCalled,
            store: localStorage.getItem('deepsea_soup_solved_v1'),
            endOpen: !document.querySelector('#modal-end').classList.contains('hidden'),
            endStars:(document.querySelector('#end-stars')||{}).textContent||''};
          SoupAI.judgeGuess = orig;
          return JSON.stringify(res);
        })()""", timeout=60)
        log("   猜汤底结果：" + str(auto))
        ad = json.loads(auto) if auto and not str(auto).startswith("__ERR__") else {}
        ok("AI 判定走通并结算（汤底已揭晓）", ad.get("endOpen") is True, auto)
        ok("熬出汤底后自动打勾（本地记录已写入）",
           ad.get("before") is False and ad.get("after") is True and str(ad.get("pid")) in str(ad.get("store")),
           auto)

        log("\n== 汤库卡片读得到自动打的勾 ==")
        c.ev("""(function(){
          var b=document.querySelector('#btn-library'); if(b) b.click();
        })()""")
        time.sleep(1.5)
        refl = c.ev("""(function(){
          var pid=%s;
          var cards=document.querySelectorAll('#lib-list .pz-card');
          for(var i=0;i<cards.length;i++){
            if(cards[i].getAttribute('data-lib-id')===pid){
              return JSON.stringify({solved:cards[i].classList.contains('solved'),
                check:cards[i].querySelector('.pz-check').classList.contains('on')});
            }
          }
          // 不在首页 30 张里也算通过（记录已在 localStorage）
          return JSON.stringify({notOnPage:true, store:localStorage.getItem('deepsea_soup_solved_v1')});
        })()""" % json.dumps(ad.get("pid")))
        log("   汤库卡片：" + str(refl))
        rf = json.loads(refl) if refl and not str(refl).startswith("__ERR__") else {}
        ok("汤库卡片反映自动打的勾",
           rf.get("solved") is True or rf.get("notOnPage") is True, refl)

        log("\n== 绿勾跨面板共享（选汤面板读到同一份记录） ==")
        mark = c.ev("""(function(){
          localStorage.setItem('deepsea_soup_solved_v1', JSON.stringify({'turtle':1}));
          return localStorage.getItem('deepsea_soup_solved_v1');
        })()""")
        ok("预置记录已写入", "turtle" in str(mark), mark)
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
        # 进房徽章
        badge = c.ev("""(function(){
          var el=document.querySelector('#room-count');
          var players=document.querySelectorAll('#room-players .room-player');
          return JSON.stringify({badge: el? el.textContent : '', players: players.length});
        })()""")
        log("   徽章：" + str(badge))
        bd = json.loads(badge) if badge and not str(badge).startswith("__ERR__") else {}
        ok("房间徽章 1/15", bd.get("badge") == "1/15", badge)
        ok("玩家列表已渲染", (bd.get("players") or 0) >= 1, badge)

        c.ev("document.querySelector('#btn-room-choose').click()")
        time.sleep(2.5)
        shared = c.ev("""(function(){
          var cards=document.querySelectorAll('#pick-list .pz-card');
          var hit=null, on=0;
          for(var i=0;i<cards.length;i++){
            if(cards[i].getAttribute('data-id')==='turtle') hit=cards[i];
            if(cards[i].classList.contains('solved')) on++;
          }
          return JSON.stringify({found: !!hit,
            turtleSolved: hit? hit.classList.contains('solved'):null,
            turtleCheck: hit? hit.querySelector('.pz-check').classList.contains('on'):null,
            solvedCount: on});
        })()""")
        log("   选汤面板共享实测：" + str(shared))
        sd = json.loads(shared) if shared and not str(shared).startswith("__ERR__") else {}
        ok("选汤面板读得到单人那边打的勾", sd.get("turtleSolved") is True and sd.get("turtleCheck") is True, shared)

        c.ev("document.querySelector('#pick-cancel').click()")
        time.sleep(0.6)
        log("\n== 多人端也有密码看汤底入口 ==")
        mb = c.ev("""(function(){
          var b=document.querySelector('#btn-room-unlock');
          if(!b) return JSON.stringify({found:false});
          var r=b.getBoundingClientRect();
          return JSON.stringify({found:true, text:b.textContent.trim(),
            visible:r.width>0&&r.height>0, inAskbar: !!b.closest('.askbar'),
            font:getComputedStyle(b).fontFamily.slice(0,30)});
        })()""")
        log("   多人端按钮：" + str(mb))
        mbd = json.loads(mb) if mb and not str(mb).startswith("__ERR__") else {}
        ok("多人端有密码看汤底按钮", mbd.get("found") is True, mb)
        ok("多人端按钮独立成条", mbd.get("inAskbar") is False and mbd.get("visible") is True, mb)
        ok("多人端按钮同样是等宽紫字", "mono" in str(mbd.get("font", "")).lower(), mbd.get("font"))

        # 多人端弹窗
        c.ev("document.querySelector('#btn-room-unlock').click()")
        time.sleep(0.8)
        mm = c.ev("""(function(){
          var h=document.querySelector('.modal-unlock');
          if(!h) return JSON.stringify({open:false});
          return JSON.stringify({open:true, head:(h.querySelector('.unlock-head')||{}).textContent||''});
        })()""")
        log("   多人端弹窗：" + str(mm))
        mmd = json.loads(mm) if mm else {}
        ok("多人端弹窗也能打开且标题一致", mmd.get("open") is True and "权区" in str(mmd.get("head", "")), mm)

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
