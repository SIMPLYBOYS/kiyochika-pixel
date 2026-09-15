# AI 動畫提示詞筆記

> 對象：用 Flow（Veo）這類「圖生影片」模型，替《東京名所圖》的某一幅做 AI 重繪動畫。
> 正本在 [`data/motion.json`](../data/motion.json) 的 `_prompt_template`；這份筆記解釋它為什麼長這樣。
> 兩邊的提示詞文字要一致，**改模板時兩邊一起改**，並在 `_prompt_template` 留紀錄。

---

## 一、先有這個認知

**提示詞只能減少重畫，擋不住重畫。**

圖生影片模型的工作方式是「照這張圖再想像一段」，每一幀都是重新生成的。
把原畫餵成第一幀只是給了起點，不是給了約束。no.50 御厩橋雷雨試了兩次 Veo，
提示詞都寫了「不得改變任何物件」，結果還是：

- 倉庫旁多出一個撐傘的人
- 清親畫的黃色團塊閃電，被換成分叉的白色閃電
- 雨線變密
- 天空被打亮成偏藍
- 輪廓被重描、木版刀痕變淡
- 模型把墊邊當成畫面往外延伸

所以提示詞的目標是**讓差異變少、變小**；生成之後照舊要：
量位移（`tools/make-motion.py`）→ 用眼睛看幀 → 寫 `differs` 差異清單 → 以「AI 重繪・非原作」上架。

---

## 二、結構：固定 base ＋ 依資料挑的 motion 句子

一幅畫的提示詞 = **base（每一幅都一樣）** 裡的 `{MOTION}`，換成**這一幅該動的句子**。

這樣設計的理由：

- **base 固定** ⇒ 每一幅受到同樣的約束，結果可以互相比較，出處也好記。
- **只有 motion 會變，而且從資料挑** ⇒ 59 幅不必各寫一份，也不會憑印象替某一幅加戲。

### base 全文

```
Animate this exact image. It is a Japanese woodblock print from the Meiji era (Kobayashi Kiyochika, 1876-1881), placed on a plain beige background.

CAMERA: Locked-off static shot for the whole clip. No pan, tilt, zoom, push-in, parallax, rotation or reframing. The entire print stays in frame, including its paper margins, printed title and red seal. The plain background around the print stays plain and empty.

KEEP IDENTICAL: Every person, boat, vehicle, animal, building, bridge, tree, pole and sign keeps its exact position, pose, shape and number from the first frame to the last. Nothing enters, leaves or appears. The carved outlines, flat areas of printed colour, colour palette and paper texture stay exactly as printed.

WHAT MOVES: {MOTION}

STYLE: The motion stays inside the woodblock look: flat printed colour, no photographic lighting, no 3D depth, no motion blur, no added grain, no colour grading. Movement is slow, subtle and continuous. The clip loops seamlessly: the last frame matches the first frame.
```

### base 五段各在防什麼

| 段落 | 在做什麼 | 防的是 |
|---|---|---|
| 開頭 | 說明這是一張明治木版畫，放在素色米底上 | 模型把它當照片或插畫處理 |
| CAMERA | 鏡頭鎖死，逐項列出不准的運鏡；整張紙（紙邊、題字、紅印）都要在畫面裡；墊邊維持素色 | 推近、平移、重新構圖；把墊邊畫成畫面的延伸 |
| KEEP IDENTICAL | 人、船、車、動物、建築、橋、樹、電線桿、招牌的**位置、姿勢、形狀、數量**從頭到尾不變；沒有東西進出或出現；刀痕、平塗色塊、色盤、紙紋照原樣 | 多出人物、東西移動、輪廓重描、顏色飄移 |
| WHAT MOVES | 放 motion 句子 | （見下一節） |
| STYLE | 動也要動在木版的樣子裡：平塗、無攝影光、無 3D、無動態模糊、無顆粒、無調色；慢、輕、連續；最後一幀對上第一幀 | 變成照片感或 3D 動畫；循環接不起來 |

---

## 三、motion 句子：從資料挑，不看圖猜

跟遊戲裡天候層（`src/weather.js`）用**同一套證據**：題名判出的天候與時刻、人工挑過並命名的標註。

