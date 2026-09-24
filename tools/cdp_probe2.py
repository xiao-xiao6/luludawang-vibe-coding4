# -*- coding: utf-8 -*-
"""真浏览器实测 · 第二轮：细节项复核。

  1. 十二楼的按钮 tag 应为「脑洞 / 悬疑 / 都市」
  2. 密码看汤底（权区）弹窗：错密码拒绝、对密码 608521 出汤底；双端都有按钮
  3. 房间聊天进房后默认展开 + 固定高度、线索板加高
  4. 黑幕转场实测总时长（GSAP 路径）
  5. 多人房「本锅」面板 tag + 绿勾跨面板共享

输出写 tools/_cdp_report2.txt（UTF-8）。
"""
import json, os, subprocess, time, urllib.request
import websocket

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = "http://127.0.0.1:8899/index.html"
WORKER = "http://127.0.0.1:8791"
PORT = 9334
OUT = os.path.join(ROOT, "tools", "_cdp_report2.txt")
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
        self.ws = websocket.create_connection(wsurl, timeout=60)
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
                    raise RuntimeError(method + " " + json.dumps(msg["error"], ensure_ascii=False))
                return msg.get("result", {})
        raise RuntimeError("timeout " + method)

    def ev(self, expr, timeout=60):
        r = self.call("Runtime.evaluate",
                      {"expression": expr, "returnByValue": True, "awaitPromise": True},
                      timeout=timeout)
        if r.get("exceptionDetails"):
            return "__ERR__ " + str(r["exceptionDetails"].get("exception", {}).get("description"))[:300]
        return r.get("result", {}).get("value")


