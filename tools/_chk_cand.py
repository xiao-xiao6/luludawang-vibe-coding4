# -*- coding: utf-8 -*-
import io, os, json, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"C:\Users\Administrator\AppData\Roaming\@opensquilla\desktop-electron\opensquilla\workspace\海龟汤小游戏"
T = lambda *p: os.path.join(ROOT, *p)
rows = {r["id"]: r for r in json.load(io.open(T("tools", "checkup_all.json"), encoding="utf-8"))}
CAND = [
 ("A1", ["lib_15397666d0dc", "lib_63cc13c14001", "lib_ff8274c3b6a4", "lib_1b87b25ec3f6"]),
 ("A2", ["lib_cf4df2679f37", "lib_f63fea0b8942", "lib_bc9361702fe8"]),
 ("A3", ["lib_87cf5cda72ec", "lib_5a07724b936e", "lib_b14834641b71", "lib_6484e3174027"]),
 ("A4", ["lib_1109722c5e9b", "lib_04881146676a"]),
 ("A5", ["lib_600c89e5687d", "lib_9d1ba3a3e810", "lib_586e3435151a"]),
 ("A6", ["lib_647ed957cb9b", "lib_9e2ac3c33b31", "lib_ce47f98df151"]),
 ("A7", ["lib_524e0a51b2d9", "lib_531fe2908aac", "lib_8149a55c2cf7", "lib_f5ffa3a3b5fe"]),
 ("A8", ["lib_1b25c1841aea", "lib_83fccebd826a", "lib_7386ca5835f0"]),
 ("A9", ["lib_893f0dea93cd", "lib_fb6a80169330", "lib_004e5146594c", "lib_6f9d41b86cb2"]),
 ("B1", ["lib_4d4ae7aa267f", "lib_ef652fe14c3e", "lib_5267d633ce14", "lib_5a74db2ed992"]),
 ("B2", ["lib_73c238975974", "lib_9a2bf4d46848", "lib_ddcb2a1ef3b9", "lib_2590ed8fda9c", "lib_c8cac6026c94", "lib_df9bd6c3c973", "lib_e6c0007af520"]),
 ("B3", ["lib_776b70302820", "lib_d3c52f26b4cd", "lib_b3baae0cd56a", "lib_90d8b1927623", "lib_a8471499667e", "lib_2d7a2f4d5b9f"]),
 ("B4", ["lib_2bfce712eedb", "lib_056db100d29a", "lib_146ba5100f1f", "lib_641dec1f9ed2"]),
 ("B5", ["lib_255999f4f6ba", "lib_d03a68f1e0d1"]),
 ("B6", ["lib_668d61fd84da", "lib_0994796001f5", "lib_997403b58735"]),
 ("B7", ["lib_43e1934bbc83", "lib_57ae1306e87a", "lib_bb9b8da83f0b", "lib_09a8742453b7", "lib_e09338da20be", "lib_4195efaab01e", "lib_b560a80af76b", "lib_6a2910380309", "lib_57c970bf7a82", "lib_eace40ad0af6", "lib_fddab6f49384", "lib_153b82ead579", "lib_6c4c07d9075a"]),
 ("B8", ["lib_749507623b5d", "lib_c3fe6268a938"]),
 ("B9", ["lib_0cf00682e3ce", "lib_1a6283e13128"]),
 ("B10", ["lib_26a8f6aeae4e", "lib_03d26eb2cfd1"]),
 ("B11", ["lib_30c815b194ce", "lib_a1674525f6df"]),
]
for fam, ids in CAND:
    print("========", fam)
    for i in ids:
        r = rows.get(i)
        if not r:
            print("  (缺)", i); continue
        print("  [%s|%s] %s" % (i, r["src"][:16], r["title"][:18]))
        print("    面:%s" % r["surface"][:120].replace("\n", " "))
        print("    底:%s" % r["truth"][:120].replace("\n", " "))
