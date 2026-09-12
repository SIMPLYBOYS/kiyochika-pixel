// 遊戲本體。兩層閘門（年份決定何時出現、光線決定何時可收）的邏輯在 src/clock.js，
// 這裡只負責把它接到畫面上：時鐘、收景、進度、事件、結局。
// ⛔ 細節搜尋（每景 2–3 個可點的細節）還沒做——那要逐幅挑座標，是另一塊工。
import { createMap, setVisibility } from './map.js';
import { clockOf, blocked, collectable, visible, yearOf, tick, newState } from './clock.js';
import { zoom } from './zoom.js';
import { openScroll } from './scroll.js';
import { playIntro, startTicker, introSeen } from './intro.js';
import { createMusic } from './audio.js';
import { weather } from './weather.js';

const $ = id => document.getElementById(id);

// 開發時資料檔要繞過快取。localhost 才加，線上讓瀏覽器正常快取。
// （模組本身由 tools/serve.py 加版本號，見那支的檔頭。）
const bust = location.hostname === 'localhost' ? `?t=${Date.now()}` : '';
const grab = async url => {
  const r = await fetch(url + bust);
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);   // fetch 對 404 不會 reject
  return r.json();
};

const [all, world, ml, refmaps, topicMap, topicText, topicZh, audio, palettes, motion] = await Promise.all([
  grab('data/views.json'),
  grab('data/geo/modern.json'),
  // 地名只是裝飾，掛掉不該連地圖一起拖下水
  grab('data/meiji-places.json').catch(e => (console.warn('地名層略過:', e), { places: [] })),
  grab('data/reference-maps.json').catch(e => (console.warn('文獻地圖略過:', e), null)),
  grab('data/topics.json').catch(e => (console.warn('解說對應表略過:', e), {})),
  grab('data/topics-text.json').catch(e => (console.warn('解說略過:', e), { items: {} })),
  grab('data/topics-zh.json').catch(e => (console.warn('解說譯文略過:', e), { items: {} })),
  grab('data/audio-tracks.json').catch(e => (console.warn('配樂略過:', e), { tracks: [] })),
  grab('data/palettes.json').catch(e => (console.warn('色盤略過:', e), {})),
  grab('data/motion.json').catch(e => (console.warn('動態版略過:', e), { clips: [] })),
]);

// 🔴 能玩的是**地圖上有的那些**。收錄 69 幅，其中 10 幅沒查到座標（空白是資訊，
// 理由逐條寫在 places.json）——它們畫不到地圖上，就永遠點不到、收不了。
// 原本進度分母寫 69：那個數字保證跑不完（最多 59/69），結局卡也因此永遠不會出現。
// ⇒ 遊戲的世界＝有座標的那 59 幅，⛔ 不要用一個玩家達不到的分母。
const unmapped = all.filter(v => v.include && !v.subject);
const views = all.filter(v => v.include && v.subject);

// 地名三組，畫在同一層、同一套避讓：
//   ku    明治 15 区 —— 座標寫在白名單裡（Wikidata），只畫在 1880 那側
//   水系  —— 白名單只存名字，座標由 modern.json 的 labels 依名字 join（一個來源）
//   city  現代 23 区 —— 直接來自 labels，只畫在現代那側
const anchor = new Map((world.labels ?? []).map(l => [l.name, l]));
const places = [
  ...(ml.places ?? []).map(p => (p.kind === 'ku' ? p : { ...p, ...anchor.get(p.osm) })),
  ...(world.labels ?? []).filter(l => l.kind === 'city').map(l => ({ ...l, osm: l.name, edo: null })),
].filter(p => p.lng != null);

// ── 進度 ──────────────────────────────────────────────────────
// 版號 v1 ＝ 第一版，沒有舊存檔要處理。**改動閘門規則時記得升版號**——
// 舊存檔配新規則，玩家一開遊戲就會看到不一致的地圖（東京二十景踩過這個）。
const KEY = 'kiyochika.v1';
const load = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && Array.isArray(raw.collected)) return { ...newState(), ...raw };
  } catch { /* 存檔壞了就當新局，⛔ 不要讓它擋住遊戲 */ }
  return newState();
};
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* 無痕模式 */ } };
const state = load();

setVisibility(v => visible(v, clockOf(state)));
const map = createMap($('map'), views, world.layers, places, pick);

