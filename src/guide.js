// 玩法：給玩家查的那一頁。
//
// 🔴 **這裡的每一句都要是程式真的在做的事**，⛔ 不是「遊戲大概是這樣玩」。
// 所以會跟著規則變的東西一律從規則本身讀進來（時刻、天候輪替、幾景翻一年、
// 地圖上有幾幅、哪幾幅有重繪版）——寫死的數字會在下一次改規則時安靜地變成謊話。
// 地圖圖例同理：畫的是**真的 .mark 元素**，吃的是地圖本身那套 CSS，
// 地圖的點改了樣子，這裡跟著改，⛔ 不另外畫一份會對不上的示意圖。

const dot = cls => `<svg class="swatch" viewBox="-18 -18 36 36" aria-hidden="true">
  <g class="mark ${cls}"><circle class="halo" r="16"/><circle class="pulse" r="7"/><circle class="dot" r="7"/></g></svg>`;

/**
 * @param o.mapped    地圖上有幾幅（進度的分母）
 * @param o.unmapped  收錄了但查不到座標的幾幅
 * @param o.times     一天的刻，已轉成中文（曉・晝・夕・夜）
 * @param o.weathers  天候輪替，已轉成中文
 * @param o.perYear   收幾景翻一年
 * @param o.years     時鐘的 [第一年, 最後一年]
 * @param o.kiyoYears 清親自己的 [第一年, 最後一年]（⚠️ 不等於時鐘：時鐘多了安治的 1882）
 * @param o.yasuji    弟子井上安治收了幾幅
 * @param o.clips     有 AI 重繪版的景名
 * @param o.refmap    當時的市街圖（HUD 上那個連結的年份），沒有就 null
 */
