# -*- coding: utf-8 -*-
"""
体检修复 · 第 1 步：去重删除（汤库层）
每条删除都必须在 DEL 里写明「保留谁 / 为什么是重复」，脚本会打印对照供复核。
写盘前自动备份到 _local_backup/library.data.js.bak-checkup
"""
import io, os, re, json, shutil, sys
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
MASTER = T("data", "library", "library.data.js")

# 删除 id -> (保留 id, 理由)
DEL = {
 # —— train_8k 同题多写（面+底几乎一致）——
 "lib_63cc13c14001": ("lib_15397666d0dc", "狗偷吃早餐，同一题两种措辞"),
 "lib_f63fea0b8942": ("lib_cf4df2679f37", "狗吃光晚餐，cf4 细节最全"),
 "lib_bc9361702fe8": ("lib_cf4df2679f37", "狗跳上桌吃晚餐，同上"),
 "lib_5a07724b936e": ("lib_87cf5cda72ec", "邻居狗叼走鞋，87c 细节最全"),
 "lib_b14834641b71": ("lib_87cf5cda72ec", "邻居狗叼鞋当玩具，同上"),
 "lib_6484e3174027": ("lib_87cf5cda72ec", "邻居狗叼走鞋，同上"),
 "lib_04881146676a": ("lib_1109722c5e9b", "灯自动开关=电气故障，同一题"),
 "lib_586e3435151a": ("lib_9d1ba3a3e810", "门铃半夜自响=接触/线路故障，同一题"),
 "lib_531fe2908aac": ("lib_8149a55c2cf7", "漏水形成类脚印水渍，汤底 jac0.44 同解"),
 "lib_1b25c1841aea": ("lib_83fccebd826a", "阳台衣服投影，汤底 jac0.41 同解"),
 "lib_893f0dea93cd": ("lib_fb6a80169330", "水管震动声像人声，汤底 jac0.30 同解"),
 # —— 经典题在汤库内的多份抄录 ——
 "lib_ef652fe14c3e": ("lib_5a74db2ed992", "电梯侏儒（雨伞按按钮）经典题，保留最完整版"),
 "lib_4d4ae7aa267f": ("lib_5a74db2ed992", "电梯侏儒，同一题换楼层数字"),
 "lib_5267d633ce14": ("lib_5a74db2ed992", "电梯侏儒，同一题换楼层数字"),
 "lib_9a2bf4d46848": ("lib_73c238975974", "半根火柴/热气球抽签，同一经典题"),
 "lib_c8cac6026c94": ("lib_73c238975974", "最后一根火柴=热气球抽签，同一经典题"),
 "lib_ddcb2a1ef3b9": ("lib_b2e6b0296473", "棺材划火柴越狱，同一经典题"),
 "lib_2590ed8fda9c": ("lib_b2e6b0296473", "棺材划火柴越狱，同一经典题"),
 "lib_d3c52f26b4cd": ("lib_776b70302820", "灯塔看守关灯致船难自杀，同一经典题"),
 "lib_b3baae0cd56a": ("lib_776b70302820", "同上（夜里关灯=灯塔）"),
 "lib_90d8b1927623": ("lib_776b70302820", "同上（关收音机=关灯塔灯）"),
 "lib_a8471499667e": ("lib_776b70302820", "同上（推门见灯塔灭）"),
 # —— 「音乐停了」走钢丝家族（同一汤底 6 份）——
 "lib_09a8742453b7": ("lib_43e1934bbc83", "蒙眼走钢丝·乐声停=落脚信号，同解"),
 "lib_e09338da20be": ("lib_43e1934bbc83", "同上（停电版）"),
 "lib_4195efaab01e": ("lib_43e1934bbc83", "同上（乐手起杀心版）"),
 "lib_57c970bf7a82": ("lib_43e1934bbc83", "同上（磁带断版，汤底还自指「和钢丝演员的惨剧一样」）"),
 "lib_bb9b8da83f0b": ("lib_43e1934bbc83", "「三解」拼盘，其中一解即走钢丝，与保留条重复"),
 "lib_fddab6f49384": ("lib_6a2910380309", "盲人游泳者靠收音机回岸，汤底同解"),
 "lib_153b82ead579": ("lib_6a2910380309", "盲人游泳者靠铃声判断方向，同一汤底换成闹钟/浮铃"),
 # —— 其它同故事 ——
 "lib_056db100d29a": ("lib_2bfce712eedb", "盲人吹蜡烛·鼓掌暴露只砍了他的手，同一题"),
 "lib_641dec1f9ed2": ("lib_146ba5100f1f", "作者在自己书里夹钱验证有无读者，同一题"),
 "lib_314cc038dce2": ("lib_71e675399a64", "不识字的人借书翻到某页看记号，同一题"),
 "lib_d03a68f1e0d1": ("lib_255999f4f6ba", "寝室洗头致室友与自己死亡，同一题"),
 "lib_13f7db377f7b": ("lib_aac5e74f3bff", "山顶小屋开门=悬崖下人落水；且该条标题错挂成「侏儒竞争」"),
 "lib_9d27d7019398": ("lib_44433fb07ea5", "海龟汤本汤经典题，汤库内已有完整版"),
 "lib_cf3e6fe7ac2d": ("lib_44433fb07ea5", "海龟汤本汤经典题（091原版）"),
 "lib_bb9cfe3405ab": ("lib_44433fb07ea5", "海龟汤本汤经典题（恋人肉版）"),
}

src = io.open(MASTER, encoding="utf-8").read()
head = src[:src.find("var SOUP_LIBRARY")]
i = src.find("var SOUP_LIBRARY"); i = src.find("[", i)
end = src.find("\nvar SOUP_LIB_CATS", i)
tail = src[end:]
data = json.loads(src[i:end].rsplit("]", 1)[0] + "]")
byid = {e["id"]: e for e in data}
print("删除前:", len(data))

# 校验：保留条必须存在
bad = []
for d, (k, why) in DEL.items():
    if d not in byid: bad.append(("删除条不存在", d))
    if k not in byid: bad.append(("保留条不存在", k))
if bad:
    print("校验失败:"); [print("  ", *b) for b in bad]; sys.exit(2)

print("\n===== 删除/保留对照（人工复核用）=====")
for d, (k, why) in sorted(DEL.items(), key=lambda x: x[1][0]):
    rd, rk = byid[d], byid[k]
    print("--- 删 %s「%s」 保 %s「%s」 | %s" % (d, rd["title"][:14], k, rk["title"][:14], why))
    print("    删底:", rd["truth"][:56].replace("\n", " "))
    print("    保底:", rk["truth"][:56].replace("\n", " "))

shutil.copyfile(MASTER, T("_local_backup", "library.data.js.bak-checkup"))
out = [e for e in data if e["id"] not in DEL]
removed = len(data) - len(out)
print("\n实际删除:", removed, "剩余:", len(out))
body = head + "var SOUP_LIBRARY = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";" + tail
io.open(MASTER, "w", encoding="utf-8").write(body)
json.dump({k: {"kept": v[0], "why": v[1], "title": byid[k]["title"]} for k, v in DEL.items()},
          io.open(T("tools", "checkup_removed.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("已写 tools/checkup_removed.json")
