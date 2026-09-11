#!/usr/bin/env python3
"""Phase 0 — 盤點 Wikimedia Commons 上小林清親的東京光線画 → data/inventory.json

⚠️ 2026/09/10 結果：去重後只有約 38 幅、4 幅低於 1000px，**主素材源改為 NDL《清親畫帖》**
（見 fetch-ndl.py）。這支留著做交叉比對（同一幅哪家掃得好、英文題名、年份旁證）。

**為什麼是盤點不是抓圖**：Action Plan §1 的出場門檻是「Tier 1 可用 ≥ 40 幅才立 MVP」。
數字沒出來之前不該有任何 pipeline 工作。這支腳本只回答三個問題：
Commons 上有幾幅、哪幾幅是東京 1876–1884 的光線画、每幅最好的掃描多大。

**Commons 沒有《東京名所図》專屬 category**（2026/09/10 查過：`Print series by
Kobayashi Kiyochika` 底下只有武蔵百景、日本名所図会、戰爭畫……），所以走兩條路取聯集：
分類樹（含 Rijksmuseum 子類）＋ 全站檔案搜尋 `Kiyochika`。單靠分類會漏掉
沒被歸類的散件（edo-hyakkei 的 no.115 就是這樣漏的）。

**分類靠標題與 metadata，不靠 category**。判定三道：
  1. 作者是清親（Artist 欄或檔名）
  2. 年份落在 1876–1884（光線画 1876-08 首發，1881 停畫；外桜田等少數 c.1884）
  3. 題名地點在東京畫框內（PLACES 表：romaji／漢字／荷蘭文三種寫法）
沒判到地點的不是「非東京」，是「未判」——列在 unplaced 裡人工看，⛔ 不猜。

同一幅畫多館都有（両国大火 LACMA 就有兩張），用「地點＋題材」當 group key 併起來，
每組取最大掃描當 best。group 是給人看 contact sheet 用的粗分，不是最終定案。

檢查是點名式的（edo-hyakkei §2.7 教訓）：七幅已實跑過 pipeline 的作品必須在場。
寫檔在檢查之後。

用法：
  python3 tools/fetch-commons.py               # 只盤點
  python3 tools/fetch-commons.py --download    # 順便抓 1600px 到 research/commons/
"""
import argparse, json, re, sys, time, unicodedata, urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetchlib import fetch, get_json

ROOT = Path(__file__).resolve().parent.parent
UA = "kiyochika-pixel/0.1 (research; contact via https://github.com/SIMPLYBOYS/kiyochika-pixel)"
API = "https://commons.wikimedia.org/w/api.php"
CATS = ["Category:Kobayashi Kiyochika",
        "Category:Prints by Kobayashi Kiyochika in the Rijksmuseum Amsterdam"]
YEARS = (1876, 1885)   # 光線画 1876–81（外桜田 c.1884）；武蔵百景 1884–85 另標 series
FETCH_WIDTH = 1600   # 480px 畫布的 3.3x 過採樣（shin-hanga 定案值）