// ── 面板 ──────────────────────────────────────────────────────
// 🔴 圖用 repo 裡的 assets/thumb（tools/make-thumbs.py 產），不連 NDL 的 IIIF。
// 直接連試過：回 429。那次是我們自己當天抓太多，但道理不變——
// 上線之後每個玩家開一次面板就打 NDL 一次，既脆弱又不禮貌。
const pad = v => String(v.id).padStart(2, '0');
const thumb = v => `assets/thumb/${pad(v)}.jpg`;      // 真跡（和紙，含奧付）720px，面板用
const plate = v => `assets/plate/${pad(v)}.jpg`;      // 同一張的 1527–1690px，原寸檢視用
const pixel = v => `assets/pixel/${pad(v)}.png`;      // 像素版（480px・16 色・Bayer）
const REF_W = 480;                   // 像素畫布的寬度，69 幅都一樣
const TIME_JA = { dawn: '曉', day: '晝', dusk: '夕', night: '夜' };
const WX_JA = { clear: '晴', snow: '雪', rain: '雨' };
// 擋住的理由要說得出來。說不出來的閘門，玩家只會覺得是壞的。
const WHY = {
  year: b => `要等到 ${b.need} 年——那時清親才畫下它`,
  time: b => `要在${TIME_JA[b.need]}來`,
  weather: b => `要等到${b.need === 'snow' ? '下雪' : '下雨'}的日子`,
  event: () => '兩国大火那一夜之後才畫得出來',
  got: () => '已經收過了',
};
let selected = null, shownId = null, stopWx = () => {};
let onResize = () => {};
addEventListener('resize', () => onResize());

