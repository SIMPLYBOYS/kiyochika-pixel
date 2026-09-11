#!/usr/bin/env python3
"""Phase 0 — 《清親畫帖》三冊（NDL Digital Collections, IIIF）→ data/views.json 骨架

**這是主素材源，Commons 降為交叉比對**（2026/09/10 盤點）：
Commons 去重後光線画只有約 38 幅、其中 4 幅低於 1000px；NDL 寄別1-9-2-3《清親畫帖》
三冊 84 枚（pid 2605147／2605148／2605149）一次給了 69 幅東京光線画，掃描 8123×9819
（畫心約 3300px），公有領域，IIIF 直接拉。NDL Image Bank「清親光線画」專題指的就是這套。

**題名從三冊第 2 頁的細目表抄**（NDL 館員手寫，2026/09/10 逐字讀圖轉錄），不從外部清單湊。
細目表的 ○ 記號＝館內有複本，與我們無關。

**頁碼是規則不是查表**：每冊第 1 頁封面、第 2 頁細目，之後奇數頁題簽、偶數頁畫
⇒ 冊內第 k 幅在第 2k+2 頁。self-check 對三冊 manifest 的 canvas 數驗這條規則。

排除的（留在資料裡，`include: false`，不刪——刪了下次盤點又會找到它們）：
  73–80 《新版三十二相》滑稽畫 · 81–84 井上安治（弟子，Action Plan §5 待 Aaron 決定）
  55／56 箱根（畫框外）· 57 ざくろにぶどう（靜物）

用法：
  python3 tools/fetch-ndl.py               # 只建骨架
  python3 tools/fetch-ndl.py --download    # 抓 2400px 整頁到 research/ndl/NN.jpg（裁畫心是 Phase 2 的事）
"""
import argparse, json, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetchlib import fetch, get_json

ROOT = Path(__file__).resolve().parent.parent
UA = "kiyochika-pixel/0.1 (research; contact: ferrari828@gmail.com)"
MANIFEST = "https://www.dl.ndl.go.jp/api/iiif/{pid}/manifest.json"
# IIIF 的 size 語法：整幅是 "full"，指定寬度才是 "900,"。
# 🔴 原本一律寫 "{w}," ⇒ 整幅那個變成 "full," ，是無效的 IIIF 網址
# （views.json 裡 84 筆全帶著它，而沒有人點過所以沒人發現）。
IMAGE = "https://dl.ndl.go.jp/api/iiif/{pid}/R{page:07d}/full/{size}/0/default.jpg"
PAGE_WIDTH = 2400

# (pid, 冊內枚數)；細目表寫的枚數，第三冊 32 枚含滑稽畫與安治
VOLUMES = [(2605147, 30), (2605148, 22), (2605149, 32)]

