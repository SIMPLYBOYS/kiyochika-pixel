#!/usr/bin/env python3
"""知識層的第三層——**解說**：ウィキペディア（日本語版）→ data/topics-text.json

前兩層回答的是「這是哪裡」（座標・現代地址）與「今天那裡有什麼」（標高・車站・碑）。
這一層回答的是**「這是什麼」**：畫裡那台人力車是什麼時候出現在東京街上的、
海運橋旁邊那棟洋樓是誰蓋的、清親畫的「光線画」在浮世絵裡是什麼位置。

🔴 **為什麼不是我自己寫。** 這個 repo 一路的規矩是「⛔ 不寫沒有出處的話」
（`places.json` 的 `_rule`、`details.json` 的 `_label`、README 的〈兩條規則〉）。
六十九段憑印象的畫作賞析、兩百段憑印象的器物考——那正是這裡要避開的東西。
⇒ 解說**逐字取自維基百科的導言段**，標明出處與授權，玩家點得進原文。
   我做的事只有一件：**決定哪一條目對應哪一幅畫／哪一個標註**，而那個對應
   人工逐條確認過，寫在 `data/topics.json`（人工檔，機器不覆寫）。

🔑 **對應關係比文字重要，也比文字容易錯。** 「橋場」「柳島」「両国」這些詞
在維基百科上都有同名的別處條目（柳島是墨田区的町名，也是香川的地名）。
所以 `--propose` 只是**提案**：把候選條目與導言頭一句印出來，我逐條看過才寫進
`topics.json`，⛔ 不自動採用搜尋第一名。這跟 Phase 0 座標那次是同一條教訓。

授權：維基百科文字 CC BY-SA 4.0 ⇒ 面板上標出處與授權、連回原文，
`topics-text.json` 裡每一條都帶 `license` 與 `url`。

用法：
  python3 tools/fetch-topics.py --propose        # 出提案表 research/_topics.md（給人看）
  python3 tools/fetch-topics.py --write          # 依 topics.json 抓導言 → topics-text.json
"""
import argparse, json, re, sys, time, urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetchlib import get_json

ROOT = Path(__file__).resolve().parent.parent
UA = "kiyochika-pixel/0.1 (research; contact via https://github.com/SIMPLYBOYS/kiyochika-pixel)"
API = "https://ja.wikipedia.org/w/api.php"
LICENSE = "CC BY-SA 4.0（ウィキペディア日本語版）"
SENTENCES = 3            # 導言取前三句：一句太乾，整段太長，面板塞不下
# ⚠️ 有些條目最要緊的一句不在前三句：汐留駅那條前三句在講貨物支線，
# 「日本初の起点となる鉄道駅」是第四句。⇒ topics.json 可以逐條指定要幾句。

# 題名裡這些字是畫法或天候，不是地名／事物，拿去搜只會搜到別的東西
NOISE = re.compile(r"(之圖|之景|の圖|の図|図|圖|景|夜|晝|暁|曉|夕暮|夕景|雪中|雪景|雨中|"
                   r"日中|朧月|遠景|其一|其二|東京)")


def wiki(params):
    q = urllib.parse.urlencode({**params, "format": "json", "formatversion": "2"})
    return get_json(f"{API}?{q}", UA, retry_on=(KeyError,))


def search(term, n=3):
    r = wiki({"action": "query", "list": "search", "srsearch": term, "srlimit": n})
    return [h["title"] for h in r.get("query", {}).get("search", [])]


def intro(title, n=SENTENCES, section=None):
    """回傳 {title, text, wikidata, url}；找不到回 None。

    section 給了就取那一節而不是導言——清親的生平在「浮世絵師となるまで」那幾節裡，
    導言只有兩句（⛔ 而生平正是這一層最該講的東西）。"""
    r = wiki({"action": "query", "prop": "extracts|pageprops", "explaintext": 1,
              "redirects": 1, "titles": title, **({} if section else {"exintro": 1})})
    pages = r.get("query", {}).get("pages", [])
    if not pages or pages[0].get("missing"):
        return None
    p = pages[0]
    raw = p.get("extract") or ""
    if section:
        # extracts 的純文字用「== 標題 ==」分節。⚠️ 標題要**完全相等**才取，
        # ⛔ 不用包含比對——「作品」會撞到「作品一覧」。
        blocks = re.split(r"\n=+ *(.+?) *=+\n", "\n" + raw)
        found = None
        for i in range(1, len(blocks) - 1, 2):
            if blocks[i].strip() == section:
                found = blocks[i + 1]
                break
        if found is None:
            return None
        raw = found
    text = " ".join(raw.split())
    # 句號切句。⚠️ 括號裡的句號不算（「1873年（明治6年）。」那種），所以只切「。」後面接非括號的
    parts = re.split(r"(?<=。)", text)
    body = "".join(parts[:n]).strip()
    return {"title": p["title"], "text": body,
            "wikidata": (p.get("pageprops") or {}).get("wikibase_item"),
            "url": "https://ja.wikipedia.org/wiki/" + urllib.parse.quote(p["title"].replace(" ", "_")),
            "license": LICENSE}