// 「今そこには何があるか」。全部是推導出來的、指得出出處的
// （行政界與周邊地物＝OSM、標高＝国土地理院）——⛔ 這一層不由我寫，
// 六十九段憑印象的今昔對比正是這個專案一路在拒絕的東西。
// ⚠️ 区與町可能不一致：44 大川富士見渡的點在河中央（那是渡船），
// 落在墨田区，最近的町卻是對岸台東区的蔵前——兩個都對，所以兩個都寫。
const KIND = { worship: '寺社', bridge: '橋', park: '公園', water: '水' };
function here(v) {
  const p = v.place ?? {}, n = v.now ?? {};
  if (!p.modern_ward) return '';
  const town = p.modern_town ? `${p.modern_town}<small>（${p.modern_town_km}km）</small>` : '';
  const pano = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${v.subject.lat},${v.subject.lng}`;
  // 標高的「高い／低い」是拿同一畫帖的 59 個點排出來的，不是外面的說法
  const rank = n.elevation_rank;
  const tag = rank == null ? '' : rank >= 0.8 ? '<small>（這本畫帖裡偏高）</small>'
    : rank <= 0.2 ? '<small>（偏低）</small>' : '';
  return `
    <dt>現在</dt><dd>${p.modern_ward} ${town}${
      n.elevation == null ? '' : `　標高 ${n.elevation}m ${tag}`}<br>
      <a href="${pano}" target="_blank" rel="noopener">站到那裡看 ↗</a></dd>
    ${n.station ? `<dt>最近車站</dt><dd>${n.station.name}　<small>${n.station.km} km</small></dd>` : ''}
    ${n.nearby?.length ? `<dt>今日周邊</dt><dd>${n.nearby.map(
        x => `${x.name}<small> ${KIND[x.kind] ?? ''} ${x.m}m</small>`).join('　')}</dd>` : ''}
    ${n.marker ? `<dt class="mk">碑</dt><dd class="mk">${n.marker.name}<small> ${n.marker.m}m</small></dd>` : ''}`;
}

// ── 動態版：這個 repo 唯一一層生成出來的東西 ──────────────────
// 🔴 規矩寫在 data/motion.json 的 _rule：只動氛圍不動內容、原畫當底只讓遮罩內動、
// 畫面上固定標「AI 生成・非原作」、⛔ 不進畫卷不進收藏不算進度。
// 🔑 這一層的「出處」＝**可重現**：模型、日期、prompt、遮罩都記在資料檔裡。
// ⚠️ 沒有片子就當這個功能不存在（⛔ 不要留一顆按了沒東西的鈕）。
const clipOf = v => (motion.clips ?? []).find(c => c.id === v.id);

// ── 色盤：把光的骨架攤開 ──────────────────────────────────────
// 🔴 像素化在這一作不是濾鏡，是**分析工具**：這一作叫光線畫，而 16 色量化留下來的
// 那 16 個顏色，就是清親用來處理光的那套色階。data/palettes.json 是 quantize.py
// 在 Phase 2 就產出的（每幅 16 色），⚠️ 但一直沒有任何一行程式讀它——
// 「算出來卻沒人看」跟「沒算」是一樣的。
const lumOf = hex => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
};
const palLum = {};                       // 每幅的平均明度
for (const [id, cols] of Object.entries(palettes ?? {})) {
  palLum[id] = cols.reduce((a, c) => a + lumOf(c), 0) / cols.length;
}
// 排名拿同一本畫帖的其餘各幅比——⛔ 不引用外面的說法，同「標高偏高／偏低」那一層
const lumSorted = Object.values(palLum).sort((a, b) => a - b);
const lumRank = id => {
  const v = palLum[id];
  return v == null ? null : lumSorted.filter(x => x < v).length / (lumSorted.length - 1);
};
function palette(v) {
  const cols = (palettes ?? {})[v.id];
  if (!cols) return '';
  const r = lumRank(v.id), l = Math.round(palLum[v.id]);
  const tag = r == null ? '' : r >= 0.8 ? '這幅是畫帖裡偏亮的'
    : r <= 0.2 ? '這幅是畫帖裡偏暗的' : '明暗落在中間';
  return `<section class="pal">
    <h3>十六色</h3>
    <div class="chips">${cols.map(c => `<i style="background:${c}" title="${c}"></i>`).join('')}</div>
    <p>把這幅壓成 480px・16 色之後剩下的顏色。平均明度 ${l}／255——${tag}。<br>
      <small>⛔ 不是濾鏡：光線畫講的就是光，這 16 個顏色是他處理光用的那套色階。
      由 tools/quantize.py 算出（Bayer 8×8），排名拿同一本畫帖的 ${lumSorted.length} 幅比。</small></p>
  </section>`;
}

// ── 解說 ──────────────────────────────────────────────────────
// 🔴 這些文字**不是我寫的**，是維基百科的導言逐字抓下來的（tools/fetch-topics.py），
// 我只決定「哪一幅對哪一條目」——那份對應在 data/topics.json，人工逐條確認過。
// ⛔ 指不準就不給：柳島・駿賀町・萬代橋那幾幅留空，理由寫在 topics.json 的 _skip。
// 為什麼不自己寫賞析：六十九段憑印象的畫論，正是這個 repo 一路在拒絕的東西。
// topics.json 的值可以是條目名，也可以是 {title, n}（少數條目要多抓幾句）
// 🔴 顯示的是**繁中譯文**（data/topics-zh.json，人工翻的），日文原文原地留在
// topics-text.json 給多語系用。譯文缺一條就退回原文——⛔ 寧可看到日文，不要開天窗。
// ⚠️ CC BY-SA 允許翻譯，但條件是：標出處、說明改動過、同樣授權釋出 ⇒ 面板寫「譯自」。
const topicOf = v => {
  // ⚠️ 帶 section 的（清親的生平分三節）鍵是「條目#章節」——只用標題會三節互相蓋掉
  const name = typeof v === 'string' ? v : v?.section ? `${v.title}#${v.section}` : v?.title;
  const ja = (topicText.items ?? {})[name];
  if (!ja) return null;
  const zh = (topicZh.items ?? {})[name];
  return zh ? { ...ja, title: zh.title, text: zh.text } : ja;
};
const card1 = (t, tag, open) => t ? `
  <details${open ? ' open' : ''}>
    <summary>${t.title}${tag ? `<small>　${tag}</small>` : ''}</summary>
    <p>${t.text}<br><a href="${t.url}" target="_blank" rel="noopener">維基百科（日文原文）↗</a></p>
  </details>` : '';

const keyOf = v => (typeof v === 'string' ? v : v?.title);

function reading(v) {
  const placeKey = keyOf((topicMap.places ?? {})[v.id]);
  const place = topicOf(placeKey);
  // 去重要**跨兩欄**：有 5 幅的「這是什麼地方」跟「畫裡的東西」指同一條
  //（4 海運橋＝第一銀行／42 兩國花火＝隅田川花火大会／47 紙幣寮＝国立印刷局／
  //  53 五角堂＝内国勧業博覧会／72 大丸＝大の字）——同一段話印兩次。
  // ⇒ 先把地方那條放進 seen，事物那欄就不會再出一次。
  // ⚠️ 比的是**條目名**不是物件：topics.json 的值可能是字串也可能是 {title, n}，
  // 直接比物件會永遠不相等（第一版的去重就是這樣沒生效）。
  const seen = new Set(placeKey ? [placeKey] : []);
  const things = (v.details ?? []).map(d => keyOf((topicMap.things ?? {})[d.label_ja]))
    .filter(n => n && !seen.has(n) && seen.add(n)).map(topicOf).filter(Boolean);
  if (!place && !things.length) return '';
  return `<section class="read"><h3>解說</h3>
    ${card1(place, '這是什麼地方', true)}
    ${things.map(t => card1(t, '畫裡的東西')).join('')}
    <p class="src">譯自維基百科日本語版　CC BY-SA 4.0</p></section>`;
}

