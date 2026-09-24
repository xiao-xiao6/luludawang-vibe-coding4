# -*- coding: utf-8 -*-
"""真浏览器实测 · 第五轮：右栏「上线索板 + 下房间聊天」固定尺寸。

需求（主人 2026-09-24）：
  右侧的线索板和房间聊天都在右栏里，线索板在上、固定大小，
  房间聊天在下面、固定大小；两块的高度都不随房间人数 / 线索条数 /
  聊天条数变化。

用 headless Chrome + CDP，配合已部署的真 Worker
（https://soup-room.57gqq9hsq.workers.dev），把页面真的开进多人房：
  1) 用精品层「最后一碗汤」（11 条线索）关键词汤主刷出真线索；
  2) 从多个浏览器身份往房间里灌真聊天；
  3) 在 1366x900 / 1600x1000 / 1440x800 三种窗口下，
     分别在「空房 / 单条 / 满线索 / 满聊天」四个状态量两块的高度，
     断言高度恒定、且两块互不重叠、也不压住「问答记录」按钮。

输出：tools/_cdp_layout5.txt（UTF-8）
"""
import json, os, subprocess, time, urllib.request, urllib.error
import websocket

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = "http://127.0.0.1:5500/index.html"
# 默认跑本地 wrangler dev（源码的 15 人上限 + 最新服务端逻辑）；
# 也可以用 SOUP_WORKER 环境变量指回已部署的线上 Worker。
WORKER = os.environ.get("SOUP_WORKER", "http://127.0.0.1:8791")
PORT = 9341
OUT = os.path.join(ROOT, "tools", "_cdp_layout5.txt")
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
ORIGIN = "http://127.0.0.1:5500"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

# 精品层「最后一碗汤」：11 条线索，关键词判定即可（不需要 AI Key）
PUZZLE_ID = "turtle"
HOST_ID = "layout-host-0001"

# 11 条线索各自的有效关键词（取自 puzzles.data.js 的 turtle.clues[].kw，
# 已跳过出现在汤面里的词），逐条问出 → 线索板刷满
CLUE_QUESTIONS = [
    "你是不是遇到过海难？",       # 1 yes
    "你是被困在一座荒岛上吗？",   # 2 yes
    "你们是不是在挨饿？",         # 3 yes
    "当时还有别的同伴吗？",       # 4 yes
    "那碗汤里是不是有人肉？",     # 5 yes
    "他是想自杀吗？",             # 6 no
    "是服务员下毒害他吗？",       # 7 no
    "他是因为过敏或者生病吗？",   # 8 no
    "这件事和他的妻子有关吗？",   # 9 irr
    "他是因为账单或者破产吗？",   # 10 irr
    "这是灵异或者诅咒吗？",       # 11 irr
]

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


def api(path, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(WORKER + path, data=data, method=method)
    if data:
        r.add_header("content-type", "application/json")
    r.add_header("Origin", ORIGIN)
    # Cloudflare 会拦 Python 默认 UA（403），伪装成浏览器才拿得到响应
    r.add_header("User-Agent", UA)
    try:
        with urllib.request.urlopen(r, timeout=45) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}