| 資料裡有 | 用這句 |
|---|---|
| 天候：雨 `rain` | `The rain already drawn in the print keeps falling at the same angle and the same density; it does not get heavier. Wet ground and water catch a faint flicker of reflected light.` |
| 天候：雪 `snow` | `The snow already drawn in the print keeps drifting down slowly at the same density. Snow lying on roofs and on the ground does not change.` |
| 時刻：夜 `night` | `The scene stays as dark as printed.` |
| 標註名含 燈・灯・火・光・明 | `Lamps, lanterns and lit windows that are already in the print flicker very gently, in brightness only.` |
| 時刻：夕 `dusk` | `The existing evening sky glows and fades very slightly; its colours stay as printed.` |
| 時刻：曉 `dawn` | `The existing morning sky brightens very slightly; its colours stay as printed.` |
| 天候：月 `moon` | `Moonlight on the existing water shimmers gently; the moon itself stays fixed.` |
| 天候：煙火 `fireworks` | `The fireworks already in the sky pulse gently in brightness; their shapes stay as printed.` |
| 天候：火 `fire` | `The flames and smoke already drawn in the print flicker and billow slowly in place; they do not spread or grow.` |
| 標註名含 閃電・稲妻・雷 | `The lightning keeps exactly its printed shape, size, position and colour; only its brightness pulses, and the whole scene brightens briefly in sync once or twice.` |
| 以上都沒有 | `Almost nothing moves. Existing clouds drift a tiny amount and existing water shimmers faintly. If the print has no sky or water, the whole image stays still apart from a barely perceptible breathing of light.` |

**挑法**：符合的全部接起來，順序照上表；一個都沒有就只用最後一句。時刻是「晝」的不加句子。

59 幅的分佈：**33 幅至少有一句，26 幅只有最後那句**（唯一一幅「晝」不加句子，算在後者）。

**例外：資料沒寫、畫面上卻明明白白看得到的。** 天候只從題名判，所以題名沒寫雨、畫裡卻在下大雨的（例：no.9 梅若神社），
記在 `_prompt_template.overrides`，**連同理由**。只影響提示詞，不改遊戲的收景規則。看不準的不加（例：no.8 天上那顆黃色圓盤，分不出是月亮還是夕陽）。

---

## 四、十個寫法技巧

### 1. 用英文下指令
模型對英文指令的遵從最穩。中文說明留在資料檔與這份筆記裡給人看。

### 2. 不點名不想要的東西
影片模型對被提到的名詞很敏感，**寫了 “no umbrella” 反而容易畫出傘**。
所以不寫 no umbrella、no branching lightning、no extra people，
一律用不帶名詞的說法：「維持原樣」「沒有東西進出或出現」。

### 3. 只准動「已經畫在畫裡的」
每一句都帶 *already drawn in the print*、*existing*、*that are already in the print*。
意思是：雨可以繼續下，但只能是畫裡那場雨；燈可以閃，但只能是畫裡那幾盞。
這把「動」限定在原畫已有的元素上，不給模型加東西的空間。

### 4. 把「動多少」寫成可以檢查的條件
不寫「下雨」，寫「**同樣的角度、同樣的密度，不會變大**」；
不寫「閃電」，寫「**形狀、大小、位置、顏色都不變，只有亮度在閃**」；
不寫「失火」，寫「**在原地晃動，不擴散、不變大**」。
條件越具體，模型越沒有自由發揮的空間，事後也越容易對照。

### 5. 鏡頭限制要逐項列出來
只寫 static camera 不夠，要把 pan、tilt、zoom、push-in、parallax、rotation、reframing 都點出來。
（這些是運鏡術語，不是畫面內容，點名不會有第 2 點的反效果。）

### 6. 交代墊邊
原畫長寬比約 1.56，Veo 只出 16:9，所以要先把原畫墊成 16:9（米色墊邊，數字記在 `_pad`）。
提示詞要明講「畫放在素色背景上，背景維持素色」，否則模型會把墊邊當成畫面往外畫。

### 7. 要求循環
寫上 *the last frame matches the first frame*。模型不一定做得到，
但做得到時，`make-motion.py` 的首尾交疊會接得更自然。

### 8. 把風格鎖在木版上
平塗、無攝影光、無 3D、無動態模糊、無顆粒、無調色。
沒有這段，模型很容易把畫「修」成照片感或補上景深。

### 9. 每一句都要對應一個真的失敗
不為了「看起來周全」加句子。每條約束都要說得出它在防哪一次實際發生過的問題：

| 句子 | 對應的失敗 |
|---|---|
| Nothing enters, leaves or appears | 倉庫旁多出撐傘的人 |
| lightning keeps exactly its printed shape…colour | 黃色團塊閃電被換成分叉白閃 |
| it does not get heavier | 雨線變密 |
| colour palette…stay exactly as printed | 天空被打亮成偏藍 |
| carved outlines…stay exactly as printed | 輪廓被重描、刀痕變淡 |
| The plain background…stays plain and empty | 墊邊被當成畫面延伸 |

### 10. 不寫擋不掉的東西
例如 *no watermark*：浮水印是平台加的，提示詞擋不掉，寫了只是多一個名詞（又回到第 2 點）。

---

## 五、選哪幾幅來做

