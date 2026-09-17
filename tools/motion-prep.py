#!/usr/bin/env python3
"""AI 動畫生成前的準備：每一幅產出「墊成 16:9 的第一幀」與「組好的提示詞」。

  research/motion/NN-pad16x9.png        原畫墊成 16:9（Veo 只出 16:9，不墊就會被裁）
  research/motion/NN-prompt.txt         主模板（_prompt_template）＋ 依資料挑的 motion 句子
  research/motion/NN-prompt-street.txt  （--street 才有）變體 B 街景版：讓人動起來
  （--vivid 時 NN-prompt.txt 改寫成變體 C 生動版：每一幅寫好的動作指令，見 _prompt_template.vivid.scenes）

並把墊邊的座標寫進 data/motion.json 的 _pad——make-motion.py 事後照這組數字切回原畫的框。

🔴 motion 句子**從資料挑，不看圖猜**（規則寫在 _prompt_template.pick，跟 src/weather.js 同一套證據）。
   資料沒寫、但畫面上明明白白看得到的（例：題名沒寫雨、畫裡在下大雨），
   記在 _prompt_template.overrides，**連同理由**——⛔ 不在這支程式裡偷偷加。
   overrides 只影響提示詞，不改 views.json（遊戲的收景閘門照舊只看題名）。

用法：
  python3 tools/motion-prep.py 1-10
  python3 tools/motion-prep.py --street 1 2 4 7
  python3 tools/motion-prep.py --vivid 1-10      # 生動版；沒寫過 scenes 的景會被擋下來
"""
import argparse, json, re
from pathlib import Path
from PIL import Image, ImageStat

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "research" / "motion"
LAMP = re.compile("燈|灯|火|光|明")
BOLT = re.compile("閃電|稲妻|雷")


def pick(v, tpl):
    """這一幅該接哪幾句 motion（照 tpl['motion'] 的鍵順序）。"""
    c = v.get("conditions") or {}
    labels = [d.get("label", "") for d in v.get("details") or []]
    extra = (tpl.get("overrides") or {}).get(str(v["id"]), {}).get("add", [])
    hit = {c.get("weather"), c.get("time_of_day"), *extra}
    if any(LAMP.search(l) for l in labels): hit.add("lamp")
    if any(BOLT.search(l) for l in labels): hit.add("bolt")
    return [k for k in tpl["motion"] if k != "default" and k in hit]


