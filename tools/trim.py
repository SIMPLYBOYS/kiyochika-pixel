#!/usr/bin/env python3
"""Phase 2 — 裁切：research/ndl/NN.jpg（整頁）→ assets/plate（和紙）＋ assets/image（畫心）

🔴 **Phase 2 的第一件事，沒修好之前不定任何細節座標**（Action Plan §3）。
東京二十景就是因為裁切改動而把 57 個細節座標全部重定位過一次。

NDL 掃的是**畫帖的一整頁**，四層：

    ① 掃描台的灰底（下方另外躺著比例尺、色卡、館藏標籤）
    ② 畫帖台紙 ＋ 蓋在上面的襯紙（兩者都是米色，色差極小）
    ③ 版畫的和紙（含奧付）      ④ 畫心

**做法不是「調出一組萬用參數」，是「跑幾組、挑一個」。** 這是試了一輪之後的結論：

  單一參數組合救不了全部——補縫補得大，比例尺會被連進來（12・19・44・47 多留一條尺）；
  補得小，紙上一道摺痕就把台紙切成兩半（33・01 只剩一半）。兩邊都試過，各壞一半。

  但**整本畫帖的版面是一致的**：和紙一律 1400–1800px 寬、550–1500px 高
  （實測 69 幅的中位數 1640×1103）。這個先驗**來自資料本身**，不是我的假設 ⇒
  可以拿它當選擇規則：跑 9 組候選，挑出符合這本冊子實際版型的那個。

踩過的三個坑（順序就是踩到的順序）：

🔴 **一、外圈的中位數不是背景色。** 這些頁的**上緣是襯紙、下緣才是灰底**，
   中位數落在哪一邊要看那一頁，落錯就整個判定反過來（44 只留下 681 列）。
   ⇒ 灰底**只從最底部 1.5% 取樣**，那裡一律是掃描台。

🔴 **二、單一列掉到門檻下就切斷連續段。** 取最長連續段是對的（比例尺與台紙之間隔著
   一道灰，用 first/last 會跨過去把尺收進來），但摺痕會製造假縫。
   ⇒ 先做 1-D 閉合再取最長段，而**補多大是候選參數之一**，不是定值。

🔴 **三、保險絲要擋崩潰，不要擋正常裁切。** 第一版設「裁掉超過一半就不採用」，
   但和紙本來就只佔台紙約 39% ⇒ 每一幅正常的裁切都被擋掉，全部退回整頁。

**驗收只能用眼睛**：`research/_trim.png`（畫心）與 `_plate.png`（和紙）逐格看。

用法：
  python3 tools/trim.py            # 裁切 ＋ 出兩張對照表
  python3 tools/trim.py --force    # 重裁已存在的
"""
import argparse, json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "research" / "ndl"
PLATE, IMAGE = ROOT / "assets" / "plate", ROOT / "assets" / "image"

DETECT_W = 1200          # 偵測在半尺寸上做，框再放大回去：快四倍，誤差 ±2px
PEEL_MOUNT = (20, 0.50)  # 灰底 → 台紙
PEEL_WASHI = (26, 0.35)  # 台紙 → 和紙
PEEL_IMAGE = (26, 0.30)  # 和紙 → 畫心
# 候選：補縫大小 × 先切掉上緣多少（襯紙有時整個蓋住上半，切掉它才找得到台紙）
VARIANTS = [(g, t) for g in (0.03, 0.012, 0.005) for t in (0.0, 0.28, 0.42)]
# 這本畫帖的版型（69 幅實測，中位 1640×1103）。⚠️ 這是**這一批資料**的先驗，
# 換一套素材要重新量，不要照抄。
W_MIN, W_MAX, H_MIN, H_MAX = 1400, 1800, 550, 1500
KEEP_IMAGE = 0.55        # 畫心那一層只該削掉紙邊；削掉更多就是判錯，退回和紙