# 地點表。key 是之後 views.json 用的 slug；正規式吃 romaji（去變音符後）、漢字、荷蘭文。
# 只列光線画題名裡出現過的地名，不是東京地名總表——多列一個就多一個誤判入口。
PLACES = [
    ("shin-ohashi",   r"shin[ -]?o+hashi|新大橋"),
    ("ryogoku",       r"ryo+goku|両国|兩國|ryohgoku"),
    ("asakusa",       r"asakusa|senso ?ji|浅草|淺草"),
    ("ueno",          r"ueno|toshogu|上野|東照宮|shinobazu|不忍|ikenohata|池之端|benten"),
    ("kanda",         r"kanda|神田"),
    ("ochanomizu",    r"ochanomizu|御茶ノ水|御茶の水|お茶の水"),
    ("sakurada",      r"sakurada|桜田|櫻田|kasumigaseki|霞ヶ関|霞が関"),
    ("kudan",         r"kudan|九段"),
    ("nihonbashi",    r"nihonbashi|日本橋|edobashi|edo bridge|江戸橋|suruga[ -]?cho|駿河町|honcho|本町"),
    ("shinagawa",     r"shinagawa|品川|takanawa|高輪"),
    ("sumida",        r"sumida|隅田|okawa|great riverbank|大川|umaya|厩橋|hashiba|橋場|imado|今戸|matsuchi|待乳|mimeguri|三囲|suijin|水神"),
    ("koume",         r"koume|小梅|hikifune|曳舟"),
    ("umewaka",       r"umewaka|梅若"),
    ("bandai",        r"bandai|万代|萬代|kaiun|海運橋"),
    ("ishihara",      r"ishihara|石原"),
    ("shinbashi",     r"shinbashi|shimbashi|新橋|ginza|銀座"),
    ("tsukiji",       r"tsukiji|築地|akashi|明石"),
    ("kaiko",         r"imperial palace|castle|皇居|城|nijubashi|二重橋"),
    ("yushima",       r"yushima|湯島|confucian|聖堂"),
    ("kameido",       r"kameido|亀戸"),
    ("mukojima",      r"mukojima|向島"),
    ("fukagawa",      r"fukagawa|深川"),
    ("hisamatsucho",  r"hisamatsu|久松"),
    ("atagoyama",     r"atago|愛宕"),
    ("zojoji",        r"zojoji|増上寺|shiba|芝"),
    ("toranomon",     r"toranomon|虎ノ門|虎の門"),
    ("kawaguchi",     r"kawaguchi|川口"),   # 川口善光寺：35.79N，畫框北緣 35.805 內
]
# 明確在畫框外的題名——清親也畫箱根、駿河、日光。這些是「非東京」不是「未判」。
OUTSIDE = r"hakone|箱根|suruga(?![ -]?cho)|駿(?!河町)|satta|薩埵|fuji from|nikko|日光|yokohama|横浜|kamakura|鎌倉|tsukigase|月ヶ瀬|sarubashi|猿橋"
# 題材：同一地點不同幅靠這個分開（浅草寺雪 vs 浅草夜店）
MOTIFS = [
    ("fireworks", r"firework|vuurwerk|hanabi|花火"),   # 要排在 fire 前面
    ("fireflies", r"firefl|hotaru|蛍|螢"),
    ("fire",      r"\bfire\b|conflagration|vuurzee|taika|kaji|大火|出火|火事"),
    ("snow",      r"snow|sneeuw|\byuki\b|sekkei|雪"),
    ("rain",      r"\brain|regen|\buchu\b|\bame\b|雨"),
    ("moon",      r"moon|maan|tsuki|月"),
    ("night",     r"night|nacht|\byoru\b|夜"),
    ("dawn",      r"dawn|sunrise|rising sun|morning|akatsuki|\basa\b|曉|暁|朝|日の出"),
    ("dusk",      r"dusk|evening|sunset|yugure|夕|暮"),
]
# 非風景的系列與題材：戰爭畫、諷刺畫、肖像、花鳥。命中就整筆排除。
EXCLUDE = r"sens[oō]|war|torpedo|man-of-war|nisshin|nichiro|portrait|geisha|oden|hana moy|kodai moy|banzai|kyodo risshi|nikutei|cat|neko|hawk|hunter|kenba|street ?artist|straatartiest"
# 七幅已在 shin-hanga-pixel 實跑過 pipeline 的作品：點名驗，缺一即 assert
MUST_HAVE = ["shin-ohashi/rain", "kanda/dawn", "asakusa/snow", "ochanomizu/snow",
             "sakurada/snow", "ueno/snow", "ryogoku/fire"]


def api(**p):
    p.setdefault("format", "json")
    return get_json(API + "?" + urllib.parse.urlencode(p), UA)


def paged(**p):
    out, cont = [], {}
    while True:
        d = api(**p, **cont)
        out += [m["title"] for m in d["query"][list(d["query"])[-1]]]
        if "continue" not in d:
            return out
        cont = d["continue"]


def fold(s):
    s = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


untag = lambda h: re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", h or "")).strip()


def harvest():
    titles = set()
    for c in CATS:
        titles |= set(paged(action="query", list="categorymembers", cmtitle=c, cmtype="file", cmlimit="500"))
    titles |= set(paged(action="query", list="search", srsearch="Kiyochika", srnamespace="6", srlimit="500"))
    titles = sorted(t for t in titles if re.search(r"\.(jpe?g|png|tiff?)$", t, re.I))
    print(f"候選檔案 {len(titles)}（分類＋搜尋聯集）", flush=True)
    rows = []
    for i in range(0, len(titles), 50):
        d = api(action="query", titles="|".join(titles[i:i + 50]), prop="imageinfo",
                iiprop="url|size|extmetadata")
        for p in d["query"]["pages"].values():
            if "imageinfo" not in p:
                continue
            ii = p["imageinfo"][0]
            m = ii["extmetadata"]
            get = lambda k: untag(m.get(k, {}).get("value"))
            rows.append({
                "file": p["title"], "url": ii["url"].split("?")[0], "w": ii["width"], "h": ii["height"],
                "artist": get("Artist"), "date": get("DateTimeOriginal"),
                "desc": get("ImageDescription"), "object": get("ObjectName"),
                "credit": get("Credit"), "license": get("LicenseShortName"),
            })
        time.sleep(0.2)
    return rows


