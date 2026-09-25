#!/bin/bash
# 第二支宣傳片：**同一個地點，1880 與今天**（docs/promo/kiyochika-today-9x16.mp4）
#
# 🔴 跟第一支（make-promo.sh）的角度**刻意不同**：第一支是功能導覽，這一支只講一件事——
# 把原畫與同一個座標的街景擺在**同一個畫框**裡對切。同一批觀眾看到的不該是重複的東西。
# 🔴 副字幕只寫 data/views.json 的 now 欄位查得到的東西（現代区町名・碑與距離・車站），
# ⛔ 不寫「當時最新的洋樓」這類我自己的形容——宣傳片也照這個 repo 的規矩。
#
#   node tools/promo-today-shots.mjs research/promo2 4,58,82    # 先抓成對素材（跑正式站）
#   bash tools/make-promo-today.sh
#
# ⚠️ 成對素材要連正式站抓：街景金鑰的 referrer 白名單裡沒有 localhost。
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
P="$ROOT/research/promo2"; SEG="$P/seg"; mkdir -p "$SEG"
OUT="$ROOT/docs/promo"; mkdir -p "$OUT"
FF="ffmpeg -hide_banner -loglevel error -y"
VIDEO="$OUT/kiyochika-today-9x16.mp4"

# 字幕條與標題卡（跟第一支共用 tools/promo-cards.html 的版面）
node "$ROOT/tools/promo-shots.mjs" cards "$P" title2,end t1,t2,t3,t4,t5,t6,t7,t8

# 整頁卡：$1 圖 $2 秒 $3 輸出
card() {
  $FF -loop 1 -t "$2" -i "$1" -filter_complex \
    "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p[o]" \
    -map "[o]" -t "$2" -c:v libx264 -crf 18 -preset veryfast "$3"
}

# 畫框（原畫或街景）置中放在深色底上 ＋ 字幕：$1 圖 $2 秒 $3 字幕 $4 輸出
# ⚠️ 兩張是同一個框截的（#art）⇒ 剪接時是「同一個地點換了 146 年」，⛔ 不是兩張不相干的圖。
shot() {
  $FF -loop 1 -t "$2" -i "$1" -i "$3" -filter_complex \
    "color=c=0x101d29:s=1080x1920:d=$2[bg];[0:v]scale=1080:-2,setsar=1[v];\
     [bg][v]overlay=0:(H-h)/2-90[m];[m][1:v]overlay=0:0,fps=30,format=yuv420p[o]" \
    -map "[o]" -t "$2" -c:v libx264 -crf 18 -preset veryfast "$4"
}

card "$P/card-title2.png" 3.2 "$SEG/a.mp4"
shot "$P/pair-4-then.png"  3.4 "$P/cap-t1.png" "$SEG/b.mp4"
shot "$P/pair-4-now.png"   3.4 "$P/cap-t2.png" "$SEG/c.mp4"
shot "$P/pair-58-then.png" 3.2 "$P/cap-t3.png" "$SEG/d.mp4"
shot "$P/pair-58-now.png"  3.2 "$P/cap-t4.png" "$SEG/e.mp4"
shot "$P/pair-82-then.png" 3.2 "$P/cap-t5.png" "$SEG/f.mp4"
shot "$P/pair-82-now.png"  3.4 "$P/cap-t6.png" "$SEG/g.mp4"
shot "$ROOT/research/promo/02-map.png"    3.2 "$P/cap-t7.png" "$SEG/h.mp4"
shot "$ROOT/research/promo/09-finale.png" 3.6 "$P/cap-t8.png" "$SEG/i.mp4"
card "$P/card-end.png" 4.0 "$SEG/j.mp4"

printf "file '%s'\n" "$SEG"/{a,b,c,d,e,f,g,h,i,j}.mp4 > "$SEG/list.txt"
$FF -f concat -safe 0 -i "$SEG/list.txt" -c copy "$SEG/silent.mp4"
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$SEG/silent.mp4")

# 配樂同第一支：雅樂「衣香」第 8 秒起（選曲是量出來的，理由見 make-promo.sh）
$FF -i "$SEG/silent.mp4" -ss 8 -t "$DUR" -i "$ROOT/assets/audio/02.m4a" -filter_complex \
  "[0:v]fade=t=in:st=0:d=0.5,fade=t=out:st=$(python3 -c "print(round($DUR-0.8,2))"):d=0.8[v];\
   [1:a]afade=t=in:st=0:d=1.2,afade=t=out:st=$(python3 -c "print(round($DUR-2.5,2))"):d=2.5,\
        loudnorm=I=-16:TP=-1.5:LRA=11[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -crf 19 -preset medium -pix_fmt yuv420p \
  -c:a aac -b:a 160k -shortest -movflags +faststart "$VIDEO"

# README／社群用：直式封面與會動的預覽（GitHub 不吃 <video>，見 make-promo.sh）
$FF -ss 5 -i "$VIDEO" -frames:v 1 -q:v 3 "$OUT/today-poster-9x16.jpg"

echo "完成 ${DUR}s"
ls -la "$VIDEO" "$OUT/today-poster-9x16.jpg"
