#!/usr/bin/env python3
"""生成的動態版：影片 → assets/motion/NN.webm（＋ .mp4 後備）

🔴 **這是這個 repo 唯一一層生成出來的東西**，所以它的「出處」定義得比別層嚴：
模型、日期、prompt、來源圖全部記在 `data/motion.json`。**指不出這些就不該放進遊戲。**

🔑 這支工具量一件事：**構圖有沒有被動到**。每 0.3 秒抽一格跟原畫比「邊還在不在同一個
地方」（邊的位置＝構圖；光變了邊不該跑）。閾值拿**原畫自己**做過對照：

    只調亮 40% → 6.3 ／ 只降對比 30% → 5.7 ／ 整幅平移 12px → 19.0 ／ 左右鏡像 → 21.5

⇒「只動光」落在 6 上下，「構圖動了」跳到 19 以上。

🔴 量出來之後怎麼辦，看 clips 裡的 `kind` ——**這是一個要人來做的決定，不是閾值**：
  · `atmosphere`      宣稱「這是那幅畫動起來」⇒ 超過 16 直接擋，⛔ 不要放寬這個數字
  · `reinterpretation` 宣稱「這是照那幅畫重畫的另一件作品」⇒ 不擋，但**強制列出差異**
                       （`differs`），而且那份差異會印在玩家看得到的地方。
     ⚠️ 選這個就不准再叫它「動態版」——它不是原畫動起來，是模型的版本。

無縫循環：把開頭 fade 秒淡入疊到結尾（Veo 那類影片不會自己接得起來）。
16:9 墊過的來源會照 `_pad` 的數字自己切回原畫的框（⛔ 不用手打座標，那組數字是出處）。

用法：
  python3 tools/make-motion.py 50 --video research/motion/new_p50.mp4
  python3 tools/make-motion.py 50 --video ... --check-only     # 只驗不輸出
"""
import argparse, json, subprocess, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "motion"
FPS, WIDTH = 24, 960          # 面板最寬 960，⛔ 不必留更大的：那只是讓玩家多載幾 MB
SAMPLE = 0.3                  # 每幾秒抽一格來驗
WARN, STOP = 12, 16


def probe(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0",
                        "-show_entries", "stream=width,height,duration",
                        "-show_entries", "format=duration", "-of", "json", str(path)],
                       capture_output=True, text=True, check=True)
    d = json.loads(r.stdout)
    st = d["streams"][0]
    return int(st["width"]), int(st["height"]), float(st.get("duration") or d["format"]["duration"])