def pad(plate):
    """墊成 16:9：比 16:9 窄的左右墊、比 16:9 寬的上下墊。墊邊色取這一幅自己紙邊的中位數。"""
    im = Image.open(plate).convert("RGB"); w, h = im.size
    strip = Image.new("RGB", (2 * w + 2 * h, 8)); x = 0
    for b in (im.crop((0, 0, w, 8)), im.crop((0, h - 8, w, h)),
              im.crop((0, 0, 8, h)).rotate(90, expand=True), im.crop((w - 8, 0, w, h)).rotate(90, expand=True)):
        strip.paste(b, (x, 0)); x += b.size[0]
    fill = tuple(int(c) for c in ImageStat.Stat(strip).median)
    if w / h < 16 / 9:
        cw, ch = round(h * 16 / 9 / 2) * 2, h
    else:
        cw, ch = w, round(w * 9 / 16 / 2) * 2
    at = ((cw - w) // 2, (ch - h) // 2)
    canvas = Image.new("RGB", (cw, ch), fill); canvas.paste(im, at)
    return canvas, at, (w, h), fill


def credit(prompt, v):
    """提示詞裡的畫師要照這一幅的 attribution 寫。

    🔴 模板寫的是 “by Kobayashi Kiyochika (1876-1881)” 與 “Kiyochika's palette”——
    81–84 是弟子井上安治畫的，照抄就是在提示詞裡把畫師寫錯。⇒ 換掉；換不到就擋下來，⛔ 不默默放行。"""
    if v.get("attribution") != "inoue-yasuji":
        return prompt
    out = (prompt.replace("by Kobayashi Kiyochika (1876-1881)", "by Inoue Yasuji, a student of Kobayashi Kiyochika")
                 .replace("Kiyochika's palette", "the print's own palette")
                 .replace("as Kiyochika drew it", "as Yasuji drew it"))
    assert "Kiyochika" not in out.replace("a student of Kobayashi Kiyochika", ""), f"no.{v['id']} 的提示詞還有清親的名字"
    return out


def ids(tokens):
    out = []
    for t in tokens:
        a, _, b = t.partition("-")
        out += list(range(int(a), int(b) + 1)) if b else [int(a)]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="+", help="編號或範圍，例：1-10 50 72")
    ap.add_argument("--street", action="store_true", help="另外寫一份街景版（變體 B）")
    ap.add_argument("--vivid", action="store_true", help="NN-prompt.txt 改用生動版（變體 C）")
    a = ap.parse_args()

    views = json.loads((ROOT / "data" / "views.json").read_text(encoding="utf-8"))
    views = {v["id"]: v for v in (views["views"] if isinstance(views, dict) else views)}
    mp = ROOT / "data" / "motion.json"
    data = json.loads(mp.read_text(encoding="utf-8"))
    tpl, street = data["_prompt_template"], data["_prompt_template"]["street"]

    # 規則的自我檢查：已經上線的兩幅，挑出來的句子要跟當時一樣
    assert pick(views[50], tpl) == ["rain", "lamp", "bolt"], pick(views[50], tpl)
    assert pick(views[72], tpl) == [], pick(views[72], tpl)

    OUT.mkdir(parents=True, exist_ok=True)
    for i in ids(a.ids):
        v = views.get(i)
        plate = ROOT / "assets" / "plate" / f"{i:02d}.jpg"
        if not v or not v.get("include") or not plate.exists():
            print(f"no.{i}  ⛔ 略過（不在收錄內或沒有原畫）"); continue
        # 沒座標的那 10 幅畫不到地圖上（src/main.js 只收 include && subject），玩家永遠點不到
        # ⇒ 做了動畫也沒有入口。⛔ 不要為它生提示詞。理由逐條寫在 places.json 的 _unresolved。
        if not v.get("subject"):
            print(f"no.{i}  ⛔ 略過：沒查到座標 ⇒ 不在地圖上 ⇒ 點不到（見 places.json 的 _unresolved）"); continue
        keys = pick(v, tpl)
        old_pad = data["_pad"].get(str(i))
        if any(c["id"] == i for c in data["clips"]) and old_pad:
            # 已經有片子 ⇒ ⛔ 不重墊（線上那支切框用的是當時那組數字），只重寫提示詞——重生用
            cw, ch = old_pad["canvas"]; at = tuple(old_pad["plate_at"])
            canvas = type("C", (), {"size": (cw, ch)})
            print(f"no.{i}  已經有片子：沿用原本的墊邊 {old_pad['file']}，只重寫提示詞")
        else:
            canvas, at, size, fill = pad(plate)
            png = OUT / f"{i:02d}-pad16x9.png"; canvas.save(png)
            data["_pad"][str(i)] = {"file": str(png.relative_to(ROOT)), "canvas": list(canvas.size),
                                    "plate_at": list(at), "plate_size": list(size), "fill": "#%02X%02X%02X" % fill}
        if a.vivid:
            scene = tpl["vivid"]["scenes"].get(str(i))
            if not scene:
                print(f"no.{i}  ⛔ 生動版還沒寫這一幅的 scenes（_prompt_template.vivid.scenes），⛔ 不用通用句子湊"); continue
            prompt = tpl["vivid"]["base"].replace("{SCENE}", scene)
        else:
            prompt = tpl["base"].replace("{MOTION}", " ".join(tpl["motion"][k] for k in keys) or tpl["motion"]["default"])
        prompt = credit(prompt, v)
        (OUT / f"{i:02d}-prompt.txt").write_text(prompt + "\n", encoding="utf-8")
        note = (f"no.{i:<2} {v['title']['ja']}　墊 {canvas.size[0]}×{canvas.size[1]}（原畫在 {at}）　"
                + ("生動版" if a.vivid else f"句子：{'＋'.join(keys) or 'default'}"))
        if str(i) in (tpl.get("overrides") or {}):
            note += f"　⚠️ override：{tpl['overrides'][str(i)]['why']}"
        if a.street:
            if (v.get("conditions") or {}).get("weather") == "fire":
                note += "　⛔ 火災不做街景版"
            else:
                sm = " ".join([street["motion"]] + [tpl["motion"][k] for k in keys])
                (OUT / f"{i:02d}-prompt-street.txt").write_text(credit(street["base"].replace("{MOTION}", sm), v) + "\n", encoding="utf-8")
                note += "　＋街景版"
        print(note)
    mp.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
