#!/usr/bin/env python3
"""AI 重繪版「鎖回原畫」：沒在動的地方換回原畫的像素，只有真的在動的區域留模型畫的。

為什麼：img2video 每一幀都整張重畫，所以**沒在動的地方也會跟原畫不一樣**——紙邊的字形被改、
招牌的字糊掉、遠景的窗多一格。那些差異不是演出，只是重畫的副作用，而原畫的像素我們手上就有。

怎麼判「沒在動」：每個像素看它在整支片子裡的明度起伏（時間上的標準差）。起伏小＝模型只是把它
重畫了一遍、沒讓它動 ⇒ 換回原畫；起伏大＝真的有東西在動 ⇒ 留模型的。邊界羽化，免得出現一刀切的縫。

🔴 這一支**只量、只出預覽**，⛔ 不動 assets/motion、不改 data/motion.json：
   · 鎖回之後好不好看只有眼睛知道（動的東西邊上會不會有殘影、色調接不接得起來），
     ⇒ 預覽與對照格圖出在 research/motion/lock/（不進 git、不上線），看過再決定收哪幾支。
   · 收了之後它仍然是 kind=reinterpretation，面板照樣掛「AI 重繪・非原作」；differs 要人重看一遍
     （講紙邊字形、靜止處細節的那幾條會變成不成立），並補一句「靜止的部分是原畫的像素」。
     ⛔ 不可以因為它看起來更像原畫就改掛 atmosphere——動的部分仍是模型畫的。

🔴 浮水印**留著**：生成模型在右下角蓋的那顆四角星，作者記過「不修掉，它正好提醒這不是清親的作品」
   （見各支的 differs）。它不會動，照上面的規則會被原畫蓋掉 ⇒ 那一塊明確排除在鎖回之外。

⚠️ 兩種片子鎖了沒用，--survey 會標出來：
   · 整幅都在動的（雨、雪、鏡頭在滑）——幾乎沒有靜止區可鎖；
   · 整幅被重新上色的——靜止區換回原畫之後，跟旁邊模型畫的色調接不起來，會變成補丁。
   這兩種鎖回幫不上忙；要不要重生是另一個決定（整幅是雨的那種，本來就該整幅在動）。

用法：
  python3 tools/motion-lock.py --survey          # 量每一支：靜止區佔多少、靜止區離原畫多遠、建議
  python3 tools/motion-lock.py 10 72             # 出這幾支的預覽與對照格圖 → research/motion/lock/
"""
import argparse, importlib.util, json, re, subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "research" / "motion" / "lock"
W = 480                       # 量測用的寬度（同像素版）；遮罩在這個尺度算，再放大
THR = 6                       # 明度的時間標準差超過這個數＝在動。壓縮雜訊與紙紋的「沸騰」約 2–4
GROW, FEATHER = 9, 4          # 動的區域往外長幾格、再羽化幾格（W=480 的尺度）
# 建議門檻：來自 2026-11 第一次試算的七支（靜止區 41–77% 的三支鎖回後離原畫 6→3，8–18% 的四支幾乎沒差）。
# ⚠️ 這是「建議看哪幾支」，不是關卡——收不收是看過預覽之後作者的決定。
MIN_STILL, MAX_TONE = 0.40, 6.0
# 浮水印在來源片（1280×720）裡的位置：2026-11 拿 59 支來源片疊起來量的，六成以上的片子在
# x 1136–1183、y 576–623 都比原畫亮（那顆四角星）。往外留 8px。
WM_SRC, WM_BOX = (1280, 720), (1128, 568, 1192, 632)

_mm = importlib.util.spec_from_file_location("make_motion", ROOT / "tools" / "make-motion.py")
mm = importlib.util.module_from_spec(_mm); _mm.loader.exec_module(mm)      # crop_of／probe 用同一份


def luma(a):
    return a @ np.array([.2126, .7152, .0722], np.float32)


