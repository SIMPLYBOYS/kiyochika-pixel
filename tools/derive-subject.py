#!/usr/bin/env python3
"""Phase 0 — 69 幅的 subject 座標（題名的地名 → OSM 地物）→ 寫回 data/views.json

**斷詞只從題名來，座標只從 OSM 來。** 這條規則抄自 edo-hyakkei §3.6：
加了題名以外的知識，根據就變成「我的印象」，無從查證。所以：

  地名 = 題名裡的字（先做旧字体正規化，因為細目表是旧字）
  座標 = `data/geo/gazetteer.json` 裡某一個具名地物，帶 OSM id

⇒ 每一筆 subject 都指得出「是哪個 OSM 元素給的」。錯了看得出來錯在哪。

🔴 **四個會安靜給出「看起來合理」答案的坑**：

1. **子字串比對**（edo-hyakkei §3.6 踩過）。日文地名部件共用：「大川端石原橋」裡有
   「大川」也有「石原橋」。規則＝**先頭錨定優先，其次最長者勝**。
   ⚠️ 第一版用「2 字以下一律不採」擋這個坑，結果 69 幅只中 10——**日本地名本來就多半是兩個字**
   （銀座・高輪・今戸・橋場・蔵前・大森）。長度不是好判準，**位置才是**：
   清親的題名幾乎都以地名開頭，所以先頭比中的兩字名可信，句中冒出來的兩字名不可信。
2. **同名地物**。八雲神社、稲荷神社在東京有幾十個。同名多筆時，用題名裡**另一個**
   比中的地名當錨，取離錨最近的；沒有第二個錨就標 ambiguous，⛔ 不猜。
3. **「同名多筆」有兩種，混在一起就會誤判**。隅田川 40 筆是**同一條河被切成很多段**
   （散佈 20km），八雲神社 10 筆是**十個不同的神社**。前者要合併成一個地物，後者不能。
   判準＝叢集直徑：同名且互相靠近（≤2km）視為一個地物取重心；散開的才是真的同名衝突。
   ⚠️ 但線狀地物合併後的重心**不是畫的位置**——隅田川的重心在河中段，而「隅田川夜」畫的是
   某一段。所以線狀地物（water）即使合併也只標 `low` 信心，等人工用畫面定。
4. **地物不存在了**。百本杭・五本松・元柳橋・紙幣寮・六角茶屋是明治的東西，OSM 沒有。
   這不是比對失敗，是**史地問題**——落在 `data/places.json`（人工檔，機器不覆寫），
   照 edo-hyakkei 對 `edo-places.json` 的處置：人工判斷放在機器碰不到的地方，
   而且**依據要寫在同一筆裡**（`source` 欄：OSM id／Wikidata QID／哪張圖上量的）。

用法：
  python3 tools/derive-subject.py            # 只報告，不寫
  python3 tools/derive-subject.py --write    # 寫回 views.json
"""
import argparse, json, math, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 旧字体 → 新字体。只列細目表 84 條裡真的出現過的字，⛔ 不放通用表：
# 通用表會把沒驗過的替換偷渡進資料。
OLD2NEW = str.maketrans({
    "兩": "両", "淺": "浅", "圖": "図", "櫻": "桜", "萬": "万", "瀧": "滝", "廣": "広",
    "藏": "蔵", "國": "国", "會": "会", "傳": "伝", "濱": "浜", "寫": "写", "內": "内",
    "驛": "駅", "畫": "画", "曉": "暁", "臺": "台", "龜": "亀", "燒": "焼", "號": "号",
    "區": "区", "點": "点", "邊": "辺", "澤": "沢", "觀": "観", "樂": "楽", "豐": "豊",
})
# 同一個音在題名與 OSM 裡寫法不同，不統一就對不上：
# 「御茶の水」vs OSM「御茶ノ水橋」、「池の端」vs OSM「池之端」、「虎の門」vs OSM「虎ノ門」。
# 三個字都唸 no，是同一個地名的三種寫法，不是三個地方。
KANA = str.maketrans({"の": "ノ", "之": "ノ", "ヶ": "ケ", "が": "ケ"})
# 題名的前綴，**比對前就剝掉**。第一版只用它算「是不是先頭」，沒有剝——
# 於是「東京銀座街日報社」比中的是「東京」（→ 東京駅），三幅畫全指到同一個點。
# ⛔ 不含「元」：元柳橋 ≠ 柳橋、元両国 ≠ 両国，剝掉會換成另一個地方。
PREFIX = ("東京", "御")
# 🔴 「東京」不能當地名候選。剝前綴之後又加了「不剝的版本也比」，
# 於是它在原題名裡的位置是 0（先頭）⇒ 又贏了一次，1・3・21 三幅再度全指到東京駅。
# 前綴要兩件事一起做：**剝掉，而且把它自己排除在候選之外**。
STOP = {"東京"}
# 地物種類的可信度順序：橋與寺社是題名指的東西本身，駅與町名只是「那一帶」。
KIND_RANK = {"bridge": 0, "worship": 1, "historic": 2, "park": 3, "water": 4, "station": 5, "place": 6}
DISTRICT = {"station", "place"}   # 這兩種只能標「這一帶」，不是畫的位置
CLUSTER_KM = 2.0    # 同名叢集直徑上限：以內視為同一地物（坑 3）
NEAR_KM = 4.0       # 同名消歧時，錨與候選的合理距離上限