def institution(r):
    s = r["file"] + " " + r["credit"]
    for k, v in [("LACMA", "LACMA"), ("Honolulu", "Honolulu Museum of Art"), ("Rijksmuseum", "Rijksmuseum"),
                 ("RP-P-", "Rijksmuseum"), ("Wellcome", "Wellcome Collection"), ("LCCN", "Library of Congress"),
                 ("Jordan Schnitzer", "Jordan Schnitzer Museum of Art"), ("Museum of Fine Arts", "MFA Boston"),
                 ("Metropolitan", "Met"), ("Art Institute", "AIC"), ("NDL", "NDL")]:
        if k in s:
            return v
    return None


def year_of(r):
    for s in (r["date"], r["file"], r["desc"], r["object"]):
        # 🔴 兩種假年份：Rijksmuseum 館藏號 RP-P-1988-281 的 1988、檔名裡的生卒年 (1847-1915)。
        # 第一版沒濾，武蔵百景整批被判成 1980 年代、池之端花火被判成 1847。
        s = re.sub(r"RP-P-\d{4}|\(?\b1847\s*[-–]\s*1915\)?", " ", s or "")
        m = re.search(r"(明治)\s*(\d{1,2})\s*年", s)
        if m:
            return 1867 + int(m.group(2))
        m = re.search(r"\b(18[6-9]\d|19[01]\d)\b", s)
        if m:
            return int(m.group(1))
    return None


def classify(r):
    text = fold(" ".join([r["file"], r["object"], r["desc"]]))
    if not re.search(r"kiyochika|清親", fold(r["artist"]) + text):
        return "not-kiyochika", None
    if re.search(EXCLUDE, text):
        return "excluded", None
    y = year_of(r)
    if y and not (YEARS[0] <= y <= YEARS[1]):
        return "outside-years", None
    # 地點先於「非東京」：描述裡常順帶提到富士山，駿河町的三井也會被 suruga 咬到
    place = next((k for k, pat in PLACES if re.search(pat, text)), None)
    if not place:
        return ("outside-tokyo" if re.search(OUTSIDE, text) else "unplaced"), None
    motif = next((k for k, pat in MOTIFS if re.search(pat, text)), None)
    if motif:
        return "tokyo", f"{place}/{motif}"
    # 沒題材詞的白天景只靠地點會併錯（sumida 一組五幅不同的畫）。
    # 子鍵＝標題去掉館名／編號／虛詞後的詞集——同一幅畫在不同館的英文標題大多同字不同序。
    words = re.sub(r"\b(lacma|honolulu|museum|art|met|dp|kobayashi|kiyochika|woodblock|print|file|jpe?g|tokyo|tokei|view|the|of|at|from|in|by|a|no|zu|before|scene|river)\b|\d+",
                   " ", fold(r["object"] or r["file"]))
    sub = "-".join(sorted(set(re.findall(r"[a-z]{3,}", words)))[:4]) or "untitled"
    return "tokyo", f"{place}/day:{sub}"


def build(rows):
    groups, bins = {}, {}
    for r in rows:
        cls, key = classify(r)
        bins.setdefault(cls, []).append(r["file"])
        if cls != "tokyo":
            continue
        series = "musashi-hyakkei" if re.search(r"musashi|武蔵百景", fold(r["file"] + r["object"] + r["desc"])) else "kosenga"
        cand = {"file": r["file"], "image_url": r["url"], "px": [r["w"], r["h"]], "series": series,
                "institution": institution(r), "year": year_of(r), "license": r["license"],
                "title_hint": r["object"][:120] or r["file"], "credit": r["credit"][:100]}
        groups.setdefault(key, []).append(cand)
    works = []
    for key in sorted(groups):
        cs = sorted(groups[key], key=lambda c: -c["px"][0] * c["px"][1])
        works.append({"key": key, "place": key.split("/")[0], "motif": key.split("/")[1].split(":")[0],
                      "series": cs[0]["series"], "best": cs[0], "candidates": cs,
                      # 之後 Phase 0 第二步人工填：題名（日）、subject lat/lng、御届年月
                      "title_ja": None, "subject": None, "published": None})
    return works, bins


def download(works):
    dest = ROOT / "research" / "commons"
    dest.mkdir(parents=True, exist_ok=True)
    for w in works:
        out = dest / (w["key"].replace("/", "_") + ".jpg")
        if out.exists():
            continue
        name = w["best"]["file"].removeprefix("File:").replace(" ", "_")
        url = f"https://commons.wikimedia.org/wiki/Special:FilePath/{urllib.parse.quote(name)}?width={FETCH_WIDTH}"
        out.write_bytes(fetch(url, UA, timeout=180).read())
        print(f"  {out.name}  {out.stat().st_size // 1024}KB", flush=True)
        time.sleep(1.0)


