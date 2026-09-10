#!/usr/bin/env python3
"""research/ndl/NN.jpg（2400px 整頁）→ assets/thumb/NN.jpg（720px）

**為什麼不直接連 NDL 的 IIIF**：試過，會被限流。實測面板的圖回 429——
那是我們自己當天抓太多，但道理不變：**上線後每一個玩家開一次面板就打 NDL 一次**，
既脆弱又不禮貌。圖進 repo，執行期就不依賴別人的伺服器。

720px 不是最終素材——Phase 2 的 trim 會從 research/ 的 2400px 重新裁畫心、量化成
480px 的像素版。這一批只是「Phase 1 的面板要有東西看」，所以整頁不裁：
裁畫心是 Phase 2 要修的那件事（四層結構），現在裁等於先做一次然後重做。

用法： python3 tools/make-thumbs.py
"""
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC, DEST, W = ROOT / "research" / "ndl", ROOT / "assets" / "thumb", 720

views = [v for v in json.loads((ROOT / "data" / "views.json").read_text(encoding="utf-8")) if v["include"]]
DEST.mkdir(parents=True, exist_ok=True)
made, missing = 0, []
for v in views:
    src = SRC / f"{v['id']:02d}.jpg"
    if not src.exists():
        missing.append(v["id"])
        continue
    out = DEST / f"{v['id']:02d}.jpg"
    if out.exists():
        continue
    im = Image.open(src).convert("RGB")
    im.thumbnail((W, W * 4), Image.LANCZOS)
    im.save(out, quality=82, optimize=True)
    made += 1

have = sorted(int(p.stem) for p in DEST.glob("*.jpg"))
size = sum(p.stat().st_size for p in DEST.glob("*.jpg")) / 1e6
print(f"新做 {made} 張，共 {len(have)} 張 / {size:.1f}MB → {DEST.relative_to(ROOT)}")
if missing:
    print(f"⚠️ research/ndl 缺 {len(missing)} 張：{missing}　先跑 python3 tools/fetch-ndl.py --download")
assert len(have) == len(views), f"{len(have)} 張對不上 {len(views)} 幅"
print("self-check ok")