def norm(s):
    return (s or "").translate(OLD2NEW).translate(KANA)


def km(a, b):
    dy = (a[0] - b[0]) * 111.0
    dx = (a[1] - b[1]) * 111.0 * math.cos(math.radians(a[0]))
    return math.hypot(dx, dy)


def strip_prefix(t):
    for p in PREFIX:
        if t.startswith(p) and len(t) > len(p) + 1:
            return t[len(p):]
    return t


def script_of(ch):
    o = ord(ch)
    if 0x4E00 <= o <= 0x9FFF:
        return "kanji"
    if 0x3040 <= o <= 0x30FF:
        return "kana"
    return "other"


def at_boundary(t, i, name):
    """🔴 句中的比中要落在詞界上，否則就是子字串誤判。

    判準＝**前一個字的文字種類**：同種類代表切在詞中間。
      「大川端石原橋」的「原橋」前面是「石」（漢字）⇒ 詞被切斷，不採
      「ためいけ」的「いけ」前面是「め」（假名）⇒ 同上
    這是 edo-hyakkei §3.6「日文地名不能用子字串比對」的可執行版：
    那邊的解法是先頭比對，但先頭比對會漏掉句中真的有的地名，
    改成「先頭 or 詞界」兩者取一。

    ⚠️ **只對兩字名執行**。第一版一律執行，把「芝葉増上寺日中」的増上寺、
    「三ッ又永代橋遠景」的永代橋也擋掉了——三個字以上的地名不會是別的詞的尾巴，
    這條規則對它們只有偽陰性沒有偽陽性。"""
    if i == 0 or len(name) >= 3:
        return True
    return script_of(t[i - 1]) != script_of(name[0])


def cluster(cands):
    """同名多筆：全部互相靠近就是一個地物（回傳重心），否則回 None。

    ⚠️ 重心要取，種類要從最可信的那一筆拿：「日本橋」六筆裡有橋也有地鐵站，
    取到站就變成「日本橋夜」畫的是地鐵站。"""
    lat = sum(c["lat"] for c in cands) / len(cands)
    lng = sum(c["lng"] for c in cands) / len(cands)
    if max(km((c["lat"], c["lng"]), (lat, lng)) for c in cands) <= CLUSTER_KM:
        best = min(cands, key=lambda c: KIND_RANK.get(c["kind"], 9))
        if best["kind"] not in DISTRICT:          # 有具體地物就用它自己的座標，不用重心
            return best
        return {**best, "lat": round(lat, 6), "lng": round(lng, 6)}
    return None


def candidates(title, gaz):
    # 剝前綴與不剝**兩個版本都要比**：剝了才看得到「東京銀座街」的銀座，
    # 不剝才對得上「御茶ノ水橋」——「御」在這個地名裡是名字的一部分，不是敬語前綴。
    # 只做其中一個都會漏，取兩者的聯集，位置取較前的那個。
    variants = [norm(title), strip_prefix(norm(title))]
    hits, pos = {}, {}
    for g in gaz:
        n = norm(g["name"])          # gazetteer 那側也要正規化，否則只有題名變了對不上
        if len(n) < 2 or n in STOP:
            continue
        best = None
        for t in variants:
            i = t.find(n)
            if i >= 0 and at_boundary(t, i, n) and (best is None or i < best):
                best = i
        if best is None:
            continue
        hits.setdefault(n, []).append(g)
        pos[n] = min(pos.get(n, 99), best)
    # 先頭者優先，同為先頭則長者勝（坑 1）
    return sorted(hits.items(), key=lambda kv: (pos[kv[0]] != 0, -len(kv[0])))