# 細目表逐字轉錄。編號是細目表的連號（1–84）。
TITLES = """
1 東京銀座街日報社
2 二重橋前乗馬圖
3 東京橋場渡黄昏景
4 海運橋（第一銀行雪）
5 柳島日没
6 上野公園画家写生図
7 兩國雪中・元兩國廣小路
8 淺草田甫太郎稲荷
9 梅若神社
10 瀧の川の圖
11 池の端弁天
12 駿賀町雪
13 小梅曳舟通雪景
14 上野東照宮積雪之圖
15 上野公園内之景
16 川口鍋釜製造圖
17 川口善光寺雨晴
18 高輪牛町朧月景
19 品川海上眺望圖
20 湯島元聖堂之景
21 東京兩國百本杭暁之圖
22 元柳橋兩國遠景
23 江戸橋夕暮富士
24 堀切花菖蒲
25 亀戸梅屋敷
26 道灌山夕日暮
27 三ッ又永代橋遠景
28 隅田川夜
29 御城内釣橋之圖
30 一石橋夕景
31 隅田川小春凪
32 不忍池畔雨中圖
33 大川端石原橋
34 九段坂五月夜
35 大森朝の海
36 根津神社秋色
37 芝葉増上寺日中
38 神田八雲神社暁
39 御茶の水雪
40 櫻田弁慶堀原
41 天王寺下衣川
42 兩國花火之圖
43 千ほんくい兩國橋
44 大川富士見渡
45 大川岸一之橋遠景
46 本所御藏橋
47 常盤橋内紙幣寮之圖
48 萬代橋朝日出
49 橋場の夕暮
50 御厩橋雷雨
51 五本松雨月
52 上野六角茶屋
53 第二回内国博覧會内五角堂
54 第二回内国勧業博覧會内美術館噴水
55 箱根底倉湯本萬年橋
56 從箱根山中富嶽眺望
57 ざくろにぶどう
58 新橋ステンション
59 日本橋夜
60 兩国大火浅草橋 明治十四年一月廿六日出火
61 濱町より寫兩国大火
62 久松町ニテ見る出火 明治十四年二月十一日
63 兩国焼跡
64 ためいけ（虎の門夕景）
65 神田川夕景
66 柳原夜雨
67 淺草藏前夏夜
68 淺草夜見世
69 淺草寺雪中
70 今戸夏月
71 池の端花火
72 大傳馬町大丸
73 新版三十二相 過古ことをおもふ 他
74 新版三十二相 まごあやし 他
75 新版三十二相 どもり 他
76 新版三十二相 ちわ喧嘩のあと 他
77 新版三十二相 亭主もどらぬかん 他
78 新版三十二相 あくび 他
79 新版三十二相 やれやれくたびれた 他
80 新版三十二相 みとれる 他
81 淺草橋夕景（井上安治 明13）
82 新吉原夜櫻景（井上安治）
83 京橋勧業場之景（井上安治 明15）
84 赤坂紀伊國坂（東京真画名所図解 井上安治）
""".strip().splitlines()

EXCLUDE = {
    **{n: "新版三十二相（滑稽畫，非風景）" for n in range(73, 81)},
    **{n: "井上安治（弟子）——Action Plan §5 待決定" for n in range(81, 85)},
    55: "箱根，畫框外", 56: "箱根，畫框外", 57: "靜物",
}
# 清親 1881/01/26 両国大火三幅，§2.9 事件機制的素材；點名驗
MUST_HAVE = {60, 61, 62, 39, 69, 38, 33}


def locate(n):
    """細目連號 → (pid, 頁)。冊內第 k 幅在第 2k+2 頁。"""
    for pid, count in VOLUMES:
        if n <= count:
            return pid, 2 * n + 2
        n -= count
    raise ValueError(n)


def build():
    """🔴 這支會重寫 views.json，而座標是另一支（derive-subject.py）填的。
    第一版直接覆寫 ⇒ 重跑一次就把 59 個查證過的座標洗掉，而且不會有任何錯誤訊息。
    所以：**已經在檔案裡的推導欄位要原地帶過來**，這支只負責它自己產生的東西
    （題名・出處・頁碼・收錄與否）。出版年月讀 data/published.json（人工檔）。"""
    prev = {}
    old = ROOT / "data" / "views.json"
    if old.exists():
        prev = {v["id"]: v for v in json.loads(old.read_text(encoding="utf-8"))}
    pubp = ROOT / "data" / "published.json"
    pub = json.loads(pubp.read_text(encoding="utf-8"))["published"] if pubp.exists() else {}
    # 出版年有兩個來源，**分開存也分開讀**（見 fetch-dates.py 檔頭）：
    #   published        ＝ 版上奧付的御届日期，我自己判讀的（10 幅）
    #   published_year   ＝ 館方斷代，Japan Search 查的（51 幅）
    # 這裡只把兩者並列進 views.json，⛔ 不合併成一欄——合併就分不出證據等級了。
    extp = ROOT / "data" / "dates-external.json"
    ext = json.loads(extp.read_text(encoding="utf-8"))["dates"] if extp.exists() else {}
    views = []
    for line in TITLES:
        n, title = line.split(" ", 1)
        n = int(n)
        pid, page = locate(n)
        artist = "inoue-yasuji" if n >= 81 else "kiyochika"
        views.append({
            "id": n,
            "title": {"ja": title, "romaji": None, "en": None},
            "attribution": artist,
            "include": n not in EXCLUDE,
            "exclude_reason": EXCLUDE.get(n),
            # 御届年月要從畫面欄外讀（Phase 0 第二步），Commons metadata 只有年
            "published": (pub.get(str(n)) or {}).get("value"),
            "published_confidence": (pub.get(str(n)) or {}).get("confidence"),
            "published_year": (ext.get(str(n)) or {}).get("year"),
            "published_year_source": (ext.get(str(n)) or {}).get("source"),
            "viewpoint": {"lat": None, "lng": None, "confidence": "unknown"},
            "subject": None,
            "bearing": None,
            "place": {"meiji_ku": None, "modern_ward": None, "modern_landmark": None},
            "conditions": {"time_of_day": None},
            "notes": {"geo": None, "commentary": None},
            "source": {
                "institution": "国立国会図書館デジタルコレクション",
                "item": "清親畫帖", "call_number": "寄別1-9-2-3",
                "pid": pid, "page": page,
                "manifest": MANIFEST.format(pid=pid),
                "image_url": IMAGE.format(pid=pid, page=page, size="full"),
                "license": "Public domain",
                # 同一幅若 Commons 有更好的掃描，fetch-commons.py 的 inventory 交叉比對後填
                "commons_file": None,
            },
        })
    for v in views:
        p = prev.get(v["id"])
        if not p:
            continue
        for k in ("subject", "bearing", "viewpoint", "conditions", "notes"):
            if p.get(k) not in (None, {}, []):
                v[k] = p[k]
        if (p.get("place") or {}).get("anchor"):
            v["place"] = p["place"]
    return views


