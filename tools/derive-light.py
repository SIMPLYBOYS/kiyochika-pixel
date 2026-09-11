#!/usr/bin/env python3
"""Phase 2/3 — 光線條件：從題名判出時刻與天候 → data/views.json 的 conditions

**為什麼是「光」而不是別的**：清親這批叫光線画，主題就是光——瓦斯燈、月、雪後、
曉、夕、大火。題名幾乎都把光線條件寫在上面（「浅草寺雪中」「日本橋夜」「神田八雲神社暁」），
⇒ 這個軸**資料現成，不必再判讀奧付**，而且比出版時序更貼題。

**兩層閘門的下層**（上層是出版年，見 fetch-dates.py）：
    年份 → 這一幅**什麼時候出現**在地圖上（1876→1881）
    光線 → 這一幅**什麼時候可收**（時刻與天候對了才收得到）

🔴 **只採題名明說的，⛔ 不從畫面亮度推。**
量過：夜景的畫面亮度中位 90、其餘 135–145，兩端分得開、中間整片重疊
（雪景亮是因為雪不是因為白天；火場暗是因為夜不是因為陰天）。
⇒ 沒寫時刻的那些就標 null ＝**不限光線**，隨時可收。
這不是資料缺口，是設計：清親特意標了時刻的那些才是有條件的。

用法：
  python3 tools/derive-light.py            # 只報告
  python3 tools/derive-light.py --write    # 寫回 views.json
"""
import argparse, collections, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 順序有意義：先比中的贏。「五本松雨月」同時有雨與月 ⇒ 時刻取 night、天候取 rain。
# ⚠️「五月夜」的「五月」是月份不是月亮，所以「月」前面接數字時不算 night——
# 但那一幅本來就有「夜」，會先比中，這條只是不讓它靠「月」誤判別的。
TIME = [
    ("night", r"夜|花火|燈|灯|(?<![一二三四五六七八九十])月"),
    ("dusk",  r"夕|暮|黄昏|日没"),
    ("dawn",  r"暁|曉|朝|日出"),
    ("day",   r"日中|昼|晝"),
]
WEATHER = [
    ("fire",      r"大火|出火|焼跡"),
    ("fireworks", r"花火"),
    ("snow",      r"雪"),
    ("rain",      r"雨"),
    ("moon",      r"(?<![一二三四五六七八九十])月"),
    ("clear",     r"晴|凪"),
]


def classify(title):
    # 🔴 只看題名本身，不看後面附的事件說明。
    # 60「兩国大火浅草橋 明治十四年一月廿六日出火」的「廿六**日出**火」裡有「日出」，
    # 整句拿去比會把它判成 dawn——又是子字串誤判（同 derive-subject 的坑二）。
    t = title.split(" ")[0]
    return (next((k for k, p in TIME if re.search(p, t)), None),
            next((k for k, p in WEATHER if re.search(p, t)), None))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    vp = ROOT / "data" / "views.json"
    views = json.loads(vp.read_text(encoding="utf-8"))
    tod = collections.Counter()
    wx = collections.Counter()
    free = []
    for v in views:
        if not v["include"]:
            continue
        t, w = classify(v["title"]["ja"])
        v["conditions"] = {"time_of_day": t, "weather": w, "source": "title" if (t or w) else None}
        tod[t] += 1
        wx[w] += 1
        if not t and not w:
            free.append((v["id"], v["title"]["ja"]))

    inc = [v for v in views if v["include"]]
    print("時刻（題名判得出的）：" + "，".join(f"{k or '不限'} {n}" for k, n in tod.most_common()))
    print("天候（題名判得出的）：" + "，".join(f"{k or '無'} {n}" for k, n in wx.most_common()))
    gated = sum(1 for v in inc if v["conditions"]["time_of_day"] or v["conditions"]["weather"])
    print(f"\n有光線條件（會被閘門管到）：{gated} / {len(inc)}")
    print(f"不限光線（隨時可收）：{len(free)}")
    for i, t in free[:12]:
        print(f"   {i:2d} {t[:20]}")
    if len(free) > 12:
        print(f"   …共 {len(free)} 幅")

    # 點名驗：這幾幅的條件寫在題名上，一眼可核對。錯了代表正則被改壞了。
    by = {v["id"]: v["conditions"] for v in views}
    # ⚠️ 69「淺草寺雪中」只有天候沒有時刻——第一版我把期待值寫成 night+snow，
    # 點名驗抓到的是**我的期待錯了**，不是程式錯。條件只能來自題名真的寫了什麼。
    must = {69: (None, "snow"), 59: ("night", None), 38: ("dawn", None),
            39: (None, "snow"), 50: (None, "rain"), 60: (None, "fire"), 42: ("night", "fireworks")}
    for i, (t, w) in must.items():
        got = (by[i]["time_of_day"], by[i]["weather"])
        assert got == (t, w), f"no.{i} 判成 {got}，期待 {(t, w)}"
    print("self-check ok（7 幅點名驗過）")
    if args.write:
        vp.write_text(json.dumps(views, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("寫回 data/views.json")
    else:
        print("（--write 才會寫檔）")


if __name__ == "__main__":
    main()