def resolve(title, gaz):
    hits = candidates(title, gaz)
    if not hits:
        return None, "no-match", None, None
    name, cands = hits[0]
    kind = min(cands, key=lambda c: KIND_RANK.get(c["kind"], 9))["kind"]
    # 駅名／町名只指得出「這一帶」；線狀地物（河）連那一帶都指不準（坑 3）
    conf = "low" if kind == "water" else ("district" if kind in DISTRICT else "osm")
    if len(cands) == 1:
        return cands[0], "osm", name, conf
    merged = cluster(cands)
    if merged:
        return merged, f"osm-cluster×{len(cands)}", name, conf
    # 真的同名衝突 → 找第二個錨（坑 2）
    for other, ocands in hits[1:]:
        if other in name or name in other:
            continue
        anchor = cluster(ocands) if len(ocands) > 1 else ocands[0]
        if not anchor:
            continue
        best, bd = None, 1e9
        for c in cands:
            d = km((c["lat"], c["lng"]), (anchor["lat"], anchor["lng"]))
            if d < bd:
                best, bd = c, d
        if best and bd <= NEAR_KM:
            return best, f"osm-anchored:{other}({bd:.1f}km)", name, conf
    return None, f"ambiguous:{name}×{len(cands)}", name, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    views = json.loads((ROOT / "data" / "views.json").read_text(encoding="utf-8"))
    gaz = json.loads((ROOT / "data" / "geo" / "gazetteer.json").read_text(encoding="utf-8"))
    mp = ROOT / "data" / "places.json"
    _m = json.loads(mp.read_text(encoding="utf-8")) if mp.exists() else {}
    manual = _m.get("places", {})
    reject_ids = set(_m.get("_reject", {}))

    stats, unresolved = {}, []
    bump = lambda k: stats.__setitem__(k, stats.get(k, 0) + 1)
    for v in views:
        if not v["include"]:
            continue
        if str(v["id"]) in reject_ids:      # 目視檢查否掉的自動比對結果（places.json 的 _reject）
            v["subject"] = None
            v["place"]["anchor"] = None
            unresolved.append((v["id"], v["title"]["ja"], "rejected-by-eye"))
            bump("rejected")
            continue
        m = manual.get(str(v["id"]))
        if m:
            v["subject"] = {"lat": m["lat"], "lng": m["lng"]}
            v["place"]["anchor"] = {"how": "manual", "name": m.get("name"),
                                    "source": m["source"], "confidence": m.get("confidence", "manual")}
            v["notes"]["geo"] = m["why"]
            bump("manual")
            continue
        g, how, name, conf = resolve(v["title"]["ja"], gaz)
        if g:
            v["subject"] = {"lat": g["lat"], "lng": g["lng"]}
            v["place"]["anchor"] = {"how": how, "name": name, "osm": g["id"],
                                    "kind": g["kind"], "confidence": conf}
            bump(how.split(":")[0].split("×")[0])
        else:
            v["subject"] = None
            v["place"]["anchor"] = None
            unresolved.append((v["id"], v["title"]["ja"], how))
            bump(how.split(":")[0])

    inc = [v for v in views if v["include"]]
    print(f"{len(inc)} 幅：" + "，".join(f"{k} {n}" for k, n in sorted(stats.items())))
    print("\n— 已定位（逐筆核對：地名／OSM 元素／怎麼定的）—")
    for v in inc:
        a = (v["place"] or {}).get("anchor")
        if not a or not v["subject"]:
            continue
        src = a["source"] if a["how"] == "manual" else f"{a['osm']:<16} {a['kind']:<8} {a['how']}"
        flag = {"low": "🟡", "district": "◐ "}.get(a.get("confidence"), "  ")
        print(f" {flag}{v['id']:2d} {v['title']['ja']:<24} 「{a.get('name') or '—'}」 {v['subject']['lat']:.4f},{v['subject']['lng']:.4f}  {src}")
    print("  （◐ ＝ 只定到「那一帶」（駅名／町名），🟡 ＝ 線狀地物，兩者都要人工用畫面收斂）")
    print(f"\n— 未定位 {len(unresolved)}（人工進 data/places.json，⛔ 不猜）—")
    for i, t, why in unresolved:
        print(f"  {i:2d} {t:<24} {why}")

    done = [v for v in inc if v["subject"]]
    B = {"w": 139.565, "e": 139.925, "s": 35.535, "n": 35.805}
    out = [(v["id"], v["subject"]) for v in done
           if not (B["w"] <= v["subject"]["lng"] <= B["e"] and B["s"] <= v["subject"]["lat"] <= B["n"])]
    assert not out, f"這些座標落在畫框外：{out}"   # edo-hyakkei §2.7 坑 1：一個都不能在框外
    if args.write:
        (ROOT / "data" / "views.json").write_text(json.dumps(views, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"\n寫回 data/views.json：{len(done)}/{len(inc)} 有座標")
    print(f"self-check ok（{len(done)} 個座標全在畫框內）")


if __name__ == "__main__":
    main()
