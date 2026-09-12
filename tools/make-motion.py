#!/usr/bin/env python3
"""生成的動態版：關鍵幀 → assets/motion/NN.webm（＋ .mp4 後備）

🔴 **這是這個 repo 唯一一層生成出來的東西**，所以它的「出處」定義得比別層嚴：
模型、日期、prompt、來源圖、每一張關鍵幀的檔名，全部記在 `data/motion.json`。
**指不出這些就不該放進遊戲。**

做法刻意不是「丟給模型生一段影片」，而是：
  ① 原畫（assets/plate/NN.jpg）當第一張關鍵幀——⛔ 底一定是真跡，不是模型畫的
  ② 用影像模型只改**氛圍**（閃電亮度、雨、水光），產出 2–3 張同構圖的關鍵幀
  ③ 這支工具把它們交叉淡入淡出、組成無縫循環

🔑 這樣做的三個理由：
  · 構圖來自原畫，模型只碰光——⛔ 它沒有機會生出不存在的招牌、人或建築
  · 幀數少、可以逐張用眼睛看過再收——影片一秒 24 幀，沒有人會逐幀檢查
  · 輸出是**確定的**：同樣的關鍵幀跑這支工具，結果一樣（同色盤、同裁切那幾支）

用法：
  1. 關鍵幀放 research/motion/，命名 NN-1.png、NN-2.png…（NN＝景的編號，同尺寸）
  2. 在 data/motion.json 的 clips 加一筆（見該檔的 _rule 與欄位範例）
  3. python3 tools/make-motion.py 50
"""
import json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "research" / "motion"
OUT = ROOT / "assets" / "motion"
FPS = 24


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    vid = int(sys.argv[1])
    data = json.loads((ROOT / "data" / "motion.json").read_text(encoding="utf-8"))
    clip = next((c for c in data["clips"] if c["id"] == vid), None)
    assert clip, f"data/motion.json 裡沒有 no.{vid} 這一筆——⛔ 先把模型、日期、prompt 記上去再跑"

    frames = [SRC / f for f in clip["frames"]]
    missing = [f.name for f in frames if not f.exists()]
    assert not missing, f"缺關鍵幀：{missing}"
    assert len(frames) >= 2, "至少要兩張關鍵幀（一張就不叫動態）"

    plate = ROOT / "assets" / "plate" / f"{vid:02d}.jpg"
    from PIL import Image
    base = Image.open(plate).size
    bad = [f.name for f in frames if Image.open(f).size != base]
    # 🔴 尺寸必須跟原畫一樣：不一樣就表示模型重新裁過構圖，而**構圖不是它能動的東西**
    assert not bad, f"這幾張跟原畫尺寸對不上（模型重新裁過構圖）：{bad}　原畫 {base}"

    hold = clip.get("hold", 0.6)        # 每張停留幾秒
    fade = clip.get("fade", 0.5)        # 交叉淡入淡出幾秒
    OUT.mkdir(parents=True, exist_ok=True)

    # 用 ffmpeg 把關鍵幀串成交叉淡入的循環：… → 1 → 2 → … → 1（收尾接回第一張才無縫）
    seq = frames + [frames[0]]
    args = ["ffmpeg", "-y", "-loglevel", "error"]
    for f in seq:
        args += ["-loop", "1", "-t", str(hold + fade), "-i", str(f)]
    chain, prev, t = [], "0:v", 0.0
    for i in range(1, len(seq)):
        out = f"x{i}"
        chain.append(f"[{prev}][{i}:v]xfade=transition=fade:duration={fade}:offset={t + hold}[{out}]")
        prev, t = out, t + hold
    vf = ";".join(chain) + f";[{prev}]format=yuv420p,fps={FPS}[v]"
    webm = OUT / f"{vid:02d}.webm"
    subprocess.run(args + ["-filter_complex", vf, "-map", "[v]",
                           "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "34", "-an", str(webm)], check=True)
    # ⚠️ Safari 對 VP9/WebM 的支援看版本 ⇒ 再出一份 H.264（同配樂那次的理由：⛔ 不賭）
    mp4 = OUT / f"{vid:02d}.mp4"
    subprocess.run(args + ["-filter_complex", vf, "-map", "[v]",
                           "-c:v", "libx264", "-crf", "26", "-pix_fmt", "yuv420p", "-an", str(mp4)], check=True)

    for f in (webm, mp4):
        print(f"  → {f.relative_to(ROOT)}　{round(f.stat().st_size / 1e6, 2)}MB")
    print(f"\n{len(frames)} 張關鍵幀・每張停 {hold}s・交叉 {fade}s ＝ 一輪約 {len(frames) * hold + fade:.1f}s")
    print("⛔ 驗收用眼睛看：構圖有沒有被改、有沒有多出東西、循環接得順不順")


if __name__ == "__main__":
    main()