def load(data, clip):
    """→ (來源片路徑, 切回原框的濾鏡, 逐格畫面 [T,h,W,3], 原畫 [h,W,3], 浮水印在 W 尺度的框或 None)"""
    vid = clip["id"]
    src = ROOT / re.split(r"[（(\s]", clip.get("source", ""))[0]
    if not src.is_file():
        return None
    vw, vh, _ = mm.probe(src)
    pre, _ = mm.crop_of(data, vid, vw)
    plate = Image.open(ROOT / "assets" / "plate" / f"{vid:02d}.jpg").convert("RGB")
    h = round(W * plate.height / plate.width) // 2 * 2
    vf = f"{pre + ',' if pre else ''}fps=6,scale={W}:{h}"
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(src), "-vf", vf,
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    F = np.frombuffer(raw, np.uint8).reshape(-1, h, W, 3).astype(np.float32)
    P = np.asarray(plate.resize((W, h), Image.LANCZOS), np.float32)
    # 浮水印的框：來源片座標 → 切回原框之後的座標 → W 尺度
    wm = None
    pad = (data.get("_pad") or {}).get(str(vid))
    if pad:
        k = vw / pad["canvas"][0]
        x0, y0 = pad["plate_at"][0] * k, pad["plate_at"][1] * k
        s = W / (pad["plate_size"][0] * k)
        sx, sy = vw / WM_SRC[0], vh / WM_SRC[1]
        b = [(WM_BOX[0] * sx - x0) * s, (WM_BOX[1] * sy - y0) * s, (WM_BOX[2] * sx - x0) * s, (WM_BOX[3] * sy - y0) * s]
        b = [int(max(0, min(lim, round(v)))) for v, lim in zip(b, (W, h, W, h))]
        if b[2] > b[0] and b[3] > b[1]:
            wm = b
    return src, pre, F, P, wm


def measure(F, P, wm):
    """→ (遮罩 [h,W] 0–1：1＝留模型的, 數字)"""
    sd = luma(F).std(0)
    moving = (sd > THR)
    if wm:
        moving[wm[1]:wm[3], wm[0]:wm[2]] = True                 # 浮水印不鎖
    m = Image.fromarray((moving * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(GROW)) \
             .filter(ImageFilter.GaussianBlur(FEATHER))
    M = np.asarray(m, np.float32) / 255
    still = M < 0.05
    mean = F.mean(0)
    before = np.abs(luma(F) - luma(P)).mean()
    locked = P[None] * (1 - M[None, ..., None]) + F * M[None, ..., None]
    after = np.abs(luma(locked) - luma(P)).mean()
    tone = float(np.abs(luma(mean) - luma(P))[still].mean()) if still.any() else float("nan")
    shift = (mean - P)[still].mean(0) if still.any() else np.zeros(3)      # 靜止區整體偏了多少（R,G,B）
    return M, {"still": float(still.mean()), "tone": tone, "before": float(before), "after": float(after),
               "shift": [round(float(v), 1) for v in shift]}


def advice(n):
    # ⚠️ 這裡只說「鎖回有沒有用」，⛔ 不說「該不該重生」：整幅在動可能正是那幅畫該有的樣子
    #（no.50 御厩橋雷雨整幅是雨），那是作者看過片子之後的決定。
    if n["still"] < MIN_STILL:
        return "整幅在動，鎖了沒用"
    if n["tone"] > MAX_TONE:
        return "靜止區色調偏了，鎖了可能變補丁（看預覽再定）"
    return "可鎖 ⇒ 出預覽看"


def preview(data, clip):
    got = load(data, clip)
    if not got:
        print(f"no.{clip['id']:02d}  來源片不在 research/motion/，略過")
        return
    src, pre, F, P, wm = got
    M, n = measure(F, P, wm)
    vid, h = clip["id"], P.shape[0]
    OUT.mkdir(parents=True, exist_ok=True)
    mask = OUT / f"{vid:02d}-mask.png"
    Image.fromarray((M * 255).astype(np.uint8)).save(mask)
    # 對照格圖：三個時間點 ×（模型的｜鎖回的），最右一欄是遮罩（白＝留模型的）與原畫
    ts = [len(F) // 5, len(F) // 2, len(F) * 9 // 10]
    sheet = Image.new("RGB", (W * 3, h * len(ts)), "#101d29")
    for r, t in enumerate(ts):
        lock = P * (1 - M[..., None]) + F[t] * M[..., None]
        extra = np.repeat(M[..., None], 3, 2) * 255 if r == 0 else P
        for c, a in enumerate((F[t], lock, extra)):
            sheet.paste(Image.fromarray(a.clip(0, 255).astype(np.uint8)), (c * W, r * h))
    sheet.save(OUT / f"{vid:02d}-sheet.jpg", quality=88)
    # 成片預覽：原畫當底、來源片照遮罩蓋上去。⛔ 這裡不做無縫循環也不壓成上線的規格——那是 make-motion.py 的事。
    H = round(mm.WIDTH * h / W) // 2 * 2
    fit = f"scale={mm.WIDTH}:{H},format=gbrp"
    out = OUT / f"{vid:02d}.mp4"
    # 🔴 長度一定要用 -t 寫死：原畫與遮罩是 -loop 1 的無限長輸入，maskedmerge 不會因為影片播完就停，
    # -shortest 在這裡也不管用（只有一條輸出）——第一次跑就這樣編了十分鐘、寫出 36MB 還沒停。
    dur = mm.probe(src)[2]
    loop = ["-framerate", str(mm.FPS), "-loop", "1"]
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(src),
                    *loop, "-i", str(ROOT / "assets" / "plate" / f"{vid:02d}.jpg"),
                    *loop, "-i", str(mask), "-filter_complex",
                    f"[0:v]{pre + ',' if pre else ''}{fit},fps={mm.FPS}[v];[1:v]{fit}[p];[2:v]{fit}[m];"
                    "[p][v][m]maskedmerge,format=yuv420p[o]",
                    "-map", "[o]", "-t", f"{dur:.3f}", "-an", "-c:v", "libx264", "-crf", "20", str(out)],
                   check=True, timeout=180)
    print(f"no.{vid:02d}  靜止區 {n['still'] * 100:4.1f}%｜靜止區離原畫 {n['tone']:4.1f}｜全幅離原畫 {n['before']:4.1f} → {n['after']:4.1f}"
          f"｜{advice(n)}\n        → {out.relative_to(ROOT)}・{(OUT / f'{vid:02d}-sheet.jpg').relative_to(ROOT)}")