def longest(line, cover, gap):
    ok = line > cover
    n = len(ok)
    g = max(1, int(n * gap))
    i = 0                                   # 1-D 閉合：填掉短於 g 的 False 段
    while i < n:
        if not ok[i]:
            j = i
            while j < n and not ok[j]:
                j += 1
            if i > 0 and j < n and j - i <= g:
                ok[i:j] = True
            i = j
        else:
            i += 1
    best = cur = None
    for i, v in enumerate(ok):
        if v:
            cur = i if cur is None else cur
            if best is None or i - cur >= best[1] - best[0]:
                best = (cur, i + 1)
        else:
            cur = None
    return best


def box_of(a, bg, tol, cover, gap):
    """a = HxWx3 陣列。回傳 (x0,y0,x1,y1) 或 None。"""
    mask = np.abs(a - bg).max(axis=2) > tol
    ri = longest(mask.mean(axis=1), cover, gap)
    ci = longest(mask.mean(axis=0), cover, gap)
    return (ci[0], ri[0], ci[1], ri[1]) if ri and ci else None


def ring_bg(a, f=0.02):
    h, w = a.shape[:2]
    m = max(2, int(min(h, w) * f))
    return np.median(np.concatenate([a[:m].reshape(-1, 3), a[-m:].reshape(-1, 3),
                                     a[:, :m].reshape(-1, 3), a[:, -m:].reshape(-1, 3)]), axis=0)


def trim_blank(im, grey, limit=0.20):
    """削掉四邊「不是畫」的空白條：多留的台紙（亮而均勻）與掃描尺（灰）。

    版型選擇規則挑出的框有時會往下多含一段——實測 8 幅底部帶著比例尺、
    另外幾幅帶著一條台紙。兩者都有同一個特徵：**那一列的中位色不是畫，是紙或掃描台**。
    每邊最多削 limit，免得把大片留白的天空當成紙削掉。"""
    a = np.asarray(im, dtype=np.int16)
    h, w = a.shape[:2]
    paper = np.percentile(a.reshape(-1, 3), 97, axis=0)          # 這張圖裡最亮的紙色
    def blank(line):
        px = line.reshape(-1, 3)
        med = np.median(px, axis=0)
        if np.abs(med - paper).max() < 12 or np.abs(med - grey).max() < 18:
            return True
        # 比例尺：**中性色＋高反差**（黑白刻度）。畫面再暗也有彩度，尺沒有。
        # 前一版只認「像紙或像掃描台」，而尺兩者都不像（黑白混在一起的中位是中灰），
        # 於是 6 幅底部留著一條尺。
        return abs(med.max() - med.min()) < 12 and px.std(axis=0).max() > 40
    t, b, l, r = 0, h, 0, w
    while b - t > h * (1 - limit) and blank(a[b - 1]):
        b -= 1
    while b - t > h * (1 - limit) and blank(a[t]):
        t += 1
    while r - l > w * (1 - limit) and blank(a[:, r - 1]):
        r -= 1
    while r - l > w * (1 - limit) and blank(a[:, l]):
        l += 1
    return im.crop((l, t, r, b))


def sub(a, b):
    return a[b[1]:b[3], b[0]:b[2]]