function pick(v) {
  if (selected) selected.classList.remove('sel');
  selected = map.node(v.id);
  if (selected) { selected.classList.add('sel'); selected.dataset.id = v.id; }
  shownId = v.id;
  const clock = clockOf(state);
  const b = blocked(v, clock, state);
  const got = state.collected.includes(v.id);
  const y = yearOf(v);
  const c = v.conditions || {};
  const cond = [c.time_of_day && TIME_JA[c.time_of_day], c.weather && (WX_JA[c.weather] || c.weather)]
    .filter(Boolean).join('・');
  $('body').innerHTML = `
    <h2>${v.title.ja}</h2>
    <div id="art" class="${marks ? '' : 'nomarks'}"><img src="${thumb(v)}" alt="${v.title.ja}">${got ? spots(v) : ''}</div>
    ${got ? `<button id="mark" class="wide">${marks ? '隱藏標註' : '顯示標註'}</button>
             <button id="flip" class="wide">16 色：看光的骨架</button>
             ${clipOf(v) ? '<button id="anim" class="wide">動態版 <small>AI 生成</small></button>' : ''}` : ''}
    <button id="big" class="wide">看原寸</button>
    ${!b ? '<button id="take" class="wide take">收入畫帖</button>'
        : b.why === 'got' ? ''          // 收過了不必再說一次，上面的提示已經在講這件事
        : `<p class="gate">${WHY[b.why](b)}</p>`}
    <dl>
      <dt>年</dt><dd>${y ?? '<span class="warn">年代未詳</span>'}${
        v.published ? `　<small>奧付 ${v.published}</small>` : ''}</dd>
      ${cond ? `<dt>光</dt><dd>${cond}</dd>` : ''}
      ${here(v)}
      <dt>典藏</dt><dd><a href="https://dl.ndl.go.jp/pid/${v.source.pid}" target="_blank"
        rel="noopener">NDL ${v.source.item}・第 ${v.source.page} 圖</a><br>
        <small>${v.source.call_number}　${v.source.license}</small></dd>
    </dl>
    ${got ? palette(v) : ''}
    ${reading(v)}`;
  $('panel').classList.add('on');
  document.body.classList.add('panel-open');
  const img = $('art')?.firstElementChild;
  if (img) { img.onload = () => fitArt(v); fitArt(v); }
  // 天候層：只動氛圍（雪・雨・燈火明滅），而且只在資料說得出來的景上動。
  // ⚠️ 每次重畫面板都要先收掉上一層，否則 rAF 會越疊越多（切像素／真跡也會重畫）。
  stopWx();
  stopWx = $('art') ? weather($('art'), v) : () => {};
  onResize = () => fitArt(v);
  $('big').onclick = () => zoom(plate(v), `${v.title.ja}　NDL 清親畫帖・第 ${v.source.page} 圖`);
  const take = $('take');
  if (take) take.onclick = () => collect(v);
  const mark = $('mark');
  if (mark) mark.onclick = () => {
    marks = !marks;
    $('art').classList.toggle('nomarks', !marks);
    mark.textContent = marks ? '隱藏標註' : '顯示標註';
  };
  // 動態版：把 <img> 換成 <video>，並且**永遠**帶著那條標示。
  const clip = clipOf(v);
  const anim = $('anim');
  if (anim && clip) anim.onclick = () => {
    const art = $('art');
    const on = !art.querySelector('video');
    art.querySelector('video, img')?.remove();
    if (on) {
      art.insertAdjacentHTML('afterbegin', `
        <video autoplay loop muted playsinline>
          <source src="${clip.file}" type="video/webm">
          <source src="${clip.file.replace(/\.webm$/, '.mp4')}" type="video/mp4">
        </video>
        <b class="gen">AI 生成・非原作</b>`);
      // ⛔ 標註在這一層關掉：生成的每一格未必跟原畫對得上，標在上面就是在替它背書
      art.classList.add('nomarks');
    } else {
      art.querySelector('.gen')?.remove();
      art.insertAdjacentHTML('afterbegin', `<img src="${thumb(v)}" alt="${v.title.ja}">`);
      art.classList.toggle('nomarks', !marks);
    }
    anim.textContent = on ? '回到真跡' : '動態版 ';
    if (!on) anim.insertAdjacentHTML('beforeend', '<small>AI 生成</small>');
    fitArt(v);
  };
  const flip = $('flip');
  if (flip) {
    // 🔴 預設是**真跡**。像素版的資訊嚴格少於真跡（同一個框、少掉的只有色階），
    // 一部價值在文獻性的作品，沒有理由預設先給人看降過質的版本。
    // ⇒ 像素版改成明講的一個選擇，鈕上直接寫按下去會看到什麼。
    // 像素版與真跡是同一張和紙 ⇒ 框一樣、座標一樣，標註在兩邊都對得上。
    let px = false;
    flip.onclick = () => {
      px = !px;
      $('art').firstElementChild.src = px ? pixel(v) : thumb(v);
      $('art').classList.toggle('px', px);
      flip.textContent = px ? '回到真跡' : '16 色：看光的骨架';
      fitArt(v);
    };
  }
}