def propose():
    views = [v for v in json.loads((ROOT / "data" / "views.json").read_text(encoding="utf-8"))
             if v.get("include")]
    out = ["# 解說條目提案（人工逐條確認後寫進 data/topics.json）", "",
           "⛔ 不要整批採用：同名的別處條目很多（柳島・橋場・両国），這張表就是為了看出那些。", ""]
    out.append("## 每一幅的「這是什麼地方」")
    for v in views:
        a = (v.get("place") or {}).get("anchor") or {}
        title_word = NOISE.sub("", v["title"]["ja"].split("（")[0]).strip()
        terms = [t for t in dict.fromkeys([a.get("name"), title_word]) if t]
        out.append(f"\n### {v['id']:02d} {v['title']['ja']}　<small>anchor={a.get('name')}</small>")
        for t in terms:
            for cand in search(t, 2):
                d = intro(cand)
                if d:
                    out.append(f"- `{d['title']}`（{d['wikidata']}）── {d['text'][:110]}")
            time.sleep(0.1)
    labels = sorted({d["label_ja"] for v in views for d in (v.get("details") or []) if d.get("label_ja")})
    out += ["", "## 標註裡的事物（只挑講得出歷史的，⛔ 人・木・影 那種不必）", ""]
    for lab in labels:
        cands = search(lab, 1)
        if not cands:
            continue
        d = intro(cands[0])
        if d:
            out.append(f"- **{lab}** → `{d['title']}`（{d['wikidata']}）── {d['text'][:110]}")
        time.sleep(0.1)
    p = ROOT / "research" / "_topics.md"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"提案寫到 {p.relative_to(ROOT)}（{len(views)} 幅 ＋ {len(labels)} 個標註詞）")
    print("⛔ 這是提案不是結果：逐條看過再寫進 data/topics.json")


def write():
    topics = json.loads((ROOT / "data" / "topics.json").read_text(encoding="utf-8"))
    # ⚠️ 鍵要含章節：清親的生平是同一個條目的三節，只用標題當鍵它們會互相蓋掉
    # （第一版就是這樣，三節寫出來變成同一段導言）。⇒ 鍵是「條目#章節」。
    wanted = {}                       # 鍵 → (條目, 章節, 要幾句)
    for sec in ("places", "things", "notes"):
        for v in (topics.get(sec) or {}).values():
            if isinstance(v, str):
                name, part, n = v, None, SENTENCES
            else:
                name, part, n = v["title"], v.get("section"), v.get("n", SENTENCES)
            key = f"{name}#{part}" if part else name
            wanted[key] = (name, part, max(wanted.get(key, (None, None, 0))[2], n))
    out, missing = {}, []
    for key, (t, part, n) in sorted(wanted.items()):
        d = intro(t, n, section=part)
        if not d:
            missing.append(key)
            continue
        if part:
            d = {**d, "title": f"{d['title']}・{part}", "url": d["url"] + "#" + urllib.parse.quote(part)}
        out[key] = d
        print(f"  {key:<28}→ {len(d['text'])} 字")
        time.sleep(0.15)
    assert not missing, f"這些條目抓不到，⛔ 不寫出半套：{missing}"
    # 導言只有一句半的多半是**曖昧頁**（「浜町（はまちょう、はままち）」那種）——
    # 第一版就這樣誤用了浜町與神田川。字數短是那種錯最早的徵兆，所以報出來。
    for t, d in sorted(out.items(), key=lambda kv: len(kv[1]["text"]))[:3]:
        if len(d["text"]) < 30:
            print(f"  ⚠️ {t} 只有 {len(d['text'])} 字——確認它不是曖昧頁")
    # 譯文與原文不能悄悄分家：原文改版了就要重譯
    zh = ROOT / "data" / "topics-zh.json"
    if zh.exists():
        items = json.loads(zh.read_text(encoding="utf-8")).get("items", {})
        gone = [t for t in out if t not in items]
        moved = [t for t, d in out.items() if t in items and items[t].get("ja") != len(d["text"])]
        if gone:
            print(f"  ⚠️ 還沒翻的 {len(gone)} 條：{gone}")
        if moved:
            print(f"  ⚠️ 維基原文改了、譯文要跟著更新的 {len(moved)} 條：{moved}")
    # 「這是什麼地方」與「畫裡的東西」指到同一條的，面板會自動去重（src/main.js），
    # 但這裡報出來，因為那是**對應表的事實**：策展的人該知道哪幾幅是這種情形。
    views = [v for v in json.loads((ROOT / "data" / "views.json").read_text(encoding="utf-8"))
             if v.get("include")]
    name = lambda v: v if isinstance(v, str) else v["title"]
    both = []
    for v in views:
        pl = topics.get("places", {}).get(str(v["id"]))
        if not pl:
            continue
        for d in v.get("details") or []:
            th = topics.get("things", {}).get(d.get("label_ja"))
            if th and name(th) == name(pl):
                both.append(f"no.{v['id']}「{name(pl)}」")
                break
    if both:
        print(f"  ℹ️ 地方與事物指同一條、面板會去重的 {len(both)} 幅：{'、'.join(both)}")

    dest = ROOT / "data" / "topics-text.json"
    dest.write_text(json.dumps({"_": "維基百科導言，機器抓的；對應關係在 topics.json（人工）。"
                                     "逐字引用，授權 CC BY-SA 4.0，面板上標出處並連回原文。",
                                "items": out}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"\n{len(out)} 條 → {dest.relative_to(ROOT)}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--propose", action="store_true")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    if a.propose:
        propose()
    elif a.write:
        write()
    else:
        print(__doc__)
