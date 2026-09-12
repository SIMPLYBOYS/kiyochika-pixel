// 地圖：一套真實座標，明治／現代兩層皮，SVG + viewBox 平移縮放。
// 從 edo-hyakkei 複製過來——同一座城、同一個畫框、同一份 OSM 資料。
// 差別只有三處，全在資料不在這裡：滑桿另一端是 1880、地名換明治 15 区、
// 1880 年已經有一條鐵道（下面的 RAIL1872）。
// 不用 Leaflet 的理由見 §4.3；不用 canvas 是因為 viewBox 本身就是免費的 pan/zoom。
//
// ponytail: 海岸線是讀圖手描的近似值，足夠驗證視覺效果（§3.2 已驗證成立）。
// 正式版換國土地理院向量 + 明治迅速測圖／江戶切繪圖 georeference。

// 1880（明治13）的汀線。沿用 edo-hyakkei 為 1858 量的那條——
// 月島 1892、芝浦 1913 以後才填，這 22 年間東京灣岸線沒有大變動。
const EDO = [
  [139.745, 35.520], [139.740, 35.545], [139.735, 35.570], [139.738, 35.595], [139.740, 35.620],
  [139.744, 35.638], [139.755, 35.650], [139.766, 35.657], [139.775, 35.663], [139.786, 35.668],
  [139.797, 35.668], [139.803, 35.665], [139.820, 35.663], [139.835, 35.662], [139.850, 35.657],
  [139.865, 35.648], [139.885, 35.655], [139.885, 35.700],
];
const MODERN = [
  [139.745, 35.520], [139.775, 35.522], [139.790, 35.535], [139.828, 35.547], [139.818, 35.567],
  [139.800, 35.583], [139.790, 35.598], [139.788, 35.612], [139.795, 35.622], [139.810, 35.630],
  [139.828, 35.632], [139.860, 35.638], [139.885, 35.625], [139.885, 35.700],
];
// 手描的四條河已刪：OSM 有真的隅田川(17段)／中川／多摩川／江戸川／荒川，
// 而且畫得比手描準。留著只會在海面上多兩條戳出去的線。
const DAIBA = [[139.7745, 35.6295], [139.7695, 35.6325]]; // 品川台場（1854 築，1880 年還在）
// 🔴 1880 那側唯一該留下的現代設施：新橋—横浜鐵道（1872 開業）。
// 其餘鐵路與幹道都歸 #modern，滑到 1880 一起消失——但這條那時就在跑，
// 而且清親畫過它（58 新橋ステンション）。
// ponytail: 三點折線，取自本作已查證的三個站點座標
// （新橋停車場 Q104698226／品川駅／大森駅，見 data/places.json 與 gazetteer）。
// 真實路線的彎道沒有畫；要更準就從 OSM 的東海道線切一段。
const RAIL1872 = [[139.76147, 35.66598], [139.7391, 35.6285], [139.7279, 35.5885]];

// 畫框。四邊都由「景的實際範圍 + 一點邊」決定，不是隨手取的整數：
// 西邊到 139.565 是為了收進 no.87 井の頭の池弁天の社（139.575），
// 它在三鷹，比第二西的景還西 11km——舊畫框 139.66 根本裝不下它。
// 順帶把長寬比從 0.66（直幅）拉到 1.08，橫向視窗看全図時的空白少一半。
const B = { w: 139.565, e: 139.925, s: 35.535, n: 35.805 };
// 收邊點：把陸地多邊形收在畫框外很遠的地方，這樣畫框內不會露出多邊形的邊。
// 它畫出去多遠不重要——所有地理圖層都裁在畫框內（clipPath #sheet），
// 這是 2026/08/07 補的：先前沒裁，這條收邊線一路畫到 lng 139.25／lat 35.10，
// 縮小時整個畫面是一片沒有任何資料的米色，看起來就像地圖沒載入。
const CLOSE = [[140.25, 35.70], [140.25, 36.15], [139.25, 36.15], [139.25, 35.10], [139.745, 35.10]];

const K = Math.cos((B.s + B.n) / 2 * Math.PI / 180);
const W = 1000;
const H = Math.round(W * (B.n - B.s) / ((B.e - B.w) * K));

export const project = (lng, lat) => [
  (lng - B.w) / (B.e - B.w) * W,
  (B.n - lat) / (B.n - B.s) * H,
];
/** project 的反函式。點地圖換回經緯度用。 */
export const unproject = (x, y) => [
  B.w + x / W * (B.e - B.w),
  B.n - y / H * (B.n - B.s),
];
const d = pts => pts.map(p => project(p[0], p[1]))
  .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');

// 每層合成一個 path（多段 subpath）。OSM 那批有 5,800 條線，
// 一條一個 <path> 會讓瀏覽器吃掉五千多個節點，pan/zoom 立刻卡。
const multi = ways => ways.map(w => d(w)).join('');

// 出現與否由外面的 clock.js 決定，這裡只收一個判定函式，免得地圖去 import 玩法。
let shown = () => true;
export const setVisibility = fn => { shown = fn; };