// ── 標註：清親在這裡畫了什麼 ───────────────────────────────────
// 205 個點的座標由 tools/derive-details.py 在**像素版**上算、人工逐幅挑過並命名
// （data/details.json）⇒ 標出來的必然是 480px／16 色之後還看得見的東西。
// 🔴 這裡**不做「找線索」**：東海道那套是把名字藏起來讓玩家點，這一作的重點是
// 知道自己在看什麼——所以名字直接標在原位，開關由玩家決定。
// ⛔ 切到真跡時 CSS 會把標註藏起來：真跡含紙邊與奧付，裁切不同，座標對不上。
let marks = true;                       // 一場之內記得，⛔ 不必存檔
const spots = v => (v.details ?? []).map(
  d => `<b class="spot" style="left:${d.x * 100}%;top:${d.y * 100}%">${d.label}</b>`).join('');

/** 決定**整個面板的欄寬**，而不只是圖的寬度。
 *
 *  🔴 第一版只設圖的寬度，結果圖是置中的、標題與按鈕與資料全靠左
 *  ——桌機上差了 140px，看起來就是跑版。⇒ 欄寬算一次，所有東西共用（CSS 的 --col）。
 *
 *  倍率**放大時取整數**：像素畫布是 480px，非整數倍會把一個畫素攤成 1.7 個螢幕畫素，
 *  開了 image-rendering:pixelated 也是糊的。縮小時沒得挑，照比例。
 *
 *  ⚠️ 依據是**像素版的原生尺寸**（views.json 的 pixel，由 apply-details.py 寫入），
 *  不是當下顯示那張圖——切到真跡時那張的裁切不同（和紙含紙邊與奧付），
 *  拿它算欄寬會讓版面在切換時跳一次。 */
function fitArt(v) {
  const art = $('art');
  const img = art?.firstElementChild;
  const [pw, ph] = v.pixel ?? [480, 300];
  if (!img) return;
  const availW = $('panel').clientWidth - 40;          // 扣掉左右內距
  // 🔴 倍率是**視窗的性質，不是這一幅的性質**。原本拿這一幅的尺寸去算，
  // 於是矮一點的畫落在不同的整數倍上——58 新橋ステンション 顯示 480px、
  // 隔壁一幅 960px，同一個面板換一幅畫欄寬就跳一次（Aaron 看到的就是這個）。
  // 改成只看面板有多寬：像素畫布一律 480，所以每一幅都用同一個倍率。
  // ⛔ 不再拿高度去夾——夾了就等於「高的畫顯示得比較小」，又回到同一個毛病；
  // 高的畫多佔一點捲動就好（面板本來就 overflow:auto）。
  const k = availW / REF_W;
  const w = Math.round(pw * (k >= 1 ? Math.floor(k) : k));
  $('panel').style.setProperty('--col', `${w}px`);
  img.style.width = art.style.width = `${w}px`;
}

// ── 收景 ──────────────────────────────────────────────────────
function collect(v) {
  if (!collectable(v, clockOf(state), state)) return;
  state.collected.push(v.id);
  state.step++;                       // 收一景就過一刻
  tick(state, views);                 // 年份只由這裡推進（含防鎖死那一條）
  const first = clockOf(state).year >= 1881 && !state.fire;
  if (first) state.fire = true;
  save();
  paint();
  pick(v);                            // 面板留在原地，換成收過的樣子
  if (first) {
    card('兩国大火', `明治十四年一月廿六日，兩国起的火一路燒到淺草橋。<br>
      清親畫了四幅——燒著的天、逃的人，還有燒完之後。<br>
      <small>60 兩国大火浅草橋・61 濱町より寫兩国大火・62 久松町ニテ見る出火・63 兩国焼跡</small>`);
  } else if (state.collected.length === views.length) {
    card('光線畫到這裡為止', `明治十四年，清親不畫光線畫了。<br>
      石版與照片進來，木版的風景賣不動了。五年，${views.length} 幅。<br>
      <small>這是這位畫師畫下的整個東京。</small>`);
  }
}

