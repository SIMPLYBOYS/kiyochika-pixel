#!/usr/bin/env python3
"""Phase 2 — 像素化：assets/image（畫心）→ assets/pixel（480px・16 色・Bayer）

參數是東京二十景可行性期實測定案的，⛔ 不要憑感覺改
（依據見[可行性分析]第三節與 shin-hanga-pixel/scripts/quantize.py 的檔頭）：

    畫布 480px · per-scene 16 色（ADAPTIVE / median-cut）· Bayer 8×8 有序遞色

三條踩過的地雷，原樣沿用：

  1. **先裁到畫心再 denoise 再量化。** 掃描的和紙紋理會「免費遞色」，讓不加 dither
     的結果看起來假性合格；磨掉紙紋才看得到真實的斷層。
  2. **dither 必選，而且必須 Bayer。** Floyd-Steinberg 會在暗部灑白色噪點（像髒污），
     破壞版畫的乾淨感；Bayer 的規則網點反而貼近木版肌理。
  3. 🔴 **RMSE 不可當判準**——數值上 none < bayer < fs，與肉眼結論完全相反。
     這條 pipeline 只能用眼睛驗收，⛔ 不要做自動化數值 gate。

清親特有的一件（巴水那批沒有）：**光線画有大量夜景**，暗部佔畫面一半以上。
16 色的色盤在夜景裡幾乎全給了暗部階調 ⇒ 那正是 Bayer 最需要的地方，
也是 Phase 3 挑細節座標時最容易挑到「量化後就不存在」的地方（見 Action Plan §3）。

用法：python3 tools/quantize.py
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC, OUT = ROOT / "assets" / "image", ROOT / "assets" / "pixel"
CANVAS, NCOLORS = 480, 16

# 標準 8×8 Bayer 閾值矩陣，正規化到 [-0.5, 0.5]
BAYER8 = np.array([
    [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21],
], dtype=np.float64) / 64.0 - 0.5


def to_canvas(im, width=CANVAS):
    return im.resize((width, max(1, round(im.height * width / im.width))), Image.LANCZOS)


def denoise(im):
    """磨掉紙紋與掃描顆粒。不做這步，紙紋會冒充遞色。"""
    return im.filter(ImageFilter.MedianFilter(3)).filter(ImageFilter.GaussianBlur(0.8))


def bayer_quantize(im, ncolors=NCOLORS):
    """per-scene 色盤限色 ＋ Bayer 8×8 有序遞色。

    做法：先按色盤的量化階距加上 Bayer 偏移，再做**無 dither** 的最近色匹配——
    讓抖動由我們控制，不交給 PIL 的 FS。"""
    pal = im.convert("P", palette=Image.Palette.ADAPTIVE, colors=ncolors)
    spread = 255.0 / ncolors
    a = np.asarray(im, dtype=np.float64)
    tile = np.tile(BAYER8, (a.shape[0] // 8 + 1, a.shape[1] // 8 + 1))[:a.shape[0], :a.shape[1]]
    shifted = Image.fromarray(np.clip(a + tile[:, :, None] * spread, 0, 255).astype(np.uint8))
    q = shifted.quantize(palette=pal, dither=Image.Dither.NONE)
    return q, pal


def palette_hex(pal):
    p = pal.getpalette()
    return ["#%02x%02x%02x" % tuple(p[i * 3:i * 3 + 3]) for i in range(len(p) // 3)]


def main():
    views = [v for v in json.loads((ROOT / "data" / "views.json").read_text(encoding="utf-8")) if v["include"]]
    OUT.mkdir(parents=True, exist_ok=True)
    palettes, rows, thin = {}, [], []
    for v in views:
        src = SRC / f"{v['id']:02d}.jpg"
        if not src.exists():
            print(f"  ⚠️ 缺 {src.name}　先跑 python3 tools/trim.py")
            continue
        im = Image.open(src).convert("RGB")
        over = im.width / CANVAS                      # 過採樣率：素材品質的指標之一
        q, pal = bayer_quantize(denoise(to_canvas(im)))
        q.save(OUT / f"{v['id']:02d}.png", optimize=True)   # 索引色 PNG，RGB 會胖一倍
        palettes[str(v["id"])] = palette_hex(pal)
        rows.append(v)
        if over < 2.0:
            thin.append((v["id"], im.width, round(over, 1)))
        print(f"  {v['id']:02d} {v['title']['ja'][:13]:<15}{im.size} → {q.size}  過採樣 {over:.1f}x", flush=True)

    (ROOT / "data" / "palettes.json").write_text(
        json.dumps(palettes, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    COLS, TW, TH = 6, 500, 420
    sheet = Image.new("RGB", (COLS * TW, -(-len(rows) // COLS) * TH), "white")
    dr = ImageDraw.Draw(sheet)
    for i, v in enumerate(rows):
        im = Image.open(OUT / f"{v['id']:02d}.png").convert("RGB")
        x, y = (i % COLS) * TW, (i // COLS) * TH
        dr.text((x + 8, y + 6), f"{v['id']:02d} {v['title']['ja'][:16]}", fill="black")
        sheet.paste(im, (x + (TW - im.width) // 2, y + 24))
    sheet.save(ROOT / "research" / "_scenes.png")

    total = sum(f.stat().st_size for f in OUT.glob("*.png")) / 1e6
    print(f"\n{len(rows)} 幅 → {OUT.relative_to(ROOT)}（{total:.1f}MB）·色盤 → data/palettes.json")
    for i, w, o in thin:
        print(f"  ⚠️ {i:02d} 原始畫心只有 {w}px，過採樣 {o}x —— 低於 2x 時量化會直接吃掉細節")
    assert len(rows) == len(views), f"{len(rows)} 張對不上 {len(views)} 幅"
    assert all(len(p) == NCOLORS for p in palettes.values()), "有色盤不是 16 色"
    print("⛔ 驗收：research/_scenes.png 用眼睛看，不要信 RMSE")


if __name__ == "__main__":
    main()
