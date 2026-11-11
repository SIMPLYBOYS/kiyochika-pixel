#!/usr/bin/env python3
"""AI 重繪版「鎖回原畫」：沒在動的地方換回原畫的像素，只有真的在動的區域留模型畫的。

為什麼：img2video 每一幀都整張重畫，所以**沒在動的地方也會跟原畫不一樣**——紙邊的字形被改、
招牌的字糊掉、遠景的窗多一格。那些差異不是演出，只是重畫的副作用，而原畫的像素我們手上就有。

怎麼判「沒在動」：每個像素看它在整支片子裡的明度起伏（時間上的標準差）。起伏小＝模型只是把它
重畫了一遍、沒讓它動 ⇒ 換回原畫；起伏大＝真的有東西在動 ⇒ 留模型的。邊界羽化，免得出現一刀切的縫。

🔑 **色調偏掉的先校色再鎖**。模型有時把整幅調藍、調亮；直接鎖回，換回原畫的地方跟旁邊模型畫的
   色調接不起來，變成一塊一塊的補丁（no.68：一塊褐一塊藍）。⇒ 拿靜止區當參考，求一組「片子的顏色
   → 原畫的顏色」的整幅線性對應（RGB 仿射，12 個數字），套在每一格上，再鎖回。
   · 只在靜止區離原畫超過 MAX_TONE 時才校：色調本來就對的片子，⛔ 不去動模型的顏色。
   · 回報的數字是**沒拿來擬合的那一半**靜止區（棋盤格對半分），不是自己驗自己。
   · 2026-11 試過四種校法（no.68）：線性 14.8→3.8、二次式 3.6、低頻校正場 5.8、二次式＋低頻場 3.3
     ⇒ 最簡單的線性就拿到絕大部分，其餘不值得多出來的複雜度。
   ⚠️ 它假設整支片子偏的方向一樣：色調隨時間變的（no.03 天色從青綠轉粉紅）、只有局部被改色的，校不回來。

🔴 這一支**只量、只出預覽**，⛔ 不動 assets/motion、不改 data/motion.json：
   · 鎖回之後好不好看只有眼睛知道（動的東西邊上會不會有殘影、色調接不接得起來），
     ⇒ 預覽與對照格圖出在 research/motion/lock/（不進 git、不上線），看過再決定收哪幾支。
   · 收了之後它仍然是 kind=reinterpretation，面板照樣掛「AI 重繪・非原作」；differs 要人重看一遍
     （講紙邊字形、靜止處細節、整幅色調的那幾條會變成不成立），並補一句「靜止的部分是原畫的像素」。
     ⛔ 不可以因為它看起來更像原畫就改掛 atmosphere——動的部分仍是模型畫的。

🔴 浮水印**留著**：生成模型在右下角蓋的那顆四角星，作者記過「不修掉，它正好提醒這不是清親的作品」
   （見各支的 differs）。它不會動，照上面的規則會被原畫蓋掉 ⇒ 那一塊明確排除在鎖回之外。

⚠️ 整幅都在動的（雨、雪、鏡頭在滑）幾乎沒有靜止區可鎖，--survey 會標出來。
   鎖回幫不上忙；要不要重生是另一個決定（整幅是雨的那種，本來就該整幅在動）。

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


def load(data, clip, src=None):
    """→ (來源片路徑, 切回原框的濾鏡, 逐格畫面 [T,h,W,3], 原畫 [h,W,3], 浮水印在 W 尺度的框或 None)"""
    vid = clip["id"]
    src = Path(src) if src else ROOT / re.split(r"[（(\s]", clip.get("source", ""))[0]
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


def tone_fix(mean, P, still):
    """整幅線性校色：靜止區裡 原畫 ≈ 片子 · Aᵀ + b。→ (A, b, 驗證那一半校色後離原畫多遠) 或 None"""
    yy, xx = np.mgrid[:still.shape[0], :still.shape[1]]
    half = ((yy // 24) + (xx // 24)) % 2 == 0               # 棋盤格：一半擬合、一半只拿來驗
    fit, val = still & half, still & ~half
    if fit.sum() < 500 or val.sum() < 500:
        return None
    X = np.concatenate([mean[fit], np.ones((int(fit.sum()), 1), np.float32)], 1)
    coef = np.linalg.lstsq(X, P[fit], rcond=None)[0]        # [4,3]：前三列是矩陣，最後一列是位移
    A, b = coef[:3].T, coef[3]
    return A, b, float(np.abs(luma(mean @ A.T + b) - luma(P))[val].mean())


def measure(F, P, wm):
    """→ (遮罩 [h,W] 0–1：1＝留模型的, 數字, 校色 (A,b) 或 None)"""
    sd = luma(F).std(0)
    moving = (sd > THR)
    if wm:
        moving[wm[1]:wm[3], wm[0]:wm[2]] = True                 # 浮水印不鎖
    m = Image.fromarray((moving * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(GROW)) \
             .filter(ImageFilter.GaussianBlur(FEATHER))
    M = np.asarray(m, np.float32) / 255
    still = M < 0.05
    mean = F.mean(0)
    tone = float(np.abs(luma(mean) - luma(P))[still].mean()) if still.any() else float("nan")
    # 色調偏了才校；校了沒比較好就不校（⛔ 不為了校而校）
    fix, tone_fixed = None, None
    if tone > MAX_TONE:
        got = tone_fix(mean, P, still)
        if got and got[2] < tone:
            fix, tone_fixed = (got[0], got[1]), got[2]
    G = F if fix is None else np.clip(F @ fix[0].T + fix[1], 0, 255)
    before = np.abs(luma(F) - luma(P)).mean()
    after = np.abs(luma(P[None] * (1 - M[None, ..., None]) + G * M[None, ..., None]) - luma(P)).mean()
    return M, {"still": float(still.mean()), "tone": tone, "tone_fixed": tone_fixed,
               "before": float(before), "after": float(after)}, fix


def advice(n):
    # ⚠️ 這裡只說「鎖回有沒有用」，⛔ 不說「該不該重生」：整幅在動可能正是那幅畫該有的樣子
    #（no.50 御厩橋雷雨整幅是雨），那是作者看過片子之後的決定。
    if n["still"] < MIN_STILL:
        return "整幅在動，鎖了沒用"
    if n["tone"] <= MAX_TONE:
        return "可鎖 ⇒ 出預覽看"
    if n["tone_fixed"] is not None and n["tone_fixed"] <= MAX_TONE:
        return "校色後可鎖 ⇒ 出預覽看"
    return "校色後色調仍偏，鎖了可能變補丁（看預覽再定）"


def render(src, pre, vid, M, fix, out, crf=20):
    """來源片逐格讀進來，在這裡校色、照遮罩疊在原畫上，再交給 ffmpeg 編碼。→ 格數

    🔴 不用 ffmpeg 的濾鏡圖做這件事：第一版用 -loop 1 的原畫＋maskedmerge，無限長的輸入讓它播完也不停
    （-shortest 在那裡不管用），編了十分鐘寫出 36MB。逐格在這裡算，長度就是來源片的長度，沒有別的可能。
    ⛔ 這裡不做無縫循環也不壓成上線的規格——那是 make-motion.py 的事（它拿這支的輸出當來源）。"""
    tint = (lambda a: a) if fix is None else (lambda a: np.clip(a @ fix[0].T + fix[1], 0, 255))
    h, w = M.shape
    size = (mm.WIDTH, round(mm.WIDTH * h / w) // 2 * 2)
    Pb = np.asarray(Image.open(ROOT / "assets" / "plate" / f"{vid:02d}.jpg").convert("RGB")
                    .resize(size, Image.LANCZOS), np.float32)
    Mb = np.asarray(Image.fromarray((M * 255).astype(np.uint8)).resize(size, Image.BILINEAR), np.float32)[..., None] / 255
    dec = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(src), "-vf",
                            f"{pre + ',' if pre else ''}scale={size[0]}:{size[1]},fps={mm.FPS}",
                            "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    enc = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
                            "-s", f"{size[0]}x{size[1]}", "-r", str(mm.FPS), "-i", "-", "-an",
                            "-c:v", "libx264", "-crf", str(crf), "-pix_fmt", "yuv420p", str(out)], stdin=subprocess.PIPE)
    nbytes, frames = size[0] * size[1] * 3, 0
    while len(buf := dec.stdout.read(nbytes)) == nbytes:
        f = tint(np.frombuffer(buf, np.uint8).reshape(size[1], size[0], 3).astype(np.float32))
        enc.stdin.write((Pb * (1 - Mb) + f * Mb + .5).astype(np.uint8).tobytes())
        frames += 1
    enc.stdin.close()
    assert dec.wait() == 0 and enc.wait() == 0 and frames > 0, f"no.{vid} 沒編成功"
    return frames


def lock_for(data, clip, out, src=None, crf=10):
    """make-motion.py --lock 走這裡：量、（需要的話）校色、鎖回，寫出一支中間檔給它接著做循環與壓縮。
    → 要記進 data/motion.json 的那一筆（出處＝可重現：門檻、佔比、校色用的 12 個數字都在）。"""
    import datetime
    got = load(data, clip, src)
    assert got, f"no.{clip['id']} 的來源片不在 research/motion/，鎖不了"
    src, pre, F, P, wm = got
    M, n, fix = measure(F, P, wm)
    frames = render(src, pre, clip["id"], M, fix, out, crf)
    return {"date": datetime.date.today().isoformat(), "still": round(n["still"], 3),
            "tone": round(n["tone"], 1), "tone_fixed": None if fix is None else round(n["tone_fixed"], 1),
            "colour": None if fix is None else {"A": [[round(float(v), 4) for v in r] for r in fix[0]],
                                                "b": [round(float(v), 2) for v in fix[1]]},
            "before": round(n["before"], 1), "after": round(n["after"], 1), "thr": THR, "frames": frames,
            "_": "沒在動的地方換回原畫的像素（tools/motion-lock.py）。still＝靜止區佔畫面的比例；"
                 "tone＝靜止區離原畫的灰階差，tone_fixed＝校色後（用沒拿來擬合的那一半驗）；"
                 "colour＝校色用的 RGB 仿射（原畫 ≈ 片子·Aᵀ＋b），null＝色調本來就對、沒校；"
                 "before→after＝全幅離原畫的灰階差；thr＝判定在動的門檻。浮水印那一塊不鎖。⛔ 不要手改"}


def preview(data, clip):
    got = load(data, clip)
    if not got:
        print(f"no.{clip['id']:02d}  來源片不在 research/motion/，略過")
        return
    src, pre, F, P, wm = got
    M, n, fix = measure(F, P, wm)
    tint = (lambda a: a) if fix is None else (lambda a: np.clip(a @ fix[0].T + fix[1], 0, 255))
    vid, h = clip["id"], P.shape[0]
    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray((M * 255).astype(np.uint8)).save(OUT / f"{vid:02d}-mask.png")
    # 對照格圖：三個時間點 ×（模型的｜鎖回的），最右一欄是遮罩（白＝留模型的）與原畫
    ts = [len(F) // 5, len(F) // 2, len(F) * 9 // 10]
    sheet = Image.new("RGB", (W * 3, h * len(ts)), "#101d29")
    for r, t in enumerate(ts):
        lock = P * (1 - M[..., None]) + tint(F[t]) * M[..., None]
        extra = np.repeat(M[..., None], 3, 2) * 255 if r == 0 else P
        for c, a in enumerate((F[t], lock, extra)):
            sheet.paste(Image.fromarray(a.clip(0, 255).astype(np.uint8)), (c * W, r * h))
    sheet.save(OUT / f"{vid:02d}-sheet.jpg", quality=88)
    out = OUT / f"{vid:02d}.mp4"
    frames = render(src, pre, vid, M, fix, out)
    tone = f"{n['tone']:4.1f}" + (f" → 校色後 {n['tone_fixed']:.1f}" if fix else "")
    print(f"no.{vid:02d}  靜止區 {n['still'] * 100:4.1f}%｜靜止區離原畫 {tone}｜全幅離原畫 {n['before']:4.1f} → {n['after']:4.1f}"
          f"｜{advice(n)}\n        → {out.relative_to(ROOT)}（{frames} 格）・{(OUT / f'{vid:02d}-sheet.jpg').relative_to(ROOT)}")
    if fix:                    # 出處＝可重現：校色用的那 12 個數字印出來（收進去時要記進 motion.json）
        print("        校色 A＝" + "；".join(" ".join(f"{v:+.3f}" for v in row) for row in fix[0])
              + "　b＝" + " ".join(f"{v:+.1f}" for v in fix[1]))


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
    print("編號  靜止區  靜止區離原畫(→校色後)  全幅離原畫(鎖前→鎖後)  模板   建議")
    for clip, n in rows:
        fam = "vivid" if "vivid" in (clip.get("template") or "") or clip.get("prompt", "").startswith("Bring") \
            else "close" if "close" in (clip.get("template") or "") else "忠實"
        if not n:
            print(f"no.{clip['id']:02d}  —  來源片不在 research/motion/（{fam}）")
            continue
        tone = f"{n['tone']:5.1f}" + (f" → {n['tone_fixed']:4.1f}" if n["tone_fixed"] is not None else "       ")
        print(f"no.{clip['id']:02d}  {n['still'] * 100:5.1f}%  {tone}        {n['before']:6.1f} → {n['after']:4.1f}"
              f"           {fam:5s}  {advice(n)}")
    for label, key in (("可鎖", "可鎖"), ("校色後可鎖", "校色後可鎖"), ("校色後仍偏", "校色後色調仍偏")):
        ids = sorted(c["id"] for c, n in rows if n and advice(n).startswith(key))
        print(f"{label} {len(ids)} 支：{' '.join(map(str, ids))}")


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
