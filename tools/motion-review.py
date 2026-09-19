#!/usr/bin/env python3
"""
生成片的初審（上架前、還沒寫進 data/motion.json 時用；寫進去之後由 make-motion.py 量正式的邊緣位移）。

  python3 tools/motion-review.py research/motion/p26.mp4 26

印三個數字，並把 3×3 格圖存到 research/motion/review/（不進 git）給人看：
  · 第一幀 vs 墊邊圖（灰階差）：< 10 才是從原畫開始的（同 make-motion 的 FIRST）
  · 每 0.5 秒的灰階差曲線：中途突然跳 10 以上＝換場景／切鏡頭；一路線性爬升＝鏡頭在推近（no.22）
  · 首尾推近倍率：最後一格最像第一格放大幾 %（> 104% 就是推近）
⚠️ 灰階差跟 make-motion 的邊緣位移是兩把不同的尺，數字不能互相比較（no.18 的教訓）。
"""
import json, subprocess, sys, tempfile
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
src, vid = Path(sys.argv[1]), int(sys.argv[2])
out = ROOT / "research/motion/review"; out.mkdir(parents=True, exist_ok=True)
pad = Image.open(ROOT / json.loads((ROOT / "data/motion.json").read_text())["_pad"][str(vid)]["file"]).convert("RGB")


def diff(a, b, size=(128, 72)):
    a, b = a.convert("L").resize(size), b.convert("L").resize(size)
    return sum(abs(x - y) for x, y in zip(a.tobytes(), b.tobytes())) / (size[0] * size[1])


ts = [x * 0.5 for x in range(20)] + [9.9]
with tempfile.TemporaryDirectory() as tmp:
    fr = {}
    for t in ts:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(t), "-i", str(src), "-frames:v", "1", f"{tmp}/{t}.png"], check=True)
        fr[t] = Image.open(f"{tmp}/{t}.png").convert("RGB")
curve = [diff(pad, fr[t]) for t in ts]
first, last = fr[0], fr[9.9]
W, H = first.size


def zoomed(s, dx):
    w, h = int(W * s), int(H * s)
    x0, y0 = (w - W) // 2 - dx, (h - H) // 2
    return first.resize((w, h)).crop((x0, y0, x0 + W, y0 + H))


zoom = min((diff(zoomed(s / 100, dx), last, (256, 144)), s, dx) for s in range(100, 116, 2) for dx in range(-48, 49, 16))
jumps = [ts[k] for k in range(1, len(ts)) if curve[k] - curve[k - 1] > 10]
print(f"no.{vid} 第一幀 {curve[0]:.1f} {'✅' if curve[0] < 10 else '⛔ 不是從原畫開始'}")
print("  曲線 " + " ".join(f"{d:.0f}" for d in curve) + (f"　⚠️ {jumps[0]}s 跳動（換場景？）" if jumps else ""))
print(f"  首尾：不縮放差 {diff(first, last, (256, 144)):.1f}；最像第一格放大 {zoom[1]}%（差 {zoom[0]:.1f}）"
      + ("　⚠️ 推近" if zoom[1] > 104 and not jumps and zoom[0] < diff(first, last, (256, 144)) - 3 else "")
      + ("（換場景時倍率沒有意義）" if jumps else ""))
g = Image.new("RGB", (640 * 3, 360 * 3))
for n, t in enumerate([0, 1, 2, 3, 4, 5, 6, 7, 9.9]):
    g.paste(fr[t].resize((640, 360)), ((n % 3) * 640, (n // 3) * 360))
g.save(out / f"{src.stem}-grid.jpg", quality=85)
print(f"  格圖（0,1,2 / 3,4,5 / 6,7,9.9 秒）：{(out / f'{src.stem}-grid.jpg').relative_to(ROOT)}")