export function createMap(svg, views, geo, places, onPick) {
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  // slice 不是 meet：讓內容填滿視窗，看不到的用拖的。
  // 畫框外現在是 --off 的留白，就算 slice 裁掉一點也不會出現沒資料的區域。
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  // 江戶的海岸線不再需要自己的多邊形：底層畫現代陸地，1858 那側靠 #reclaimed
  // 把新生地蓋成海蓋出來。少一個多邊形，兩條海岸線也不會再對不齊。
  const modernLand = `${d([...MODERN, ...CLOSE])}Z`;
  svg.innerHTML = `
    <defs>
      <!-- 🔴 2026/08/07 改：OSM 圖層改裁在**現代**陸地內，不是江戶陸地。
           先前裁在江戶陸地，代價是新生地那塊永遠空白——推到 2026 時，
           目黒川、立会川這些河會斷在填海地的邊緣，流不進海裡，看起來就是壞的。
           改法是反過來：裁在較大的現代陸地，然後在 1858 那側用海把新生地蓋回去
           （下面的 #reclaimed）。這樣兩個年代都對，而且不必把圖層畫兩份。 -->
      <clipPath id="land"><path d="${modernLand}"/></clipPath>
      <!-- 地圖是一張有邊的紙。所有地理圖層都裁在這個矩形內，
           框外交給 body 的 --sea 底色——那是「圖到此為止」，不是海也不是陸。
           不裁的話陸地多邊形會一路鋪到框外幾十公里，全是沒資料的米色。 -->
      <clipPath id="sheet"><rect x="0" y="0" width="${W}" height="${H}"/></clipPath>
      <!-- 路與軌各畫兩層（下面 #modern）。幾何只存一份，用 <use> 引兩次——
           把那兩串 d 複製一遍會讓 DOM 多幾十萬個字元，而它們是整份資料裡最肥的。 -->
      <path id="roadgeo" d="${multi(geo.road)}"/>
      <path id="railgeo" d="${multi(geo.rail)}"/>
    </defs>
    <g clip-path="url(#sheet)">
    <rect x="0" y="0" width="${W}" height="${H}" fill="var(--sea)"/>
    <!-- 底層畫的是現代陸地（含新生地），江戶的海岸線靠上面的 #reclaimed 蓋出來。
         描邊讓水陸交界有一條線，海灣的形狀在全圖時比較認得出來。 -->
    <path d="${modernLand}" fill="var(--land)" stroke="#8ea3b4" stroke-width="1.1" opacity=".95"/>
    <g clip-path="url(#land)">
    <!-- 起伏。国土地理院の標高タイル（DEM5A ＋ DEM10B）から tools/fetch-dem.py が
         焼いた一枚。江戸の形は地形そのもの——山の手（20m 前後の台地）と
         下町（2m 前後の沖積低地）の段差が町の性格も広重の構図も決めている。
         そして §2.10 視点狩りは「地形を読め」と要求しているのに、
         この段差が地図に一本も描かれていなかった。
         紙と同じ等距円筒に焼き直してあるので、そのまま枠に貼れば重なる。 -->
    <image id="relief" href="data/geo/relief.jpg" x="0" y="0" width="${W}" height="${H}"
           preserveAspectRatio="none" opacity=".62"/>
    <path id="park" d="${multi(geo.park)}Z" fill="#b9c4a6" opacity=".5"/>
    <!-- 寺社の境内。江戸は寺の町——寺町はまとめて配置された都市計画の産物で、
         谷中・三田・浅草に固まって出るのはそのなごり。百景も寺社を繰り返し描く。
         **名前は出さない**：面積で採った 300 件のうち、一件ずつ開創年を
         確かめたのは明治以降と分かる数件だけ（fetch-osm.py の POST_EDO）。
         「このあたりは寺社の地」という濃淡までなら言えるが、
         「この寺は 1858 年にここに在った」とは言えない。言えない分は描かない。 -->
    <path id="worship" d="${multi(geo.worship)}Z" fill="#b5674a" opacity=".34"
          stroke="#8e4a30" stroke-width=".7" stroke-opacity=".5"/>
    <!-- 堀與川是江戶就有的（半蔵濠、千鳥ヶ淵、日本橋川…），兩個年代都畫 -->
    <path id="warea" d="${multi(geo.water_area)}Z" fill="var(--river)" opacity=".55"/>
    <path id="wline" d="${multi(geo.water_line)}" fill="none" stroke="var(--river)"
          stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity=".8"/>
    <!-- 鐵路與幹道才是現代的，滑到 1858 要消失 -->
    <g id="modern" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <!-- 道路兩層：寬的深色打底、窄的淺色壓上。一條線看起來是「線」，
           兩層疊起來才看起來是「路」——而且交叉口會自己接成路網，
           不必知道哪條壓哪條。這是製圖的 casing，不是裝飾。
           鐵路同理：實線打底＋淺色虛線壓上＝枕木。原本是一條棕色虛線，
           粗細與顏色都跟道路太接近，兩者分不出來。 -->
      <use href="#roadgeo" stroke="#9a8a71" stroke-width="2.4" opacity=".38"/>
      <use href="#roadgeo" stroke="#f2ead6" stroke-width="1.2" opacity=".95"/>
      <use href="#railgeo" stroke="#6d645a" stroke-width="1.6" opacity=".5"/>
      <use href="#railgeo" stroke="#efe8d8" stroke-width="1.1"
           stroke-dasharray="3.5 3.5" opacity=".85"/>
      <!-- 明治以降の境内（明治神宮・靖国・乃木…）。1858 年に無いので
           鐵路と同じくここに置く——年代滑桿で一緒に消える。 -->
      <path d="${multi(geo.worship_modern)}Z" fill="#b5674a" opacity=".34"
            stroke="#8e4a30" stroke-width=".7" stroke-opacity=".5"/>
    </g>
    </g>
    <!-- 新橋—横浜鐵道（1872）。跟 #modern 反向：滑到 1880 才出現。
         畫在 land 裁切之外，因為它要能壓在海岸線上（品川以南沿著海走）。 -->
    <g id="rail1872" fill="none" stroke-linecap="round" opacity="0">
      <path d="${d(RAIL1872)}" stroke="#6d645a" stroke-width="1.8" opacity=".55"/>
      <path d="${d(RAIL1872)}" stroke="#efe8d8" stroke-width="1.2"
            stroke-dasharray="3.5 3.5" opacity=".9"/>
    </g>
    <!-- 新生地。1880 那側用海把它蓋回去——連同上面畫的碼頭運河一起蓋掉，
         那些地方當年是海。畫在 OSM 之後、台場之前：台場就在這塊裡面，
         擺在後面才不會被自己的海蓋掉。 -->
    <path id="reclaimed" d="${d([...MODERN, ...EDO.slice().reverse()])}Z"
          fill="var(--sea)" stroke="var(--sea)" stroke-width="1.5"/>
    <g id="daiba" fill="var(--land)" stroke="#b8ad93">${DAIBA.map(p => {
      const [x, y] = project(p[0], p[1]);
      return `<rect x="${x - 5}" y="${y - 5}" width="10" height="10" transform="rotate(20 ${x} ${y})"/>`;
    }).join('')}</g>
    </g>
    <!-- 紙的邊。沒有它，框外的底色會跟灣內的海連成一片，看不出圖到哪裡結束 -->
    <rect x="0" y="0" width="${W}" height="${H}" fill="none"
          stroke="#000" stroke-opacity=".28" stroke-width="2"/>
    <g id="places"></g>
    <g id="marks"></g>`;

  const marks = svg.querySelector('#marks');
  const pins = [];              // 標記的地圖座標，relabel() 每次縮放重設 transform

  // §2.7 江戶地名。只畫 data/edo-places.json 挑過的 62 個——
  // 為什麼不能用規則自動挑（畫框內含舞浜，OSM 有迪士尼的 Hudson River），
  // 見該檔的 _why_not_automatic。
  const placesG = svg.querySelector('#places');
  const labels = places.filter(p => {
    // 錨點在畫紙外的一律不畫。#places 不在 #sheet 的裁切裡（裁了字會被切一半），
    // 所以這裡得自己擋——否則名字會飄在圖框外的留白上，看起來像跑版。
    const [x, y] = project(p.lng, p.lat);
    return x >= 0 && x <= W && y >= 0 && y <= H;
  }).map(p => {
    const [x, y] = project(p.lng, p.lat);
    const t = document.createElementNS(svg.namespaceURI, 'text');
    t.setAttribute('class', `place ${p.kind}`);
    t.setAttribute('x', x.toFixed(1));
    t.setAttribute('y', y.toFixed(1));
    t.textContent = p.osm;
    placesG.append(t);
    // span = 這個地物在地圖座標上的跨距。地物要在畫面上佔到一定比例才標名字，
    // 否則皇居那二十條堀在遠處會疊成一坨墨。
    return { el: t, span: p.size / (B.e - B.w) * W, edo: p.edo, now: p.osm,
             city: p.kind === 'city', meiji: p.kind === 'ku' };
  });
  const SHOW = 0.06;
  let era = 1;
  function relabel() {
    // 字級與描邊要抵銷縮放，否則 viewBox 一變字就跟著放大縮小。
    // 景名（#marks）跟地名（#places）都要，兩邊在畫面上才是同一個尺度。
    // 🔴 一個 CSS 像素等於幾個地圖單位。**不是 vb.w / 視窗寬**——那只在寬邊綁住時
    // 成立。slice 的倍率是 max(視窗寬/vb.w, 視窗高/vb.h)，直式手機是高綁住，
    // 舊寫法在那裡高估 1.85 倍：地名與圓點被畫成 17.7px 而不是 12px。
    // 跟 toSvg 用的是同一個倍率，兩邊必須一致，否則點到的位置會跟看到的差一截。
    const r = svg.getBoundingClientRect();
    const px = 1 / Math.max(r.width / vb.w, r.height / vb.h);
    // 🔴 介面元件在窄螢幕上等比縮一點。地名與圓點是拿「螢幕像素」定尺寸的，
    // 所以手機上的絕對大小跟桌機一模一樣——但畫面只有 390px 寬，同一顆點佔掉的
    // 版面是桌機的三倍，看起來就是「比例太大」。
    // 沒有縮到跟桌機同比例（那會是 6.8px 的字、4.5px 的點）：字要讀得到、點要按得到。
    // 0.8 是可讀與不擁擠之間的折衷。斷點跟 CSS 的 700px 對齊。
    const upx = px * (r.width < 700 ? 0.8 : 1);
    placesG.setAttribute('font-size', (upx * 12).toFixed(2));
    placesG.setAttribute('stroke-width', (upx * 3).toFixed(2));
    // 標記整組等比縮回螢幕尺度：圓點、圖會環、視線扇形、景名一次全對。
    // 形狀是用螢幕像素畫在原點的，scale(px) 之後在畫面上就是那個像素數。
    for (const m of pins) m.g.setAttribute('transform', `translate(${m.x} ${m.y}) scale(${upx})`);

    // 先決定地名的文字內容（避讓要用字數估寬度，得先知道字是什麼）
    for (const l of labels) {
      // 滑到 1858 那側就換成當時的名字（弁慶濠→弁慶堀）——只有 9 個真的不同
      const want = era > 0.5 && l.edo ? l.edo : l.now;
      if (l.el.textContent !== want) l.el.textContent = want;
    }

    // ── 標籤避讓 ────────────────────────────────────────────────
    // 同一塊地方只留一個名字：按優先序試放，放不下的就不放。
    // 寬度用「字數 × 字級」估，不呼叫 getBBox()——那會強制 layout，
    // 滾輪連續縮放時每格要量一百多個，代價付不起。都是全形字，1 字約 1em。
    // 一切都在地圖單位下比較：整張圖是等比縮放的，不必換算到螢幕座標。
    const boxes = [];
    const place = (cx, cy, w, h) => {
      const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
      for (const b of boxes) if (x0 < b[2] && x1 > b[0] && y0 < b[3] && y1 > b[1]) return false;
      boxes.push([x0, y0, x1, y1]);
      return true;
    };
    // 只跟畫面內的標籤搶位置，畫面外的不該佔位
    const visH = r.height * px;
    const vy = vb.y + (vb.h - visH) / 2;
    const onScreen = (x, y) => x > vb.x && x < vb.x + vb.w && y > vy && y < vy + visH;

    // 優先序：景名先排，地名撿剩下的。景是內容，地名是襯底。
    const zoomed = svg.classList.contains('zoomed');
    {
      for (const m of pins) {
        const t = m.g.querySelector('text');
        const show = zoomed && onScreen(m.x, m.y)
          // 文字靠左起排在點的右邊（x=11），所以中心要往右推半個字串寬
          && place(m.x + upx * (11 + t.textContent.length * 13 / 2), m.y + upx * 2,
                   upx * 13 * t.textContent.length, upx * 15);
        // 用 class 不用 inline display：inline 的 display:none 連 :hover 都蓋掉，
        // 被擠掉的景名就再也叫不出來了。交給 CSS 才有 hover 的餘地。
        t.classList.toggle('crowded', !show);
      }
    }
    // 水系先排，区名撿剩下的。水系與堀是這張圖的骨架，
    // 区名是「這裡叫什麼」的註腳，讓註腳讓位比較不痛。
    for (const l of [...labels.filter(l => !l.city), ...labels.filter(l => l.city)]) {
      const n = l.el.textContent.length;
      // 区名只活在自己的年代：1880 年沒有新宿区，2026 年沒有麹町区。
      // 水系與堀兩個時代都通（名字沒改過），不受這條管。
      const inEra = l.city ? era <= 0.5 : l.meiji ? era > 0.5 : true;
      l.el.style.display = inEra
        && l.span / vb.w > SHOW && onScreen(+l.el.getAttribute('x'), +l.el.getAttribute('y'))
        && place(+l.el.getAttribute('x'), +l.el.getAttribute('y') - upx * 4,
                 upx * 12 * n, upx * 14) ? '' : 'none';
    }
  }

  const nodes = new Map();
  let dragged = () => false;                   // 下面 pan/zoom 那段會覆寫
  for (const v of views) {
    if (!v.subject) continue;                  // 沒座標的景暫時上不了圖
    const [x, y] = project(v.subject.lng, v.subject.lat);
    const g = document.createElementNS(svg.namespaceURI, 'g');
    // 座標的把握程度畫在點上。59 個座標裡有 32 個只定到「那一帶」（駅名／町名／
    // 線狀地物），把它們畫得跟查到本體的一樣實，等於在地圖上宣稱一件沒查證的事。
    // 依據記在 views.json 的 place.anchor.confidence，這裡只是把它畫出來。
    const conf = (v.place && v.place.anchor && v.place.anchor.confidence) || 'district';
    g.setAttribute('class', `mark ${conf === 'osm' || conf === 'wikidata' ? 'exact' : 'approx'}`);
    // 有方位角的畫一道視線扇形——那是 §7-15 從畫中地標推出來的廣重視線方向，
    // 不確定度約 ±30°，所以畫成扇形不是箭頭：形狀本身就在說「大概往這邊」。
    // 形狀一律畫在原點、用「螢幕像素」當單位，實際位置與大小交給 transform。
    // 先前是把座標與半徑直接寫進 cx/cy/r（地圖單位），於是拉近時整個標記跟著脹大——
    // 縮放放寬之後，市中心會變成一堆蓋住地圖的大圓餅。
    const cone = v.bearing == null ? '' : (() => {
      const r = 26, half = 30 * Math.PI / 180, a = (v.bearing - 90) * Math.PI / 180;
      const p = t => `${(r * Math.cos(t)).toFixed(1)} ${(r * Math.sin(t)).toFixed(1)}`;
      return `<path class="cone" d="M0 0 L${p(a - half)} A${r} ${r} 0 0 1 ${p(a + half)} Z"/>`;
    })();
    // 可收的景會擴一圈暈（CSS 的 .pulse）。錯開起始時間，否則全圖同時呼吸
    // 像跑馬燈；錯開之後比較像水面上零星的漣漪。用 id 當種子，重整不會變。
    // 🔴 這三圈缺一不可（原本只有中間那一顆，`.pulse` 的 CSS 寫了但**元素從來沒生出來**，
    // 於是「可收」與「不可收」的差別只剩填色，59 個點裡找 6 個金點——找不到是應該的）：
    //   halo  靜態的暈，⛔ 不能只靠動畫：prefers-reduced-motion 的人要看得到同一件事
    //   pulse 擴散的漣漪，錯開起始時間，否則全圖同時呼吸像跑馬燈。用 id 當種子，重整不會變
    //   dot   點本身
    const delay = ((v.id * 37) % 28) / 10;
    g.innerHTML = `${cone}<circle class="halo" r="16"/>
      <circle class="pulse" r="7" style="animation-delay:${delay}s"/>
      <circle class="dot" r="7"/>
      <text x="11" y="5">${v.title.ja ?? v.id}</text>`;
    g.onclick = e => { e.stopPropagation(); if (!dragged()) onPick(v); };
    marks.append(g);
    nodes.set(v.id, g);
    pins.push({ g, x, y });
  }

  // 平移縮放：直接改 viewBox，不需要任何函式庫
  let vb = { x: 0, y: 0, w: W, h: H };
  let onChange = () => {};
  // 🔴 地形圖有兩級，拉近了才換大的。
  //
  // 一張是不夠的：地圖可以縮放，而 relief.jpg 是 1536px（約 21m/px）——
  // 拉到底時一個影像像素被撐成 12.5 個螢幕像素，地形就成了一張粗顆粒的
  // 「概念圖」（實際被回報過）。但一開始就載 3072 那張，開場要多等 1.8MB。
  // 所以：先用小的，等到真的看得出顆粒再換。兩張都由 tools/fetch-dem.py 一次焼く。
  const reliefEl = svg.querySelector('#relief');
  const RELIEF_BASE = 1536;                  // data/geo/relief.jpg 的寬度
  let hiAsked = false;
  const upgradeRelief = () => {
    if (hiAsked) return;
    const r = svg.getBoundingClientRect();
    if (!r.width) return;
    const s = Math.max(r.width / vb.w, r.height / vb.h);        // slice 的倍率
    // 一個影像像素被撐成幾個螢幕像素。1.5 以下看不出來，以上開始有顆粒感。
    if (s * W / RELIEF_BASE < 1.5) return;
    hiAsked = true;
    const big = new Image();
    // 先載好再換 href。直接換的話中間會有一格空白——那比顆粒難看得多。
    big.onload = () => reliefEl.setAttribute('href', big.src);
    big.src = 'data/geo/relief-hi.jpg';
  };

  const apply = () => {
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    relabel(); upgradeRelief(); onChange();
  };
  const toSvg = e => {
    const r = svg.getBoundingClientRect();
    const s = Math.max(r.width / vb.w, r.height / vb.h);   // 對應 slice
    return [vb.x + (e.clientX - r.left - (r.width - vb.w * s) / 2) / s,
            vb.y + (e.clientY - r.top - (r.height - vb.h * s) / 2) / s];
  };
  // 舊版把縮小上限鎖在初始 viewBox（Math.min(W,…)），加上 slice 會裁滿畫面，
  // 結果是**永遠看不到整張圖**——王子與羽田無法同時入鏡。那就是「格局很僵」的成因。
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // 🔴 2026/08/07「地圖是空白的」修了兩層，兩層都要留著才不會復發：
  //   1. 開場視角與縮小極限本來是同一個值，遊戲一開就停在縮到最小
  //   2. 更根本的是地理圖層沒有邊——陸地多邊形鋪到框外幾十公里全是米色
  // 只修 1 的話縮小仍然是一片空白；只修 2 的話開場仍然離得太遠。

  // 景的座標分布，只用來決定開場要對準哪裡（畫框本身已照景的範圍訂好）。
  const XS = [], YS = [];
  for (const v of views) {
    if (!v.subject) continue;
    const [x, y] = project(v.subject.lng, v.subject.lat);
    XS.push(x); YS.push(y);
  }
  const pct = (a, p) => a.slice().sort((m, n) => m - n)[Math.round(p * (a.length - 1))];

  // slice 會裁滿畫面：要讓一塊矩形完整入鏡，viewBox 得寬到長寬比追上視窗。
  // 把一塊內容框進畫面：回傳需要的 viewBox 寬度。
  //
  // 🔴 舊版寫成 max(w, h × 視窗寬高比)，那**只對橫幅視窗成立**。
  // preserveAspectRatio 是 slice（填滿、溢出的用拖的），縮放倍率是
  // max(視窗寬/vb.w, 視窗高/vb.h)——哪一邊綁住，取決於視窗寬高比 R 與地圖寬高比
  // 的關係，不是永遠綁寬邊。直式手機（R≈0.59）是**高**綁住，於是同一個 vb.w
  // 只看得到 0.54 倍的寬度，舊公式少算了一半以上：開場的 fitCity 在手機上只框到
  // 約 260 個地圖單位（桌機 833），畫面看起來大得多，拖兩下就到邊。
  const cover = (w, h) => {
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return Math.max(w, h);          // 還沒排版，先給個合理值
    const R = r.width / r.height, A = H / W;
    // 看得見的範圍 = (vb.w × kx, vb.w × ky)
    const [kx, ky] = R >= 1 / A ? [1, 1 / R] : [A * R, A];
    return Math.max(w / kx, h / ky);
  };
  const PAD = 40;
  const frame = (x0, x1, y0, y1) => {
    const nw = clamp(cover(x1 - x0 + PAD * 2, y1 - y0 + PAD * 2), MIN, MAX);
    vb = { x: (x0 + x1) / 2 - nw / 2, y: (y0 + y1) / 2 - (H / W) * nw / 2,
           w: nw, h: (H / W) * nw };
    svg.classList.toggle('zoomed', nw < W * 0.45);
    apply();
  };

  const MIN = W / 16;
  // 縮到底 = 整張紙入鏡加一點邊。再往外只是看更多 --off 的留白，沒有意義。
  let MAX = Infinity;
  const remax = () => { MAX = cover(W + PAD * 2, H + PAD * 2); };
  remax();

  // 全図 = 看見整張紙。畫框 B 是照景的範圍訂的，所以「整張紙」必然含全部 118 景。
  const fitAll = () => frame(0, W, 0, H);
  // 開場：框住江戶本體（景的 5–95 百分位）。用全図開場會把城縮成中央一小塊，
  // 而王子與羽田這種邊緣景本來就該用拖的找。
  const fitCity = () => frame(pct(XS, .05), pct(XS, .95), pct(YS, .05), pct(YS, .95));

  // 別讓地圖被拖到畫面外完全不見：左上角限制在內容範圍加半個畫面的餘裕。
  // 拖曳、縮放、方向鍵三條路都要夾同一組界線，所以只寫在這裡。
  const rein = () => {
    vb.x = clamp(vb.x, -vb.w * 0.6, W - vb.w * 0.4);
    vb.y = clamp(vb.y, -vb.h * 0.6, H - vb.h * 0.4);
  };
  const pan = (dx, dy) => { vb.x += dx; vb.y += dy; rein(); apply(); };

  function zoomTo(nw, cx, cy) {
    nw = clamp(nw, MIN, MAX);
    const f = nw / vb.w;
    vb = { x: cx - (cx - vb.x) * f, y: cy - (cy - vb.y) * f, w: nw, h: (H / W) * nw };
    rein();
    svg.classList.toggle('zoomed', nw < W * 0.45);  // 拉近才顯示地名，否則市中心疊成一團
    apply();
  }

  svg.onwheel = e => {
    e.preventDefault();
    // 依滾動量連續縮放，不是每格固定倍率——觸控板一次會送出很多小事件，
    // 固定倍率會跳得很兇。ctrlKey 是 Mac 觸控板雙指捏合，幅度要放大。
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    const k = Math.exp(clamp(px, -80, 80) * (e.ctrlKey ? 0.012 : 0.0022));
    const [cx, cy] = toSvg(e);
    zoomTo(vb.w * k, cx, cy);
  };
  svg.ondblclick = e => { const [cx, cy] = toSvg(e); zoomTo(vb.w / 2, cx, cy); };
  // 🔴 resize 之後也要重畫一次。先前只叫 remax()，於是視窗一變，地名與圓點還是
  // 用**舊的**視窗寬度算的尺寸——量過：1200×835 縮到 700×900，地名從 12px 變成
  // 9.8px，而且要等玩家拖動地圖才會修正。全螢幕是一次大幅 resize，會正面撞上這個。
  addEventListener('resize', () => { remax(); apply(); });   // 長寬比變了，全図需要的寬度也變了
  // 方向鍵是按住連續走，不是一下跳一格。
  // 交給作業系統的按鍵重複也不行——先卡半秒再暴衝，那不叫綿密，
  // 所以自己開 rAF，每一幀推一點點。
  //
  // 速度定成「每秒走幾個畫面寬」而不是「每幀走幾單位」：
  //   · 120Hz 的螢幕不會跑成兩倍快
  //   · 拉近時走得慢、拉遠時走得快，兩種尺度手感一致
  const PER_SEC = 0.55;                     // 橫越一個畫面約一秒八
  const ARROWS = {
    ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
  };
  const held = new Set();
  let raf = 0, last = 0;

  // 🔴 上面蓋著東西時方向鍵不是地圖的。⚠️ 這一行原本問的是 `.overlay` 與 `#hunt-ui`
  // ——**那是從 edo-hyakkei 抄過來的選擇器，這一作根本沒有那兩個東西**，
  // 所以原寸檢視／畫卷／開場開著時，方向鍵會把底下的地圖一起推走。
  // ⛔ 抄過來的判斷要跟著改名字，否則它會安靜地永遠回 false。
  const busy = () => document.querySelector('.lightbox, .scroll-view, .intro, #panel.on');
  // 焦點在滑桿或按鈕上時方向鍵是它們的（年代滑桿本來就靠左右鍵微調）。
  // 🔴 問 activeElement 而不是 e.target：keydown 派到 window 時 target 是
  // window，沒有 closest，一問就 TypeError——而全域 handler 會把它變成
  // 整片紅色致命框。而且該問的本來就是「焦點在哪」。
  const typing = () => {
    const f = document.activeElement;
    return f && f !== document.body && f.matches('input,button,select,textarea');
  };
  const halt = () => { held.clear(); cancelAnimationFrame(raf); raf = 0; last = 0; };
  const tick = t => {
    if (!held.size || busy()) return halt();
    // 切到別的分頁再回來，t 會跳掉好幾秒；不夾住的話地圖會瞬移。
    // last 為 0（第一幀）時算成一幀，這樣輕點一下也走得動。
    const dt = Math.min((t - (last || t - 16)) / 1000, 0.1);
    last = t;
    let dx = 0, dy = 0;
    for (const k of held) { dx += ARROWS[k][0]; dy += ARROWS[k][1]; }
    const len = Math.hypot(dx, dy) || 1;    // 斜著走不該比直著走快
    pan(dx / len * vb.w * PER_SEC * dt, dy / len * vb.h * PER_SEC * dt);
    raf = requestAnimationFrame(tick);
  };

  addEventListener('keydown', e => {
    if (busy() || typing()) return;
    const c = { x: vb.x + vb.w / 2, y: vb.y + vb.h / 2 };
    if (e.key === '=' || e.key === '+') zoomTo(vb.w / 1.5, c.x, c.y);
    if (e.key === '-' || e.key === '_') zoomTo(vb.w * 1.5, c.x, c.y);
    if (e.key === '0') fitAll();                         // 迷路了按 0 回到全圖
    if (!ARROWS[e.key]) return;
    e.preventDefault();                                  // 不要讓頁面跟著捲
    held.add(e.key);
    if (!raf) raf = requestAnimationFrame(tick);
  });
  addEventListener('keyup', e => { held.delete(e.key); if (!held.size) halt(); });
  // 按著方向鍵切走視窗，放開的那一下不在這個頁面——不清掉鍵會一直卡著走
  addEventListener('blur', halt);
  // 不要用 setPointerCapture：capture 之後 pointerup 落在 svg 上，
  // click 就改派到 svg 而不是景點那個 <g>，onclick 永遠不會觸發。
  // svg 本來就滿版，不 capture 也不會跟丟。
  let drag = null, moved = 0;
  // 兩指縮放。touch-action:none 把瀏覽器自己的縮放擋掉了，所以手機上要自己做——
  // 不做的話地圖在手機上只能拖不能縮（實測之前就是這樣）。
  // ptrs 記現在按著的每一指；兩指時走 pinch，不走拖曳。
  const ptrs = new Map();
  let pinch = null;                      // 上一幀兩指的距離與中點（螢幕座標）
  const gauge = () => {
    const [a, b] = [...ptrs.values()];
    return { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
             mx: (a.clientX + b.clientX) / 2, my: (a.clientY + b.clientY) / 2 };
  };
  svg.onpointerdown = e => {
    ptrs.set(e.pointerId, e);
    if (ptrs.size === 2) { pinch = gauge(); drag = null; moved = 99; return; }
    if (ptrs.size > 2) return;
    const [x, y] = toSvg(e);
    drag = { x, y }; moved = 0;
  };
  // 放開任一指就結束這一輪：剩下那一指不該接著被當成新的拖曳或點擊
  const lift = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; drag = null; };
  addEventListener('pointerup', lift);
  addEventListener('pointercancel', lift);
  svg.onpointermove = e => {
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, e);
    if (ptrs.size === 2 && pinch) {
      const g = gauge();
      // 先記下「舊中點底下是地圖的哪一點」，繞新中點縮放，再把那一點移到新中點底下——
      // 這樣兩指張開時畫面跟著手指，不會漂
      const [sx, sy] = toSvg({ clientX: pinch.mx, clientY: pinch.my });
      const [cx, cy] = toSvg({ clientX: g.mx, clientY: g.my });
      zoomTo(vb.w * pinch.d / g.d, cx, cy);
      pan(sx - cx, sy - cy);
      pinch = g; moved = 99;
      return;
    }
    if (!drag) return;
    const [x, y] = toSvg(e);
    moved += Math.abs(x - drag.x) + Math.abs(y - drag.y);
    pan(-(x - drag.x), -(y - drag.y));
  };
  // 拖曳結束時滑鼠常常正好停在某個景上，不擋掉的話一拖就誤入該景
  dragged = () => moved > 6;

  fitCity();  // 開場對準市街。用 fitAll() 開場就是「地圖沒載入」那個 bug

  const centre = () => [vb.x + vb.w / 2, vb.y + vb.h / 2];

  // ── 帶我去 ────────────────────────────────────────────────
  // 🔴 **滑過去，不要瞬移。** 瞬間換位置的地圖會讓人失去方向感——
  // 玩家需要看到「從這裡移到那裡」，才知道那個點在自己原本位置的哪一邊。
  // ⛔ 也不重設縮放：那是玩家自己調的視野。只有縮到最遠（點小得看不清）時才拉近一級。
  let glideId = 0;
  const glide = (tx, ty, tw) => {
    const from = { ...vb }, t0 = performance.now(), MS = 520;
    const id = ++glideId;                       // 連按兩次：後一次接手，⛔ 不要兩個動畫打架
    const step = now => {
      if (id !== glideId) return;
      const k = Math.min(1, (now - t0) / MS);
      const e = 1 - Math.pow(1 - k, 3);         // ease-out：起步快、收尾穩
      vb = { x: from.x + (tx - from.x) * e, y: from.y + (ty - from.y) * e,
             w: from.w + (tw - from.w) * e, h: (H / W) * (from.w + (tw - from.w) * e) };
      rein();
      svg.classList.toggle('zoomed', vb.w < W * 0.45);
      apply();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  return {
    zoomIn: () => zoomTo(vb.w / 1.6, ...centre()),
    zoomOut: () => zoomTo(vb.w * 1.6, ...centre()),
    fitAll,
    // 縮放按鈕要能反映「還能不能再縮」，否則按下去沒反應會像壞掉
    atMax: () => vb.w >= MAX - 1,
    atMin: () => vb.w <= MIN + 1,
    // 註冊當下就先跑一次：初始的 fitAll() 發生在 createMap 內部、
    // 外部還來不及註冊，不補這一下開場按鈕狀態會是錯的
    onChange: cb => { onChange = cb; cb(); },
    /** 讓外面拿得到某一景的節點（面板要在點開時把它標出來）。 */
    node: id => nodes.get(id),
    /** 現在畫面中央對著哪裡（地圖單位）。挑「下一個」要從這裡量距離。 */
    centre,
    /** 某一景在地圖上的座標，⛔ 沒座標的景回 null（那 10 幅本來就不在圖上）。 */
    at: id => {
      const g = nodes.get(id), p = pins.find(q => q.g === g);
      return p ? [p.x, p.y] : null;
    },
    /** 帶我去：把某一景滑到畫面中央。回傳有沒有成功（沒座標就沒得帶）。 */
    goTo: id => {
      const at = nodes.get(id) && pins.find(q => q.g === nodes.get(id));
      if (!at) return false;
      const nw = clamp(vb.w >= MAX - 1 ? vb.w / 2.2 : vb.w, MIN, MAX);
      glide(at.x - nw / 2, at.y - (H / W) * nw / 2, nw);
      return true;
    },
    /** 兩層閘門畫到圖上。狀態由 src/clock.js 算，這裡只負責把它變成 class。
     *
     * 🔴 還沒出版的整個藏起來（display:none），不是畫成灰點——
     * 地圖隨年份一張張長出來是這個機制看得見的部分；而看不見的東西
     * 也不該被 hover 到（edo-hyakkei §2.6 的同一條）。 */
    render(views2, clock, state, isOpen) {
      for (const v of views2) {
        const g = nodes.get(v.id);
        if (!g) continue;
        const unpub = !shown(v, clock);
        const got = state.collected.includes(v.id);
        const open = !unpub && !got && isOpen(v);
        g.classList.toggle('unpub', unpub);
        g.classList.toggle('got', got);
        g.classList.toggle('open', open);
        g.classList.toggle('closed', !unpub && !got && !open);
        if (open) marks.append(g);   // 可收的提到最上層，市中心擠成一團時才點得到
      }
      relabel();
    },
    setEra(t) {                                 // 0=現代 1=1880
      era = t; relabel();
      // #reclaimed 現在畫的是海不是陸：t=1（1880）時不透明，把新生地蓋成海；
      // t=0（現代）時透明，露出底下的新生地與它上面的河與路。
      svg.querySelector('#reclaimed').style.opacity = t;
      svg.querySelector('#daiba').style.opacity = t;
      svg.querySelector('#modern').style.opacity = 1 - t;   // 現代的鐵路與幹道
      svg.querySelector('#rail1872').style.opacity = t;     // 1872 那條只在明治側
    },
  };
}
