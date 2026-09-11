#!/usr/bin/env python3
"""assets/plate/NN.jpg（裁好的和紙）→ assets/thumb/NN.jpg（720px）

**為什麼不直接連 NDL 的 IIIF**：試過，會被限流。實測面板的圖回 429——
那是我們自己當天抓太多，但道理不變：**上線後每一個玩家開一次面板就打 NDL 一次**，
既脆弱又不禮貌。圖進 repo，執行期就不依賴別人的伺服器。

Phase 1 時這一批是**整頁**（灰底、台紙、色卡、比例尺都在，畫心只佔四分之一），
因為當時 trim 還沒寫。Phase 2 的 trim 做完之後改吃 `assets/plate`——
和紙那層而不是畫心，因為面板是當「真跡」看的，奧付與紙邊是作品的一部分。

用法： python3 tools/make-thumbs.py
"""
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC, DEST, W = ROOT / "assets" / "plate", ROOT / "assets" / "thumb", 720

views = [v for v in json.loads((ROOT / "data" / "views.json").read_text(encoding="utf-8")) if v["include"]]
DEST.mkdir(parents=True, exist_ok=True)
made, missing = 0, []
for v in views:
    src = SRC / f"{v['id']:02d}.jpg"
    if not src.exists():
        missing.append(v["id"])
        continue
    out = DEST / f"{v['id']:02d}.jpg"
    # 🔴 來源比產物新就要重做。跳過已存在的會在 trim 改動之後留下一批舊縮圖，
    # 而畫面看起來「有圖」，不會有任何錯誤訊息（實際發生過一次）。
    if out.exists() and out.stat().st_mtime >= src.stat().st_mtime:
        continue
    im = Image.open(src).convert("RGB")
    im.thumbnail((W, W * 4), Image.LANCZOS)
    im.save(out, quality=82, optimize=True)
    made += 1

have = sorted(int(p.stem) for p in DEST.glob("*.jpg"))
size = sum(p.stat().st_size for p in DEST.glob("*.jpg")) / 1e6
print(f"新做 {made} 張，共 {len(have)} 張 / {size:.1f}MB → {DEST.relative_to(ROOT)}")
if missing:
    print(f"⚠️ assets/plate 缺 {len(missing)} 張：{missing}　先跑 python3 tools/trim.py")
assert len(have) == len(views), f"{len(have)} 張對不上 {len(views)} 幅"
print("self-check ok")