| 類別 | 幅數 | 建議 |
|---|---|---|
| 有天候、時刻或燈火閃電標註，且不是火災 | 29 | **優先**。有東西可以誠實地動 |
| 火災（兩国大火） | 4 | **風險最高**。標註全是人（逃的人、挑擔的人），模型最容易讓人動起來 |
| 只有最後那句 | 26 | 動得最少，最可能不值得做 |

---

## 六、操作步驟

1. 選一幅，依第三節挑出 motion 句子，組成完整提示詞。
2. 跑 `python3 tools/motion-prep.py <編號或範圍>`（例：`1-10`；加 `--street` 另出街景版），產出墊成 16:9 的第一幀與組好的提示詞，放在 `research/motion/`。
3. 在 Flow 生成 8 秒影片，下載 mp4，放進 `research/motion/`。
4. 在 `data/motion.json` 的 `clips` 記上：模型、日期、**逐字的提示詞**、`kind`。
5. 跑 `python3 tools/make-motion.py <編號> --video <檔案>`：切回原框、量位移、做循環、輸出。
6. 看幀，逐條寫 `differs`（模型改了什麼）。這份清單會原樣印在玩家面板上。
7. 跑驗收，再決定要不要部署。

⛔ 提示詞**每次逐字照用、逐字記錄**，不即興改。它是這一層的出處：
指不出當時用了什麼提示詞，這支影片就不該放進遊戲。

---

## 七、變體 B：街景版（讓畫裡的人動起來）

主模板要求「人、車都不准動」，所以街景畫（主體是街上的人）套主模板幾乎不會動。
想要熱鬧的街景時，改用這個變體。正本在 `data/motion.json` 的 `_prompt_template.street`。

**用這個變體生出來的，一律是「AI 重繪」**，差異清單至少要寫「人物在走動」。
⛔ 不用在兩国大火那 4 幅：畫的是逃難的人，讓他們動起來就是替清親演一場災難。

### 跟主模板差在哪

| 段落 | 主模板 | 街景版 |
|---|---|---|
| CAMERA | 鎖死、整張紙在畫面裡、墊邊維持素色 | **一字不改**。人可以動，框不能動 |
| KEEP IDENTICAL | 人、船、車、建築…全部不動 | 改成**建築、屋頂、門簾、招牌、文字、電線桿、路燈、街道、題字落款**不動 |
| WHAT MOVES | 依資料挑的氛圍句子 | 下面那句街景句 ＋ 依資料挑的氛圍句子（⛔ 不接「幾乎不動」那句，會互相矛盾） |
| STYLE | 木版風格、慢、循環 | 一樣 |

### 街景句

```
The people and vehicles already in the print come gently to life. They walk, pull and carry at an unhurried pace, in the directions their poses already suggest. Each figure keeps its clothing, colours and flat printed look. The street stays exactly as busy as printed, with the same number of people throughout.
```

### 每一句在防什麼（來自 no.72 第一次生成 `p.72.mp4` 的失敗）

| 句子 | 防的是 |
|---|---|
| CAMERA 整段不改，並且一定要用墊成 16:9 的第一幀 | 那一次沒墊，Veo 把畫放大裁切，題字「大傳馬町大丸」、落款、左側紙邊、天空上緣全被裁掉，而且救不回來 |
| with the same number of people throughout | 人越走越多：多出牽紅衣小孩的女子、撐傘的人、左邊兩個女子 |
| in the directions their poses already suggest | 讓動作從原畫的姿勢延伸，不讓模型另外編排走位 |
| Each figure keeps its clothing, colours and flat printed look | 人一動，模型最容易把人物畫成動畫風或照片感 |
| The printed title, signature and seal stay exactly as printed | 文字與印章最容易被模型改寫成亂碼 |

### 例：no.72 大傳馬町大丸

資料裡沒有天候、時刻、燈火標註 ⇒ WHAT MOVES 只放街景句。第一幀用 `research/motion/72-pad16x9.png`。

```
Animate this exact image. It is a Japanese woodblock print from the Meiji era (Kobayashi Kiyochika, 1876-1881), placed on a plain beige background.

CAMERA: Locked-off static shot for the whole clip. No pan, tilt, zoom, push-in, parallax, rotation or reframing. The entire print stays in frame, including its paper margins, printed title and red seal. The plain background around the print stays plain and empty.

KEEP IDENTICAL: Every building, roof, shop curtain, sign, lettering, pole, wire, lamp post and the street itself keeps its exact position, shape and colour. The printed title, signature and seal stay exactly as printed. The carved outlines, flat areas of printed colour, colour palette and paper texture stay exactly as printed.

WHAT MOVES: The people and vehicles already in the print come gently to life. They walk, pull and carry at an unhurried pace, in the directions their poses already suggest. Each figure keeps its clothing, colours and flat printed look. The street stays exactly as busy as printed, with the same number of people throughout.

STYLE: The motion stays inside the woodblock look: flat printed colour, no photographic lighting, no 3D depth, no motion blur, no added grain, no colour grading. Movement is slow, subtle and continuous. The clip loops seamlessly: the last frame matches the first frame.
```

