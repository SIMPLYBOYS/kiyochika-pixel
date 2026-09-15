#!/usr/bin/env python3
"""Phase 2 — 裁切：research/ndl/NN.jpg（整頁）→ assets/plate（和紙，含紙邊與奧付）

🔴 **Phase 2 的第一件事，沒修好之前不定任何細節座標**（Action Plan §3）。
東京二十景就是因為裁切改動而把 57 個細節座標全部重定位過一次。

NDL 掃的是**畫帖的一整頁**，四層：

    ① 掃描台的灰底（下方另外躺著比例尺、色卡、館藏標籤）
    ② 畫帖台紙 ＋ 蓋在上面的襯紙（兩者都是米色，色差極小）
    ③ 版畫的和紙（含紙邊與奧付）← 裁到這裡就停

🔴 **本來還有第四層「畫心」，2026/09/12 廢掉了。** 理由不是它沒調好，是
**它沒有可靠的界線可找**：淡色的天空與淡色的和紙，量起來一樣平、一樣暖
（27 三ッ又永代橋・65 神田川夕景 的天空，每列色差 5、標準差 6，跟紙邊同一個數量級）。
而判錯的兩個方向不對等——削過頭是切掉畫面（no.1 東京銀座街日報社 曾經整片天空不見，
69 幅裡 9 幅被切掉兩到四成），留過頭只是多一圈紙。⇒ 那就留著。
附帶好處：遊戲裡的像素版與真跡從此是**同一個框**，205 個標註的座標兩邊通用。

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

**驗收只能用眼睛**：`research/_plate.png` 逐格看。

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
PLATE = ROOT / "assets" / "plate"

DETECT_W = 1200          # 偵測在半尺寸上做，框再放大回去：快四倍，誤差 ±2px
PEEL_MOUNT = (20, 0.50)  # 灰底 → 台紙
PEEL_WASHI = (26, 0.35)  # 台紙 → 和紙
# 候選：補縫大小 × 先切掉上緣多少（襯紙有時整個蓋住上半，切掉它才找得到台紙）
VARIANTS = [(g, t) for g in (0.03, 0.012, 0.005) for t in (0.0, 0.28, 0.42)]
# 這本畫帖的版型（69 幅實測，中位 1640×1103）。⚠️ 這是**這一批資料**的先驗，
# 換一套素材要重新量，不要照抄。
W_MIN, W_MAX, H_MIN, H_MAX = 1400, 1800, 550, 1500


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


def trim_blank(im, grey, limit=0.20, limit_bottom=0.45):
    """削掉四邊「不是畫」的空白條：多留的台紙（亮而均勻）與掃描尺（灰）。

    版型選擇規則挑出的框有時會往下多含一段——實測 8 幅底部帶著比例尺、
    另外幾幅帶著一條台紙。兩者都有同一個特徵：**那一列的中位色不是畫，是紙或掃描台**。
    每邊最多削 limit——但**下緣放寬到 limit_bottom**。
    🔴 掃描附件（比例尺・色卡・標籤）一律躺在台紙**下面**，而且可以佔到整幅的四成；
    四邊用同一個上限時，43・44・46 那幾幅的尺削不掉（畫只佔上面六成），
    候選點就落在尺的刻度上——判讀表一眼看得出來，數字上看不出來。
    上／左／右維持 0.20：那幾邊的大片留白是真的畫（空、水、雪）。"""
    a = np.asarray(im, dtype=np.int16)
    h, w = a.shape[:2]
    paper = np.percentile(a.reshape(-1, 3), 97, axis=0)          # 這張圖裡最亮的紙色
    def blank(line):
        px = line.reshape(-1, 3)
        med = np.median(px, axis=0)
        if np.abs(med - paper).max() < 12 or np.abs(med - grey).max() < 18:
            return True
        # 掃描台的空白擋板：**中性色＋死平**。木版畫不會出現這種東西——
        # 和紙是暖的、墨有色相，連夜空都帶藍（42 兩國花火 底下那條淺灰帶是這樣切掉的）。
        if abs(med.max() - med.min()) < 8 and px.std(axis=0).max() < 10:
            return True
        # 比例尺：**中性色＋高反差**（黑白刻度）。畫面再暗也有彩度，尺沒有。
        # 前一版只認「像紙或像掃描台」，而尺兩者都不像（黑白混在一起的中位是中灰），
        # 於是 6 幅底部留著一條尺。
        return abs(med.max() - med.min()) < 12 and px.std(axis=0).max() > 40
    t, b, l, r = 0, h, 0, w
    # 🔴 下緣要容忍**最底下一條非空白**。掃描邊常有一道暗線（42 兩國花火），
    # 而逐列剝的迴圈碰到它就停——底下那整片掃描台就留在畫裡了。
    # 這是第三次踩同型的坑（cut_furniture 那次也是「一列擋住整個迴圈」）。
    skip = max(1, int(h * 0.04))    # 42 那條暗邊有 40 列（2.9%），1.5% 跨不過去
    while b - t > h * (1 - limit_bottom):
        if blank(a[b - 1]):
            b -= 1
            continue
        back = next((k for k in range(b - 2, max(t, b - 2 - skip), -1) if blank(a[k])), None)
        if back is None:
            break
        b = back + 1
    while b - t > h * (1 - limit) and blank(a[t]):
        t += 1
    while r - l > w * (1 - limit) and blank(a[:, r - 1]):
        r -= 1
    while r - l > w * (1 - limit) and blank(a[:, l]):
        l += 1
    return im.crop((l, t, r, b))


def cut_furniture(im, grey, cap=0.45, tol=0.02):
    """從底部往上找掃描附件那一塊（尺・色卡・館藏標籤），回傳該裁到第幾列。

    🔴 **逐列從最底剝行不通**，這是第二次修同一個地方。附件是
    「尺 → 白紙 → 灰帶 → 標籤」混成的**一塊**，中間夾著不像空白的列；
    而 trim_blank 是逐列剝的，最底那一列（尺）的中性判定差一個單位就不算空白
    ⇒ 迴圈從沒開始，43・44・48・49 的畫只佔上面六成，剩下全是尺。
    判讀表一眼看得出來，數字上看不出來——所以這個坑是**用眼睛抓到的**。

    改成往上掃、允許 tol 比例的雜訊列。實測：43/44/48/49 削 24–25%、
    46/47 削 4–5%、沒有附件的（1・5・34・69）削 0%。"""
    a = np.asarray(im, dtype=np.float32)
    h, w = a.shape[:2]
    paper = np.percentile(a.reshape(-1, 3), 97, axis=0)

    def furn(y):
        px = a[y]
        med = np.median(px, axis=0)
        if np.abs(med - paper).max() < 14:        # 空白紙
            return True
        if np.abs(med - grey).max() < 20:         # 掃描台
            return True
        return (med.max() - med.min()) < 16 and px.std(axis=0).max() > 28   # 尺：中性＋高反差

    best, miss = h, 0
    for y in range(h - 1, int(h * (1 - cap)), -1):
        if furn(y):
            miss, best = 0, y
        else:
            miss += 1
            if miss > h * tol:
                break
    return best


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


# 🔴 **人工框（整頁座標 x0, y0, x1, y1）：自動找和紙會把下緣切掉的幾幅。**
# 2026-09-16 收錄井上安治 81–84 時，四幅全部被切在畫面下緣：底下那一條紙邊裡印的
# **題名**（淺草橋夕景・京橋勸業場之景・赤坂紀伊國坂）、落款印、以及 82 的
# **御届日期「明治十三年六月十二日」** 全在框外；82 甚至連畫面最下面一段（地面與人力車）都被切掉。
# 第三冊最後這幾頁，版畫下緣兩角貼著半透明的襯紙膠條，自動判定在那裡就停了。
# 四邊都重新量到和紙與台紙的交界（取中段一半寬／一半高的平均，連續 4 列或 4 欄「偏白、不黃」就當台紙）。
# ⚠️ 第一次只修下緣，結果 83 京橋勧業場之景 的**上緣少 83px、右緣少 101px**（右邊那棟洋樓切掉四分之一）——
# 切錯的從來不只一邊，四邊都要量。⚠️ 驗收看 research/_plate.png，不是只看數字。
MANUAL = {
    81: (332, 806, 2020, 1934),
    82: (385, 807, 2019, 1920),
    83: (400, 798, 2037, 1912),
    84: (367, 788, 2052, 1919),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--ids", help="只重做這幾幅（逗號分隔），⛔ 不動其他幅——座標與標註綁在既有的框上")
    args = ap.parse_args()

    views = [v for v in json.loads((ROOT / "data" / "views.json").read_text(encoding="utf-8")) if v["include"]]
    redo = {int(x) for x in args.ids.split(",")} if args.ids else set()
    PLATE.mkdir(parents=True, exist_ok=True)
    rows, odd = [], []
    for v in views:
        src = SRC / f"{v['id']:02d}.jpg"
        if not src.exists():
            print(f"  ⚠️ 缺 {src.name}　先跑 python3 tools/fetch-ndl.py --download")
            continue
        pf = PLATE / f"{v['id']:02d}.jpg"
        if pf.exists() and not args.force and v["id"] not in redo:
            rows.append(v)
            continue
        page = Image.open(src).convert("RGB")
        if v["id"] in MANUAL:
            washi = page.crop(MANUAL[v["id"]])
            washi.save(pf, quality=92, subsampling=0)
            rows.append(v)
            print(f"  {v['id']:02d} {v['title']['ja'][:13]:<15}和紙{washi.size} 人工框（見 MANUAL）", flush=True)
            continue
        k = page.width / DETECT_W
        small = page.resize((DETECT_W, round(page.height / k)), Image.BILINEAR)
        box, how = find_washi(small, k)
        if not box:
            odd.append((v["id"], v["title"]["ja"], "找不到合格的和紙候選"))
            continue
        grey = np.median(np.asarray(page, dtype=np.int16)[int(page.height * 0.985):].reshape(-1, 3), axis=0)
        washi = trim_blank(page.crop(tuple(int(round(c * k)) for c in box)), grey)
        cut = cut_furniture(washi, grey)
        if cut < washi.height:
            # 尺切掉之後，下面往往又露出一段空白台紙（42 兩國花火 底下空了四分之一），
            # 所以再剝一次——第一次剝不掉是因為最底下那條尺不是空白。
            washi = trim_blank(washi.crop((0, 0, washi.width, cut)), grey)
        washi.save(pf, quality=92, subsampling=0)
        rows.append(v)
        print(f"  {v['id']:02d} {v['title']['ja'][:13]:<15}和紙{washi.size} {how}", flush=True)

    for name, folder in (("_plate", PLATE),):
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
    print(f"\n{len(rows)}/{len(views)} 幅 → assets/plate；對照表 research/_plate.png")
    for i, t, why in odd:
        print(f"  ⚠️ {i:02d} {t[:16]:<18}{why}")
    print("⛔ 驗收看對照表，不要只信尺寸")


if __name__ == "__main__":
    main()
