#!/bin/bash
# 宣傳片：docs/promo/kiyochika-promo-9x16.mp4（1080×1920・39.6 秒）與 README 用的海報。
#
# 🔴 片子裡沒有一張示意圖：畫面是 tools/promo-shots.mjs 跑真的遊戲截的（手機直式版面），
# 原畫是 assets/plate、動態是 assets/motion 裡真的那一支，配樂是 assets/audio 裡的公有領域錄音。
# ⚠️ 片尾卡要把出處寫齊（NDL 公有領域・OSM ODbL・配樂年代・AI 重繪非原作）——⛔ 不能只放網址。
#
#   bash tools/make-promo.sh            # 全部重做
#
# 需要：playwright（截圖）、ffmpeg（組裝）。中間檔放 research/promo/（不進 git）。
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
P="$ROOT/research/promo"; SEG="$P/seg"; mkdir -p "$SEG"
OUT="$ROOT/docs/promo"; mkdir -p "$OUT"
FF="ffmpeg -hide_banner -loglevel error -y"
VIDEO="$OUT/kiyochika-promo-9x16.mp4"

node "$ROOT/tools/promo-shots.mjs" shots "$P"

# 靜態圖＋字幕：$1 圖 $2 秒 $3 字幕png（可空）$4 輸出 $5 放大倍率 $6 pan(h|v|none)
# ⚠️ 每段都要在輸出端下 -t：色塊來源（color）不會自己結束，少了它 concat 會長成好幾十分鐘。
still() {
  local img=$1 dur=$2 cap=$3 out=$4 zoom=${5:-1.12} pan=${6:-h} x y w h
  w=$(python3 -c "print(int(1080*$zoom))"); h=$(python3 -c "print(int(1920*$zoom))")
  case $pan in
    h) x="(iw-ow)*t/$dur"; y="(ih-oh)/2" ;;
    v) x="(iw-ow)/2"; y="(ih-oh)*t/$dur" ;;
    *) x="(iw-ow)/2"; y="(ih-oh)/2" ;;
  esac
  local base="[0:v]scale=$w:$h:force_original_aspect_ratio=increase,crop=1080:1920:$x:$y,setsar=1"
  if [ -n "$cap" ]; then
    $FF -loop 1 -t "$dur" -i "$img" -i "$cap" \
      -filter_complex "$base[v];[v][1:v]overlay=0:0,fps=30,format=yuv420p[o]" \
      -map "[o]" -t "$dur" -c:v libx264 -crf 18 -preset veryfast "$out"
  else
    $FF -loop 1 -t "$dur" -i "$img" \
      -filter_complex "$base,fps=30,format=yuv420p[o]" \
      -map "[o]" -t "$dur" -c:v libx264 -crf 18 -preset veryfast "$out"
  fi
}

# AI 重繪版那一段：真的片子置中放在深色底上
clip() {
  local src=$1 dur=$2 cap=$3 out=$4
  $FF -t "$dur" -i "$src" -i "$cap" -filter_complex \
    "color=c=0x101d29:s=1080x1920:d=$dur[bg];[0:v]scale=1080:-2,setsar=1[v];\
     [bg][v]overlay=0:(H-h)/2[m];[m][1:v]overlay=0:0,fps=30,format=yuv420p[o]" \
    -map "[o]" -t "$dur" -c:v libx264 -crf 18 -preset veryfast "$out"
}