---

## 八、變體 C：生動版（讓畫面真的動起來）

**為什麼有這一版**：用主模板與街景版生成，模型幾乎沒產生動畫效果，失去 AI 動畫的意義。
原因在提示詞本身——「幾乎不動」「維持原樣」「沒有東西進出」「慢、輕」「頭尾一致」，每一句都在壓動作。
而這一層上架的一律是「AI 重繪・非原作」＋逐條差異清單，忠實本來就不是它的承諾，不必再用提示詞綁住。

正本在 `data/motion.json` 的 `_prompt_template.vivid`；產出用 `python3 tools/motion-prep.py --vivid <編號>`。

### 跟前兩版差在哪

| | 主模板／街景版 | 生動版 |
|---|---|---|
| 鏡頭 | 鎖死 | **仍鎖在原畫外框上**（要切回原框、面板照原畫比例放影片） |
| 內容 | 維持原樣、不准有東西進出 | **畫框裡什麼都可以動**，路人可以走進走出 |
| 動作 | 從資料挑的氛圍句子 | **每一幅寫具體演出**：主角做什麼、背景誰在動、天候或光怎麼變 |
| 節奏 | 慢、輕、頭尾一致 | **第一秒就看得出在動**，不要求循環 |
| 畫風 | 木版 | 木版＋明治時代感（衣著、車、建築） |

### 寫動作的方法
- **主詞＋動詞＋方向**：「車夫朝觀眾跑來」，不堆形容詞。
- **每幅 4–6 個動作**：前景一個主角、背景一兩樣、天候或光一樣。
- **天候仍以資料為準**；資料沒寫但畫面明白看得到的走 `overrides`（例：no.9 的雨）。
- 場景句是**作者寫的演出指示**，不是對原畫的陳述，所以可以看圖寫。

### 代價（先講清楚）
- **差異清單會變長**：幾乎每個人、每樣東西都會變，建議第一條先總結「整段是依原畫重新演出的動畫」。
- **循環接點更明顯**：不要求頭尾一致，接回開頭時的半透明重疊會比 no.72 更大。
- **構圖位移會很高**：`make-motion.py` 對 reinterpretation 不擋，但數字會照實記下。

### base 全文

```
Bring this Japanese woodblock print to life as a vivid animated scene. It is a print of Meiji-era Tokyo by Kobayashi Kiyochika (1876-1881), placed on a plain beige background.

CAMERA: The camera stays locked on the print for the whole clip, so the print's outer edges never move. Everything inside the picture is free to move.

ACTION: {SCENE}

LIFE: Motion is clearly visible from the very first second and keeps going for the whole clip. People and animals move with readable, natural actions; clothing, hair, banners, branches, water and weather react to movement and wind. Figures may walk further, turn and interact, and other passers-by may move through the scene.

STYLE: It still looks like a moving woodblock print: flat printed colour, carved outlines, paper texture and Kiyochika's palette. Everything belongs to 1870s-1880s Tokyo: period clothing, vehicles and buildings. No photorealism and no 3D rendering.
```

---

## 附：no.50 御厩橋雷雨組好的提示詞

資料：天候雨、標註有「河面的燈火」「水上的光」（→ 燈火）、「閃電」（→ 閃電）⇒ rain ＋ lamp ＋ bolt。

```
Animate this exact image. It is a Japanese woodblock print from the Meiji era (Kobayashi Kiyochika, 1876-1881), placed on a plain beige background.

CAMERA: Locked-off static shot for the whole clip. No pan, tilt, zoom, push-in, parallax, rotation or reframing. The entire print stays in frame, including its paper margins, printed title and red seal. The plain background around the print stays plain and empty.

KEEP IDENTICAL: Every person, boat, vehicle, animal, building, bridge, tree, pole and sign keeps its exact position, pose, shape and number from the first frame to the last. Nothing enters, leaves or appears. The carved outlines, flat areas of printed colour, colour palette and paper texture stay exactly as printed.

WHAT MOVES: The rain already drawn in the print keeps falling at the same angle and the same density; it does not get heavier. Wet ground and water catch a faint flicker of reflected light. Lamps, lanterns and lit windows that are already in the print flicker very gently, in brightness only. The lightning keeps exactly its printed shape, size, position and colour; only its brightness pulses, and the whole scene brightens briefly in sync once or twice.

STYLE: The motion stays inside the woodblock look: flat printed colour, no photographic lighting, no 3D depth, no motion blur, no added grain, no colour grading. Movement is slow, subtle and continuous. The clip loops seamlessly: the last frame matches the first frame.
```
