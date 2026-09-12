#!/usr/bin/env python3
"""生成動態版的關鍵幀：assets/plate/NN.jpg ＋ 提示詞 → research/motion/NN-k.png

🔴 **這支是這個 repo 唯一會呼叫生成模型的工具**，所以它做三件防守的事：
  ① **底一定是原畫**：把 assets/plate/NN.jpg 當輸入圖丟進去（img2img），
     ⛔ 不是純文字生成——純文字生出來的是「像清親的畫」，那不是清親的畫
  ② **尺寸對得上才收**：回來的圖長寬比與原畫差超過 1% 就擋下來，
     那表示模型重新裁過構圖，而**構圖不是它能動的東西**
  ③ **出處自動寫回 data/motion.json**：模型、日期、提示詞、來源圖、檔名——
     這一層的「出處」就是這幾樣，⛔ 記不全就不該放進遊戲

🔑 金鑰**不進 repo**：從環境變數 GEMINI_API_KEY 讀，或 --key-file 指一個 repo 外的檔案
（預設 ~/.gemini-key）。⛔ 這支程式不會把金鑰印出來，也不會寫進任何檔案。

用法：
  python3 tools/gen-frames.py 50 --n 2      # 生兩張關鍵幀（第 1 張是原畫本身）
  python3 tools/gen-frames.py 50 --dry      # 只印出會送什麼，不呼叫 API
"""
import argparse, base64, datetime, json, os, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "research" / "motion"
MODEL = "gemini-2.5-flash-image"
API = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"

# 提示詞逐字寫在這裡，⛔ 不要每次即興改——它是這一層的出處，要跟輸出一起存檔。
COMMON = (
    "這是一張明治時代的日本木版畫（小林清親《東京名所圖》之一）。"
    "請以它為底，**只改變光與天氣，不要改變任何物件的位置、形狀或數量**。"
    "必須保留：木版的刀痕與紙紋、原有的色版與色相、畫面四邊的和紙紙邊與落款印。"
    "⛔ 不可以：加入或移除人物、船隻、建築、招牌、文字；重新構圖或裁切；"
    "把它變成照片或 3D；修掉雜點或銳化。輸出與輸入相同的長寬比。"
)
SHOTS = {
    2: "第二幀：閃電剛過的瞬間——黃色電光退成微弱的餘光，天空回到深青綠，"
       "雨線比原圖更明顯，水面的反光變暗。",
    3: "第三幀：下一道閃電正要亮起——電光的邊緣發白，天空被照亮一階，"
       "水面出現明亮的倒影，雨線被照出來。",
}


def key(path):
    k = os.environ.get("GEMINI_API_KEY")
    if k:
        return k.strip()
    p = Path(path).expanduser()
    assert p.exists(), (f"找不到金鑰。請擇一：\n"
                        f"  export GEMINI_API_KEY=...\n"
                        f"  或把金鑰存成 {p}（chmod 600，⛔ 不要放進 repo）")
    return p.read_text().strip()


def call(api_key, img_bytes, prompt):
    body = json.dumps({"contents": [{"parts": [
        {"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(img_bytes).decode()}},
        {"text": prompt},
    ]}]}).encode()
    req = urllib.request.Request(API, data=body, method="POST", headers={
        "Content-Type": "application/json", "x-goog-api-key": api_key})
    with urllib.request.urlopen(req, timeout=300) as r:
        data = json.loads(r.read())
    for part in data["candidates"][0]["content"]["parts"]:
        blob = part.get("inline_data") or part.get("inlineData")
        if blob:
            return base64.b64decode(blob["data"])
    raise RuntimeError("回應裡沒有圖：" + json.dumps(data)[:400])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("id", type=int)
    ap.add_argument("--n", type=int, default=2, help="要生幾張（第 1 幀固定是原畫，不算在內）")
    ap.add_argument("--key-file", default="~/.gemini-key")
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()

    from PIL import Image
    plate = ROOT / "assets" / "plate" / f"{a.id:02d}.jpg"
    assert plate.exists(), f"沒有這張原畫：{plate}"
    base = Image.open(plate)
    raw = plate.read_bytes()
    OUT.mkdir(parents=True, exist_ok=True)

    if a.dry:
        print(f"底圖 {plate.relative_to(ROOT)}　{base.size}　{len(raw)/1e6:.1f}MB")
        for k in range(2, 2 + a.n):
            print(f"\n── 第 {k} 幀送出的提示詞 ──\n{COMMON}\n{SHOTS.get(k, '')}")
        return

    api_key = key(a.key_file)
    frames = [f"{a.id:02d}-1.png"]
    # 第 1 幀＝原畫本身，⛔ 不送去生成
    Image.open(plate).save(OUT / frames[0])
    for k in range(2, 2 + a.n):
        prompt = COMMON + SHOTS.get(k, "")
        print(f"  第 {k} 幀 生成中…", flush=True)
        out = OUT / f"{a.id:02d}-{k}.png"
        img_bytes = call(api_key, raw, prompt)
        out.write_bytes(img_bytes)
        got = Image.open(out)
        ar_in, ar_out = base.size[0] / base.size[1], got.size[0] / got.size[1]
        assert abs(ar_in - ar_out) / ar_in < 0.01, (
            f"⛔ 回來的長寬比對不上（{got.size} vs {base.size}）——模型重新裁過構圖，不收")
        if got.size != base.size:                 # 比例對就縮回原尺寸，組幀工具要求逐張一致
            got.resize(base.size, Image.LANCZOS).save(out)
            print(f"     （{got.size} → {base.size}，比例相同故縮回）")
        frames.append(out.name)
        print(f"     → {out.relative_to(ROOT)}　{out.stat().st_size/1e6:.2f}MB")

    # 出處寫回 data/motion.json
    mp = ROOT / "data" / "motion.json"
    d = json.loads(mp.read_text(encoding="utf-8"))
    d["clips"] = [c for c in d["clips"] if c["id"] != a.id] + [{
        "id": a.id, "file": f"assets/motion/{a.id:02d}.webm", "frames": frames,
        "base": f"assets/plate/{a.id:02d}.jpg", "model": MODEL,
        "date": datetime.date.today().isoformat(),
        "prompt": COMMON, "shots": {str(k): SHOTS.get(k, "") for k in range(2, 2 + a.n)},
        "moved": "閃電亮度・雨・水面反光", "hold": 0.6, "fade": 0.5,
    }]
    mp.write_text(json.dumps(d, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"\n出處寫進 {mp.relative_to(ROOT)}　⛔ 下一步用眼睛看過 research/motion/ 的每一張再組幀")
    print(f"   python3 tools/make-motion.py {a.id}")


if __name__ == "__main__":
    main()
