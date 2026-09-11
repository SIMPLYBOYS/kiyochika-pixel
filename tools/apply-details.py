#!/usr/bin/env python3
"""Phase 5 — 把挑好的細節寫進 data/views.json 的 details

  data/details-candidates.json（機器提案，DoG 算在像素版上）
＋ data/details.json（人工挑選與命名）
→ views.json 的 `details: [{x, y, r, label, kind}]`

**驗收兩條**，任何一條不過就中止（⛔ 不要寫出半套資料）：

1. **編號要對得上**：人工檔記的是候選編號，候選一重算就可能換位置。
   🔴 這件事真的發生過——修 `cut_furniture` 之後 41 幅的裁切變了，
   其中 19 幅我已挑好的候選跟著移位。所以這裡除了對編號，還把座標一起存下來，
   之後要比對得出來「當初挑的是這個點」。
2. **判定圈不能重疊**：兩個細節靠太近，點一下會同時中兩個（東京二十景寫過 check_spacing）。
（本來還有第三條「點上去要真的看得到東西」，用對比量。拿掉了——見下方註解：
標準差量的不是找得到，而那件事已經由「候選算在像素版上」保證。）

用法：
  python3 tools/apply-details.py            # 只驗
  python3 tools/apply-details.py --write    # 寫回 views.json
"""
import argparse, json, math
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
# 🔴 **「對比」這道閘拿掉了，因為它量的不是我要的東西。**
# 試了兩版：絕對門檻（灰階標準差 ≥ 14）標出來的**全是夜景**——量到的是「這幅畫很暗」；
# 改成跟同一幅畫比（patch std ÷ 全圖 patch std 中位數）標出 43 個，同樣不對——
# **雪地上的一個小人影，patch 幾乎全平、標準差很低，卻一眼就看得到**；
# 一叢樹葉標準差很高，卻沒有東西可找。⇒ 標準差不是「找得到」的度量。
#
# 而這道閘原本要保證的事（量化之後那裡還在）**已經由源頭保證了**：
# 候選是 DoG 局部極大、**算在像素版上**的。算得出來就代表它在。
# ⇒ 留下真正是不變量的兩條：編號對得上、判定圈不重疊。


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    views = json.loads((ROOT / "data" / "views.json").read_text(encoding="utf-8"))
    cand = json.loads((ROOT / "data" / "details-candidates.json").read_text(encoding="utf-8"))
    picks = json.loads((ROOT / "data" / "details.json").read_text(encoding="utf-8"))["details"]
    r = cand["radius"]
    bad, total = [], 0

    for v in views:
        if not v["include"]:
            continue
        sel = picks.get(str(v["id"]))
        if not sel:
            bad.append(f"no.{v['id']} 沒有挑選")
            continue
        cs = cand["candidates"].get(str(v["id"]), [])
        im = Image.open(ROOT / "assets" / "pixel" / f"{v['id']:02d}.png").convert("L")
        a = np.asarray(im, dtype=np.float32)
        out = []
        for it in sel:
            i = it["c"] - 1
            if not (0 <= i < len(cs)):
                bad.append(f"no.{v['id']} 候選 {it['c']} 不存在（只有 {len(cs)} 個）")
                continue
            c = cs[i]
            # 對比：切一塊判定圈大小的方形出來看它平不平
            px, py = c["x"] * im.width, c["y"] * im.height
            rr = r * im.width
            out.append({"x": c["x"], "y": c["y"], "r": r, "label": it["label"],
                        "kind": c["kind"], "candidate": it["c"]})
        # 判定圈不能重疊
        for m in range(len(out)):
            for n in range(m + 1, len(out)):
                d = math.hypot((out[m]["x"] - out[n]["x"]),
                               (out[m]["y"] - out[n]["y"]) * im.height / im.width)
                if d < 2 * r:
                    bad.append(f"no.{v['id']} 「{out[m]['label']}」與「{out[n]['label']}」相距 {d:.3f} < {2*r}")
        v["details"] = out
        # 版面要知道像素版多大才算得出欄寬，而且**不必等圖片載入**。
        # 這支本來就開了那張圖，順手記下來，⛔ 不要在前端用 naturalWidth 現算——
        # 那會讓欄寬在圖載完前後跳一次。
        v["pixel"] = [im.width, im.height]
        total += len(out)

    inc = [v for v in views if v["include"]]
    n3 = sum(1 for v in inc if len(v.get("details") or []) >= 3)
    print(f"{len(inc)} 幅 / 細節 {total} 個（3 個的 {n3} 幅、2 個的 {len(inc) - n3} 幅）")
    from collections import Counter
    print("種類：" + "，".join(f"{k} {n}" for k, n in Counter(
        d["kind"] for v in inc for d in v.get("details") or []).most_common()))
    for b in bad:
        print(f"  ✗ {b}")
    assert not bad, f"{len(bad)} 項不過，⛔ 不寫出半套資料"
    if args.write:
        (ROOT / "data" / "views.json").write_text(
            json.dumps(views, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("寫回 data/views.json")
    else:
        print("（--write 才會寫檔）")
    print("self-check ok")


if __name__ == "__main__":
    main()