def crop_of(data, vid, vw):
    """16:9 墊過的來源 ⇒ 照 data/motion.json 的 `_pad` 切回原畫的框。

    ⚠️ 座標不在這裡寫死：`_pad` 是餵給模型時留下的那組數字，⇒ 切回來用同一組，
    對不上就會在下面的長寬比那一關被擋下。"""
    p = (data.get("_pad") or {}).get(str(vid))
    if not p:
        return None, None
    k = vw / p["canvas"][0]
    x, y = (round(v * k) // 2 * 2 for v in p["plate_at"])
    w, h = (round(v * k) // 2 * 2 for v in p["plate_size"])
    return f"crop={w}:{h}:{x}:{y}", (w, h)


def edges(img, size):
    from PIL import Image, ImageFilter, ImageOps
    im = Image.open(img).convert("L").resize(size)
    return list(ImageOps.autocontrast(im.filter(ImageFilter.FIND_EDGES)).getdata())


def drift_rows(plate, video, pre=None):
    """逐幀量構圖位移，回傳 [(秒, 位移)]。"""
    from PIL import Image
    w, h = Image.open(plate).size
    small = (128, max(1, round(128 * h / w)))
    ref = edges(plate, small)
    rows = []
    vf = f"fps=1/{SAMPLE}" if not pre else f"{pre},fps=1/{SAMPLE}"
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["ffmpeg", "-v", "error", "-i", str(video),
                        "-vf", vf, f"{tmp}/%04d.png"], check=True)
        for i, f in enumerate(sorted(Path(tmp).glob("*.png"))):
            cur = edges(f, small)
            rows.append((i * SAMPLE, sum(abs(a - b) for a, b in zip(ref, cur)) / len(ref)))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("id", type=int)
    ap.add_argument("--video", required=True)
    ap.add_argument("--fade", type=float, default=0.6)
    ap.add_argument("--check-only", action="store_true")
    a = ap.parse_args()

    from PIL import Image
    plate = ROOT / "assets" / "plate" / f"{a.id:02d}.jpg"
    pw, ph = Image.open(plate).size
    mp = ROOT / "data" / "motion.json"
    data = json.loads(mp.read_text(encoding="utf-8"))
    clip = next((c for c in data["clips"] if c["id"] == a.id), None)
    assert clip, f"data/motion.json 裡沒有 no.{a.id}——⛔ 先把模型、日期、prompt 記上去再跑"
    for must in ("model", "date", "prompt"):
        assert clip.get(must) and "（填）" not in str(clip[must]), f"clips 裡的 {must} 還沒填"
    kind = clip.get("kind", "atmosphere")
    assert kind in ("atmosphere", "reinterpretation"), f"kind 只能是 atmosphere 或 reinterpretation：{kind}"

    src = Path(a.video)
    assert src.exists(), f"找不到影片：{src}"
    vw, vh, dur = probe(src)
    pre, box = crop_of(data, a.id, vw)
    if pre:
        print(f"⚠️ 這支是 16:9 墊過的來源 ⇒ 照 _pad 切回 {box[0]}×{box[1]}（{pre}）")
        vw, vh = box
    print(f"來源 {src}　{vw}×{vh}　{dur:.1f}s｜原畫 {pw}×{ph}")
    # 🔴 長寬比對不上＝構圖被裁過，而**構圖不是它能動的東西**（切回來之後仍要對得上）
    assert abs(vw / vh - pw / ph) / (pw / ph) < 0.02, \
        f"⛔ 長寬比對不上（{vw}×{vh} vs {pw}×{ph}）——構圖被裁過，不收"

    rows = drift_rows(plate, src, pre)
    worst = max(rows, key=lambda r: r[1])
    mean = sum(d for _, d in rows) / len(rows)
    print("\n構圖位移（0 ＝ 完全沒動；只動光約 6；構圖動了 19 以上）：")
    for t, d in rows:
        mark = "" if d < WARN else ("  ⚠️ 這一格有東西動了" if d < STOP else "  🔴 超過 atmosphere 的上限")
        print(f"  {t:5.1f}s  {d:5.1f}{mark}")
    print(f"\n最大 {worst[1]:.1f}（第 {worst[0]:.1f} 秒）・平均 {mean:.1f}")

    if kind == "atmosphere":
        assert worst[1] < STOP, (
            f"⛔ 最大位移 {worst[1]:.1f} ≥ {STOP}：模型動到的不只是光。⇒ 要嘛重新生成，"
            f"要嘛把 kind 改成 reinterpretation 並把差異逐條寫進 differs——"
            "⛔ 不要放寬這個數字，也不要剪掉不好看的那幾秒假裝它沒重畫。")
    else:
        # 🔴 reinterpretation ＝ 我們承認它重畫了 ⇒ **差異要說得出來**，而且說給玩家聽。
        d = clip.get("differs") or []
        assert len(d) >= 1 and all(isinstance(x, str) and x.strip() for x in d), \
            "kind=reinterpretation ⇒ differs 必須逐條寫出模型改了什麼（玩家面板會印出來）"
        print("\n🔴 這支宣告為 reinterpretation（照原畫重畫的另一件作品），不擋。"
              "\n   面板上會印出來的差異：")
        for x in d:
            print(f"     ・{x}")

    # 量到的數字寫回出處：⚠️ 之後有人問「它改了多少」，答案要在檔案裡，不是在某次終端機輸出裡
    clip["drift"] = {"max": round(worst[1], 1), "at": round(worst[0], 1), "mean": round(mean, 1),
                     "over_16": [round(t, 1) for t, v in rows if v >= STOP],
                     "_": f"每 {SAMPLE}s 一格，跟原畫比邊的位置。只動光約 6，構圖動了 19 以上。"}
    if not a.check_only:
        mp.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    if a.check_only:
        print("\n（--check-only：沒有輸出檔案）")
        return

    OUT.mkdir(parents=True, exist_ok=True)
    f = a.fade
    head = f"{pre}," if pre else ""
    vf = (f"[0:v]{head}scale={WIDTH}:-2,fps={FPS},split[body][pre];"
          f"[pre]trim=duration={f},format=yuva420p,fade=d={f}:alpha=1,setpts=PTS+({dur}-{f})/TB[tail];"
          f"[body]trim=start={f},setpts=PTS-STARTPTS[main];[main][tail]overlay,format=yuv420p[v]")
    for enc, out in (
        (["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "36"], OUT / f"{a.id:02d}.webm"),
        (["-c:v", "libx264", "-crf", "27", "-pix_fmt", "yuv420p"], OUT / f"{a.id:02d}.mp4"),
    ):
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src),
                        "-filter_complex", vf, "-map", "[v]", "-an", *enc, str(out)], check=True)
        print(f"  → {out.relative_to(ROOT)}　{out.stat().st_size / 1e6:.2f}MB")
    print("\n⛔ 最後一關是眼睛：循環接得順不順、有沒有多出東西、木版的味道還在不在")


if __name__ == "__main__":
    main()
