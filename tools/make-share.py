#!/usr/bin/env python3
"""分享預覽圖與網站圖示 → assets/share/og.jpg、assets/share/icon.png

🔴 ⛔ 不用 docs/promo/poster.jpg：那張寫著「宣傳影片・39 秒・點圖播放」，是給影片當封面的，
掛在網站連結上等於告訴人「點了會播影片」——而點進去是遊戲。

預覽圖＝畫帖第一幅（也是遊戲起點 1876 年那一幅）**整張和紙**放在網站的底色上：
⛔ 不裁切（紙邊與奧付本來就是那件東西的一部分）、⛔ 不加字（標題與說明由 index.html 的
og:title／og:description 給，同一句話只放一個地方）。
圖示＝地圖上的金點（index.html 的 .mark.open：金色實心＋淡暈＋米白描邊，半徑比照 map.js 的 7／16）。

用法：python3 tools/make-share.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "share"
OFF, GOLD, RIM = "#101d29", (201, 162, 39), "#fffdf5"     # index.html 的 --off／--gold／描邊
OG, PAD = (1200, 630), 30                                 # 1.91:1 是各家預覽共通的比例
FIRST = 1                                                 # 畫帖第一幅：東京銀座街日報社


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    plate = Image.open(ROOT / "assets" / "plate" / f"{FIRST:02d}.jpg").convert("RGB")
    plate.thumbnail((OG[0] - 2 * PAD, OG[1] - 2 * PAD), Image.LANCZOS)
    og = Image.new("RGB", OG, OFF)
    og.paste(plate, ((OG[0] - plate.width) // 2, (OG[1] - plate.height) // 2))
    og.save(OUT / "og.jpg", quality=86, optimize=True)

    k = 4                                                 # 畫大四倍再縮，邊才不會鋸齒
    s = 180 * k                                           # 180 ＝ apple-touch-icon 的尺寸，分頁圖示共用
    icon = Image.new("RGB", (s, s), OFF)
    d = ImageDraw.Draw(icon, "RGBA")
    c, u = s / 2, s / 34                                  # u：map.js 的一個單位（暈 r=16 ⇒ 幾乎撐滿，
                                                          # 分頁上只有 16px，點太小就只剩一粒灰）
    d.ellipse((c - 16 * u, c - 16 * u, c + 16 * u, c + 16 * u), fill=(*GOLD, 51))      # .halo opacity .2
    d.ellipse((c - 7 * u, c - 7 * u, c + 7 * u, c + 7 * u), fill=(*GOLD, 255),
              outline=RIM, width=round(1.5 * u))
    icon.resize((180, 180), Image.LANCZOS).save(OUT / "icon.png", optimize=True)

    for f in ("og.jpg", "icon.png"):
        p = OUT / f
        print(f"  → {p.relative_to(ROOT)}　{Image.open(p).size}　{p.stat().st_size / 1024:.0f}KB")


if __name__ == "__main__":
    main()
