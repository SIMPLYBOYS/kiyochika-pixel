#!/usr/bin/env python3
"""每一景的現代地址 → data/views.json 的 place 欄位。

**為什麼要有**：面板上只有題名與經緯度。知道「這裡現在是台東区浅草」，
玩家才走得過去站在那裡——那是這個作品把 1880 接回今天的地方，
而「接回今天」正是兩層皮那支滑桿在講的事。

**怎麼取**：從 OSM 拿 admin_level=7（市区町村）的面與 place=quarter／
neighbourhood 的點，然後在本機做內外判定與最近點。
不用 Nominatim 逐點反查的理由：118 次請求要照它的規約一秒一次，
而且把「這一景在哪一區」交給別人的黑箱，出錯時沒有東西可查。
面與點抓下來就在檔案裡，判定是三行程式，錯了看得出來錯在哪。

⚠️ 這支腳本只寫**可查證的現代地名**。明治當時的町名要靠當時的地圖逐張比對，
不在這裡猜——`place.meiji_ku` 維持 null，留給真正做過那件事的人填。
（地圖上畫的明治 15 区來自 Wikidata 的区本身，跟這裡的逐景判定是兩回事。）

用法： python3 tools/derive-place.py [--write]
"""
import argparse, json, math, sys, urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetchlib import get_json

ROOT = Path(__file__).resolve().parent.parent
UA = "kiyochika-pixel/0.1 (research; contact via https://github.com/SIMPLYBOYS/kiyochika-pixel)"
API = "https://overpass-api.de/api/interpreter"
BBOX = "35.535,139.565,35.805,139.925"

QUERY = f"""[out:json][timeout:300];
(
  rel["admin_level"="7"]["boundary"="administrative"]({BBOX});
  node["place"~"^(quarter|neighbourhood|suburb)$"]["name"]({BBOX});
);
out geom;"""


def rings(rel):
    """関係の outer をつなげて輪にする。境界は way が細切れなので端点で数珠つなぎ。"""
    segs = [[(p["lon"], p["lat"]) for p in (m.get("geometry") or [])]
            for m in (rel.get("members") or [])
            if m.get("role") in ("outer", "", None) and m.get("geometry")]
    segs = [s for s in segs if len(s) >= 2]
    out = []
    while segs:
        cur = segs.pop(0)
        moved = True
        while moved and cur[0] != cur[-1]:
            moved = False
            for i, s in enumerate(segs):
                if s[0] == cur[-1]:   cur += s[1:];            segs.pop(i); moved = True; break
                if s[-1] == cur[-1]:  cur += s[::-1][1:];      segs.pop(i); moved = True; break
                if s[-1] == cur[0]:   cur = s[:-1] + cur;      segs.pop(i); moved = True; break
                if s[0] == cur[0]:    cur = s[::-1][:-1] + cur; segs.pop(i); moved = True; break
        if len(cur) >= 4:
            out.append(cur)
    return out


def inside(pt, ring):
    """射線法。境界線上の判定は問わない——景がちょうど区界に載る確率は無視できる。"""
    x, y = pt
    n = len(ring)
    hit = False
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    url = API + "?" + urllib.parse.urlencode({"data": QUERY})
    # 🔴 走 get_json 不是 json.load(fetch(...))：Overpass 會回**截斷的 body**
    # （HTTP 200，讀到一半斷）。fetch 的重試只認狀態碼，攔不到這種——實際踩過一次。
    els = get_json(url, UA, timeout=300, retry_on=(429, 502, 503, 504))["elements"]
    wards = [(e["tags"]["name"], rings(e)) for e in els
             if e.get("type") == "relation" and e.get("tags", {}).get("name")]
    towns = [(e["tags"]["name"], e["lon"], e["lat"]) for e in els
             if e.get("type") == "node" and e.get("tags", {}).get("name")]
    print(f"市区町村 {len(wards)} 面（輪 {sum(len(r) for _, r in wards)}）／町の点 {len(towns)}")

    vp = ROOT / "data" / "views.json"
    views = json.loads(vp.read_text(encoding="utf-8"))
    k = math.cos(math.radians(35.67))
    done = miss = 0
    for v in views:
        if not v.get("include"):
            continue
        s = v.get("subject") or {}
        if s.get("lat") is None:
            continue
        pt = (s["lng"], s["lat"])
        ward = next((n for n, rs in wards if any(inside(pt, r) for r in rs)), None)
        # 最寄りの町。1.2km より遠ければ「その町」とは言えないので付けない
        best, bd = None, 1e9
        for n, lo, la in towns:
            d = math.hypot((lo - pt[0]) * k, la - pt[1]) * 111.19
            if d < bd:
                best, bd = n, d
        town = best if bd <= 1.2 else None
        v.setdefault("place", {})
        v["place"]["modern_ward"] = ward
        v["place"]["modern_town"] = town
        v["place"]["modern_town_km"] = round(bd, 2) if town else None
        done += ward is not None
        miss += ward is None
    print(f"區名 {done} 景／取不到 {miss} 景")

    # ── 檢查。點名，不看總數 ──────────────────────────────────
    # 點名的期待值是**地標常識**（浅草寺在台東区），不是本專案推導出來的資料。
    # 它驗的是內外判定與畫框有沒有歪，不是驗座標對不對——座標的依據在 places.json。
    by = {v["id"]: v for v in views}
    must = {69: "台東区",    # 浅草寺
            37: "港区",      # 増上寺
            35: "大田区",    # 大森
            30: "中央区",    # 一石橋
            26: "荒川区",    # 道灌山
            16: "川口市"}    # 川口（埼玉。畫框北緣就在這裡，跨都県的判定也要對）
    for i, w in must.items():
        got = by[i]["place"]["modern_ward"]
        print(f"  no.{i:<4}{by[i]['title']['ja'][:14]:<16}{got}（{w} を期待）")
        assert got == w, f"no.{i} が {got}。內外判定か枠がずれている"
    # 59 景全在陸上的市区町村內，一個都不該落空
    assert miss == 0, f"{miss} 景落不進任何市区町村。境界の輪がつながっていない疑い"

    if args.write:
        vp.write_text(json.dumps(views, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("寫入 data/views.json")
    else:
        print("（--write 才會寫檔）")
    print("self-check ok")


if __name__ == "__main__":
    main()
