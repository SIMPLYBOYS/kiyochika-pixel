#!/usr/bin/env python3
"""Phase 6 — 「今そこには何があるか」→ data/views.json 的 now

**為什麼要有**：這一作沒有東海道那種在圖裡找線索的玩法，知識層就得自己站得住。
而玩家最想知道的其實是同一件事——**清親畫的那個地方，今天長什麼樣？還美嗎？**
面板本來只有一個街景連結，點不點全看運氣。

🔴 **但這一層絕不能由我寫。** 六十九段「今昔對比」憑印象寫出來，正是這個專案
一路在拒絕的東西（見 places.json 的 _rule、details.json 的 _label）。
所以只放**推導得出來、指得出出處**的四件事：

  標高      国土地理院の標高 API。順帶跟同一畫帖的其他 68 枚比，說得出「低いほう」
  最寄り駅  OSM。這條最實用——它回答的是「怎麼去看」
  今ある物  OSM 上這個點 250m 內有名字的地物（寺社・橋・公園・史跡）
  碑        300m 內名字帶「跡／碑／発祥／旧」的地物 ＝ **那個東西沒了，只剩一塊碑**
            （no.4 海運橋：畫裡是第一國立銀行，今は「銀行発祥の地」の碑だけ）

⛔ 沒有形容詞、沒有「今も昔も変わらず」這種句子。要不要覺得它還美，是玩家去看了才知道的。

用法：
  python3 tools/derive-now.py            # 只報告
  python3 tools/derive-now.py --write    # 寫回 views.json
"""
import argparse, json, math, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = "kiyochika-pixel/0.1 (research; contact via https://github.com/SIMPLYBOYS/kiyochika-pixel)"
GSI = "https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lon={lng}&lat={lat}&outtype=JSON"
NEAR_M, MARK_M = 250, 200
# 🔴 「碑」と「旧」は外した。第一版はそれも拾って、出てきたのが
# 「至誠勤倹」「燈籠奉納記念」「旧石燈籠」——**街角の小さな石碑**であって、
# 「あったものが無くなった」印ではない。⇒ **跡 と 発祥 だけ**。
# それなら no.4「銀行発祥の地」・no.72「江戸伝馬町処刑場跡」のように、
# 碑そのものが「ここに何があったか」を語る。
MARK = ("跡", "発祥")
# 近くに何があるか。駅は別欄なので除く；place（町名）は地物ではない。
# historic も外した：上と同じ理由で小石碑だらけになる。
# 残したのは**行ってみられるもの**——寺社・橋・公園・水。
KINDS = ("worship", "bridge", "park", "water")


def km(a, b):
    k = math.cos(math.radians(a[0]))
    return math.hypot((a[1] - b[1]) * k, a[0] - b[0]) * 111.19


def elevation(lat, lng, tries=3):
    for n in range(tries):
        try:
            d = json.load(urllib.request.urlopen(urllib.request.Request(
                GSI.format(lat=lat, lng=lng), headers={"User-Agent": UA}), timeout=20))
            e = d.get("elevation")
            return (round(float(e), 1), d.get("hsrc")) if e not in (None, "-----") else (None, None)
        except Exception:
            time.sleep(1.5 * (n + 1))
    return (None, None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--no-net", action="store_true", help="跳過標高（只重算 OSM 那幾欄）")
    args = ap.parse_args()

    views = json.loads((ROOT / "data" / "views.json").read_text(encoding="utf-8"))
    gaz = json.loads((ROOT / "data" / "geo" / "gazetteer.json").read_text(encoding="utf-8"))
    stations = [g for g in gaz if g["kind"] == "station"]
    things = [g for g in gaz if g["kind"] in KINDS]
    marks = [g for g in gaz if any(m in g["name"] for m in MARK)]

    done = 0
    for v in views:
        if not v["include"] or not v.get("subject"):
            continue
        p = (v["subject"]["lat"], v["subject"]["lng"])
        anchor = (v["place"].get("anchor") or {}).get("osm")
        st = min(stations, key=lambda g: km(p, (g["lat"], g["lng"])))
        # 同名去重：OSM 的長地物（首都高・総武緩行線・歩道橋）會被切成很多段，
        # 不去重就變成「首都高速都心環状線・首都高速都心環状線・首都高速都心環状線」。
        near, seen = [], set()
        for d, g in sorted(((km(p, (g["lat"], g["lng"])), g) for g in things if g["id"] != anchor),
                           key=lambda t: t[0]):
            if d * 1000 > NEAR_M or len(near) >= 3:
                break
            base = g["name"].split(";")[0]          # 「京葉道路;両国橋」は前だけ
            if base in seen:
                continue
            seen.add(base)
            near.append({"name": base, "kind": g["kind"], "m": round(d * 1000)})
        mk = sorted(((km(p, (g["lat"], g["lng"])), g) for g in marks), key=lambda t: t[0])[:1]
        mk = [{"name": g["name"], "m": round(d * 1000), "osm": g["id"]}
              for d, g in mk if d * 1000 <= MARK_M]
        now = {"station": {"name": st["name"], "km": round(km(p, (st["lat"], st["lng"])), 2)},
               "nearby": near, "marker": mk[0] if mk else None}
        old = (v.get("now") or {})
        if args.no_net:
            now["elevation"], now["elevation_src"] = old.get("elevation"), old.get("elevation_src")
        else:
            now["elevation"], now["elevation_src"] = elevation(*p)
            time.sleep(0.3)
        v["now"] = now
        done += 1
        print(f"  {v['id']:2d} {v['title']['ja'][:12]:<14}"
              f"{'' if now['elevation'] is None else str(now['elevation']) + 'm'} "
              f"最寄 {now['station']['name']}({now['station']['km']}km) "
              f"近く {'・'.join(n['name'] for n in near) or '—'}"
              f"{'  碑 ' + mk[0]['name'] if mk else ''}", flush=True)

    inc = [v for v in views if v["include"] and v.get("subject")]
    els = [v["now"]["elevation"] for v in inc if v["now"].get("elevation") is not None]
    if els:
        els_sorted = sorted(els)
        # 同一畫帖裡的相對高低。這是**我們自己資料算出來的**，不是外部說法。
        for v in inc:
            e = v["now"].get("elevation")
            v["now"]["elevation_rank"] = (None if e is None else
                                          round(els_sorted.index(e) / max(1, len(els_sorted) - 1), 2))
        print(f"\n標高 {len(els)}/{len(inc)} 筆，{min(els)}–{max(els)}m（中位 {els_sorted[len(els_sorted)//2]}m）")
    print(f"最寄り駅 {sum(1 for v in inc if v['now']['station'])} 筆"
          f"／近くの地物 {sum(len(v['now']['nearby']) for v in inc)} 件"
          f"／碑 {sum(1 for v in inc if v['now']['marker'])} 筆")
    assert done == len(inc), "有景沒算到"
    if args.write:
        (ROOT / "data" / "views.json").write_text(
            json.dumps(views, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("寫回 data/views.json")
    else:
        print("（--write 才會寫檔）")
    print("self-check ok")


if __name__ == "__main__":
    main()
