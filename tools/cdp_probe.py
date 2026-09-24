# -*- coding: utf-8 -*-
"""真浏览器实测：用 headless Chrome + CDP 验证本轮六项改动。

覆盖：
  1. 进房人数上限 15（HTML 徽章 + 服务端 UID_MAX）
  2. 多人「选一锅汤」二级面板：选汤时和选完后都能看到 tag 标签
  3. 密码看汤底（权区）：独立按钮位 + 紫色样式 + 新文案 + 新密码 608521
  4. GSAP 黑幕转场加速
  5. 「已熬出汤底」小绿勾：单人汤库可点、可持久化、可取消
  6. 多人房间聊天默认展开 + 尺寸固定、线索板加高

输出写 tools/_cdp_report.txt（UTF-8）。
"""
import json, os, subprocess, sys, time, urllib.request
import websocket

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = "http://127.0.0.1:8899/index.html"
WORKER = "http://127.0.0.1:8791"
PORT = 9333
OUT = os.path.join(ROOT, "tools", "_cdp_report.txt")
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

lines = []
fails = [0]

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
    def __init__(self, page_ws):
        self.ws = websocket.create_connection(page_ws, timeout=60)
        self.i = 0

    def call(self, method, params=None, timeout=60):
        self.i += 1
        mid = self.i
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        end = time.time() + timeout
        while time.time() < end:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(method + " -> " + json.dumps(msg["error"], ensure_ascii=False))
                return msg.get("result", {})
        raise RuntimeError("timeout waiting " + method)

    def ev(self, expr, timeout=60):
        r = self.call("Runtime.evaluate", {
            "expression": expr, "returnByValue": True, "awaitPromise": True
        }, timeout=timeout)
        if r.get("exceptionDetails"):
            ex = r["exceptionDetails"]
            return "__ERR__ " + json.dumps(ex.get("exception", {}).get("description", ex),
                                           ensure_ascii=False)
        return r.get("result", {}).get("value")

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


def start_chrome():
    prof = os.path.join(os.environ.get("TEMP", "."), "chrome-cdp-soup")
    subprocess.run(["cmd", "/c", "rmdir", "/s", "/q", prof], capture_output=True)
    args = [CHROME, "--headless=new", "--disable-gpu", "--no-first-run",
            "--no-default-browser-check",
            "--remote-debugging-port=%d" % PORT,
            "--remote-allow-origins=*",
            "--user-data-dir=" + prof,
            "--window-size=1366,900",
            "about:blank"]
    p = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(80):
        time.sleep(0.5)
        try:
            with urllib.request.urlopen("http://127.0.0.1:%d/json/version" % PORT, timeout=2) as r:
                json.loads(r.read().decode())
            return p
        except Exception:
            continue
    raise RuntimeError("chrome 没能起来")


def new_target(url):
    req = urllib.request.Request("http://127.0.0.1:%d/json/new?%s" % (PORT, url), method="PUT")
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode())


