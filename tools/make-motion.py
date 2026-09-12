#!/usr/bin/env python3
"""生成的動態版：影片 → assets/motion/NN.webm（＋ .mp4 後備）

🔴 **這是這個 repo 唯一一層生成出來的東西**，所以它的「出處」定義得比別層嚴：
模型、日期、prompt、來源圖全部記在 `data/motion.json`。**指不出這些就不該放進遊戲。**

🔑 而「只動氛圍、不動內容」這條規矩，**影片比靜幀難守得多——一秒 24 幀，
沒有人會逐幀看**。所以這支工具替人看：每 0.3 秒抽一格，跟原畫比「邊還在不在同一個
地方」（邊的位置＝構圖；光變了邊不該跑）。閾值拿**原畫自己**做過對照：

    只調亮 40% → 6.3 ／ 只降對比 30% → 5.7 ／ 整幅平移 12px → 19.0 ／ 左右鏡像 → 21.5

⇒「只動光」落在 6 上下，「構圖動了」跳到 19 以上。超過 12 的幀列出來，
超過 16 直接擋掉——⛔ 那已經不是打光，是模型在替清親重畫。

無縫循環：把開頭 fade 秒淡入疊到結尾（Veo 那類影片不會自己接得起來）。

用法：
  python3 tools/make-motion.py 50 --video research/motion/50-veo.mp4
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


def edges(img, size):
    from PIL import Image, ImageFilter, ImageOps
    im = Image.open(img).convert("L").resize(size)
    return list(ImageOps.autocontrast(im.filter(ImageFilter.FIND_EDGES)).getdata())


def drift_rows(plate, video):
    """逐幀量構圖位移，回傳 [(秒, 位移)]。"""
    from PIL import Image
    w, h = Image.open(plate).size
    small = (128, max(1, round(128 * h / w)))
    ref = edges(plate, small)
    rows = []
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["ffmpeg", "-v", "error", "-i", str(video),
                        "-vf", f"fps=1/{SAMPLE}", f"{tmp}/%04d.png"], check=True)
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
    data = json.loads((ROOT / "data" / "motion.json").read_text(encoding="utf-8"))
    clip = next((c for c in data["clips"] if c["id"] == a.id), None)
    assert clip, f"data/motion.json 裡沒有 no.{a.id}——⛔ 先把模型、日期、prompt 記上去再跑"
    for must in ("model", "date", "prompt"):
        assert clip.get(must) and "（填）" not in str(clip[must]), f"clips 裡的 {must} 還沒填"

    src = Path(a.video)
    assert src.exists(), f"找不到影片：{src}"
    vw, vh, dur = probe(src)
    print(f"來源 {src}　{vw}×{vh}　{dur:.1f}s｜原畫 {pw}×{ph}")
    # 🔴 長寬比對不上＝模型重新裁過構圖，而**構圖不是它能動的東西**
    assert abs(vw / vh - pw / ph) / (pw / ph) < 0.02, \
        f"⛔ 長寬比對不上（{vw}×{vh} vs {pw}×{ph}）——模型重新裁過構圖，不收"

    rows = drift_rows(plate, src)
    worst = max(rows, key=lambda r: r[1])
    print("\n構圖位移（0 ＝ 完全沒動；只動光約 6；構圖動了 19 以上）：")
    for t, d in rows:
        mark = "" if d < WARN else ("  ⚠️ 這一格有東西動了" if d < STOP else "  🔴 超過上限")
        print(f"  {t:5.1f}s  {d:5.1f}{mark}")
    print(f"\n最大 {worst[1]:.1f}（第 {worst[0]:.1f} 秒）・平均 {sum(d for _, d in rows) / len(rows):.1f}")
    assert worst[1] < STOP, (
        f"⛔ 最大位移 {worst[1]:.1f} ≥ {STOP}：模型動到的不只是光。"
        "⇒ 重新生成（提示詞要寫明不得改變任何物件的位置與形狀），⛔ 不要放寬這個數字。")
    if a.check_only:
        print("\n（--check-only：沒有輸出檔案）")
        return

    OUT.mkdir(parents=True, exist_ok=True)
    f = a.fade
    vf = (f"[0:v]scale={WIDTH}:-2,fps={FPS},split[body][pre];"
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