still "$P/card-title.png"          3.0 ""             "$SEG/a.mp4" 1.06 none
still "$ROOT/assets/plate/01.jpg"  3.6 "$P/cap-1.png" "$SEG/b.mp4" 1.00 h
still "$P/02-map.png"              4.0 "$P/cap-2.png" "$SEG/c.mp4" 1.05 v
still "$P/03-panel.png"            3.2 "$P/cap-3.png" "$SEG/d.mp4" 1.08 none
still "$P/04-pixel.png"            3.2 "$P/cap-4.png" "$SEG/e.mp4" 1.08 none
clip  "$ROOT/assets/motion/01.mp4" 4.8 "$P/cap-5.png" "$SEG/f.mp4"
still "$P/06-ai-differs.png"       3.8 "$P/cap-6.png" "$SEG/g.mp4" 1.06 none
still "$P/10-zoom.png"             3.0 "$P/cap-7.png" "$SEG/h.mp4" 1.12 h
still "$P/07-emaki.png"            3.4 "$P/cap-8.png" "$SEG/i.mp4" 1.10 h
still "$P/09-finale.png"           3.4 "$P/cap-9.png" "$SEG/j.mp4" 1.06 none
still "$P/card-end.png"            4.2 ""             "$SEG/k.mp4" 1.04 none

printf "file '%s'\n" "$SEG"/{a,b,c,d,e,f,g,h,i,j,k}.mp4 > "$SEG/list.txt"
$FF -f concat -safe 0 -i "$SEG/list.txt" -c copy "$SEG/silent.mp4"
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$SEG/silent.mp4")

# 配樂：雅樂「衣香」（宮內省樂部・Victor 13024，約 1930，公有領域）第 8 秒起。
# 🔴 選曲與起點是量出來的，⛔ 不是挑好聽的：把五首各切成 40 秒窗口，取「窗內最低的 0.5 秒 RMS」
# 最高的那一段——也就是最不會中斷的那一段。02 從 8s 起是 −25.8 dB；
# 原本用的 01 端唄「梅にも春」從 0s 起是 −38.6 dB，句與句之間的間隙聽起來就像聲音斷掉（Aaron 回報）。
# ⚠️ 1925–31 年的蠟盤本來就小聲 ⇒ 用 loudnorm 拉到社群平台的 −16 LUFS，
# ⛔ 不要直接加增益（原檔 max 只有 −0.6 dB，會削頂）。
$FF -i "$SEG/silent.mp4" -ss 8 -t "$DUR" -i "$ROOT/assets/audio/02.m4a" -filter_complex \
  "[0:v]fade=t=in:st=0:d=0.5,fade=t=out:st=$(python3 -c "print(round($DUR-0.8,2))"):d=0.8[v];\
   [1:a]afade=t=in:st=0:d=1.2,afade=t=out:st=$(python3 -c "print(round($DUR-2.5,2))"):d=2.5,\
        loudnorm=I=-16:TP=-1.5:LRA=11[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -crf 19 -preset medium -pix_fmt yuv420p \
  -c:a aac -b:a 160k -shortest -movflags +faststart "$VIDEO"

# README 用的海報：從成片抽三格（地圖／AI 重繪版／結局）
for t in 9.5 20.5 35; do
  i=$((i + 1)); $FF -ss "$t" -i "$VIDEO" -frames:v 1 "$P/f$i.png"
done
node "$ROOT/tools/promo-shots.mjs" poster "$P"
$FF -i "$P/poster.png" -q:v 3 "$OUT/poster.jpg"
# 直式封面（貼社群、當縮圖用）
$FF -ss 5 -i "$VIDEO" -frames:v 1 -q:v 3 "$OUT/poster-9x16.jpg"

# README 會動的預覽：🔴 GitHub 的 README **不吃 <video>**（整個標籤會被清掉，只剩空的 <p>），
# 它只認自己上傳附件的網址，raw 連結也不行 ⇒ 用 GIF 才動得起來。
# 取 AI 重繪版那一段（第 17 秒起 4.8 秒，全片唯一真的在動的畫面）。
$FF -ss 17 -t 4.8 -i "$VIDEO" -vf "fps=12,scale=405:-1:flags=lanczos,palettegen=stats_mode=diff" "$P/pal.png"
$FF -ss 17 -t 4.8 -i "$VIDEO" -i "$P/pal.png" \
   -lavfi "fps=12,scale=405:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3" "$OUT/preview.gif"

echo "完成 ${DUR}s"
ls -la "$VIDEO" "$OUT/preview.gif" "$OUT/poster.jpg" "$OUT/poster-9x16.jpg"