class CDP:
    def __init__(self, wsurl):
        self.ws = websocket.create_connection(wsurl, timeout=120)
        self.i = 0

    def call(self, method, params=None, timeout=120):
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

    def ev(self, expr, timeout=120):
        r = self.call("Runtime.evaluate",
                      {"expression": expr, "returnByValue": True, "awaitPromise": True},
                      timeout=timeout)
        if r.get("exceptionDetails"):
            return "__ERR__ " + str(r["exceptionDetails"].get("exception", {}).get("description"))[:300]
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
  var col=document.querySelector('#col-clue');
  var clueEl=document.querySelector('#clue-panel'),
      listEl=document.querySelector('#clue-list'),
      chatEl=document.querySelector('#room-chat'),
      chatLog=document.querySelector('#room-chat-log');
  var clue=R('#clue-panel'), list=R('#clue-list'), chat=R('#room-chat'),
      qa=R('#btn-room-qa'), row=R('#room-players'), ready=R('#btn-room-ready');
  return JSON.stringify({
    vw: window.innerWidth, vh: window.innerHeight,
    colH: col? Math.round(col.getBoundingClientRect().height):null,
    clueH: clue? clue.h:null, chatH: chat? chat.h:null,
    clueY: clue? clue.y:null, clueB: clue? clue.b:null,
    chatY: chat? chat.y:null, chatB: chat? chat.b:null,
    listH: list? list.h:null, listOverflow: listEl? listEl.scrollHeight:null,
    chatLogH: chatLog ? Math.round(chatLog.getBoundingClientRect().height) : null,
    chatLogOverflow: chatLog ? chatLog.scrollHeight : null,
    clueCount: document.querySelectorAll('#clue-list .room-clue-item, #clue-list .clue').length,
    chatCount: document.querySelectorAll('#room-chat-log .chat-item').length,
    chatParent: chatEl && chatEl.parentNode
      ? (chatEl.parentNode === document.body ? "body" : (chatEl.parentNode.id || chatEl.parentNode.className))
      : null,
    chatPos: chatEl ? getComputedStyle(chatEl).position : null,
    players: document.querySelectorAll('#room-players .room-player').length,
    playerBadge: (document.querySelector('#room-count') || {}).textContent || '',
    cluePanelPos: clueEl ? getComputedStyle(clueEl).height : null,
    overlap_clue_chat: inter(clue,chat),
    overlap_chat_qa: inter(qa,chat),
    overlap_clue_qa: inter(clue,qa),
    clueChatGap: (clue&&chat)? (chat.y - clue.b) : null,
    chatBottomGap: chat? Math.round(window.innerHeight - chat.b):null
  });
})()
"""


def start_chrome():
    prof = os.path.join(os.environ.get("TEMP", "."), "chrome-cdp-soup5")
    subprocess.run(["cmd", "/c", "rmdir", "/s", "/q", prof], capture_output=True)
    p = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", "--no-first-run",
                          "--no-default-browser-check",
                          "--remote-debugging-port=%d" % PORT,
                          "--remote-allow-origins=*",
                          "--user-data-dir=" + prof,
                          "--window-size=1500,900", "about:blank"],
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


def measure_after(c, secs=1.6):
    time.sleep(secs)
    v = c.ev(MEASURE)
    if isinstance(v, str) and v.startswith("__ERR__"):
        return {"__err__": v}
    try:
        return json.loads(v)
    except Exception:
        return {"__raw__": v}


def main():
    proc = start_chrome()
    try:
        c = CDP(new_target("about:blank")["webSocketDebuggerUrl"])
        c.call("Runtime.enable")
        c.call("Page.enable")
        c.call("Page.navigate", {"url": PAGE})
        time.sleep(3.5)

        log("=== 第五轮：右栏「上线索板 + 下房间聊天」固定尺寸 ===")
        log("真浏览器 headless Chrome + CDP；后端 = " + WORKER)

        # ---- 建房（房主）+ 拉一堆真人灌聊天 ----
        st, room = api("/api/room/new", "POST", {"internalId": HOST_ID, "nickname": "房主"})
        code = room.get("roomCode")
        log("\n== 建房 ==")
        ok("真 Worker 建房成功", st == 200 and bool(code), code)
        if not code:
            return

        st2, ch = api("/api/room/%s/choose" % code, "POST",
                      {"internalId": HOST_ID, "puzzleId": PUZZLE_ID})
        ok("房主选到精品层「最后一碗汤」", st2 == 200 and not ch.get("error"), ch.get("error") or PUZZLE_ID)

        # 页面认领房主身份（刷新后 resume() 自动接回房内）。
        # 顺序要紧：setBase 内部会 persist()，必须先把 base 定下来，
        # 再写 localStorage 的房号；反过来会被 persist() 把房号抹掉。
        c.ev("SoupNet.setBase(%s)" % json.dumps(WORKER))
        c.ev("""(function(){
          try{ localStorage.setItem('soupnet.v1', JSON.stringify({
            roomCode:%s, internalId:%s, nickname:'房主', solo:false, base:%s
          })); }catch(e){}
        })()""" % (json.dumps(code), json.dumps(HOST_ID), json.dumps(WORKER)))
        c.call("Page.navigate", {"url": PAGE})
        time.sleep(5.0)

        lived = c.ev("String(!document.querySelector('#room-live').classList.contains('hidden'))")
        log("   刷新后进房状态：live=" + str(lived) + "  me=" + str(c.ev("JSON.stringify(SoupNet.me)")))
        ok("刷新后自动接回房内（resume 生效）", lived == "true", lived)

        # 全员准备 → 开局（这里只有房主一人，准备后直接 playing）
        st_r, rr = api("/api/room/%s/ready" % code, "POST", {"internalId": HOST_ID, "ready": True})
        ok("准备指令被接受", st_r == 200 and not rr.get("error"), rr.get("error") or rr.get("phase"))
        time.sleep(2.0)
        st3, snap = api("/api/room/%s/state?me=1" % code)
        log("   开局后阶段：" + str(snap.get("phase")))
        ok("房间已进入 playing", snap.get("phase") == "playing", snap.get("phase"))

        # ---------------- 状态 A：空线索 / 空聊天 ----------------
        log("\n== 状态 A：无线索、无聊天（1366x900） ==")
        c.call("Emulation.setDeviceMetricsOverride",
               {"width": 1366, "height": 900, "deviceScaleFactor": 1, "mobile": False})
        a = measure_after(c, 2.0)
        log("   " + json.dumps(a, ensure_ascii=False))
        ok("聊天框已搬进右栏（不再是屏幕右下角悬浮）", a.get("chatParent") == "col-clue",
           "parent=" + str(a.get("chatParent")))
        ok("聊天框在右栏内是常驻布局（position≠fixed）", a.get("chatPos") == "static",
           "position=" + str(a.get("chatPos")))
        ok("线索板在上、聊天框在下", (a.get("chatY") or 0) >= (a.get("clueB") or 0) - 2,
           "clueB=%s chatY=%s" % (a.get("clueB"), a.get("chatY")))
        ok("两块互不重叠", a.get("overlap_clue_chat") == 0, a.get("overlap_clue_chat"))
        base_clue_h, base_chat_h = a.get("clueH"), a.get("chatH")
        ok("线索板有固定高度", bool(base_clue_h), base_clue_h)
        ok("聊天框有固定高度", bool(base_chat_h), base_chat_h)

        # ---------------- 状态 B：灌真聊天（多身份） ----------------
        log("\n== 状态 B：灌入真聊天 + 人数拉到 15 人后复量 ==")
        for i in range(2, 8):
            api("/api/room/%s/join" % code, "POST",
                {"internalId": "chat-guest-%03d" % i, "nickname": "聊客%d" % i})
        sent = 0
        for i in range(2, 8):
            for k in range(2):
                stc, cc = api("/api/room/%s/say" % code, "POST",
                              {"internalId": "chat-guest-%03d" % i,
                               "text": "闲聊第%d条第%d句：今晚这锅汤好喝吗" % (i, k + 1),
                               "clientId": "chat-%d-%d" % (i, k)})
                if not cc.get("error"):
                    sent += 1
                else:
                    log("      聊天第%d条第%d句未入账：%s" % (i, k + 1, cc.get("error")))
                # 服务端有 600ms 同人频控（CHAT_GAP_MS），隔开再发
                time.sleep(0.7)
        # 再塞 8 个只占座的人，把房间顶到 15 人满房
        for i in range(20, 28):
            api("/api/room/%s/join" % code, "POST",
                {"internalId": "bench-guest-%03d" % i, "nickname": "坐客%d" % i})
        st_p, snap_p = api("/api/room/%s/state?me=1" % code)
        n_players = len(snap_p.get("players") or [])
        log("   成功灌入聊天：%d 条；当前在座：%d 人" % (sent, n_players))
        ok("真聊天已入账（服务端）", sent >= 8, sent)
        ok("房间已拉到 15 人满房", n_players == 15, n_players)
        b = measure_after(c, 2.5)
        log("   " + json.dumps(b, ensure_ascii=False))
        ok("页面确实渲染 15 人", (b.get("players") or 0) == 15, b.get("players"))
        ok("聊天条数确实变多了", (b.get("chatCount") or 0) > (a.get("chatCount") or 0),
           "%s → %s" % (a.get("chatCount"), b.get("chatCount")))
        ok("线索板高度不随人数 / 聊天条数变化", b.get("clueH") == base_clue_h,
           "%s → %s" % (base_clue_h, b.get("clueH")))
        ok("聊天框高度不随人数 / 聊天条数变化", b.get("chatH") == base_chat_h,
           "%s → %s" % (base_chat_h, b.get("chatH")))
        ok("15 人时两块仍不重叠", b.get("overlap_clue_chat") == 0, b.get("overlap_clue_chat"))

        # ---------------- 状态 C：刷满真线索 ----------------
        log("\n== 状态 C：刷满真线索后复量 ==")
        got = 0
        for qi, q in enumerate(CLUE_QUESTIONS):
            stq, rq = api("/api/room/%s/ask" % code, "POST",
                          {"internalId": HOST_ID, "question": q})
            if not rq.get("error"):
                got += 1
            else:
                log("      第%d问未入账：%s" % (qi + 1, rq.get("error")))
        log("   成功提问：%d 次" % got)
        st4, snap2 = api("/api/room/%s/state?me=1" % code)
        log("   线索进度：%s/%s" % (len(snap2.get("revealed") or []), snap2.get("clueTotal")))
        ok("真线索已挖出", len(snap2.get("revealed") or []) >= 4,
           "%s/%s" % (len(snap2.get("revealed") or []), snap2.get("clueTotal")))
        cc2 = measure_after(c, 2.5)
        log("   " + json.dumps(cc2, ensure_ascii=False))
        ok("线索条目确实渲染出来", (cc2.get("clueCount") or 0) >= 4, cc2.get("clueCount"))
        ok("线索板高度不随线索条数变化", cc2.get("clueH") == base_clue_h,
           "%s → %s" % (base_clue_h, cc2.get("clueH")))
        ok("聊天框高度不随线索条数变化", cc2.get("chatH") == base_chat_h,
           "%s → %s" % (base_chat_h, cc2.get("chatH")))
        ok("线索在卡片内滚动（不把卡片撑高）",
           (cc2.get("listOverflow") or 0) >= (cc2.get("listH") or 0),
           "scrollH=%s boxH=%s" % (cc2.get("listOverflow"), cc2.get("listH")))
        ok("满线索时两块仍不重叠", cc2.get("overlap_clue_chat") == 0, cc2.get("overlap_clue_chat"))
        ok("聊天框没压住「问答记录」按钮", cc2.get("overlap_chat_qa") == 0, cc2.get("overlap_chat_qa"))
        ok("线索板没压住「问答记录」按钮", cc2.get("overlap_clue_qa") == 0, cc2.get("overlap_clue_qa"))

        # ---------------- 状态 C2：聊天堆到 30 条，验证日志区内部滚动 ----------------
        log("\n== 状态 C2：聊天堆到 30 条后复量（聊天日志区应内部滚动） ==")
        extra = 0
        for round_i in range(3):
            for i in range(2, 8):
                stc, cc = api("/api/room/%s/say" % code, "POST",
                              {"internalId": "chat-guest-%03d" % i,
                               "text": "第%d轮闲聊：这条用来把聊天区擑到超出高度" % (round_i + 1),
                               "clientId": "chat-r%d-%d" % (round_i, i)})
                if not cc.get("error"):
                    extra += 1
                time.sleep(0.7)
        st5, snap3 = api("/api/room/%s/state?me=1" % code)
        n_chat = len(snap3.get("chatLog") or [])
        log("   又灌入 %d 条，服务端聊天总数：%d" % (extra, n_chat))
        ok("聊天总数已超过一屏", n_chat >= 20, n_chat)
        c2 = measure_after(c, 2.5)
        log("   " + json.dumps(c2, ensure_ascii=False))
        ok("线索板高度不随聊天条数变化", c2.get("clueH") == base_clue_h,
           "%s → %s" % (base_clue_h, c2.get("clueH")))
        ok("聊天框高度不随聊天条数变化", c2.get("chatH") == base_chat_h,
           "%s → %s" % (base_chat_h, c2.get("chatH")))
        ok("聊天框没被聊天条数撑高（与初始同高）", (c2.get("chatH") or 0) == base_chat_h,
           c2.get("chatH"))
        ok("聊天日志区内部滚动（不把聊天框撑高）",
           (c2.get("chatLogOverflow") or 0) > (c2.get("chatLogH") or 0),
           "scrollH=%s boxH=%s" % (c2.get("chatLogOverflow"), c2.get("chatLogH")))

        # ---------------- 状态 C3：截图存证 ----------------
        log("\n== 状态 C3：截图存证（1500x900，满线索 + 30 条聊天 + 15 人） ==")
        c.call("Emulation.setDeviceMetricsOverride",
               {"width": 1500, "height": 900, "deviceScaleFactor": 1, "mobile": False})
        time.sleep(2.0)
        shot_dir = os.path.join(ROOT, "tools", "shots")
        os.makedirs(shot_dir, exist_ok=True)
        shot = c.call("Page.captureScreenshot", {"format": "png"})
        import base64
        shot_path = os.path.join(shot_dir, "layout5_room_1500x900.png")
        with open(shot_path, "wb") as f:
            f.write(base64.b64decode(shot["data"]))
        log("   已存截图：tools/shots/layout5_room_1500x900.png")
        ok("截图已落盘", os.path.getsize(shot_path) > 20000, os.path.getsize(shot_path))

        # ---------------- 状态 D：换窗口尺寸 ----------------
        log("\n== 状态 D：换窗口尺寸后复量 ==")
        for (w, h) in [(1600, 1000), (1440, 800), (1200, 760)]:
            c.call("Emulation.setDeviceMetricsOverride",
                   {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": False})
            d = measure_after(c, 2.0)
            log("   %dx%d：%s" % (w, h, json.dumps(d, ensure_ascii=False)))
            ok("%dx%d 聊天框仍在右栏" % (w, h), d.get("chatParent") == "col-clue", d.get("chatParent"))
            ok("%dx%d 两块不重叠" % (w, h), d.get("overlap_clue_chat") == 0,
               d.get("overlap_clue_chat"))
            ok("%dx%d 聊天框没压住「问答记录」" % (w, h), d.get("overlap_chat_qa") == 0,
               d.get("overlap_chat_qa"))
            ok("%dx%d 聊天框在视口内（没被顶出屏幕）" % (w, h),
               (d.get("chatBottomGap") or 999) >= -2, d.get("chatBottomGap"))

        # ---------------- 状态 E：窄屏（≤1180px）应回到右下角悬浮 ----------------
        log("\n== 状态 E：窄桌面 1100x800（右栏折叠为整行，聊天框应回右下角） ==")
        c.call("Emulation.setDeviceMetricsOverride",
               {"width": 1100, "height": 800, "deviceScaleFactor": 1, "mobile": False})
        e = measure_after(c, 2.2)
        log("   " + json.dumps(e, ensure_ascii=False))
        ok("窄屏聊天框回到 body（右下角悬浮）", e.get("chatParent") == "body",
           "parent=" + str(e.get("chatParent")))
        ok("窄屏聊天框恢复 fixed 定位", e.get("chatPos") == "fixed", e.get("chatPos"))
        ok("窄屏聊天框没压住「问答记录」", e.get("overlap_chat_qa") == 0, e.get("overlap_chat_qa"))

        # ---------------- 状态 G：极矮窗口，两块仍完整可见 ----------------
        log("\n== 状态 G：极矮窗口 1300x640（两块累积高度不能把输入框顶出屏幕） ==")
        c.call("Emulation.setDeviceMetricsOverride",
               {"width": 1300, "height": 640, "deviceScaleFactor": 1, "mobile": False})
        g = measure_after(c, 2.2)
        log("   " + json.dumps(g, ensure_ascii=False))
        ok("极矮窗口聊天框仍在右栏", g.get("chatParent") == "col-clue", g.get("chatParent"))
        ok("极矮窗口两块不重叠", g.get("overlap_clue_chat") == 0, g.get("overlap_clue_chat"))
        ok("极矮窗口聊天框没压住「问答记录」", g.get("overlap_chat_qa") == 0, g.get("overlap_chat_qa"))
        sent_btn = c.ev("""(function(){
          var b=document.querySelector('#btn-room-chat-send'); if(!b) return 'NONE';
          var r=b.getBoundingClientRect();
          return JSON.stringify({y:Math.round(r.top),b:Math.round(r.bottom),h:Math.round(r.height),vh:window.innerHeight});
        })()""")
        log("   发送按钮：" + str(sent_btn))
        try:
            sb = json.loads(sent_btn)
            ok("极矮窗口下「发送」按钮完整留在视口内",
               sb.get("b", 9999) <= sb.get("vh", 0) and sb.get("h", 0) > 0, sent_btn)
        except Exception:
            ok("极矮窗口下「发送」按钮存在", False, sent_btn)

        # 再切回宽屏，确认能自动归位回右栏
        log("\n== 状态 F：宽窄来回切一次，聊天框应自动归位 ==")
        c.call("Emulation.setDeviceMetricsOverride",
               {"width": 1500, "height": 900, "deviceScaleFactor": 1, "mobile": False})
        f = measure_after(c, 2.2)
        log("   " + json.dumps(f, ensure_ascii=False))
        ok("切回宽屏后聊天框自动回到右栏", f.get("chatParent") == "col-clue", f.get("chatParent"))
        ok("切回宽屏后高度仍是固定值", f.get("chatH") == base_chat_h,
           "%s vs %s" % (f.get("chatH"), base_chat_h))

        # ---------------- 状态 H：收起聊天，线索板高度不能跟着变 ----------------
        log("\n== 状态 H：收起房间聊天后复量（线索板高度不应变化） ==")
        c.ev("""(function(){ var b=document.querySelector('#btn-room-chat-toggle'); if(b) b.click(); })()""")
        h = measure_after(c, 1.8)
        log("   " + json.dumps(h, ensure_ascii=False))
        ok("收起后聊天框仍在右栏", h.get("chatParent") == "col-clue", h.get("chatParent"))
        ok("收起后线索板高度不变", h.get("clueH") == base_clue_h,
           "%s vs %s" % (h.get("clueH"), base_clue_h))
        ok("收起后线索板在上、聊天头在下", (h.get("chatY") or 0) >= (h.get("clueB") or 0) - 2,
           "clueB=%s chatY=%s" % (h.get("clueB"), h.get("chatY")))
        # 再展开，确认两块仍与初始一致
        c.ev("""(function(){ var b=document.querySelector('#btn-room-chat-toggle'); if(b) b.click(); })()""")
        h2 = measure_after(c, 1.8)
        log("   重新展开：" + json.dumps(h2, ensure_ascii=False))
        ok("重新展开后聊天框高度回到固定值", h2.get("chatH") == base_chat_h,
           "%s vs %s" % (h2.get("chatH"), base_chat_h))
        ok("重新展开后线索板高度不变", h2.get("clueH") == base_clue_h,
           "%s vs %s" % (h2.get("clueH"), base_clue_h))
        ok("重新展开后两块不重叠", h2.get("overlap_clue_chat") == 0, h2.get("overlap_clue_chat"))

        log("\n== 汇总 ==")
        log("失败项：%d" % fails[0])
    finally:
        flush()
        try:
            proc.terminate()
        except Exception:
            pass


if __name__ == "__main__":
    main()
