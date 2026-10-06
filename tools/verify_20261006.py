# -*- coding: utf-8 -*-
"""2026-10-06 修复轮实测：多视口断言 + 截图。tools/ 本地脚本，不进仓库。"""
import io, json, os, subprocess, sys, time, urllib.request, urllib.parse
import websocket

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "http://127.0.0.1:5199/index.html"
PORT = 9357
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
OUT = os.path.join(ROOT, "tools", "_verify_20261006.txt")

lines = []
def log(s):
    lines.append(str(s))
    io.open(OUT, "w", encoding="utf-8").write("\n".join(lines) + "\n")

class CDP:
    def __init__(self, ws):
        self.ws = websocket.create_connection(ws, timeout=90)
        self.i = 0
    def call(self, m, p=None, t=90):
        self.i += 1
        mid = self.i
        self.ws.send(json.dumps({"id": mid, "method": m, "params": p or {}}))
        end = time.time() + t
        while time.time() < end:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(m + ": " + json.dumps(msg["error"])[:200])
                return msg.get("result", {})
        raise TimeoutError(m)
    def ev(self, expr, t=90):
        r = self.call("Runtime.evaluate", {
            "expression": expr, "returnByValue": True, "awaitPromise": True}, t)
        if r.get("exceptionDetails"):
            return {"__err": json.dumps(r["exceptionDetails"].get("exception", {}))[:300]}
        return r.get("result", {}).get("value")

def wait_ready(c, seconds=30):
    end = time.time() + seconds
    while time.time() < end:
        ok = c.ev("(typeof SoupApp!=='undefined') && document.readyState==='complete'")
        if ok is True: return True
        time.sleep(0.4)
    return False

def shot(c, name):
    r = c.call("Page.captureScreenshot", {"format": "png"})
    io.open(os.path.join(ROOT, "tools", "_v_" + name + ".png"), "wb").write(
        __import__("base64").b64decode(r["data"]))
    log("screenshot -> tools/_v_%s.png" % name)

results = []
def check(name, value, expect_desc, ok):
    results.append((name, ok, value))
    log("%s | %s | %s | value=%s" % ("PASS" if ok else "FAIL", name, expect_desc, json.dumps(value, ensure_ascii=False)[:220]))