/** 等一刻。⛔ 不能省——沒有這個動作，光線閘門就是鎖死
 *  （edo-hyakkei 卡在 89/118 過，原因正是時間只能靠收景推進）。 */
function wait() {
  state.step++;
  tick(state, views);
  save();
  paint();
}

function card(title, html) {
  $('card-body').innerHTML = `<h2>${title}</h2><p>${html}</p>`;
  $('card').classList.add('on');
}

function paint() {
  const clock = clockOf(state);
  setVisibility(v => visible(v, clock));
  map.render(views, clock, state, v => collectable(v, clock, state));
  const openN = views.filter(v => collectable(v, clock, state)).length;
  $('count').textContent = `${state.collected.length} / ${views.length}`;
  $('now').textContent = `明治${clock.year - 1867}年（${clock.year}）　${TIME_JA[clock.time]}　${WX_JA[clock.weather] ?? clock.weather}`;
  $('open').textContent = openN ? `現在可收 ${openN} 幅　帶我去 ↗` : '等時候';
  $('open').disabled = !openN;          // 沒東西可收時按了不該有反應
}
const shut = () => {
  stopWx();                       // 面板關了就別再跑動畫
  stopWx = () => {};
  $('panel').classList.remove('on');
  document.body.classList.remove('panel-open');
  selected?.classList.remove('sel');
  selected = null;
};
$('close').onclick = shut;
// ⚠️ 原寸檢視開著的時候，Esc 是它的——這個監聽先註冊所以先執行，
// 不擋的話一次按鍵會把兩層一起關掉（實測過）。
addEventListener('keydown', e => {
  // ⚠️ 上面蓋著東西時 Esc 是它的。這個監聽**先註冊所以先執行**，
  // 後註冊者的 stopPropagation 攔不住它 ⇒ 只能在這裡問「上面有沒有東西」。
  // 原寸檢視與畫卷同理，⛔ 新增一層就要記得加進這個選擇器。
  if (e.key === 'Escape' && !document.querySelector('.lightbox, .scroll-view')) shut();
});

// ── 年代滑桿 ──────────────────────────────────────────────────
// 讀數講的是「疊了多少」，不是哪一年——中間那些位置沒有任何一年長那樣。
// 兩端才報年份，因為那兩端是真的有資料的年份。
const era = $('era');
const say = () => {
  const t = era.value / 1000;
  $('eranow').textContent = t > 0.98 ? '明治十三年 1880 的地圖'
    : t < 0.02 ? '2026 現在的地圖'
    : `兩張圖疊著 — 明治 ${Math.round(t * 100)}%`;
};
era.oninput = () => { map.setEra(era.value / 1000); say(); };
map.setEra(era.value / 1000); say();

// ── 縮放鈕 ────────────────────────────────────────────────────
$('zin').onclick = () => map.zoomIn();
$('zout').onclick = () => map.zoomOut();
$('zfit').onclick = () => map.fitAll();
map.onChange(() => {
  $('zin').disabled = map.atMin();          // 按下去沒反應的鈕比沒有更糟
  $('zout').disabled = map.atMax();
});

// ── 當時的市街圖 ──────────────────────────────────────────────
// ⛔ 不對位，當文獻用（edo-hyakkei §3.6）。而且只連出去不收進 repo——
// 目前唯一夠好的那張掃描是 CC BY-NC-SA，理由寫在 data/reference-maps.json。
if (refmaps?.primary) {
  const m = refmaps.primary;
  const a = document.createElement('a');
  a.href = m.viewer; a.target = '_blank'; a.rel = 'noopener'; a.id = 'refmap';
  a.textContent = `${m.year} 年的東京 ↗`;
  a.title = `${m.title}（${m.holder.split('（')[0]}）`;
  $('hud').append(a);
}

// 驗收腳本要拿得到細節座標才驗得了「點中會標出來」。
// 只掛資料不掛函式——⛔ 不要讓測試從外面驅動遊戲邏輯，那樣測到的是測試自己。
window.__views = views;

