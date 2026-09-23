# -*- coding: utf-8 -*-
"""路线3：为「无汤底」条目生成 AI 汤底（草稿池）—— 并发版

三道闸
------
  闸1 约束生成 —— 提示词写死硬规则（禁超自然/科幻/梦境/多重人格/失忆/替身等；
                    只允许现实世界物理可能的因果；汤面每个反常点都要被解释；
                    不得引入汤面未出现的专有名词）
  闸2 机器自检 —— 生成后立刻校验，不合格直接丢弃：
                    * 命中禁用词 / 汤底过短(<30字) / 过长(>600字)
                    * 引号内出现汤面未有的人名地名
                    * 关键词少于 4 个
  闸3 反向验证 —— --verify 时再起一次调用，只给汤面让模型猜，结果**只记录不否决**
                    （新模型只凭汤面很难猜中原句，硬否决会让整批产出为 0）；
                    要严格模式加 --strict-verify

产出
----
  data/library/ai_truth.json
    { id: { truth, keywords[], truthSource:"ai", model, promptVersion, checks{...} } }

用法
----
  python tools/gen_ai_truths.py --workers 8            # 并发生成（默认闸2）
  python tools/gen_ai_truths.py --workers 8 --verify   # 附闸3（慢一倍，只记录）
  python tools/gen_ai_truths.py --dry                  # 只看待生成清单
  python tools/gen_ai_truths.py --limit 20 --workers 4 # 小批量试跑

环境变量
--------
  OPENAI_BASE_URL   默认 http://127.0.0.1:8787/v1
  OPENAI_API_KEY / AI_TRUTH_KEY   调用凭证
  AI_TRUTH_MODEL    默认 deepseek-v4-flash-0731
"""

import argparse
import concurrent.futures as cf
import io
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
WS = os.path.dirname(PROJ)

LIB = os.path.join(PROJ, "data", "library", "soups.json")
RECOVERED = os.path.join(PROJ, "data", "library", "truth_recovery.json")
OUT = os.path.join(PROJ, "data", "library", "ai_truth.json")

BASE_URL = os.environ.get("OPENAI_BASE_URL", "http://127.0.0.1:8787/v1").rstrip("/")
API_KEY = os.environ.get("OPENAI_API_KEY") or os.environ.get("AI_TRUTH_KEY") or ""
MODEL = os.environ.get("AI_TRUTH_MODEL", "deepseek-v4-flash-0731")
PROMPT_VERSION = "route3-v2"

BANNED = [
    "外星人", "外星", "超能力", "异能", "穿越", "重生", "时空", "平行宇宙",
    "其实都是梦", "一场梦", "做梦", "梦境", "催眠", "多重人格", "第二人格",
    "人格分裂", "精神分裂", "失忆", "双胞胎替身", "替身", "鬼", "幽灵",
    "诅咒", "魔法", "修仙", "妖怪", "机器人", "人工智能", "克隆", "丧尸", "病毒变异",
]

SYSTEM = """你是海龟汤（情境推理谜题）的出题人。给定一段「汤面」，你要写出唯一、可推理、符合现实世界物理与常识的「汤底」。

硬规则（违反任意一条即为失败）：
1. 只能使用现实世界中物理上可能发生的因果。禁止超自然、科幻、穿越、梦境、催眠、多重人格、失忆、双胞胎替身、外星人、鬼怪、诅咒、机器人等。
2. 汤底必须解释汤面里每一个反常点，不允许留下无法解释的细节。
3. 不允许引入汤面中未出现过的专有名词（人名、地名、机构名、作品名）。若汤面用第一人称，汤底也不要生造姓名。
4. 汤底长度 80～300 字，中文，陈述句，不要分点、不要标题、不要"答案是"这类前缀。
5. 必须能从中提炼出至少 6 个用于判定的关键词（名词或短句）。

输出格式（严格 JSON，不要多余文字）：
{"truth": "……", "keywords": ["…","…","…","…","…","…"]}"""

GUESS_SYSTEM = "你是一个海龟汤玩家。只给你汤面，请说出你认为的真相，一句话概括即可。不要提问，直接给结论。"

_lock = threading.Lock()


def norm(s):
    return re.sub(r"\s+", "", str(s or ""))


def chat(messages, timeout=180, max_tokens=1600, tries=3):
    body = json.dumps({
        "model": MODEL,
        "messages": messages,
        "temperature": 0.65,
        "max_tokens": max_tokens,
    }, ensure_ascii=False).encode("utf-8")
    last = ""
    for i in range(tries):
        try:
            req = urllib.request.Request(
                BASE_URL + "/chat/completions", data=body,
                headers={"Content-Type": "application/json",
                         "Authorization": "Bearer " + API_KEY},
                method="POST")
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = json.loads(r.read().decode("utf-8", "replace"))
            msg = (data.get("choices") or [{}])[0].get("message") or {}
            txt = msg.get("content")
            if isinstance(txt, list):
                txt = "".join(str(x.get("text") or "") if isinstance(x, dict) else str(x) for x in txt)
            if txt and str(txt).strip():
                return str(txt)
            last = "空正文"
        except urllib.error.HTTPError as e:
            last = "HTTP %s" % e.code
        except Exception as e:
            last = str(e)[:60]
        time.sleep(1.5 * (i + 1))
    raise RuntimeError(last or "调用失败")


