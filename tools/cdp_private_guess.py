# -*- coding: utf-8 -*-
"""UI 双标签页实测：甲建房选汤配AI → 乙进房 → 双人跑「私有猜底」全流程。

  A. 猜错：双方「问答记录/实时对话」都不出现猜底条目（全程私密）
  B. 乙先猜对：乙弹个人庆祝弹窗（只有乙看得到汤底），甲只收汤主报喜、不弹全员揭底
  C. 甲也猜对：全员说破 → 两人统一揭底 + 排行榜
两个玩家用不同 origin（127.0.0.1:8080 / localhost:8080）隔离 localStorage。
输出 tools/_cdp_private_guess_report.txt。
"""
import json, os, sys, time, base64, urllib.request
import websocket

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tools", "_cdp_private_guess_report.txt")
PORT = 9345

lines = []
fails = [0]

def log(s):
    print(s); lines.append(str(s))

def flush():
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

def ok(name, cond, extra=""):
    log(("  [PASS] " if cond else "  [FAIL] ") + name + (("   [" + str(extra)[:220] + "]") if extra else ""))
    if not cond: fails[0] += 1
    flush()


class Tab:
    def __init__(self, ws, target_id=None):
        self.ws = websocket.create_connection(ws, timeout=120)
        self.target_id = target_id
        self.i = 2
        self.msgs = []
        self.cmd("Runtime.enable")
        self.cmd("Log.enable")

    def front(self):
        """把本 tab 切到前台：headless 下后台 tab 的 visibilitychange 会掉轮询。"""
        try:
            if self.target_id:
                urllib.request.urlopen("http://127.0.0.1:%d/json/activate/%s" % (PORT, self.target_id)).read()
            self.cmd("Page.bringToFront")
        except Exception:
            pass

    def cmd(self, method, params=None, timeout=120):
        self.i += 1
        mid = self.i
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        end = time.time() + timeout
        while time.time() < end:
            m = json.loads(self.ws.recv())
            if m.get("method"):
                self.msgs.append(m)
                continue
            if m.get("id") == mid:
                if "error" in m:
                    raise RuntimeError(method + " -> " + json.dumps(m["error"], ensure_ascii=False))
                return m.get("result", {})
        raise RuntimeError("timeout " + method)

    def ev(self, expr, timeout=60):
        src = json.dumps(expr)
        r = self.cmd("Runtime.evaluate", {"expression": "(function(){ return eval(" + src + "); })()", "returnByValue": True, "awaitPromise": True}, timeout)
        exc = r.get("exceptionDetails")
        if exc:
            raise RuntimeError("JS: " + str(exc.get("text")) + " " + str(exc.get("exception", {}).get("description"))[:200])
        return r.get("result", {}).get("value")

    def pump(self):
        try:
            self.ws.settimeout(0.05)
            m = json.loads(self.ws.recv())
            self.ws.settimeout(120)
            return m
        except Exception:
            self.ws.settimeout(120)
            return None

    def errors(self):
        out = []
        while True:
            m = self.pump()
            if m is None:
                break
            if m.get("method") == "Runtime.exceptionThrown":
                d = m["params"]["exceptionDetails"]
                out.append((d.get("text") or "") + " | " + str(d.get("exception", {}).get("description"))[:240])
            elif m.get("method") == "Log.entryAdded" and m["params"]["entry"]["level"] == "error":
                out.append(m["params"]["entry"]["text"][:240])
        return out


def wait_for(tab, pred, memo, secs=25):
    end = time.time() + secs
    while time.time() < end:
        tab.front()
        try:
            v = tab.ev(pred)
        except Exception as e:
            log("  JS: " + str(e)[:200]); v = False
        if v:
            return True
        time.sleep(0.4)
    log("  [TIMEOUT] 等待失败: " + memo)
    flush()
    return False

def new_tab(url):
    req = urllib.request.Request("http://127.0.0.1:%d/json/new?%s" % (PORT, urllib.parse.quote(url, safe="")), method="PUT")
    j = json.loads(urllib.request.urlopen(req).read().decode())
    return j["webSocketDebuggerUrl"], j.get("id")

SHOT_DIR = os.path.join(ROOT, "tools", "shots")
os.makedirs(SHOT_DIR, exist_ok=True)
def snap(tab, name):
    try:
        tab.front()
        time.sleep(0.4)
        tab.cmd("Emulation.setDeviceMetricsOverride", {"width": 1380, "height": 860, "deviceScaleFactor": 1, "mobile": False})
        img = tab.cmd("Page.captureScreenshot", {"format": "png"})
        with open(os.path.join(SHOT_DIR, name + ".png"), "wb") as f:
            f.write(base64.b64decode(img["data"]))
        log("  [SHOT] tools/shots/" + name + ".png")
    except Exception as e:
        log("  [SHOT-ERR] " + str(e)[:160])