// 清親本人與「光線画」是什麼，一場看一次就夠——放在 HUD，不佔每一幅的面板
const who = $('who');
if (who) who.onclick = () => {
  const n = topicMap.notes ?? {};
  // 生平分三節（出身・成為繪師・弟子），⛔ 不是導言那兩句——那兩句講不出他是誰
  const parts = ['作者', '生い立ち', '絵師になるまで', '様式', '弟子'].map(k => topicOf(n[k])).filter(Boolean);
  const conflict = (topicMap._conflict ?? {})['ワーグマンに師事'];
  const links = topicMap.links ?? [];
  card('清親與光線畫', `${parts.map(t =>
    `<b>${t.title}</b><br>${t.text}<br><a href="${t.url}" target="_blank" rel="noopener">維基百科（日文原文）↗</a>`
  ).join('<br><br>')}
    ${conflict ? `<br><br><small class="warn">⚠️ ${conflict}</small>` : ''}
    ${links.length ? `<br><br><b>延伸閱讀</b><br>${links.map(l =>
      `<a href="${l.url}" target="_blank" rel="noopener">${l.title}</a><br>
       <small>${l.who}<br>${l.why}</small>`).join('<br><br>')}` : ''}
    <br><br><small>⛔ 延伸閱讀是**連結不是引用**：那些文章有版權，一個字都不抄。<br>${(audio.tracks ?? []).length ? `配樂　${
    audio.tracks.map(t => `${t.title}（${t.issue}）`).join('・')}<br>
    🔴 1876–1881 沒有錄音存在（留聲機 1877 年才發明）——這五首是 1925–31 年錄的
    **當時仍在演奏的曲目**，全為公有領域。<br>` : ''}譯自維基百科日本語版　CC BY-SA 4.0<br>
    這部畫帖收 ${unmapped.length + views.length} 幅，地圖上有 ${views.length} 幅；另外 ${unmapped.length} 幅查不到座標，
    畫不到地圖上就不放進來——空白是資訊。</small>`);
};

// ── 畫卷 ──────────────────────────────────────────────────────
// 收進畫帖的景連成一卷、由右往左展讀。⛔ 還沒收的留空格不跳過——
// 卷長不隨進度變，才看得出「還差哪幾幅」。
$('emaki').onclick = () => openScroll(
  views.map((v, i) => ({ ...v, n: i + 1 })),      // n＝卷裡的順序，標籤用漢數字寫它
  v => state.collected.includes(v.id),
  v => { pick(v); map.goTo(v.id); },              // 從卷裡點進去，地圖也跟著移過去
  (v, mode) => (mode === 'pixel' ? pixel(v) : thumb(v)),
);
addEventListener('keydown', e => { if (e.key === 'e') $('emaki').click(); });

// ── 帶我去 ────────────────────────────────────────────────────
// 金點只有幾個、地圖卻是整個東京，「在哪裡」本身就是一道無謂的關卡
//（Aaron：「幾乎找不出來在地圖上的哪裡」）。這顆鈕把地圖滑到下一個金點。
// 🔑 **每按一次換下一個**，而且是從畫面中央往外算距離 ⇒ 連按就是照遠近巡一圈，
// ⛔ 不是每次都跳回同一個。剛帶到的那個要排除，否則按第二次原地不動看起來像壞了。
// ⚠️ 「排除上一個」不夠：帶過去之後，離新中心最近的就是剛剛離開的那個 ⇒ 兩點乒乓。
// 改成記住這一輪帶過的，全部走完才重來——連按就是把現在收得到的景巡一遍。
let toured = new Set();
let leadTimer = null, lastLed = null;
function guide() {
  const clock = clockOf(state);
  const open = views.filter(v => collectable(v, clock, state) && map.at(v.id));
  if (!open.length) return;
  let rest = open.filter(v => !toured.has(v.id));
  if (!rest.length) {                                          // 巡完一輪，從頭再來
    toured = new Set();
    // ⚠️ 但別把「現在正對著的這個」當成下一站——不然巡完一圈的那一按原地不動
    rest = open.filter(v => v.id !== lastLed);
    if (!rest.length) rest = open;
  }
  const [cx, cy] = map.centre();
  const d = v => { const [x, y] = map.at(v.id); return Math.hypot(x - cx, y - cy); };
  const next = rest.sort((a, b) => d(a) - d(b))[0];
  toured.add(next.id);
  lastLed = next.id;
  map.goTo(next.id);
  // 帶到了就把名字亮出來——不然玩家還是要在一堆點裡認哪一個是剛剛那個。
  // ⚠️ 計時器只能有一個：每個點各自計時的話，舊的那一個會把新亮起來的清掉
  //（實測連按第四次時 .lead 消失，就是前一次的計時器回來清的）。
  document.querySelectorAll('#map .mark.lead').forEach(e => e.classList.remove('lead'));
  clearTimeout(leadTimer);
  const g = map.node(next.id);
  if (g) {
    g.classList.add('lead');
    leadTimer = setTimeout(() => g.classList.remove('lead'), 2600);
  }
}
$('open').onclick = guide;
addEventListener('keydown', e => { if (e.key === 'g') guide(); });