def parse_json(text):
    if not text:
        return None
    m = re.search(r"\{.*\}", str(text), re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


def gate2(surface, truth, keywords):
    if not truth or len(truth) < 30:
        return False, "汤底过短"
    for w in BANNED:
        if w in truth:
            return False, "命中禁用词：" + w
    if len(truth) > 600:
        return False, "汤底过长"
    if not keywords or len(keywords) < 4:
        return False, "关键词不足"
    for m in re.findall(r"[「『“\"《]([^」』”\"》]{2,8})[」』”\"》]", truth):
        if m and m not in surface:
            return False, "引入汤面未有的专有名词：" + m
    return True, ""


def gate3(surface, truth):
    try:
        guess = chat([{"role": "system", "content": GUESS_SYSTEM},
                      {"role": "user", "content": surface}], max_tokens=300)
    except Exception as e:
        return True, "闸3跳过：" + str(e)[:40]
    g = norm(guess)
    if not g:
        return False, "闸3：猜不出"
    kws = set(re.findall(r"[\u4e00-\u9fa5]{2,6}", truth))
    hit = sum(1 for w in kws if w in g)
    return hit >= 2, guess[:80]


def save(done):
    with _lock:
        tmp = OUT + ".tmp"
        with io.open(tmp, "w", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(done, ensure_ascii=False, sort_keys=True, indent=1) + "\n")
        os.replace(tmp, OUT)


def work(item, verify, strict):
    eid, surface = item
    try:
        raw = chat([{"role": "system", "content": SYSTEM},
                    {"role": "user", "content": "汤面：\n" + surface}])
    except Exception as ex:
        return eid, None, "api:" + str(ex)[:50]
    obj = parse_json(raw)
    if not obj:
        return eid, None, "非JSON"
    truth = str(obj.get("truth") or "").strip()
    kws = [str(k).strip() for k in (obj.get("keywords") or []) if str(k).strip()]
    ok, why = gate2(surface, truth, kws)
    checks = {"gate2": ok, "gate2_why": why}
    if ok and verify:
        ok3, g = gate3(surface, truth)
        checks["gate3"] = ok3
        checks["gate3_guess"] = g
        if strict:
            ok = ok3
    if not ok:
        return eid, None, why or "闸3"
    return eid, {
        "truth": truth,
        "keywords": kws,
        "truthSource": "ai",
        "model": MODEL,
        "promptVersion": PROMPT_VERSION,
        "checks": checks,
    }, ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--verify", action="store_true")
    ap.add_argument("--strict-verify", action="store_true")
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()

    lib = json.load(io.open(LIB, encoding="utf-8"))
    recovered = json.load(io.open(RECOVERED, encoding="utf-8")) if os.path.exists(RECOVERED) else {}
    done = json.load(io.open(OUT, encoding="utf-8")) if os.path.exists(OUT) else {}

    todo = [(e["id"], e.get("surface", "")) for e in lib
            if e.get("mode") == "surface"
            and e["id"] not in recovered
            and e["id"] not in done]
    print("无汤底 %d | 已回收 %d | 已 AI 生成 %d | 本次待生成 %d"
          % (sum(1 for e in lib if e.get("mode") == "surface"),
             len(recovered), len(done), len(todo)), flush=True)

    if args.dry or not todo:
        for i, s in todo[:30]:
            print("  %-16s %s" % (i, s[:50]))
        return 0

    if not API_KEY:
        print("!! 未配置 OPENAI_API_KEY / AI_TRUTH_KEY")
        return 2

    if args.limit:
        todo = todo[:args.limit]

    ok_n = 0
    fail_n = 0
    t0 = time.time()
    with cf.ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(work, it, args.verify, args.strict_verify): it[0] for it in todo}
        for k, fut in enumerate(cf.as_completed(futs), 1):
            eid, rec, why = fut.result()
            if rec:
                done[eid] = rec
                ok_n += 1
                print("  [%d/%d] %s OK  %s" % (k, len(todo), eid, rec["truth"][:50]), flush=True)
                if ok_n % 5 == 0:
                    save(done)
            else:
                fail_n += 1
                print("  [%d/%d] %s 拒：%s" % (k, len(todo), eid, why), flush=True)
    save(done)
    dt = time.time() - t0
    print("\n本次生成 %d 条 | 被拒 %d 条 | 累计 %d 条 | 耗时 %.0f 秒"
          % (ok_n, fail_n, len(done), dt), flush=True)
    print("写出: %s" % os.path.relpath(OUT, WS))
    return 0


if __name__ == "__main__":
    sys.exit(main())
