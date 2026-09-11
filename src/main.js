// 遊戲本體。兩層閘門（年份決定何時出現、光線決定何時可收）的邏輯在 src/clock.js，
// 這裡只負責把它接到畫面上：時鐘、收景、進度、事件、結局。
// ⛔ 細節搜尋（每景 2–3 個可點的細節）還沒做——那要逐幅挑座標，是另一塊工。
import { createMap, setVisibility } from './map.js';
import { clockOf, blocked, collectable, visible, yearOf, tick, newState } from './clock.js';

const $ = id => document.getElementById(id);

// 開發時資料檔要繞過快取。localhost 才加，線上讓瀏覽器正常快取。
// （模組本身由 tools/serve.py 加版本號，見那支的檔頭。）
const bust = location.hostname === 'localhost' ? `?t=${Date.now()}` : '';
const grab = async url => {
  const r = await fetch(url + bust);
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);   // fetch 對 404 不會 reject
  return r.json();
};

const [all, world, ml, refmaps] = await Promise.all([
  grab('data/views.json'),
  grab('data/geo/modern.json'),
  // 地名只是裝飾，掛掉不該連地圖一起拖下水
  grab('data/meiji-places.json').catch(e => (console.warn('地名層略過:', e), { places: [] })),
  grab('data/reference-maps.json').catch(e => (console.warn('文獻地圖略過:', e), null)),
]);

const views = all.filter(v => v.include);

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
const thumb = v => `assets/thumb/${pad(v)}.jpg`;      // 真跡（和紙，含奧付）
const pixel = v => `assets/pixel/${pad(v)}.png`;      // 像素版（480px・16 色・Bayer）
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
const CONF = {
  osm: ['查到地物本身', 'OSM'],
  wikidata: ['查到地物本身', 'Wikidata'],
  district: ['只到這一帶', '駅名或町名'],
  low: ['依據有缺口', ''],
  manual: ['人工定位', ''],
};
let selected = null, shownId = null;

