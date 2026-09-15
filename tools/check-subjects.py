#!/usr/bin/env python3
"""Phase 0 — 把 60 個 subject 座標畫在 OSM 水系上目視 → research/_subjects.png

**為什麼要有這一步**：derive-subject.py 的 assert 只驗「有沒有掉出畫框」，
那擋得住 5km 的錯，擋不住 500m 的錯。而 500m 的錯正是這條 pipeline 會產生的那種
（同名地物取到隔壁那個、街區級的錨落在街區重心而不是畫的位置）。

edo-hyakkei 學到的是同一件事：Playwright 驗收抓得到節點數與 404，
抓不到「看起來不對」。**這條 pipeline 只能人眼驗收。**

看的時候要問的是：河、橋、寺社的點有沒有落在該落的水邊；
江東・本所那一帶的點是不是全擠在一起（那代表 district 級的錨太粗）。

用法： python3 tools/check-subjects.py
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
B = {"w": 139.565, "e": 139.925, "s": 35.535, "n": 35.805}   # edo-hyakkei src/map.js 的畫框 B
W = 1800
import math
K = math.cos((B["s"] + B["n"]) / 2 * math.pi / 180)
H = round(W * (B["n"] - B["s"]) / ((B["e"] - B["w"]) * K))

COLOR = {"osm": (200, 30, 30), "wikidata": (30, 90, 200), "district": (230, 150, 20), "low": (140, 140, 140)}


def project(lng, lat):
    return ((lng - B["w"]) / (B["e"] - B["w"]) * W, (B["n"] - lat) / (B["n"] - B["s"]) * H)


def main():
    geo = json.loads((ROOT / "data" / "geo" / "modern.json").read_text(encoding="utf-8"))
    views = json.loads((ROOT / "data" / "views.json").read_text(encoding="utf-8"))
    im = Image.new("RGB", (W, H), (250, 248, 242))
    dr = ImageDraw.Draw(im)
    for layer, col, wid in (("water_area", (196, 220, 232), 1), ("water_line", (120, 170, 200), 2),
                            ("rail", (215, 210, 205), 1)):
        for way in geo["layers"].get(layer, []):
            pts = [project(p[0], p[1]) for p in way]
            if layer == "water_area" and len(pts) > 2:
                dr.polygon(pts, fill=col)
            elif len(pts) > 1:
                dr.line(pts, fill=col, width=wid)

    n = 0
    for v in views:
        if not v["include"] or not v["subject"]:
            continue
        n += 1
        x, y = project(v["subject"]["lng"], v["subject"]["lat"])
        c = COLOR.get((v["place"].get("anchor") or {}).get("confidence"), (0, 0, 0))
        dr.ellipse([x - 5, y - 5, x + 5, y + 5], fill=c, outline=(255, 255, 255))
        dr.text((x + 7, y - 6), f"{v['id']}", fill=(20, 20, 20))
    dr.text((10, 10), f"kiyochika subjects {n}/{sum(1 for v in views if v['include'])}  red=osm blue=wikidata orange=district grey=low", fill=(0, 0, 0))
    out = ROOT / "research" / "_subjects.png"
    im.save(out)
    print(f"{out.relative_to(ROOT)}  {im.size}  {n} 點")
    # 密度檢查：同一個點上疊了幾筆？重疊代表 district 級的錨太粗，不是錯但要知道
    from collections import Counter
    c = Counter((round(v["subject"]["lat"], 4), round(v["subject"]["lng"], 4))
                for v in views if v["include"] and v["subject"])
    dup = {k: n2 for k, n2 in c.items() if n2 > 1}
    for k, n2 in sorted(dup.items(), key=lambda kv: -kv[1]):
        ids = [v["id"] for v in views if v["include"] and v["subject"]
               and (round(v["subject"]["lat"], 4), round(v["subject"]["lng"], 4)) == k]
        print(f"  ⚠️ {n2} 幅共用同一點 {k}：{ids}")


if __name__ == "__main__":
    main()