def main():
    proc = start_chrome()
    try:
        t = new_target("about:blank")
        c = CDP(t["webSocketDebuggerUrl"])
        c.call("Runtime.enable")
        c.call("Page.enable")

        c.call("Page.navigate", {"url": PAGE})
        time.sleep(3.2)

        log("=== 真浏览器实测报告（headless Chrome + CDP）===")
        log("页面：" + PAGE)

        log("\n== 载入 ==")
        ok("页面标题正常", "深海汤屋" in str(c.ev("document.title")), c.ev("document.title"))
        ok("无致命脚本错误：SoupApp 存在", bool(c.ev("!!window.SoupApp")))
        ok("SoupApp.isSolved 已导出", c.ev("typeof SoupApp.isSolved==='function'") is True)
        ok("SoupApp.toggleSolved 已导出", c.ev("typeof SoupApp.toggleSolved==='function'") is True)

        log("\n== 任务1 房间人数 8 -> 15 ==")
        ok("HTML 徽章显示 0/15", c.ev("document.querySelector('#room-count').textContent") == "0/15",
           c.ev("document.querySelector('#room-count').textContent"))
        ui = open(os.path.join(ROOT, "js", "room-ui.js"), encoding="utf-8").read()
        wroom = open(os.path.join(ROOT, "worker", "src", "room.js"), encoding="utf-8").read()
        ok("前端计数用 /15", 'length + "/15"' in ui)
        ok("服务端 UID_MAX = 15", "const UID_MAX = 15;" in wroom)
        ok("满房提示改成 15 人", "最多 15 人" in ui)

        log("\n== 任务4 黑幕转场加速 ==")
        tr = open(os.path.join(ROOT, "js", "transition.js"), encoding="utf-8").read()
        ok("GSAP 淡入压到 0.22", "duration: 0.22" in tr)
        ok("GSAP 收幕压到 0.28", "duration: 0.28" in tr)
        ok("WAAPI 总时长 600ms", "duration: 600" in tr)
        ok("旧的 880ms 已移除", "duration: 880" not in tr)
        ok("兜底定时器同步收紧", "armGuard(el, 1000)" in tr and "}, 950)" in tr)

        log("\n== 任务5 单人汤库「已熬出汤底」绿勾 ==")
        c.ev("document.querySelector('#btn-library').click()")
        time.sleep(1.5)
        n_card = c.ev("document.querySelectorAll('#lib-list .pz-card').length")
        n_check = c.ev("document.querySelectorAll('#lib-list .pz-check').length")
        ok("汤库卡片已渲染", (n_card or 0) > 0, "cards=%s" % n_card)
        ok("每张汤卡都有绿勾位", n_check == n_card and (n_card or 0) > 0, "checks=%s" % n_check)
        c.ev("document.querySelector('#lib-list .pz-check').click()")
        time.sleep(0.5)
        st = c.ev("""(function(){
          var ck=document.querySelector('#lib-list .pz-check');
          var id=ck.getAttribute('data-check');
          return JSON.stringify({on:ck.classList.contains('on'),txt:ck.textContent,
            checked:ck.getAttribute('aria-checked'),id:id,
            store:localStorage.getItem('deepsea_soup_solved_v1'),
            card:ck.closest('.pz-card').classList.contains('solved'),
            border:getComputedStyle(ck.closest('.pz-card')).borderTopColor});
        })()""")
        d = json.loads(st) if st and not str(st).startswith("__ERR__") else {}
        ok("点绿勾后卡片套上 solved", d.get("card") is True, st)
        ok("勾号显示", d.get("txt") == "\u2713", st)
        ok("aria-checked 同步 true", d.get("checked") == "true", st)
        ok("浏览器实测卡片边框变绿", "207" in str(d.get("border", "")), d.get("border"))
        ok("写入本地记录", bool(d.get("store")) and str(d.get("id")) in str(d.get("store")), st)
        ok("isSolved 读得到", c.ev("SoupApp.isSolved(%s)" % json.dumps(d.get("id"))) is True)
        un = c.ev("""(function(){
          document.querySelector('#lib-list .pz-check').click();
          var ck=document.querySelector('#lib-list .pz-check');
          return JSON.stringify({on:ck.classList.contains('on'),
            card:ck.closest('.pz-card').classList.contains('solved'),
            store:localStorage.getItem('deepsea_soup_solved_v1')});
        })()""")
        ud = json.loads(un) if un else {}
        ok("再点一次可取消标记", ud.get("on") is False and ud.get("card") is False, un)
        ok("取消后记录同步清空", ud.get("store") == "{}", un)

        log("\n== 任务6 房间聊天默认展开 + 尺寸固定 ==")
        html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
        css = open(os.path.join(ROOT, "style.css"), encoding="utf-8").read()
        ok("HTML 容器默认无 collapsed", 'class="room-chat hidden" id="room-chat"' in html)
        ok("切换按钮 aria-expanded=true", 'class="rc-title" id="btn-room-chat-toggle" aria-expanded="true"' in html)
        ok("展开态固定高度 400px", ".room-chat:not(.collapsed) { height: 400px; }" in css)
        ok("聊天框宽度加到 320px", "width: 320px;" in css)
        ok("日志区改为弹性自适应", "flex: 1 1 auto;" in css and "height: 300px;" in css)
        ok("线索板加高 min(62vh,620px)", "height: min(62vh, 620px)" in css)

        log("\n== 任务3 密码看汤底（权区） ==")
        ok("新密码 608521", 'var TRUTH_CODE = "608521";' in ui)
        ok("旧密码 081208 已废", 'TRUTH_CODE = "081208"' not in ui)
        ok("按钮文案含「权区」", ("密码看汤底（权区）" in html) and ("\U0001f511" in html))
        ok("独立 unlock-bar 两条（单人+多人）", html.count('class="unlock-bar"') == 2,
           html.count('class="unlock-bar"'))
        ok("单人 askbar 里已无旧按钮", '</button>\n        <button type="button" class="btn ghost" id="btn-unlock">' not in html)
        ok("CSS 有紫色权区样式", ".unlock-btn" in css and "ui-monospace" in css and "--auth:" in css)
        ok("弹窗标题带钥匙串", "unlock-head" in ui and "\U0001f511 密码看汤底（权区）" in ui)
        ok("搞怪文案已写入", "噜噜大王" in ui and "闲杂人等速速退去" in ui and "耶嘿嘿嘿" in ui)
        ok("弹窗紫色边框样式", ".modal-unlock { border-color: rgba(185, 138, 224, .45); }" in css)

        log("\n== 任务2 多人选汤面板 tag 标签（连本地 worker 实测） ==")
        c.ev("SoupNet.setBase(%s)" % json.dumps(WORKER))
        # 走真实 UI 路径：多人房间 -> 建房 -> 等进房 -> 选一锅
        c.ev("document.querySelector('#btn-multi').click()")
        time.sleep(1.0)
        c.ev("document.querySelector('#btn-room-create').click()")
        time.sleep(1.2)
        # 昵称弹窗：填入并确认
        c.ev("""(function(){
          var i=document.querySelector('#pt-nick');
          if(i){ i.value='翔太'; document.querySelector('#pt-nick-ok').click(); return 'filled'; }
          return 'no-modal';
        })()""")
        time.sleep(4.5)
        st0 = c.ev("""(function(){
          var code=document.querySelector('#room-code');
          var live=document.querySelector('#room-live');
          return JSON.stringify({code:code?code.textContent:'',
            live: live? !live.classList.contains('hidden') : false});
        })()""")
        log("   进房状态：" + str(st0))
        sd0 = json.loads(st0) if st0 and not str(st0).startswith("__ERR__") else {}
        ok("真实走 UI 建房成功", bool(sd0.get("live")), st0)
        if sd0.get("live"):
            time.sleep(0.6)
            c.ev("document.querySelector('#btn-room-choose').click()")
            time.sleep(2.5)
            panel = c.ev("""(function(){
              var host=document.querySelector('.modal-library');
              if(!host) return JSON.stringify({open:false});
              var cards=host.querySelectorAll('#pick-list .pz-card');
              var cats=host.querySelectorAll('#pick-list .pz-cat');
              var first=cards[0];
              return JSON.stringify({open:true, cards:cards.length, cats:cats.length,
                sample:first?first.textContent.replace(/\\s+/g,' ').trim().slice(0,100):'',
                catRows:host.querySelectorAll('#pick-list .pz-cats').length,
                checks:host.querySelectorAll('#pick-list .pz-check').length,
                catNames:[].map.call(cats,function(x){return x.textContent;}).slice(0,9)});
            })()""")
            log("   面板实测：" + str(panel))
            pd = json.loads(panel) if panel and not str(panel).startswith("__ERR__") else {}
            ok("「选一锅汤」面板已打开", pd.get("open") is True, panel)
            ok("卡片渲染出 tag 标签出来", (pd.get("cats") or 0) > 0, panel)
            ok("每张卡都带标签行", (pd.get("catRows") or 0) == (pd.get("cards") or -1), panel)
            ok("选汤面板同时有绿勾", (pd.get("checks") or 0) == (pd.get("cards") or -1), panel)

            # 选中一锅，看选完之后汤面处是否也显示 tag
            picked = c.ev("""(async function(){
              try{
                var card=document.querySelector('#pick-list .pz-card');
                var id=card.getAttribute('data-id');
                card.click();
                return JSON.stringify({ok:true,id:id});
              }catch(e){ return JSON.stringify({ok:false,err:String(e)}); }
            })()""", timeout=45)
            log("   选汤：" + str(picked))
            time.sleep(5)
            roompz = c.ev("""(function(){
              var pz=document.querySelector('#room-puzzle');
              var cats=pz?pz.querySelectorAll('.pz-cat'):[];
              return JSON.stringify({txt:pz?pz.textContent.replace(/\\s+/g,' ').trim().slice(0,120):'',
                cats:cats.length, names:[].map.call(cats,function(x){return x.textContent;})});
            })()""")
            log("   房间汤面处：" + str(roompz))
            rd = json.loads(roompz) if roompz and not str(roompz).startswith("__ERR__") else {}
            ok("选完后房间汤面也显示 tag 标签", (rd.get("cats") or 0) > 0, roompz)
        else:
            log("   （本地 worker 未就绪，跳过选汤面板实测）")
            fails[0] += 1
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
