#!/usr/bin/env python3
"""Phase 2 — 出版年月：Japan Search（國立國會圖書館營運的全國聚合）→ data/dates-external.json

**為什麼需要外部來源**：版上的奧付判讀撞到兩堵牆——年份欄常常**只刻到十位**
（「明治十　年」，個位留給每一刷填）或整組空白，而且逐幅放大判讀是資料輸入工。
69 幅裡自己讀得準的只有 10 幅。

**Japan Search 聚合了日本各館的目錄**，其中三家有這批：
  · 東京都江戸東京博物館（tokyomuseumcolection）—— 記到「明治9年8月31日」這種精度
  · ARC 立命館錦絵データベース（arc_nishikie）—— 多半只到「明治１２」
  · 名古屋市博物館 等

🔴 **這跟奧付判讀不是同一種證據，不要混在一起**：
  奧付 ＝ 版上印的御届日期（出版當下的登記）
  館方 ＝ 機構的斷代，可能出自同一張奧付、也可能出自目錄學研究或推定
⇒ 分開存（本檔 vs `published.json`），衝突時**兩個都留著並標出來**，⛔ 不要讓新的蓋掉舊的。
（實例：id 1 東京銀座街日報社，我讀奧付是「八月廿一日」，江戸東京博物館記 8月31日。）

**比對規則**：題名正規化後**完全相等**才採用（旧字体轉新字体、去掉括號與空白）。
日本地名與畫題共用字太多，模糊比對會安靜地配錯——同 derive-subject 的教訓。

用法：
  python3 tools/fetch-dates.py            # 只查詢並報告
  python3 tools/fetch-dates.py --write    # 寫入 data/dates-external.json
"""
import argparse, json, re, time, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = "kiyochika-pixel/0.1 (research; contact via https://github.com/SIMPLYBOYS/kiyochika-pixel)"
API = "https://jpsearch.go.jp/api/item/search/jps-cross"
OLD2NEW = str.maketrans({
    "兩": "両", "淺": "浅", "圖": "図", "櫻": "桜", "萬": "万", "瀧": "滝", "廣": "広",
    "藏": "蔵", "國": "国", "會": "会", "傳": "伝", "濱": "浜", "寫": "写", "內": "内",
    "驛": "駅", "畫": "画", "曉": "暁", "臺": "台", "龜": "亀", "燒": "焼", "號": "号",
    "區": "区", "點": "点", "邊": "辺", "澤": "沢", "觀": "観", "樂": "楽", "豐": "豊",
})
# 館方標記的精度差很多，要分級留著，⛔ 不要一律當成「年」
PREC = [(r"明治\s*[0-9０-９一二三四五六七八九十]+\s*年\s*[0-9０-９一二三四五六七八九十]+\s*月\s*[0-9０-９一二三四五六七八九十]+\s*日", "day"),
        (r"明治\s*[0-9０-９一二三四五六七八九十]+\s*年\s*[0-9０-９一二三四五六七八九十]+\s*月", "month"),
        (r"明治\s*[0-9０-９一二三四五六七八九十]+\s*年?", "year")]


def norm(s):
    return re.sub(r"[「」　\s（）()・,，.。]", "", (s or "").translate(OLD2NEW))


def get(url, tries=3, timeout=30):
    for n in range(tries):
        try:
            return json.loads(urllib.request.urlopen(
                urllib.request.Request(url, headers={"User-Agent": UA}), timeout=timeout).read())
        except Exception as e:
            last = e
            time.sleep(1.2 * (n + 1))
    raise last


def lookup(title_ja):
    """回傳 (西元年, 原始和曆字串, 精度, 資料庫, 連結) 或 None。"""
    head = title_ja.split(" ")[0]          # 細目表有些條目後面接說明，只用前半
    d = get(API + "?" + urllib.parse.urlencode({"keyword": "小林清親 " + head, "size": 10}))
    for h in d.get("list", []):
        c = h["common"]
        if norm(c.get("title")) != norm(head):
            continue                        # 題名要完全相等，⛔ 不做模糊比對
        temporal = [str(x) for x in (c.get("temporal") or [])]
        year = next((x for x in temporal if re.fullmatch(r"1[89]\d\d", x)), None)
        if not year:
            continue
        wa = next((x for x in temporal if "明治" in x), "")
        prec = next((p for pat, p in PREC if re.search(pat, wa)), "year" if wa else "unknown")
        return int(year), wa, prec, c.get("database"), c.get("linkUrl")
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    views = [v for v in json.loads((ROOT / "data" / "views.json").read_text(encoding="utf-8")) if v["include"]]
    own = json.loads((ROOT / "data" / "published.json").read_text(encoding="utf-8"))["published"]
    out, miss, clash = {}, [], []
    for v in views:
        try:
            r = lookup(v["title"]["ja"])
        except Exception as e:
            print(f"  {v['id']:2d} {v['title']['ja'][:14]:<16}查詢失敗 {str(e)[:40]}")
            continue
        if not r:
            miss.append(v["id"])
            print(f"  {v['id']:2d} {v['title']['ja'][:14]:<16}—")
        else:
            year, wa, prec, db, link = r
            out[str(v["id"])] = {"year": year, "raw": wa, "precision": prec,
                                 "source": f"jpsearch:{db}", "url": link}
            mine = own.get(str(v["id"]), {}).get("value")
            flag = ""
            if mine and not str(mine).startswith(str(year)):
                clash.append((v["id"], mine, wa))
                flag = f"  🔴 與奧付判讀 {mine} 不一致"
            print(f"  {v['id']:2d} {v['title']['ja'][:14]:<16}{year}  {wa:<14}{prec:<6}{db}{flag}")
        time.sleep(0.5)

    print(f"\n命中 {len(out)} / {len(views)}；查不到 {len(miss)}：{miss}")
    import collections
    print("精度：" + "，".join(f"{k} {n}" for k, n in collections.Counter(
        r["precision"] for r in out.values()).most_common()))
    print("來源：" + "，".join(f"{k} {n}" for k, n in collections.Counter(
        r["source"] for r in out.values()).most_common()))
    for i, mine, theirs in clash:
        print(f"  🔴 no.{i} 奧付「{mine}」vs 館方「{theirs}」—— 兩個都留著，⛔ 不要讓其中一個蓋掉另一個")

    if args.write:
        f = ROOT / "data" / "dates-external.json"
        f.write_text(json.dumps({
            "_": "外部知識庫（Japan Search）查到的出版年。**不是奧付判讀**，見 tools/fetch-dates.py 檔頭。",
            "_tier": "館方斷代。可能出自同一張奧付，也可能出自目錄學研究或推定 ⇒ 與 published.json 分開存。",
            "_precision": "day/month/year＝館方記到哪一級；unknown＝有西元年但沒有和曆原文。",
            "fetched": time.strftime("%Y-%m-%d"), "dates": out,
        }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"寫出 {f.relative_to(ROOT)}")
    else:
        print("（--write 才會寫檔）")


if __name__ == "__main__":
    main()