// ── 開場與跑馬燈 ──────────────────────────────────────────────
// 開場只有第一次自己跳出來（存在 localStorage），之後從 HUD 的「開場」重看。
const intro = () => playIntro({
  views, total: views.length + unmapped.length, yearOf, src: v => thumb(v),
  topic: name => topicOf(name),
  // ⛔ 開場關掉之後**什麼都不要動**。第一版順手叫了 map.fitAll()，那等於把開場視角
  // 從「框住江戶本體」換成「整張紙」——市中心的點會擠成一團互相蓋住（驗收腳本
  // 當場點不到標記）。開場是一層蓋在上面的東西，不該改遊戲的狀態。
});
$('replay').onclick = intro;

// ── 配樂 ──────────────────────────────────────────────────────
// 🔴 不是「明治九年的聲音」：1876–1881 沒有錄音存在。這五首是 1925–31 年錄的
// **當時仍在演奏的曲目**（端唄・雅樂・尺八本曲・新內・追分），全是公有領域，
// 出處與盤號記在 data/audio.json。⚠️ 瀏覽器要等使用者動作才准出聲 ⇒ 只在按鈕與
// 開場的「入場」之後才 play()。
const music = createMusic(audio.tracks ?? [], {
  onTrack: t => { $('nowplaying').textContent = t ? `♪ ${t.title}` : ''; },
});
const paintMusic = on => {
  $('music').classList.toggle('on', on);
  $('music').title = on ? '關掉配樂（M）' : '配樂：五首公有領域的早期唱片（M）';
  if (!on) $('nowplaying').textContent = '';
};
$('music').onclick = () => paintMusic(music.toggle());
addEventListener('keydown', e => { if (e.key === 'm') $('music').click(); });
paintMusic(music.on);
// 上次開著就等第一次點擊／按鍵接著放（開場的「入場」也算那一下）
music.armResume();
// 驗收要看得到 AudioContext 的狀態與增益（見 audio.js 的 debug()）。
// ⚠️ 這一行只能放在 music 建好之後——放到上面 window.__views 那裡會是 TDZ，
// 整支模組在那裡就丟 ReferenceError，後面的接線全部沒跑（自己剛剛踩過）。
window.__music = music;

// ── 沈浸模式 ──────────────────────────────────────────────────
// 全螢幕 ＋ 把周邊收到很淡，只留地圖與畫。
// ⚠️ iOS Safari 不讓非 video 元素進全螢幕 ⇒ **就算進不了全螢幕，也要照樣收起周邊**，
// 否則那顆鈕在手機上按了完全沒反應。所以兩件事分開做：class 自己管，全螢幕盡力而為。
const setImmersive = on => {
  document.body.classList.toggle('immersive', on);
  $('full').textContent = on ? '離開' : '沈浸';
};
$('full').onclick = async () => {
  const on = !document.body.classList.contains('immersive');
  setImmersive(on);
  try {
    if (on) await document.documentElement.requestFullscreen?.();
    else if (document.fullscreenElement) await document.exitFullscreen();
  } catch { /* 不給全螢幕就算了，周邊照樣收起來 */ }
};
// 用 F11 或 Esc 自己離開全螢幕時，class 要跟著回來
addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) setImmersive(false);
});
addEventListener('keydown', e => { if (e.key === 'f') $('full').click(); });
if (!introSeen()) intro();

// 手機上 HUD 會折行，跑馬燈得知道它多高才放得下去（⛔ 不要寫死）
const hudH = () => document.documentElement.style.setProperty(
  '--hud-h', `${Math.round($('hud').getBoundingClientRect().height)}px`);
// ⚠️ 只在載入時量一次不夠：HUD 的內容之後才填（「現在可收 N 幅」），一填就變高，
// 量到的還是舊值（實測跑馬燈因此壓在 HUD 底下）。⇒ 讓 ResizeObserver 盯著它。
new ResizeObserver(hudH).observe($('hud'));
hudH();

startTicker($('ticker'), {
  views, yearOf,
  blurb: [
    '小林清親《東京名所圖》　<i>光線畫・明治九年–十四年 1876–1881</i>',
    `收錄 ${views.length + unmapped.length} 幅，地圖上 ${views.length} 幅　<i>另 ${unmapped.length} 幅查不到座標，空白是資訊</i>`,
    '典藏　国立国会図書館デジタルコレクション《清親畫帖》　<i>寄別1-9-2-3・公有領域</i>',
  ],
});

$('wait').onclick = wait;
$('card-close').onclick = () => $('card').classList.remove('on');
addEventListener('keydown', e => { if (e.key === 'w') wait(); });
paint();