// 現在那裡是哪裡。tools/derive-place.py 從 OSM 的行政界做內外判定得來的，
// 街景連結不帶金鑰（api=1 的分享網址），沒有街景的地點 Google 會自己退到地圖。
// ⚠️ 区與町可能不一致：44 大川富士見渡的點在河中央（那是渡船），
// 落在墨田区，最近的町卻是對岸台東区的蔵前——兩個都對，所以兩個都寫。
function here(v) {
  const p = v.place ?? {};
  if (!p.modern_ward) return '';
  const town = p.modern_town ? `${p.modern_town}<small>（${p.modern_town_km}km）</small>` : '';
  const pano = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${v.subject.lat},${v.subject.lng}`;
  return `<dt>現在</dt><dd>${p.modern_ward} ${town}<br>
    <a href="${pano}" target="_blank" rel="noopener">站到那裡看 ↗</a></dd>`;
}

function pick(v) {
  if (selected) selected.classList.remove('sel');
  selected = map.node(v.id);
  if (selected) { selected.classList.add('sel'); selected.dataset.id = v.id; }
  shownId = v.id;
  const a = v.place?.anchor ?? {};
  const [why, from] = CONF[a.confidence] ?? ['—', ''];
  const src = a.source ?? [a.osm && `OSM ${a.osm}`, a.how].filter(Boolean).join('　');
  const clock = clockOf(state);
  const b = blocked(v, clock, state);
  const got = state.collected.includes(v.id);
  const y = yearOf(v);
  const c = v.conditions || {};
  const cond = [c.time_of_day && TIME_JA[c.time_of_day], c.weather && (WX_JA[c.weather] || c.weather)]
    .filter(Boolean).join('・');
  $('body').innerHTML = `
    <h2>${v.title.ja}</h2>
    <div id="art"><img src="${got ? pixel(v) : thumb(v)}" alt="${v.title.ja}">${got ? hunt(v) : ''}</div>
    ${got ? `<p class="hint">${hint(v)}</p><button id="flip" class="wide">像素 ／ 真跡</button>` : ''}
    ${b ? `<p class="gate">${WHY[b.why](b)}</p>`
        : '<button id="take" class="wide take">收入畫帖</button>'}
    <dl>
      <dt>年</dt><dd>${y ?? '<span class="warn">年代未詳</span>'}${
        v.published ? `　<small>奧付 ${v.published}</small>` : ''}</dd>
      ${cond ? `<dt>光</dt><dd>${cond}</dd>` : ''}
      <dt>座標</dt><dd>${v.subject.lat.toFixed(5)}, ${v.subject.lng.toFixed(5)}</dd>
      <dt>把握</dt><dd>${why}${from ? `　<small>${from}</small>` : ''}</dd>
      <dt>依據</dt><dd><small>${src || '—'}</small></dd>
      ${here(v)}
      ${v.notes?.geo ? `<dt>備註</dt><dd><small>${v.notes.geo}</small></dd>` : ''}
      <dt>典藏</dt><dd><a href="https://dl.ndl.go.jp/pid/${v.source.pid}" target="_blank"
        rel="noopener">NDL ${v.source.item}・第 ${v.source.page} 圖</a><br>
        <small>${v.source.call_number}　${v.source.license}</small></dd>
    </dl>`;
  $('panel').classList.add('on');
  const take = $('take');
  if (take) take.onclick = () => collect(v);
  const flip = $('flip');
  if (flip) {
    let px = true;
    flip.onclick = () => {
      px = !px;
      $('art').firstElementChild.src = px ? pixel(v) : thumb(v);
      // 真跡的構圖跟像素版不同（和紙含紙邊與奧付），座標對不上 ⇒ 切過去就不能找
      $('art').classList.toggle('plate', !px);
    };
    $('art').onclick = e => { if (!$('art').classList.contains('plate')) poke(v, e); };
  }
}

// ── 細節搜尋 ──────────────────────────────────────────────────
// 收過的畫可以在畫面上找東西。座標由 tools/derive-details.py 在**像素版**上算、
// 人工挑過（data/details.json）⇒ 找得到的必然是量化之後還在的東西。
// 🔴 所以只在像素版上開放搜尋：切到真跡時關掉，那邊的座標對不上。
const foundOf = v => state.found?.[v.id] ?? [];
const hunt = v => (v.details ?? []).map((d, i) => foundOf(v).includes(i)
  ? `<b class="spot" style="left:${d.x * 100}%;top:${d.y * 100}%">${d.label}</b>` : '').join('');
const hint = v => {
  const n = (v.details ?? []).length;
  if (!n) return '';
  const f = foundOf(v).length;
  if (f >= n) return `${n} つとも見つけた`;
  const left = (v.details ?? []).filter((_, i) => !foundOf(v).includes(i));
  const light = left.filter(d => d.kind === 'light').length;
  return `絵の中に ${n} つ。見つけた ${f}${light ? `　<small>のこりに 光 が ${light}</small>` : ''}`;
};

/** 點畫面找細節。判定圈半徑是資料裡的 r（畫布寬的比例），⛔ 不要在這裡另訂一個。 */
function poke(v, e) {
  if (!state.collected.includes(v.id) || !(v.details ?? []).length) return;
  const img = $('art').firstElementChild;
  const b = img.getBoundingClientRect();
  const x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height;
  const ar = b.width / b.height;            // 判定圈是圓的，y 要照長寬比換算
  const i = v.details.findIndex((d, k) => !foundOf(v).includes(k)
    && Math.hypot(d.x - x, (d.y - y) / ar) < d.r);
  if (i < 0) return;
  (state.found ??= {})[v.id] = [...foundOf(v), i];
  save();
  pick(v);
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
    card('兩国大火', `明治十四年一月廿六日、兩国から出た火が浅草橋まで焼けた。<br>
      清親はそれを四枚描いている——燃える空、逃げる人、そして焼跡。<br>
      <small>60 兩国大火浅草橋・61 濱町より寫兩国大火・62 久松町ニテ見る出火・63 兩国焼跡</small>`);
  } else if (state.collected.length === views.length) {
    card('光線画は、ここで終わる', `明治十四年、清親は光線画をやめた。<br>
      石版と写真が入り、木版の景色は売れなくなる。五年、${views.length} 枚。<br>
      <small>これがこの絵師が描いた東京のすべてです。</small>`);
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
  $('open').textContent = openN ? `いま ${openN} 枚` : '時を待つ';
}
const shut = () => { $('panel').classList.remove('on'); selected?.classList.remove('sel'); selected = null; };
$('close').onclick = shut;
addEventListener('keydown', e => e.key === 'Escape' && shut());

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

$('wait').onclick = wait;
$('card-close').onclick = () => $('card').classList.remove('on');
addEventListener('keydown', e => { if (e.key === 'w') wait(); });
paint();
