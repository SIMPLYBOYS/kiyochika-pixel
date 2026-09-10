#!/usr/bin/env python3
"""Phase 0 — 裁出每幅的奧付（御届）欄 → research/colophon/NN.png，供逐幅判讀出版年月

**為什麼不能用 metadata**：NDL 的 manifest 只有「[18--]」（見 fetch-ndl.py 的 metadata），
Commons 那批多半只有年。而「出版才出現」的機制要月份——edo-hyakkei §2.6 的閘門
是按月開的，年級精度會讓五年的時間軸只剩五格。

**日期在畫面上**：明治的錦繪在版面邊緣印「御届 明治○年○月○日」，
下面接住址・出版人・畫工（實見：37 芝葉増上寺日中 ＝ 長谷川丁十九バンチ／
出版人 福田熊次郎／畫工 小林清親）。

🔴 **但不是每幅都填了**：37 的御届欄是「明治　年　月　日」——**格式印了，數字空著**。
所以這支腳本只負責裁圖，判讀與「讀不到」都要逐幅記錄，⛔ 不從別處補一個年份進去。

奧付位置各幅不同（右緣居多，也有在左緣或下緣的）。預設裁右緣，
`--full` 裁整幅供找不到時人工看。

用法：
  python3 tools/fetch-colophon.py                 # 裁右緣，跳過已存在的
  python3 tools/fetch-colophon.py --sheet 4       # 順便把裁好的每 4 幅拼成一張供判讀
  python3 tools/fetch-colophon.py --ids 37,60     # 只做這幾幅
"""
import argparse, json, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetchlib import fetch

ROOT = Path(__file__).resolve().parent.parent
UA = "kiyochika-pixel/0.1 (research; contact: ferrari828@gmail.com)"
# 右緣直條。pct 是相對整頁（含畫帖台紙），版畫的右邊界大約在 82–88% 之間。
REGION = "pct:70,22,20,62"
WIDTH = 900


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", help="逗號分隔，只處理這幾幅")
    ap.add_argument("--sheet", type=int, default=0, help="每 N 幅拼一張判讀用的表")
    ap.add_argument("--full", action="store_true", help="裁整頁（奧付不在右緣時用）")
    args = ap.parse_args()

    views = [v for v in json.loads((ROOT / "data" / "views.json").read_text(encoding="utf-8")) if v["include"]]
    if args.ids:
        want = {int(x) for x in args.ids.split(",")}
        views = [v for v in views if v["id"] in want]
    dest = ROOT / "research" / ("page" if args.full else "colophon")
    dest.mkdir(parents=True, exist_ok=True)
    region = "full" if args.full else REGION

    got = []
    for v in views:
        out = dest / f"{v['id']:02d}.jpg"
        if not out.exists():
            s = v["source"]
            url = f"https://dl.ndl.go.jp/api/iiif/{s['pid']}/R{s['page']:07d}/{region}/{WIDTH},/0/default.jpg"
            out.write_bytes(fetch(url, UA, timeout=180).read())
            print(f"  {out.name} {v['title']['ja'][:14]} {out.stat().st_size // 1024}KB", flush=True)
            time.sleep(0.8)
        got.append((v, out))
    print(f"{len(got)} 幅 → {dest.relative_to(ROOT)}")

    if args.sheet:
        from PIL import Image, ImageDraw
        n = args.sheet
        for i in range(0, len(got), n):
            batch = got[i:i + n]
            ims = [Image.open(p).convert("RGB") for _, p in batch]
            for im in ims:
                im.thumbnail((900, 1600))
            W = sum(im.width + 12 for im in ims)
            H = max(im.height for im in ims) + 34
            board = Image.new("RGB", (W, H), "white")
            dr = ImageDraw.Draw(board)
            x = 0
            for (v, _), im in zip(batch, ims):
                board.paste(im, (x, 30))
                dr.text((x + 4, 8), f"{v['id']} {v['title']['ja'][:16]}", fill="black")
                x += im.width + 12
            f = ROOT / "research" / f"_colo{i // n:02d}.png"
            board.save(f)
            print(f"  sheet {f.name} {board.size} ids={[v['id'] for v, _ in batch]}")


if __name__ == "__main__":
    main()
