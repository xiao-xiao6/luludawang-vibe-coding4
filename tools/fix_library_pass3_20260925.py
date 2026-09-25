# -*- coding: utf-8 -*-
"""第三轮修复：撤销 pass2 去重的误杀。
对 tools/fix_library_pass2_20260925.json 里每一条被删项，拿 979 快照（js/library.public.js，
仍含被删条目）对比它与保留项的汤底：
  - 被删方本身是元文本垃圾（red herrings / 来源链接等）→ 维持删除
  - 保留方是元文本垃圾、被删方是真汤 → 用真汤顶替（删保留、恢复被删）
  - 汤底相似 >= 0.60 → 真冗余，维持删除
  - 汤底不同（<0.60）且双方都是真汤 → 是「同型不同题」的变体，恢复被删方
留痕 tools/fix_library_pass3_20260925.json；改完需重跑 node tools/build_worker_data.js
"""
import re, json, io, sys, difflib

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

def load_arr(path, var):
    raw = open(path, encoding="utf-8").read()
    i = raw.index(var)
    j = raw.index("[", i)
    depth, k, instr, esc = 0, j, False, False
    while True:
        c = raw[k]
        if instr:
            if esc: esc = False
            elif c == "\\": esc = True
            elif c == '"': instr = False
        else:
            if c == '"': instr = True
            elif c == "[": depth += 1
            elif c == "]":
                depth -= 1
                if depth == 0: break
        k += 1
    return json.loads(raw[j:k+1]), raw, j, k

master, m_raw, m_j, m_k = load_arr(r"data\library\library.data.js", "SOUP_LIBRARY")
snap, _, _, _ = load_arr(r"js\library.public.js", "SOUP_LIBRARY")
snapmap = {p.get("id"): p for p in snap}
log = json.load(open(r"tools\fix_library_pass2_20260925.json", encoding="utf-8"))
print("master:", len(master), "| snapshot:", len(snap), "| pass2 removed:", len(log["dup_removed"]))

CJK = "\u4e00-\u9fff"
def norm(s): return re.sub("[^0-9A-Za-z" + CJK + "]", "", s or "")
def bsim(a, b):
    A, B = norm(a)[:800], norm(b)[:800]
    if not A or not B: return 0.0
    return difflib.SequenceMatcher(None, A, B).ratio()

META = re.compile(r"(This allows red herrings|red herrings|ground.?truth|benchmark|来源[:：]\s*\[|example\.test|忽略(以上|之前)|ignore (the )?(previous|above))", re.I)
def is_meta(p):
    return bool(META.search(str(p.get("truth") or ""))) or bool(META.search(str(p.get("surface") or "")))

have = {p.get("id") for p in master}
actions = {"restored": [], "replaced": [], "confirmed": [], "skipped": []}
removed_ids = []

for d in log["dup_removed"]:
    rid, kid = d["removed_id"], d["kept_id"]
    r, kp = snapmap.get(rid), snapmap.get(kid)
    if not r or not kp:
        actions["skipped"].append({"id": rid, "why": "missing-in-snapshot"}); continue
    if rid in have:
        actions["skipped"].append({"id": rid, "why": "already-present"}); continue
    mr, mk = is_meta(r), is_meta(kp)
    sb = bsim(r.get("truth", ""), kp.get("truth", ""))
    if mr and not mk:
        actions["confirmed"].append({"id": rid, "keep": kid, "bsim": round(sb, 2), "why": "removed-is-meta"})
    elif mk and not mr:
        master = [p for p in master if p.get("id") != kid] + [r]
        have.discard(kid); have.add(rid)
        removed_ids.append(kid)
        actions["replaced"].append({"id": rid, "kill": kid, "bsim": round(sb, 2),
                                    "restored": d.get("removed_title"), "killed": d.get("kept_title")})
    elif sb >= 0.60:
        actions["confirmed"].append({"id": rid, "keep": kid, "bsim": round(sb, 2), "why": "true-dup"})
    else:
        master.append(r); have.add(rid)
        actions["restored"].append({"id": rid, "keep": kid, "bsim": round(sb, 2),
                                    "title": d.get("removed_title"), "kept": d.get("kept_title")})

body = m_raw[:m_j] + json.dumps(master, ensure_ascii=False) + m_raw[m_k+1:]
open(r"data\library\library.data.js", "w", encoding="utf-8").write(body)
json.dump({"actions": actions, "drop_meta_kept": removed_ids},
          open(r"tools\fix_library_pass3_20260925.json", "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)

print("final master:", len(master))
print("restored:", len(actions["restored"]), "| replaced:", len(actions["replaced"]),
      "| confirmed-dup:", len(actions["confirmed"]), "| skipped:", len(actions["skipped"]))
for a in actions["restored"]:
    print("  +R", a["bsim"], a["title"], "(kept was", a["kept"] + ")")
for a in actions["replaced"]:
    print("  +P kill-meta", a["kill"], "->", a["restored"])
for a in actions["skipped"]:
    print("  ?S", a["id"], a["why"])
