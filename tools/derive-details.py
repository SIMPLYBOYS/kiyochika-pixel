#!/usr/bin/env python3
"""Phase 5 — 細節搜尋的候選點：assets/pixel → data/details-candidates.json ＋ 判讀用的表

**為什麼機器提案、人挑**：東京二十景那次 19 幅挑了 57 個座標，最大的坑是
**座標挑在真跡上，約 1/4 在 480px／16 色下根本不存在**（低對比、靠色相分辨的、
細密紋理三類會被量化吃掉）。這支從根本繞開那個坑：

  🔑 **候選直接在像素版上算** ⇒ 找得到的必然是量化後還在的東西。

做法是 DoG（小模糊 − 大模糊）取絕對值的局部極大：緊緻、與周圍對比強的斑點會浮出來，
大片漸層不會。實測命中的正是這批畫該找的東西——瓦斯燈、閃電、人影、五重塔、車輪。

**亮暗要分開報**：光線画的主題就是光。亮斑（bright）多半是光源——瓦斯燈、提灯、月、火；
暗斑（dark）多半是剪影——人、舟、柱。遊戲的提示可以直接用這個分類。

⛔ **這支不決定最終座標**，只提案。挑哪幾個、叫什麼名字寫在 `data/details.json`
（人工檔，機器不覆寫）——同 places.json／published.json 的分工。

用法：
  python3 tools/derive-details.py --sheet 4    # 出候選 ＋ 每 4 幅一張判讀表
"""
import argparse, json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
# 判讀表的編號要**讀得到**。PIL 預設字型在 960px 寬的表上只有幾個畫素高，
# 第一版就是這樣——圈看得到、號碼認不出來，整個判讀變成猜的。
FONT = next((f for f in ("/System/Library/Fonts/Helvetica.ttc",
                         "/System/Library/Fonts/Supplemental/Arial.ttf",
                         "/Library/Fonts/Arial.ttf") if Path(f).exists()), None)
PIXEL = ROOT / "assets" / "pixel"
N = 6                 # 每幅提幾個候選，給挑選留餘裕
RAD = 0.055           # 判定圈半徑（畫布寬的比例）。兩個候選至少隔 2×RAD
BORDER = 0.05         # 邊緣這一圈不提案——落款與紙邊不是「畫裡的東西」


def propose(im, n=N):
    a = np.asarray(im.filter(ImageFilter.GaussianBlur(1.2)).convert("L"), dtype=np.float32)
    b = np.asarray(im.filter(ImageFilter.GaussianBlur(9)).convert("L"), dtype=np.float32)
    diff = a - b                      # 正 ＝ 比周圍亮（光源）；負 ＝ 比周圍暗（剪影）
    dog = np.abs(diff)
    h, w = dog.shape
    m = int(min(h, w) * BORDER)
    dog[:m] = 0; dog[-m:] = 0; dog[:, :m] = 0; dog[:, -m:] = 0
    rad = int(w * RAD)
    out, d = [], dog.copy()
    for _ in range(n):
        i = int(d.argmax())
        y, x = divmod(i, w)
        if d[y, x] <= 0:
            break
        out.append({"x": round(x / w, 4), "y": round(y / h, 4),
                    "kind": "light" if diff[y, x] > 0 else "dark",
                    "score": round(float(dog[y, x]), 1)})
        d[max(0, y - rad):y + rad, max(0, x - rad):x + rad] = 0   # NMS，順便保證間距
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", type=int, default=0)
    args = ap.parse_args()

    views = [v for v in json.loads((ROOT / "data" / "views.json").read_text(encoding="utf-8")) if v["include"]]
    cand, tiles = {}, []
    for v in views:
        f = PIXEL / f"{v['id']:02d}.png"
        if not f.exists():
            print(f"  ⚠️ 缺 {f.name}　先跑 python3 tools/quantize.py")
            continue
        im = Image.open(f).convert("RGB")
        cs = propose(im)
        cand[str(v["id"])] = cs
        big = im.resize((im.width * 2, im.height * 2), Image.NEAREST)
        dr = ImageDraw.Draw(big)
        r = int(big.width * RAD)
        font = ImageFont.truetype(FONT, 30) if FONT else None
        for k, c in enumerate(cs, 1):
            x, y = c["x"] * big.width, c["y"] * big.height
            col = (255, 210, 60) if c["kind"] == "light" else (255, 70, 70)
            dr.ellipse([x - r, y - r, x + r, y + r], outline=col, width=3)
            # 號碼畫在圈的右上角，配一個實心底——壓在畫面上才認得出來。
            # ⚠️ 靠近上緣時要翻到圈下面，否則號碼被畫布切掉（27 那幅六個號碼看不到五個）。
            bx = min(max(x + r * 0.6, 20), big.width - 20)
            by = y - r - 24 if y - r - 24 > 6 else y + r + 4
            dr.ellipse([bx - 17, by - 4, bx + 17, by + 30], fill=(20, 20, 20), outline=col, width=2)
            dr.text((bx - 8, by - 1), str(k), fill=col, font=font)
        tiles.append((v, big))

    out = ROOT / "data" / "details-candidates.json"
    out.write_text(json.dumps({
        "_": "機器提案的細節候選。⛔ 不是最終座標——挑哪幾個、叫什麼寫在 data/details.json。",
        "_how": "DoG 局部極大，**算在 assets/pixel 上**，所以提到的必然是量化後還在的東西。",
        "_kind": "light ＝ 比周圍亮（多半是光源：瓦斯燈・提灯・月・火）；dark ＝ 比周圍暗（剪影：人・舟・柱）。",
        "radius": RAD, "candidates": cand,
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    lights = sum(1 for cs in cand.values() for c in cs if c["kind"] == "light")
    total = sum(len(cs) for cs in cand.values())
    print(f"{len(cand)} 幅 × 最多 {N} 個 ＝ {total} 個候選（亮 {lights}／暗 {total - lights}）→ {out.relative_to(ROOT)}")

    if args.sheet:
        n = args.sheet
        for i in range(0, len(tiles), n):
            batch = tiles[i:i + n]
            W = max(t[1].width for t in batch)
            H = sum(t[1].height + 26 for t in batch)
            bd = Image.new("RGB", (W, H), "white")
            dr = ImageDraw.Draw(bd)
            y = 0
            for v, t in batch:
                dr.text((4, y + 5), f"{v['id']} {v['title']['ja'][:24]}", fill="black")
                bd.paste(t, (0, y + 22))
                y += t.height + 26
            f = ROOT / "research" / f"_det{i // n:02d}.png"
            bd.save(f)
            print(f"  {f.name} ids={[v['id'] for v, _ in batch]}")


if __name__ == "__main__":
    main()
