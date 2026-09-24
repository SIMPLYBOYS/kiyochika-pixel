#!/usr/bin/env python3
"""配樂：Wikimedia Commons → assets/audio/*.opus ＋ data/audio-tracks.json

🔴 **1876–1881 沒有錄音存在。** 留聲機 1877 年才發明，日本最早的商業錄音是 1903 年
Gaisberg 來錄的。⇒ 這一層放的**不是當年的聲音，是當年就在演奏的曲目**，
由 1925–1931 年的唱片留下來（端唄・新內・追分・雅樂・尺八本曲）。
⛔ 面板上不寫成「明治九年的聲音」——那是假的，而這個 repo 不寫假的。

⛔ **也不用 WebAudio 自己編。** 座標、標註、解說一路都拒絕沒有出處的東西，
配樂沒有理由例外：真正的唱片存在、是公有領域、而且指得出盤號與演奏者。

選曲與理由在 `data/audio.json`（人工檔）。這支只做三件機器該做的事：
  ① 依 Commons 的檔名抓原檔（帶出處與授權回來，⛔ 不是隨便下載）
  ② 轉成單聲道 AAC——原檔 2.4–3.9MB 的 Ogg 共 18 分鐘，轉完約剩四分之一。
     78 轉唱片本來就是窄頻單聲道，轉單聲道 48k 聽不出差別，但 GitHub Pages 省很多
  ③ 把長度與出處寫進 data/audio-tracks.json 給前端用

用法：
  python3 tools/fetch-audio.py            # 只查詢並報告（不寫檔）
  python3 tools/fetch-audio.py --write    # 下載、轉檔、寫出
"""
import argparse, hashlib, json, re, subprocess, sys, urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetchlib import download, get_json

ROOT = Path(__file__).resolve().parent.parent
UA = "kiyochika-pixel/0.1 (research; contact via https://github.com/SIMPLYBOYS/kiyochika-pixel)"
API = "https://commons.wikimedia.org/w/api.php"
OUT = ROOT / "assets" / "audio"
# 🔴 格式選 **AAC（.m4a）不是 Opus**：Opus 省一點，但 Safari 對 Ogg 容器的支援
# 一路都不穩，而這是要上線給人聽的——⛔ 不賭「大概可以」。AAC 三家瀏覽器都吃。
# 單聲道 56k：78 轉唱片本來就是窄頻單聲道，聽不出差別，18 分鐘共約 7MB。
BITRATE = "56k"


def strip(html):
    return re.sub(r"\s+", " ", re.sub("<[^>]+>", " ", html or "")).strip()


def commons(titles):
    q = urllib.parse.urlencode({
        "action": "query", "prop": "imageinfo", "format": "json", "formatversion": "2",
        "iiprop": "url|extmetadata|size", "titles": "|".join(f"File:{t}" for t in titles)})
    pages = get_json(f"{API}?{q}", UA)["query"]["pages"]
    out = {}
    for p in pages:
        if "imageinfo" not in p:
            continue
        ii = p["imageinfo"][0]
        m = ii.get("extmetadata", {})
        g = lambda k: strip((m.get(k, {}) or {}).get("value", ""))
        out[p["title"][5:]] = {
            "url": ii["url"].split("?")[0], "mb": round(ii.get("size", 0) / 1e6, 2),
            "bytes": ii.get("size", 0),
            "license": g("LicenseShortName"), "artist": g("Artist"), "credit": g("Credit"),
            "page": "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(p["title"].replace(" ", "_")),
        }
    return out


def seconds(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "default=nw=1:nk=1", str(path)], capture_output=True, text=True)
    return round(float(r.stdout.strip()), 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    picks = json.loads((ROOT / "data" / "audio.json").read_text(encoding="utf-8"))["tracks"]
    meta = commons([t["file"] for t in picks])
    missing = [t["file"] for t in picks if t["file"] not in meta]
    assert not missing, f"Commons 上找不到：{missing}"

    bad = [f"{f}（{m['license']}）" for f, m in meta.items() if "public domain" not in m["license"].lower()]
    # 🔴 授權自己驗一次，⛔ 不靠「我記得它是公有領域」。這一層要拿去上線發布的。
    assert not bad, f"這些不是公有領域，⛔ 不收：{bad}"

    rows, total = [], 0
    for i, t in enumerate(picks, 1):
        m = meta[t["file"]]
        dest = OUT / f"{i:02d}.m4a"
        print(f"\n{i:02d} {t['title']}　{m['license']}　原檔 {m['mb']}MB")
        print(f"   {m['page']}")
        if args.write:
            OUT.mkdir(parents=True, exist_ok=True)
            raw = OUT / f"_{i:02d}.src"
            # ⚠️ Commons 的音檔會回截斷的 body（實測 2.36/2.59MB 就斷）⇒ 對大小、對不上重抓
            download(m["url"], UA, raw, expect=m["bytes"])
            # 🔴 -movflags +faststart 一定要加：預設 moov（播放索引）寫在檔案**最後面**，
            # 瀏覽器得把整首 1–3MB 下載完才出得了聲——手機上就是「按了很久才有音樂」
            # （2026-09-24 玩家回報，五首都是這樣，事後用 -c copy 重封裝修掉）。
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw),
                            "-ac", "1", "-c:a", "aac", "-b:a", BITRATE,
                            "-movflags", "+faststart", str(dest)], check=True)
            raw.unlink()
            mb = round(dest.stat().st_size / 1e6, 2)
            sec = seconds(dest)
            total += mb
            print(f"   → {dest.relative_to(ROOT)}　{mb}MB　{int(sec // 60)}:{int(sec % 60):02d}")
        else:
            sec, mb = None, None
        # v＝內容雜湊，網址帶 ?v= 破 7 天快取（同 make-motion.py 寫進 motion.json 的那個）
        v = hashlib.sha1(dest.read_bytes()).hexdigest()[:8] if dest.exists() else None
        rows.append({"file": f"assets/audio/{i:02d}.m4a", "title": t["title"], "note": t["note"],
                     "performer": t["performer"], "issue": t["issue"], "year": t["year"],
                     "seconds": sec, "v": v, "license": m["license"], "source": m["page"]})

    if not args.write:
        print("\n（這是查詢，沒有寫檔。要下載轉檔加 --write）")
        return
    dest = ROOT / "data" / "audio-tracks.json"
    dest.write_text(json.dumps(
        {"_": "配樂清單，機器產生（選曲與理由在 audio.json）。"
              "🔴 1876–1881 沒有錄音存在，這些是 1925–31 年錄的**當時仍在演奏的曲目**。",
         "tracks": rows}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"\n{len(rows)} 首 → {OUT.relative_to(ROOT)}（共 {round(total, 1)}MB）・清單 → {dest.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