def find_washi(small, k):
    """跑 9 組候選，挑符合這本冊子版型的那個。回傳 (框, 用了哪組) 或 (None, None)。

    🔴 k = 原圖 / 偵測圖的倍率。版型帶（W_MIN…）是**原尺寸**的數字，而框是在
    半尺寸上量的——不乘回去就永遠不合格（第一版全 69 幅落空，而且錯在單位不在邏輯）。"""
    a = np.asarray(small, dtype=np.int16)
    grey = np.median(a[int(a.shape[0] * 0.985):].reshape(-1, 3), axis=0)
    picks = []
    for gap, top in VARIANTS:
        y0 = int(a.shape[0] * top)
        src = a[y0:]
        bm = box_of(src, grey, *PEEL_MOUNT, gap)
        if not bm:
            continue
        mount = sub(src, bm)
        bw = box_of(mount, ring_bg(mount), *PEEL_WASHI, gap)
        if not bw:
            continue
        w, h = bw[2] - bw[0], bw[3] - bw[1]
        # 換算回未切上緣的座標
        box = (bm[0] + bw[0], y0 + bm[1] + bw[1], bm[0] + bw[2], y0 + bm[1] + bw[3])
        # 合格條件：尺寸落在這本冊子的版型帶，而且真的從台紙裡挖出了東西
        if W_MIN <= w * k <= W_MAX and H_MIN <= h * k <= H_MAX and w < 0.92 * (bm[2] - bm[0]):
            picks.append((w * h, box, (gap, top)))
    if not picks:
        return None, None
    _, box, how = max(picks)          # 合格的裡面取最大：寧可多留一圈紙
    return box, how


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    views = [v for v in json.loads((ROOT / "data" / "views.json").read_text(encoding="utf-8")) if v["include"]]
    PLATE.mkdir(parents=True, exist_ok=True)
    IMAGE.mkdir(parents=True, exist_ok=True)
    rows, odd = [], []
    for v in views:
        src = SRC / f"{v['id']:02d}.jpg"
        if not src.exists():
            print(f"  ⚠️ 缺 {src.name}　先跑 python3 tools/fetch-ndl.py --download")
            continue
        pf, imf = PLATE / f"{v['id']:02d}.jpg", IMAGE / f"{v['id']:02d}.jpg"
        if pf.exists() and imf.exists() and not args.force:
            rows.append(v)
            continue
        page = Image.open(src).convert("RGB")
        k = page.width / DETECT_W
        small = page.resize((DETECT_W, round(page.height / k)), Image.BILINEAR)
        box, how = find_washi(small, k)
        if not box:
            odd.append((v["id"], v["title"]["ja"], "找不到合格的和紙候選"))
            continue
        grey = np.median(np.asarray(page, dtype=np.int16)[int(page.height * 0.985):].reshape(-1, 3), axis=0)
        washi = trim_blank(page.crop(tuple(int(round(c * k)) for c in box)), grey)
        # 畫心：從和紙再削一次紙邊。削過頭就退回和紙——寧可留紙邊，不要切掉畫。
        wa = np.asarray(washi, dtype=np.int16)
        bi = box_of(wa, ring_bg(wa, 0.03), *PEEL_IMAGE, 0.012)
        image = washi
        if bi and (bi[2] - bi[0]) * (bi[3] - bi[1]) >= KEEP_IMAGE * washi.width * washi.height:
            image = washi.crop(bi)
        else:
            odd.append((v["id"], v["title"]["ja"], "畫心層退回和紙（紙邊留著）"))
        washi.save(pf, quality=92, subsampling=0)
        image.save(imf, quality=92, subsampling=0)
        rows.append(v)
        print(f"  {v['id']:02d} {v['title']['ja'][:13]:<15}和紙{washi.size} 畫心{image.size} {how}", flush=True)

    for name, folder in (("_plate", PLATE), ("_trim", IMAGE)):
        COLS, TW, TH = 8, 300, 260
        sheet = Image.new("RGB", (COLS * TW, -(-len(rows) // COLS) * TH), "white")
        dr = ImageDraw.Draw(sheet)
        for i, v in enumerate(rows):
            f = folder / f"{v['id']:02d}.jpg"
            if not f.exists():
                continue
            im = Image.open(f)
            im.thumbnail((TW - 12, TH - 30))
            x, y = (i % COLS) * TW, (i // COLS) * TH
            sheet.paste(im, (x + 6, y + 22))
            dr.text((x + 6, y + 6), f"{v['id']:02d} {v['title']['ja'][:12]}", fill="black")
        sheet.save(ROOT / "research" / f"{name}.png")
    print(f"\n{len(rows)}/{len(views)} 幅 → assets/plate ＋ assets/image；對照表 research/_plate.png・_trim.png")
    for i, t, why in odd:
        print(f"  ⚠️ {i:02d} {t[:16]:<18}{why}")
    print("⛔ 驗收看對照表，不要只信尺寸")


if __name__ == "__main__":
    main()