def start_chrome():
    prof = os.path.join(os.environ.get("TEMP", "."), "chrome-cdp-soup2")
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

        log("=== 第二轮细节复核（headless Chrome + CDP）===")

        log("\n== 十二楼的按钮 tag ==")
        c.ev("document.querySelector('#btn-library').click()")
        time.sleep(1.5)
        c.ev("""(function(){
          var kw=document.querySelector('#lib-search');
          if(kw){ kw.value='十二楼'; kw.dispatchEvent(new Event('input',{bubbles:true})); }
        })()""")
        time.sleep(1.5)
        st = c.ev("""(function(){
          var cards=document.querySelectorAll('#lib-list .pz-card');
          for(var i=0;i<cards.length;i++){
            if(/十二楼/.test(cards[i].textContent)){
              var cs=cards[i].querySelectorAll('.pz-cat');
              return JSON.stringify({n:cs.length, names:[].map.call(cs,function(x){return x.textContent;}),
                title:cards[i].querySelector('.pz-title').textContent});
            }
          }
          return JSON.stringify({n:0, note:'没找到十二楼', sample:document.querySelector('#lib-list .pz-card')?document.querySelector('#lib-list .pz-card').textContent.slice(0,60):''});
        })()""")
        log("   实测：" + str(st))
        d = json.loads(st) if st and not str(st).startswith("__ERR__") else {}
        names = d.get("names") or []
        ok("十二楼卡片有 tag", (d.get("n") or 0) > 0, st)
        ok("tag = 脑洞/悬疑/都市", names == ["脑洞", "悬疑", "都市"], names)

        log("\n== 密码看汤底（权区）弹窗实测 ==")
        c.ev("document.querySelector('#btn-lib-back') && document.querySelector('#btn-lib-back').click()")
        time.sleep(0.8)
        # 单人：先开一道汤，再点密码看汤底
        c.ev("""(function(){
          var b=document.querySelector('#btn-library'); if(b) b.click();
        })()""")
        time.sleep(1.2)
        c.ev("document.querySelector('#lib-list .pz-card').click()")
        time.sleep(2.5)
        opened = c.ev("""(function(){
          var g=document.querySelector('#screen-game');
          return g? !g.classList.contains('hidden') : false;
        })()""")
        ok("已进汤（单人）", opened is True, opened)
        btn = c.ev("""(function(){
          var b=document.querySelector('#btn-unlock');
          if(!b) return JSON.stringify({found:false});
          var r=b.getBoundingClientRect();
          var bar=b.closest('.unlock-bar');
          var barR=bar?bar.getBoundingClientRect():null;
          var inAskbar = !!b.closest('.askbar');
          return JSON.stringify({found:true, text:b.textContent.trim(),
            visible:r.width>0 && r.height>0,
            barTop: barR? Math.round(barR.top):null, btnTop: Math.round(r.top),
            barH: barR? Math.round(barR.height):0, inAskbar: inAskbar,
            font:getComputedStyle(b).fontFamily.slice(0,40),
            color:getComputedStyle(b).color});
        })()""")
        log("   按钮实测：" + str(btn))
        bd = json.loads(btn) if btn and not str(btn).startswith("__ERR__") else {}
        ok("单人端有密码看汤底按钮", bd.get("found") is True, btn)
        ok("按钮文案带钥匙+权区", "密码看汤底（权区）" in str(bd.get("text", "")), bd.get("text"))
        ok("按钮独立成条、不在提问行里", bd.get("visible") is True and bd.get("inAskbar") is False and (bd.get("barH") or 0) > 0, btn)
        ok("按钮用等宽紫字", "mono" in str(bd.get("font", "")).lower(), bd.get("font"))

        c.ev("document.querySelector('#btn-unlock').click()")
        time.sleep(0.8)
        modal = c.ev("""(function(){
          var h=document.querySelector('.modal-unlock');
          if(!h) return JSON.stringify({open:false});
          var head=h.querySelector('.unlock-head');
          var sub=h.querySelector('.unlock-sub');
          return JSON.stringify({open:true, head:head?head.textContent:'', sub:sub?sub.textContent:'',
            inputType:(h.querySelector('#unlock-code')||{}).type});
        })()""")
        log("   弹窗：" + str(modal))
        md = json.loads(modal) if modal and not str(modal).startswith("__ERR__") else {}
        ok("紫色权区弹窗已弹出", md.get("open") is True, modal)
        ok("弹窗标题含钥匙与权区", "密码看汤底（权区）" in str(md.get("head", "")), md.get("head"))
        ok("搞怪文案完整", "噜噜大王" in str(md.get("sub", "")) and "耶嘿嘿嘿" in str(md.get("sub", "")), md.get("sub"))
        ok("密码框仍是密码类型", md.get("inputType") == "password", md.get("inputType"))

        # 错密码
        c.ev("""(function(){
          var i=document.querySelector('#unlock-code');
          i.value='081208';
          document.querySelector('#unlock-ok').click();
        })()""")
        time.sleep(0.6)
        wrong = c.ev("""(function(){
          var fb=document.querySelector('#unlock-fb');
          var box=document.querySelector('#unlock-truth');
          return JSON.stringify({fb:fb?fb.textContent:'', hidden:box?box.classList.contains('hidden'):null});
        })()""")
        log("   错密码：" + str(wrong))
        wd = json.loads(wrong) if wrong else {}
        ok("旧密码 081208 被拒绝", "密码不对" in str(wd.get("fb", "")), wrong)
        ok("拒绝时不泄露汤底", wd.get("hidden") is True, wrong)

        # 正确密码
        c.ev("""(function(){
          var i=document.querySelector('#unlock-code');
          i.value='608521';
          document.querySelector('#unlock-ok').click();
        })()""")
        time.sleep(0.9)
        right = c.ev("""(function(){
          var fb=document.querySelector('#unlock-fb');
          var box=document.querySelector('#unlock-truth');
          return JSON.stringify({fb:fb?fb.textContent:'', hidden:box?box.classList.contains('hidden'):null,
            truth:(box?box.textContent:'').slice(0,70), color:getComputedStyle(box).borderTopColor});
        })()""")
        log("   正确密码：" + str(right))
        rd = json.loads(right) if right else {}
        ok("新密码 608521 通过", "汤底在下面" in str(rd.get("fb", "")), right)
        ok("汤底已显示", rd.get("hidden") is False and len(str(rd.get("truth", ""))) > 10, right)
        ok("汤底框也套紫边", "185" in str(rd.get("color", "")), rd.get("color"))

        log("\n== 房间聊天默认展开 + 尺寸固定（真实进房） ==")
        c.ev("document.querySelector('#unlock-cancel').click()")
        time.sleep(0.4)
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
        chat = c.ev("""(function(){
          var el=document.querySelector('#room-chat');
          if(!el) return JSON.stringify({found:false});
          var r=el.getBoundingClientRect();
          var log=el.querySelector('.rc-log');
          var lr=log?log.getBoundingClientRect():null;
          return JSON.stringify({found:true, hidden:el.classList.contains('hidden'),
            collapsed:el.classList.contains('collapsed'),
            aria:document.querySelector('#btn-room-chat-toggle').getAttribute('aria-expanded'),
            h:Math.round(r.height), w:Math.round(r.width),
            logH: lr? Math.round(lr.height):null,
            logScroll: log? (log.scrollHeight > log.clientHeight):null});
        })()""")
        log("   聊天框实测：" + str(chat))
        cd = json.loads(chat) if chat and not str(chat).startswith("__ERR__") else {}
        ok("进房后聊天框显示", cd.get("found") is True and cd.get("hidden") is False, chat)
        ok("默认是展开态（无 collapsed）", cd.get("collapsed") is False, chat)
        ok("aria-expanded = true", cd.get("aria") == "true", chat)
        ok("展开高度固定 400px", cd.get("h") == 400, chat)
        ok("宽度固定 320px", cd.get("w") == 320, chat)
        ok("日志区被拉长（>200px）", (cd.get("logH") or 0) > 200, chat)

        clue = c.ev("""(function(){
          var el=document.querySelector('.room-mode .col-clue .clue-list') || document.querySelector('.col-clue .clue-list');
          if(!el) return JSON.stringify({found:false});
          var r=el.getBoundingClientRect();
          return JSON.stringify({found:true, h:Math.round(r.height)});
        })()""")
        log("   线索板实测：" + str(clue))
        kd = json.loads(clue) if clue and not str(clue).startswith("__ERR__") else {}
        ok("多人房线索板已加高（>=400px）", (kd.get("h") or 0) >= 400, clue)

        log("\n== 多人「本锅」tag + 绿勾跨面板共享 ==")
        c.ev("document.querySelector('#btn-room-choose').click()")
        time.sleep(2.5)
        # 先标记一张卡的绿勾，再选它，看本锅面板是否也带 solved
        pick = c.ev("""(function(){
          var ck=document.querySelector('#pick-list .pz-check');
          ck.click();
          var id=ck.getAttribute('data-check');
          return JSON.stringify({id:id, on:ck.classList.contains('on'),
            store:localStorage.getItem('deepsea_soup_solved_v1')});
        })()""")
        log("   选汤面板打勾：" + str(pick))
        pk = json.loads(pick) if pick and not str(pick).startswith("__ERR__") else {}
        ok("选汤面板绿勾可写本地记录", pk.get("on") is True and str(pk.get("id")) in str(pk.get("store")), pick)
        c.ev("""(function(){
          var id=%s;
          var cards=document.querySelectorAll('#pick-list .pz-card');
          for(var i=0;i<cards.length;i++){ if(cards[i].getAttribute('data-id')===id){ cards[i].click(); return; } }
        })()""" % json.dumps(pk.get("id")))
        time.sleep(5)
        roompz = c.ev("""(function(){
          var pz=document.querySelector('#room-puzzle');
          var cats=pz?pz.querySelectorAll('.pz-cat'):[];
          return JSON.stringify({cats:cats.length, names:[].map.call(cats,function(x){return x.textContent;}),
            hasSolved: !!document.querySelector('.pz-card.solved, .room-pz-title.solved')});
        })()""")
        log("   本锅面板：" + str(roompz))
        rp = json.loads(roompz) if roompz and not str(roompz).startswith("__ERR__") else {}
        ok("多人本锅面板显示 tag", (rp.get("cats") or 0) > 0, roompz)

        log("\n== 黑幕转场实测时长 ==")
        t = c.ev("""(async function(){
          var t0=performance.now();
          await new Promise(function(res){
            if(window.SoupTransition && SoupTransition.play){
              SoupTransition.play({onSwap:function(){}}).then(function(){ res(); });
            } else { res(); }
          });
          return Math.round(performance.now()-t0);
        })()""", timeout=30)
        log("   转场实测耗时（ms）：" + str(t))
        ok("转场实测在 1.2s 内收幕", isinstance(t, (int, float)) and 0 < t < 1200, t)

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