def survey(data):
    rows = []
    for clip in data["clips"]:
        got = load(data, clip)
        if not got:
            rows.append((clip, None))
            continue
        _, _, F, P, wm = got
        rows.append((clip, measure(F, P, wm)[1]))
    rows.sort(key=lambda r: -(r[1]["still"] if r[1] else -1))
    print("編號  靜止區  靜止區離原畫  全幅離原畫(鎖前→鎖後)  模板   建議")
    for clip, n in rows:
        fam = "vivid" if "vivid" in (clip.get("template") or "") or clip.get("prompt", "").startswith("Bring") \
            else "close" if "close" in (clip.get("template") or "") else "忠實"
        if not n:
            print(f"no.{clip['id']:02d}  —  來源片不在 research/motion/（{fam}）")
            continue
        print(f"no.{clip['id']:02d}  {n['still'] * 100:5.1f}%  {n['tone']:8.1f}      {n['before']:6.1f} → {n['after']:4.1f}"
              f"           {fam:5s}  {advice(n)}")
    ok = [c["id"] for c, n in rows if n and advice(n).startswith("可鎖")]
    print(f"\n可鎖 {len(ok)} 支：{' '.join(map(str, sorted(ok)))}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", type=int, nargs="*")
    ap.add_argument("--survey", action="store_true")
    a = ap.parse_args()
    data = json.loads((ROOT / "data" / "motion.json").read_text(encoding="utf-8"))
    if a.survey:
        return survey(data)
    if not a.ids:
        ap.error("給編號（出預覽），或用 --survey 量全部")
    by = {c["id"]: c for c in data["clips"]}
    for i in a.ids:
        assert i in by, f"data/motion.json 裡沒有 no.{i}"
        preview(data, by[i])


if __name__ == "__main__":
    main()