def download(views):
    dest = ROOT / "research" / "ndl"
    dest.mkdir(parents=True, exist_ok=True)
    for v in views:
        if not v["include"]:
            continue
        out = dest / f"{v['id']:02d}.jpg"
        if out.exists():
            continue
        s = v["source"]
        out.write_bytes(fetch(IMAGE.format(pid=s["pid"], page=s["page"], size=f"{PAGE_WIDTH},"), UA, timeout=180).read())
        print(f"  {out.name}  {v['title']['ja']}  {out.stat().st_size // 1024}KB", flush=True)
        time.sleep(1.0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--download", action="store_true")
    args = ap.parse_args()

    views = build()
    assert len(views) == 84 and [v["id"] for v in views] == list(range(1, 85)), "細目連號不連續"
    assert sum(c for _, c in VOLUMES) == 84
    # 頁碼規則對 manifest 驗：最後一幅的頁 ≤ canvas 數，而且冊尾剛好收在最後一幅
    for pid, count in VOLUMES:
        m = get_json(MANIFEST.format(pid=pid), UA)
        canvases = len(m["sequences"][0]["canvases"])
        last = max(v["source"]["page"] for v in views if v["source"]["pid"] == pid)
        assert last == canvases, f"{pid}：最後一幅在第 {last} 頁，manifest 卻有 {canvases} 頁——頁碼規則破了"
        assert "清親" in m["label"], m["label"]
        time.sleep(0.5)
    inc = [v for v in views if v["include"]]
    assert MUST_HAVE <= {v["id"] for v in inc}
    assert all(v["attribution"] == "kiyochika" for v in inc)
    kept = sum(1 for v in inc if v["subject"])
    print(f"帶過既有座標 {kept} 筆（derive-subject.py 填的，這支不動它）")
    dated = [v for v in inc if v["published"]]
    print(f"奧付判讀 {len(dated)} 筆（published.json）：" + "，".join(f"{v['id']}={v['published']}" for v in dated))
    ey = [v for v in inc if v["published_year"]]
    lit = [v for v in inc if (v.get("conditions") or {}).get("time_of_day") or (v.get("conditions") or {}).get("weather")]
    print(f"館方年份 {len(ey)} 筆（dates-external.json）／兩者聯集 "
          f"{len({v['id'] for v in inc if v['published'] or v['published_year']})} 筆")
    print(f"有光線條件 {len(lit)} 筆（derive-light.py）")

    out = ROOT / "data" / "views.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(views, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"寫出 {out.relative_to(ROOT)}：84 筆，收錄 {len(inc)} 幅清親東京光線画，排除 {84 - len(inc)}")
    for n, why in sorted(EXCLUDE.items()):
        print(f"  ✗ {n:2d} {why}")
    print(f"門檻 ≥40：{'✅' if len(inc) >= 40 else '❌'}（{len(inc)}）")
    print("self-check ok")
    if args.download:
        print("\n下載中…")
        download(views)


if __name__ == "__main__":
    main()
