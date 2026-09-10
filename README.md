# 清親《東京名所図》像素遊戲 — Phase 0

小林清親の光線画（1876–1881）を、edo-hyakkei と同じ「一套真實座標・両層皮」の地図に載せる作品。
現在 Phase 0（素材盤點と建檔）まで。設計と判斷の記録は vault の
`projects/2026-09-kiyochika-pixel/清親東京名所図-像素遊戲-Action-Plan.md`。

## 現況

```
素材   NDL《清親畫帖》三冊 84 枚 → 收錄 69 幅（東京光線画）
座標   59/69（OSM 19・Wikidata 8・街區級 31・低信心 1）／未定位 10
日期   4/69（版面の御届欄から判讀）
```

## 跑起來

```bash
python3 tools/fetch-ndl.py --download    # views.json 骨架 ＋ 2400px 整頁 → research/ndl/
python3 tools/fetch-gazetteer.py         # OSM 具名地物 → data/geo/gazetteer.json
python3 tools/derive-subject.py --write  # 題名の地名 → subject 座標
python3 tools/check-subjects.py          # 座標を水系の上に描いて目視（自動では抓れない）
python3 tools/fetch-colophon.py --sheet 4  # 御届欄を裁って判讀用シートに
python3 tools/fetch-commons.py --sheet   # Commons 側の交叉比對（主素材ではない）
```

順序：`fetch-ndl` →`fetch-gazetteer` →`derive-subject`。
`fetch-ndl` は再実行しても `derive-subject` が入れた座標を消さない（既存値を持ち越す）。

## 人工檔（機器が上書きしない）

| | |
|---|---|
| `data/places.json` | 自動比對で解けない座標。1 件ごとに `source`（OSM id / Wikidata QID）と `why` |
| `data/published.json` | 御届欄から読んだ出版年月。読めないものは**書かない** |

判斷の根拠を持たない値は入れない。空白は情報、推測した値はそうではない。

## 素材と授權

| | 來源 | 授權 |
|---|---|---|
| 清親の版画 84 枚 | 国立国会図書館デジタルコレクション《清親畫帖》寄別1-9-2-3（IIIF） | 公有領域 |
| 街図ベクタ・地名索引 | **OpenStreetMap** | **ODbL 1.0 — © OpenStreetMap contributors の表示が必要** |
| 地名座標の一部 | Wikidata | CC0 |
| 交叉比對用 | Wikimedia Commons（LACMA / Honolulu / Rijksmuseum 掃描） | 公有領域 |