export function guideHtml(o) {
  const [y0, y1] = o.years;
  const [k0, k1] = o.kiyoYears;
  return `<h2>玩法</h2>
<div class="guide">
  <p>小林清親在 ${k0}–${k1} 年畫下的東京${o.yasuji ? `，加上弟子井上安治接下去畫的 ${o.yasuji} 幅` : ''}。
  收錄 ${o.mapped + o.unmapped} 幅，其中 ${o.mapped} 幅查得到畫的是哪裡，就在這張地圖上。<br>
  <b>目標：把地圖上的 ${o.mapped} 幅全部收進畫帖。</b></p>

  <h3>地圖上的點</h3>
  <ul class="legend">
    <li>${dot('open exact')}${dot('open approx')}<span><b>金點</b>・現在收得到（會一圈圈泛開）。點它，按「收入畫帖」。</span></li>
    <li>${dot('closed exact')}${dot('closed approx')}<span><b>淡灰</b>・已經出現，但現在收不到。點開，面板會寫要等什麼。</span></li>
    <li>${dot('got exact')}${dot('got approx')}<span><b>綠</b>・已經收進畫帖。</span></li>
  </ul>
  <p class="note">實心＝查到了畫裡那座橋、那間寺本身；空心＝只查到「那一帶」。<br>
  還沒畫出來的年份，點就不會出現——地圖會隨著年份長出來。</p>

  <h3>時間怎麼走</h3>
  <ul>
    <li>一天分四刻：${o.times.join(' → ')}。按「等一刻」過一刻；<b>收一幅也會過一刻</b>。</li>
    <li>天候一天一換，照 ${o.weathers.join(' → ')} 輪流，再從頭。</li>
    <li>年份從 ${y0} 年走到 ${y1} 年${o.yasuji && y1 > k1 ? `（${y1} 年是安治的畫）` : ''}。<b>每收 ${o.perYear} 幅進入下一年</b>；
      如果地圖上已經沒有「等一等就收得到」的畫，時間走下去也會進入下一年——所以不會卡關。</li>
    <li>上方那一列隨時寫著現在是哪一年、哪一刻、什麼天候。</li>
  </ul>

  <h3>為什麼收不到</h3>
  <p>清親畫的是某個時刻、某種天氣的東京，所以有些畫要等：</p>
  <ul>
    <li><b>「要在夜來」</b>之類——題名寫著夜、夕、曉的，要等到那一刻。</li>
    <li><b>「要等到下雪／下雨的日子」</b>——等天候輪到。</li>
    <li><b>「兩国大火那一夜之後」</b>——大火的四幅。年份走到 ${y1} 年之後，下一次收景時大火就會發生，從那之後才收得到。</li>
  </ul>
  <p class="note">年代不詳的畫一開始就在地圖上，只看時刻與天候。</p>

  <h3>收進畫帖之後</h3>
  <ul>
    <li><b>顯示標註</b>：畫師在畫裡畫了什麼，標在原來的位置。</li>
    <li><b>16 色：看光的骨架</b>：把畫壓成 16 色，看他怎麼處理光；底下是那 16 色的色盤。</li>
  </ul>
  <p class="note">不用收也看得到的：真跡、<b>看原寸</b>、畫的年份與光線、那個地方現在是哪一區、
  最近的車站、「站到那裡看 ↗」街景、典藏來源與解說。下雪、下雨、點著燈的畫，面板上會輕輕動起來。</p>
  ${o.yasuji ? `<p class="note"><b>井上安治的 ${o.yasuji} 幅</b>：面板上寫明畫師，解說會先講他是誰。
  有的畫在版面欄外印的是清親的名字，面板照實並列，不替任何一邊下定論。</p>` : ''}
  ${o.clips.length ? `<p class="note"><b>AI 重繪版</b>（目前有 ${o.clips.length} 幅：${o.clips.join('、')}）：
  生成模型照原畫重畫的影片，<b>不是原本的畫師畫的</b>，面板會一條一條列出它跟原畫差在哪。
  不算進度，也不會收進畫帖。</p>` : ''}

  <h3>上方那一列</h3>
  <dl>
    <dt>現在可收 N 幅　帶我去</dt><dd>地圖滑到下一個金點。連按會把現在收得到的巡一遍。</dd>
    <dt>等一刻</dt><dd>讓時間過一刻。</dd>
    <dt>玩法</dt><dd>這一頁。</dd>
    <dt>清親</dt><dd>畫家是誰、光線畫是什麼。</dd>
    <dt>畫卷</dt><dd>收到的畫連成一卷，由右往左讀。</dd>
    <dt>開場</dt><dd>重看開場。</dd>
    <dt>沈浸</dt><dd>全螢幕、收起周邊，只留地圖。手機上點地圖空白處叫出選單。</dd>
    <dt>♪</dt><dd>配樂開關。</dd>
    ${o.refmap ? `<dt>${o.refmap} 年的東京 ↗</dt><dd>當時的市街圖（開新分頁）。</dd>` : ''}
  </dl>
  <p class="note">手機上這一列可以左右滑。<br>
  底下的滑桿把現在（2026）與明治十三年（1880）的地圖疊在一起，只換地圖的樣子，不影響收得到什麼。</p>

  <h3>操作</h3>
  <table class="keys">
    <tr><th>地圖</th><td>拖曳移動・滾輪或兩指縮放・<kbd>＋</kbd><kbd>－</kbd> 縮放・<kbd>0</kbd> 全圖・方向鍵移動</td></tr>
    <tr><th>快捷鍵</th><td><kbd>W</kbd> 等一刻・<kbd>G</kbd> 帶我去・<kbd>E</kbd> 畫卷・<kbd>F</kbd> 沈浸・<kbd>M</kbd> 配樂・<kbd>?</kbd> 玩法・<kbd>Esc</kbd> 關閉</td></tr>
    <tr><th>畫卷</th><td><kbd>←</kbd><kbd>→</kbd> 一次一幅・<kbd>Home</kbd><kbd>End</kbd> 卷首卷尾・<kbd>Space</kbd> 自動展卷・拖曳或滾輪</td></tr>
    <tr><th>原寸</th><td>拖曳或方向鍵移動（<kbd>Shift</kbd> 走快一點）・滾輪或 ＋－ 縮放</td></tr>
  </table>

  <h3>進度存在哪</h3>
  <p class="note">存在<b>這台裝置的這個瀏覽器</b>裡。換手機、換瀏覽器、或清掉網站資料，就會從頭開始。
  收滿 ${o.mapped} 幅，會有結局。</p>
</div>`;
}