def sheet(works):
    """每組 best 的 320px 縮圖排成表，標 key。判斷「這兩組是不是同一幅」只能用眼睛。"""
    from PIL import Image, ImageDraw
    cache = ROOT / ".cache" / "thumb"
    cache.mkdir(parents=True, exist_ok=True)
    tiles = []
    for w in works:
        f = cache / (w["key"].replace("/", "_").replace(":", "-") + ".jpg")
        if not f.exists():
            name = w["best"]["file"].removeprefix("File:").replace(" ", "_")
            f.write_bytes(fetch(f"https://commons.wikimedia.org/wiki/Special:FilePath/{urllib.parse.quote(name)}?width=320", UA, timeout=120).read())
            time.sleep(0.5)
        im = Image.open(f).convert("RGB")
        im.thumbnail((320, 240))
        tiles.append((w["key"], im))
    cols, tw, th = 6, 330, 270
    rows = -(-len(tiles) // cols)
    board = Image.new("RGB", (cols * tw, rows * th), "white")
    dr = ImageDraw.Draw(board)
    for i, (k, im) in enumerate(tiles):
        x, y = (i % cols) * tw, (i // cols) * th
        board.paste(im, (x + 5, y + 5))
        dr.text((x + 5, y + 250), k[:44], fill="black")
    out = ROOT / "research" / "_sheet.png"
    board.save(out)
    print(f"contact sheet → {out.relative_to(ROOT)}（{len(tiles)} 格）")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--download", action="store_true")
    ap.add_argument("--sheet", action="store_true", help="出 contact sheet 到 research/_sheet.png（肉眼去重）")
    ap.add_argument("--verbose", action="store_true", help="連排除的也列出來，核分類用")
    args = ap.parse_args()

    rows = harvest()
    works, bins = build(rows)

    print(f"\n分類：" + "，".join(f"{k} {len(v)}" for k, v in sorted(bins.items())))
    kosen = [w for w in works if w["series"] == "kosenga"]
    print(f"東京 1876–85：{len(bins.get('tokyo', []))} 檔 → {len(works)} 組（粗分，contact sheet 再去重）"
          f"＝ 光線画 {len(kosen)} ＋ 武蔵百景 {len(works) - len(kosen)}")
    by_inst = {}
    for w in works:
        by_inst[w["best"]["institution"]] = by_inst.get(w["best"]["institution"], 0) + 1
    print("最佳掃描的館別：" + "，".join(f"{k} {v}" for k, v in sorted(by_inst.items(), key=lambda x: -x[1])))
    hi = [w for w in works if w["best"]["px"][0] >= FETCH_WIDTH]
    print(f"≥{FETCH_WIDTH}px：{len(hi)} 組；<{FETCH_WIDTH}px：{len(works) - len(hi)} 組（夠 480px 畫布，不夠圖鑑真跡）")
    print(f"\n未判地點（人工看，不是非東京）{len(bins.get('unplaced', []))}：")
    for f in bins.get("unplaced", []):
        print("  ", f)
    if args.verbose:
        for k in ("outside-years", "not-kiyochika", "outside-tokyo"):
            print(f"\n{k} {len(bins.get(k, []))}：")
            for f in bins.get(k, []):
                print("  ", f[:110])
    for w in works:
        inst = w["best"]["institution"] or ("?" + w["best"]["credit"][:18])
        print(f"  {w['key']:<36} {w['best']['px'][0]:>5}px  {inst:<20} ×{len(w['candidates'])} {w['series'][:6]}  {w['best']['file'][:60]}")

    keys = {w["key"] for w in works}
    missing = [k for k in MUST_HAVE if k not in keys]
    assert not missing, f"點名驗失敗，已實跑過的作品不在場：{missing}"
    assert len(works) >= 20, "組數低到不像話，API 或分類可能變了"
    out = ROOT / "data" / "inventory.json"
    out.write_text(json.dumps({"_": "Phase 0 盤點。works 是粗分組，title_ja／subject／published 待人工填。",
                               "fetched": time.strftime("%Y-%m-%d"), "works": works,
                               "bins": {k: v for k, v in bins.items() if k != "tokyo"}},
                              ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"\n寫出 {out.relative_to(ROOT)}；門檻 光線画 ≥40 組：{'✅' if len(kosen) >= 40 else '❌ 未達，Tier 2 決策交 Aaron'}（粗分數，以 sheet 目視去重為準）")
    print("self-check ok")
    if args.download:
        print("\n下載中…")
        download(works)
    if args.sheet:
        sheet(works)


if __name__ == "__main__":
    main()
