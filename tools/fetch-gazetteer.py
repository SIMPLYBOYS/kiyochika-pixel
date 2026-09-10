#!/usr/bin/env python3
"""Phase 0 — OSM 具名地物索引 → data/geo/gazetteer.json（給 derive-subject.py 查座標用）

**為什麼要自己抓一份而不用 Nominatim 逐筆反查**：同 edo-hyakkei `derive-place.py` 的理由
——把「這一景在哪裡」交給別人的黑箱，出錯時沒有東西可查。抓下來的每一筆都帶 OSM id，
判定錯了看得出來錯在哪，而且是同一份資料重跑會得到同樣的答案。

**為什麼是橋、寺社、町名、水系**：清親的題名幾乎全是這四類——
新大橋・海運橋・一石橋（橋）／浅草寺・増上寺・根津神社（寺社）／
銀座・高輪・今戸・大伝馬町（町）／隅田川・不忍池・神田川（水）。

bbox 與 edo-hyakkei `src/map.js` 的畫框 B 一致。

用法： python3 tools/fetch-gazetteer.py
"""
import json, sys, urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetchlib import fetch

ROOT = Path(__file__).resolve().parent.parent
UA = "kiyochika-pixel/0.1 (research; contact: ferrari828@gmail.com)"
API = "https://overpass-api.de/api/interpreter"
BBOX = "35.535,139.565,35.805,139.925"

QUERY = f"""[out:json][timeout:300];
(
  way["man_made"="bridge"]["name"]({BBOX});
  way["bridge"]["name"]({BBOX});
  node["historic"]["name"]({BBOX});
  way["historic"]["name"]({BBOX});
  node["amenity"="place_of_worship"]["name"]({BBOX});
  way["amenity"="place_of_worship"]["name"]({BBOX});
  rel["amenity"="place_of_worship"]["name"]({BBOX});
  node["place"~"^(quarter|neighbourhood|suburb|town|city|village)$"]["name"]({BBOX});
  way["leisure"="park"]["name"]({BBOX});
  rel["leisure"="park"]["name"]({BBOX});
  node["railway"="station"]["name"]({BBOX});
  way["natural"~"^(water|wetland)$"]["name"]({BBOX});
  way["waterway"~"^(river|canal)$"]["name"]({BBOX});
);
out center tags;"""


def kind_of(t):
    if t.get("bridge") or t.get("man_made") == "bridge":
        return "bridge"
    if t.get("amenity") == "place_of_worship":
        return "worship"
    if t.get("place"):
        return "place"
    if t.get("leisure") == "park":
        return "park"
    if t.get("railway") == "station":
        return "station"
    if t.get("natural") or t.get("waterway"):
        return "water"
    if t.get("historic"):
        return "historic"
    return "other"


def main():
    cache = ROOT / ".cache" / "overpass-gazetteer.json"
    if cache.exists():
        raw = json.loads(cache.read_text())
        print(f"用快取 {cache.relative_to(ROOT)}（要重抓就刪掉它）")
    else:
        raw = json.loads(fetch(API + "?" + urllib.parse.urlencode({"data": QUERY}), UA, timeout=300).read())
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(raw))
    rows, seen = [], set()
    for e in raw["elements"]:
        t = e.get("tags", {})
        name = t.get("name")
        lat = e.get("lat") or (e.get("center") or {}).get("lat")
        lng = e.get("lon") or (e.get("center") or {}).get("lon")
        if not name or lat is None:
            continue
        key = f"{e['type']}/{e['id']}"
        if key in seen:
            continue
        seen.add(key)
        rows.append({"name": name, "kind": kind_of(t), "lat": round(lat, 6), "lng": round(lng, 6),
                     "id": key, "old": t.get("name:ja-Hira") or None})
    out = ROOT / "data" / "geo" / "gazetteer.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    # 點名驗（edo-hyakkei §2.7：總數式檢查抓不出「少了最重要的那幾個」）
    names = {r["name"] for r in rows}
    must = ["新大橋", "両国橋", "浅草寺", "増上寺", "根津神社", "湯島聖堂", "永代橋", "厩橋",
            "一石橋", "江戸橋", "浅草橋", "隅田川", "神田川", "不忍池"]
    missing = [m for m in must if m not in names]
    assert not missing, f"點名驗失敗，這些地物沒抓到：{missing}"
    out.write_text(json.dumps(rows, ensure_ascii=False, indent=0) + "\n", encoding="utf-8")
    import collections
    print(f"寫出 {out.relative_to(ROOT)}：{len(rows)} 筆 / {len(names)} 個不重複名字")
    print(collections.Counter(r["kind"] for r in rows))
    print("self-check ok（點名 14 個地物全在）")


if __name__ == "__main__":
    main()
