# -*- coding: utf-8 -*-
"""隔离残留旧库文件（只移动、不删除）
js/library.data.js 是 2026-09-24 清洗前的旧版（1361 条，含全部汤底），
未被 index.html 引用，但被 build_worker_data.js 当作回落源 → 属构建地雷。
本脚本把它移到 _local_backup/ 保留，避免构建静默回退到污染数据。
"""
import os, shutil, io

ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
SRC = os.path.join(ROOT, "js", "library.data.js")
DST = os.path.join(ROOT, "_local_backup", "js-library.data.js.stale-1361-precleanup-20260926")

assert os.path.exists(SRC), "源文件不存在，可能已处理过"
assert not os.path.exists(DST), "目标已存在，避免覆盖"

size = os.path.getsize(SRC)
shutil.move(SRC, DST)

# 校验：js/ 下不再有该文件；备份区存在且大小一致
ok_src = not os.path.exists(SRC)
ok_dst = os.path.exists(DST) and os.path.getsize(DST) == size

# 复核 build_worker_data.js 的回落源现在只剩母本
bw = io.open(os.path.join(ROOT, "tools", "build_worker_data.js"), encoding="utf-8").read()
has_master = 'data", "Library", "library.data.js' in bw
print("已隔离: %s -> _local_backup/  | 大小 %d B" % (ok_src, size))
print("备份可读:", ok_dst, "| 构建脚本仍以母本为首选源:", has_master)
print("js/ 目录残留:", [f for f in os.listdir(os.path.join(ROOT, "js")) if "library.data" in f])