proc = subprocess.Popen([
    CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
    "--remote-allow-origins=*",
    "--remote-debugging-port=%d" % PORT,
    "--user-data-dir=%s" % os.path.join(os.environ.get("TEMP", "."), "soup_verify_profile"),
    "--disable-dev-shm-usage", "--allow-file-access-from-files",
    "about:blank",
], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

try:
    # 等调试端口起来
    ws_url = None
    for _ in range(60):
        try:
            with urllib.request.urlopen("http://127.0.0.1:%d/json/version" % PORT, timeout=2) as r:
                pass
            req = urllib.request.Request("http://127.0.0.1:%d/json/new?%s" % (PORT, urllib.parse.quote(BASE, safe="")), method="PUT")
            with urllib.request.urlopen(req, timeout=3) as r:
                tab = json.loads(r.read().decode("utf-8"))
            ws_url = tab["webSocketDebuggerUrl"]
            break
        except Exception:
            time.sleep(0.5)
    if not ws_url:
        raise RuntimeError("chrome devtools not reachable")

    c = CDP(ws_url)
    c.call("Runtime.enable"); c.call("Page.enable")

    # ---------- 阶段 A：宽屏 1400x900（≥1181 三栏）----------
    c.call("Emulation.setDeviceMetricsOverride", {"width": 1400, "height": 900, "deviceScaleFactor": 1, "mobile": False})
    c.call("Page.navigate", {"url": BASE + "?v=verify"}); 
    if not wait_ready(c): raise RuntimeError("page not ready (wide)")
    time.sleep(1.2)

    check("A1 宽屏 ≥1181 命中", c.ev("matchMedia('(min-width: 1181px)').matches"), "true", c.ev("matchMedia('(min-width: 1181px)').matches") is True)
    wide = c.ev("""(function(){
      var m=document.getElementById('solo-memo');
      var cs=getComputedStyle(m);
      var qa=document.getElementById('qa-log');
      return {collapsed:m.classList.contains('collapsed'), pos:cs.position,
              qaVisible: qa.offsetHeight>0 && getComputedStyle(qa).display!=='none',
              layoutCols: getComputedStyle(document.querySelector('.layout')).gridTemplateColumns.split(' ').length};
    })()""")
    check("A2 宽屏：备忘录默认展开+sticky三栏", wide, "collapsed=false, pos=static, qa可见, 三列",
          wide["collapsed"] is False and wide["pos"] == "static" and wide["qaVisible"] is True and wide["layoutCols"] >= 3)
    htmlsrc = c.ev("fetch('index.html',{cache:'no-store'}).then(r=>r.text()).then(t=>({defer:/<script[^>]+library\\.list\\.js[^>]*defer/.test(t), hasLoader:/library\\.source\\.js/.test(t), swHasLib: /js\\/library\\.list\\.js/.test(fetch('sw.js',{cache:'no-store'})) }))")
    htmlsrc = c.ev("(async()=>{const t=await (await fetch('index.html',{cache:'no-store'})).text();const s=await (await fetch('sw.js',{cache:'no-store'})).text();return {firstScreenScript:/<script[^>]+src=[^>]*library\\.list\\.js/.test(t), hasSourceLoader:/library\\.source\\.js/.test(t), swShellPreload:/SHELL[\\s\\S]*?js\\/library\\.list\\.js/.test(s)};})()")
    check("A3 首屏不带 library.list.js、懒加载器在场、SW 不预载 546KB", htmlsrc,
          "首屏 false / loader true / SHELL false",
          htmlsrc["firstScreenScript"] is False and htmlsrc["hasSourceLoader"] is True and htmlsrc["swShellPreload"] is False)

    # 进汤库：懒加载 + 列表口径
    c.ev("document.getElementById('btn-library').click()")
    c.call("Runtime.evaluate", {"expression": "new Promise(r=>{var n=0;var iv=setInterval(function(){n++;var b=document.getElementById('lib-count');var txt=b?b.textContent:'';if(txt && txt!=='…' && /\\/ /.test(txt)) {clearInterval(iv);r(1)} if(n>120) clearInterval(iv);},250);})", "awaitPromise": True, "returnByValue": True})
    libpage = c.ev("""(function(){
      var b=document.getElementById('lib-count');
      var src=[].map.call(document.querySelectorAll('#lib-src .chip'),function(x){return x.textContent.trim()});
      var cats=[].map.call(document.querySelectorAll('#lib-cat .chip'),function(x){return x.textContent.trim()});
      var cards=document.querySelectorAll('#lib-list .pz-card').length;
      var anyTrans=cats.filter(function(x){return x==='英译中'||x==='日译中'||x==='繁译简'}).length;
      var anyTech=src.concat(cats).filter(function(x){return /dataset:|github:|\\.jp|\\.net\\/|17hczmsn|KONpiGG/.test(x)}).length;
      return {count:b?b.textContent:'', srcs:src, catCount:cats.length, transInCats:anyTrans, techTags:anyTech, cards:cards, ready:window.SoupLibSource?SoupLibSource.ready():false};
    })()""")
    check("A4 汤库懒加载就绪 30/2500 + 筛选无技术标签", libpage,
          "count 含 2500、src≤7组、题材无翻译标签、无 dataset/github",
          libpage["ready"] is True and "2500" in libpage["count"] and len(libpage["srcs"]) <= 7
          and libpage["transInCats"] == 0 and libpage["techTags"] == 0 and libpage["cards"] >= 30)
    randpool = c.ev("(function(){document.getElementById('btn-lib-back').click();document.getElementById('btn-random-mode').click();var el=document.getElementById('rand-pool');var rc=[].map.call(document.querySelectorAll('#rand-cats .chip'),function(x){return x.textContent.trim()});return {txt:el.textContent, trans:rc.filter(function(x){return x==='英译中'||x==='日译中'||x==='繁译简'}).length};})()")
    check("A5 随机模式同套视图（2500 可选、无翻译 chips）", randpool, "含 2500 且 trans=0",
          "2500" in randpool["txt"] and randpool["trans"] == 0)
    c.call("Runtime.evaluate", {"expression": "document.getElementById('btn-rand-back').click()"})
    shot(c, "wide_home")

    # ---------- 阶段 B：窄屏 600x800 ----------
    c.call("Emulation.setDeviceMetricsOverride", {"width": 600, "height": 800, "deviceScaleFactor": 1, "mobile": True})
    c.call("Page.navigate", {"url": BASE + "?v=verify2"})
    if not wait_ready(c): raise RuntimeError("page not ready (narrow)")
    time.sleep(1.0)
    narrow = c.ev("""(function(){
      var m=document.getElementById('solo-memo');
      var qa=document.getElementById('qa-panel-holder')||document.querySelector('.col-qa .qa-panel');
      var qalog=document.getElementById('qa-log');
      return {memoCollapsed:m.classList.contains('collapsed'),
              memoAria:document.getElementById('btn-solo-memo-toggle').getAttribute('aria-expanded'),
              qaCollapsed:qa.classList.contains('qa-collapsed'),
              qaHidden: qalog.offsetHeight===0 || getComputedStyle(qalog).display==='none',
              chevron: getComputedStyle(document.querySelector('.qa-chev')).transform};
    })()""")
    check("B1 窄屏：备忘录默认收起(P1-1)", narrow, "collapsed=true, aria false",
          narrow["memoCollapsed"] is True and narrow["memoAria"] == "false")
    check("B2 窄屏：问答记录收成头栏(改善③)", narrow, "qa-collapsed + 日志隐藏",
          narrow["qaCollapsed"] is True and narrow["qaHidden"] is True)

    c.ev("document.getElementById('btn-library').click()")
    c.call("Runtime.evaluate", {"expression": "new Promise(r=>{var n=0;var iv=setInterval(function(){n++;var b=document.getElementById('lib-count');if(b&&/\\d+ \\/ \\d+/.test(b.textContent)){clearInterval(iv);r(1)}if(n>120)clearInterval(iv);},250);})", "awaitPromise": True})
    narrowlib = c.ev("""(function(){
      var list=document.getElementById('lib-list');
      var card=document.querySelector('.lib-card');
      var meta=card?card.querySelector('.pz-meta').textContent:'';
      return {dir:getComputedStyle(list).flexDirection, overflowX:getComputedStyle(list).overflowX, meta:meta};
    })()""")
    check("B3 窄屏汤库纵向列表(改善②)", narrowlib, "column", narrowlib["dir"] == "column")
    check("B4 卡片来源显示组名(P2-3)", narrowlib, "含可读组名",
          any(k in narrowlib["meta"] for k in ["海外经典站", "中文汤站", "社区投稿", "数据集归档", "精品自制", "其他来源"]))
    shot(c, "narrow_library")

    # 音量填充 + 坏档护栏
    vol = c.ev("""(function(){
      var v=document.getElementById('vol');
      v.value='35'; v.dispatchEvent(new Event('input',{bubbles:true}));
      var fill=getComputedStyle(v).getPropertyValue('--vol-p').trim();
      v.value='0'; v.dispatchEvent(new Event('input',{bubbles:true}));
      var fill0=getComputedStyle(v).getPropertyValue('--vol-p').trim();
      return {fill:fill, fill0:fill0, stored:JSON.parse(localStorage.getItem('deepsea_soup_v1')||'{}').volume};
    })()""")
    check("B5 音量滑轨动态填充(P3-6.1)", vol, "35% / 0%", vol["fill"] == "35%" and vol["fill0"] == "0%")

    c.ev("localStorage.setItem('deepsea_soup_v1', JSON.stringify({volume:5, sound:true}))")
    # 精确模拟「首访即坏档」：新文档创建时（boot 之前）注入坏值，排除旧页 pagehide 竞态
    inj = c.call("Page.addScriptToEvaluateOnNewDocument", {"source": "localStorage.setItem('deepsea_soup_v1', JSON.stringify({volume:5, sound:true}))"})
    c.call("Page.navigate", {"url": BASE + "?v=verify3"})
    if not wait_ready(c): raise RuntimeError("page not ready (vol guard)")
    time.sleep(0.8)
    c.call("Page.removeScriptToEvaluateOnNewDocument", {"identifier": inj.get("identifier")})
    guard = c.ev("""(function(){
      var v=document.getElementById('vol');
      var st=JSON.parse(localStorage.getItem('deepsea_soup_v1')||'{}');
      return {value:v.value, fill:getComputedStyle(v).getPropertyValue('--vol-p').trim(), volumeInStore:('volume' in st)?st.volume:'(removed)'};
    })()""")
    check("B6 越界坏音量被 reset 且不回写(P3-6.2)", guard, "value=60 fill=60% volume=removed/0.6",
          guard["value"] == "60" and guard["fill"] == "60%" and (guard["volumeInStore"] == "(removed)" or guard["volumeInStore"] == 0.6))
    # 记住 Key 开关在场
    remember = c.ev("(function(){var x=document.getElementById('ai-remember');return x?{exists:true, pressed:x.getAttribute('aria-pressed')}:null})()")
    check("B7 AI 记住 Key 开关在场(改善④)", remember, "存在默认 on", remember and remember["exists"] and remember["pressed"] == "true")
    shot(c, "narrow_game")
    log("\n==== 汇总 ====")
    log("PASS %d / FAIL %d" % (sum(1 for r in results if r[1]), sum(1 for r in results if not r[1])))
except Exception as e:
    log("ERROR: " + repr(e)[:500])
    raise
finally:
    proc.terminate()