import urllib.parse
import subprocess

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
UDATA = os.path.join(os.environ.get("TEMP", "/tmp"), "soup_cdp_pg_%d" % int(time.time()))
chrome_proc = subprocess.Popen(
    [CHROME, "--headless=new", "--remote-allow-origins=*", "--no-first-run", "--no-proxy-server",
     "--disable-gpu", "--autoplay-policy=no-user-gesture-required",
     "--remote-debugging-port=%d" % PORT, "--user-data-dir=" + UDATA, "about:blank"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(40):
    try:
        json.load(urllib.request.urlopen("http://127.0.0.1:%d/json/version" % PORT))
        break
    except Exception:
        time.sleep(0.5)
else:
    print("chrome 起不来"); sys.exit(2)
log("chrome 就绪 pid=%d" % chrome_proc.pid)
import atexit
atexit.register(lambda: chrome_proc.terminate())

def bail():
    try:
        chrome_proc.terminate()
    except Exception:
        pass
    flush()
    sys.exit(1)

_wa, _ia = new_tab("http://127.0.0.1:8080/tools/ui_setup.html?who=a")
A = Tab(_wa, _ia)
log("== 玩家 A（甲甲）开房 ==")
wait_for(A, "!!window.SoupNet && !!window.SoupRoom", "A 页面加载")
A.ev("window.__errs = []; window.addEventListener('error', function(e){ (window.__errs).push(String(e.message||e)); }); SoupNet.setBase('http://127.0.0.1:8788');")
log("  A id=" + str(A.ev("SoupNet.me.internalId")) + " nick=" + str(A.ev("SoupNet.me.nickname")) + " base=" + str(A.ev("SoupNet.baseUrl()")))
A.ev("document.getElementById('btn-multi').click()")
time.sleep(0.6)
log("  entry屏可见: " + str(A.ev("!document.getElementById('room-entry').classList.contains('hidden')")))
A.ev("document.getElementById('btn-room-create').click()")
# 昵称框：等出现后改名确认
wait_for(A, """(function(){ var el=document.getElementById('pt-nick');
  if(!el) return false; el.value='甲甲'; var b=document.getElementById('pt-nick-ok'); if(b){b.click(); return true;} return false; })()""", "A 昵称框")
ok("A 进房（拿到房号）", wait_for(A, "SoupNet.me.roomCode && SoupNet.me.roomCode.length", "A 房号", 40))
if not A.ev("!!SoupNet.me.roomCode"):
    log("  [诊断] toast=" + str(A.ev("(document.getElementById('toast')||{}).textContent")))
    log("  [诊断] window errs=" + str(A.ev("JSON.stringify((window.__errs||[]).slice(0,5))")))
    log("  [诊断] 直接 fetch /api/room/new → " + str(A.ev("""var x=new XMLHttpRequest(); x.open('POST','http://127.0.0.1:8788/api/room/new',false);
      x.setRequestHeader('content-type','application/json');
      try { x.send(JSON.stringify({internalId:'probe_'+Date.now(), nickname:'探针'})); x.status + ' ' + x.responseText.slice(0,120); } catch(e) { 'XHR-ERR ' + e.message }""")))
code = A.ev("SoupNet.me.roomCode")
log("  房号: " + str(code))

_wb, _ib = new_tab("http://localhost:8080/tools/ui_setup.html?who=b")
B = Tab(_wb, _ib)
log("== 玩家 B（乙乙）进房 ==")
wait_for(B, "!!window.SoupNet", "B 页面加载")
B.ev("SoupNet.setBase('http://127.0.0.1:8788');")
B.ev("(document.getElementById('btn-multi')||{click:function(){}}).click()")
wait_for(B, "!!document.getElementById('room-join-code')", "B 进房页")
B.ev("""var e=document.getElementById('room-join-code');
e.value='%s'; document.getElementById('btn-room-join').click();""" % code)
wait_for(B, """(function(){ var el=document.getElementById('pt-nick');
  if(!el) return false; el.value='乙乙'; var b=document.getElementById('pt-nick-ok'); if(b){b.click(); return true;} return false; })()""", "B 昵称框")
ok("B 进房成功", wait_for(B, "SoupNet.state && (SoupNet.state||{}).exists && (SoupNet.state||{}).roomCode==='%s'" % code, "B 房号"))

log("== A 配 AI + 选汤；双方准备 ==")
wait_for(A, "document.getElementById('btn-room-ai') && !document.getElementById('btn-room-ai').disabled", "A 房主按钮就绪")
A.ev("document.getElementById('btn-room-ai').click()")
ok("A 填好 mock 汤主并保存", wait_for(A, """(function(){ var base=document.getElementById('rai-base'); if(!base) return false;
  base.value='http://localtest.me:8790/v1';
  var m=document.getElementById('rai-model'), k=document.getElementById('rai-key'), sv=document.getElementById('rai-save');
  if(!m||!k||!sv) return false; m.value='mock'; k.value='sk-test'; sv.click(); return true; })()""", "AI 配置"))
time.sleep(1.5)
# 真实用户路径：打开「选一锅」汤库大弹窗，点第一张卡片
A.ev("document.getElementById('btn-room-choose').click()")
ok("A 汤库弹窗出现卡片", wait_for(A, "document.querySelectorAll('#pick-list .pz-card[data-id]').length > 0", "汤库卡片", 20))
A.ev("document.querySelector('#pick-list .pz-card[data-id]').click()")
ok("A 选汤成功（puzzleId）", wait_for(A, "SoupNet.state && (SoupNet.state||{}).puzzleId", "puzzleId", 15),
   A.ev("(document.getElementById('toast')||{}).textContent"))
A.ev("document.getElementById('btn-room-ready').click()")
B.ev("document.getElementById('btn-room-ready').click()")
ok("双方准备 → 自动开锅", wait_for(A, "SoupNet.state && (SoupNet.state||{}).phase==='playing' && (SoupNet.state||{}).order.length===2", "开锅", 30))

log("== A. 猜错全程私密（甲猜：🟡 模糊判定，只冷却 60s）==")
A.ev("document.getElementById('btn-room-guess').click()")
ok("A 猜底弹窗带私密提示", wait_for(A, """(function(){ var t=document.getElementById('rguess-input');
  return !!(t && t.closest('.modal') && /只有你自己的屏幕看得到/.test(t.closest('.modal').textContent)); })()""", "私密提示"))
A.ev("""var t=document.getElementById('rguess-input'); if(t){ t.value='甲瞎猜一通 WRONG-TEXT-3311 VAGUE'; }
var s=document.getElementById('rguess-submit'); if(s) s.click();""")
ok("A 就地拿到 🟡 判定", wait_for(A, """(function(){ var f=document.getElementById('rguess-fb');
  return !!(f && /方向模糊/.test(f.textContent)); })()""", "A 判定"),
   A.ev("""(function(){ var f=document.getElementById('rguess-fb'); return f ? f.textContent : ''; })()"""))
A.ev("var c=document.getElementById('rguess-cancel'); if(c) c.click();")
time.sleep(1.5)
qaB = str(B.ev("JSON.stringify(((SoupNet.state||{}).qaLog||[]).map(function(x){return x.kind;}))"))
ok("B 问答流无 guess 条目", '"guess"' not in qaB, qaB)
qaA = str(A.ev("JSON.stringify(((SoupNet.state||{}).qaLog||[]).map(function(x){return x.kind;}))"))
ok("A 自己的问答流也不留猜底痕", '"guess"' not in qaA, qaA)
leakB = B.ev("((SoupNet.state||{}).chatLog||[]).concat((SoupNet.state||{}).qaLog||[]).some(function(x){return JSON.stringify(x).indexOf('WRONG-TEXT-3311')!==-1;})")
ok("B 快照里搜不到 A 猜底原文", leakB is False)
feedTxt = A.ev("document.getElementById('room-feed').textContent")
ok("A 实时对话没有推理行", "推理" not in feedTxt and "WRONG-TEXT" not in feedTxt, feedTxt[:120])
A.ev("document.getElementById('btn-room-notebook').click()")
ok("A 猜底手账：只有 A 自己能翻到刚才那条", wait_for(A, """(function(){ var m=document.getElementById('mgn-body'); if(!m) return false;
  return /WRONG-TEXT-3311/.test(m.textContent) && /方向模糊/.test(m.textContent); })()""", "手账内容"))
B_ev_done = B.ev("""(function(){ var b=document.getElementById('btn-room-notebook'); if(!b) return 'nob'; b.click();
  var m=document.getElementById('mgn-body'); return m ? m.textContent : 'nom'; })()""")
ok("B 的手账是空的（看不到甲的猜底）", ("WRONG-TEXT" not in str(B_ev_done)), str(B_ev_done)[:100])
B.ev("var c=document.getElementById('mgn-close'); if(c) c.click();")
A.ev("var c=document.getElementById('mgn-close'); if(c) c.click();")

log("== B. 乙先说破：只弹乙 ==")
B.ev("document.getElementById('btn-room-guess').click()")
B.ev("""var t=document.getElementById('rguess-input'); if(t) t.value='乙悟了 SOLVED';
var s=document.getElementById('rguess-submit'); if(s) s.click();""")
ok("B 弹个人说破弹窗", wait_for(B, "!!document.querySelector('.me-solved-wrap .ms-truth')", "B 个人弹窗", 20))
snap(B, "01_b_personal_solved")
msB = str(B.ev("document.querySelector('.me-solved') ? document.querySelector('.me-solved').textContent : ''"))
ok("B 弹窗写明「第 1 个」", "第 1 个" in msB, msB[:100])
time.sleep(3)
ok("A 收到汤主报喜炫彩框", wait_for(A, "!!document.querySelector('.chat-item.congrats .cg-frame')", "A 报喜框", 15))
snap(A, "02_a_congrats_and_spectator")
cg = str(A.ev("document.querySelector('.chat-item.congrats .cg-text') ? document.querySelector('.chat-item.congrats .cg-text').textContent : ''"))
ok("报喜含「乙乙」+「第 1 个」", ("乙乙" in cg and "第 1 个" in cg), cg[:140])
ok("A 未被剧透（无全员揭底弹窗）", A.ev("!document.querySelector('.reveal-final')"))
ok("A 视角无 truth/myTruth 字段", A.ev("!(SoupNet.state||{}).truth && !(SoupNet.state||{}).myTruth"))
ok("A 页面上搜不到乙的推理原文", A.ev("document.body.innerText.indexOf('乙悟了')===-1"))
ok("B 猜底按钮变「已说破」且禁用", B.ev("var b=document.getElementById('btn-room-guess'); !!b && b.disabled && /已说破/.test(b.textContent)"))
ok("B 提问输入框锁定", B.ev("var q=document.getElementById('room-q-input'); !!q && q.disabled"))

log("== C. 甲也说破 → 全员统一揭底 + 排行榜 ==")
ok("等甲的 60s 冷却结束", wait_for(A, "var b=document.getElementById('btn-room-guess'); !!b && !b.disabled && !/冷却/.test(b.textContent)", "A 冷却", 110))
A.ev("document.getElementById('btn-room-guess').click()")
A.ev("""var t=document.getElementById('rguess-input'); if(t) t.value='甲也悟了 SOLVED';
var s=document.getElementById('rguess-submit'); if(s) s.click();""")
ok("A 弹个人说破（第 2 个）", wait_for(A, "!!document.querySelector('.me-solved-wrap .ms-truth')", "A 个人弹窗", 20))
ok("A 个人弹窗写明第 2 个", "第 2 个" in str(A.ev("document.querySelector('.me-solved') ? document.querySelector('.me-solved').textContent : ''")))
time.sleep(2.5)   # 等本锅已全员（B 那边可能已先弹全员揭底，B 弹窗在 ms 之后）
B.ev("var b=document.getElementById('ms-ok'); if(b) b.click();")
A.ev("var b=document.getElementById('ms-ok'); if(b) b.click();")
ok("A 统一揭底 + 排行榜出现", wait_for(A, "!!document.querySelector('.reveal-final .rank-board')", "A 排行榜", 15))
snap(A, "03_a_final_reveal_ranking")
rkA = str(A.ev("Array.prototype.map.call(document.querySelectorAll('.rk-name'),function(e){return e.textContent;}).join('>')"))
ok("A 排行榜顺序 乙甲", rkA == "乙乙>甲甲", rkA)
ok("A 终局标题=全员说破", A.ev("var h=document.querySelector('.reveal-final h3'); !!h && /全员说破/.test(h.textContent)"))
ok("B 统一揭底 + 排行榜出现", wait_for(B, "!!document.querySelector('.reveal-final .rank-board')", "B 排行榜", 20))
rkB = str(B.ev("Array.prototype.map.call(document.querySelectorAll('.rk-name'),function(e){return e.textContent;}).join('>')"))
ok("B 排行榜顺序一致", rkB == "乙乙>甲甲", rkB)

log("== 收尾：运行时错误扫描 ==")
for t, name in [(A, "A"), (B, "B")]:
    e = t.errors()
    ok(name + " 无运行时报错", not e, " ;; ".join(e[:3]))

log("\n===== UI 实测结果: " + ("ALL PASS" if not fails[0] else str(fails[0]) + " FAIL") + " =====")
bail()


