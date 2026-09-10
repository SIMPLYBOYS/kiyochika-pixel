#!/usr/bin/env python3
"""Phase 2 — 裁出奧付（御届）欄 → research/colophon/NN.png，供逐幅判讀出版年月

**日期在版面邊緣**：明治的錦繪印「御届 明治○年○月○日」，下面接住址・出版人・畫工
（實見 37：長谷川丁十九バンチ／出版人 福田熊次郎／畫工 小林清親）。

Phase 0 時這支是**從整頁的右緣**盲裁的，12 幅樣本裡有 6 幅的奧付在左緣或下緣，落在框外。
Phase 2 的 trim 把和紙（`assets/plate`）與畫心（`assets/image`）分開之後，
奧付**必然落在兩者的差集**——那一圈紙邊。所以現在不必猜位置：
把和紙的四邊各切一條、拼成一張直條，一次看得到全部四邊。

🔴 **有些版子本身就沒填**：id 8・37 印了「明治　年　月　日」但數字空著。
那不是讀不到，是版上就沒有 ⇒ `data/published.json` 記 `confidence: "blank"`，
⛔ 不要從系列年代範圍推一個年份填進去。

用法：
  python3 tools/fetch-colophon.py --sheet 6     # 全部，每 6 幅拼一張判讀表
  python3 tools/fetch-colophon.py --ids 37,60   # 只做這幾幅
"""
import argparse, json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
PLATE, DEST = ROOT / "assets" / "plate", ROOT / "research" / "colophon"
MARGIN = 0.16      # 從和紙四邊各取這個比例當「紙邊」
SCALE = 3          # 判讀用放大倍率


def inkiness(strip):
    """這一條裡有多少「紙上的小黑字」。

    判準不是「有多少暗畫素」——夜景整片都暗。是**暗點旁邊是不是亮紙**：
    先取暗遮罩，再取它與「模糊後仍然亮」的交集。奧付是黑字印在米色紙上，
    畫面則是連續調，暗的旁邊多半也暗。"""
    g = np.asarray(strip.convert("L"), dtype=np.float32)
    bright = np.asarray(strip.convert("L").filter(ImageFilter.GaussianBlur(6)), dtype=np.float32)
    return float(((g < 120) & (bright > 170)).mean())


def strips(plate):
    """挑出**有奧付的那一條**紙邊放大。

    四邊都切、拼成一張的話，一格塞三條，字就小到讀不準（實測 6 幅一張時
    看得出結構、讀不出年份的數字）。奧付只會在其中一條上，所以挑出來就好。"""
    w, h = plate.size
    m = max(8, int(w * MARGIN))
    mv = max(8, int(h * MARGIN))
    cand = [plate.crop((w - m, 0, w, h)),
            plate.crop((0, 0, m, h)),
            plate.crop((0, h - mv, w, h)).rotate(90, expand=True)]
    best = max(cand, key=inkiness)
    return best.resize((best.width * SCALE, best.height * SCALE), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids")
    ap.add_argument("--sheet", type=int, default=0)
    args = ap.parse_args()

    views = [v for v in json.loads((ROOT / "data" / "views.json").read_text(encoding="utf-8")) if v["include"]]
    if args.ids:
        want = {int(x) for x in args.ids.split(",")}
        views = [v for v in views if v["id"] in want]
    DEST.mkdir(parents=True, exist_ok=True)
    got = []
    for v in views:
        src = PLATE / f"{v['id']:02d}.jpg"
        if not src.exists():
            print(f"  ⚠️ 缺 {src.name}　先跑 python3 tools/trim.py")
            continue
        out = DEST / f"{v['id']:02d}.png"
        if not out.exists():
            strips(Image.open(src).convert("RGB")).save(out)
        got.append((v, out))
    print(f"{len(got)} 幅 → {DEST.relative_to(ROOT)}")

    if args.sheet:
        n = args.sheet
        for i in range(0, len(got), n):
            batch = got[i:i + n]
            ims = [Image.open(p).convert("RGB") for _, p in batch]
            for im in ims:
                im.thumbnail((330, 1800))
            W = sum(im.width + 10 for im in ims)
            H = max(im.height for im in ims) + 26
            board = Image.new("RGB", (W, H), "white")
            dr = ImageDraw.Draw(board)
            x = 0
            for (v, _), im in zip(batch, ims):
                board.paste(im, (x, 22))
                dr.text((x + 3, 5), f"{v['id']} {v['title']['ja'][:10]}", fill="black")
                x += im.width + 10
            f = ROOT / "research" / f"_colo{i // n:02d}.png"
            board.save(f)
            print(f"  {f.name} {board.size} ids={[v['id'] for v, _ in batch]}")


if __name__ == "__main__":
    main()
