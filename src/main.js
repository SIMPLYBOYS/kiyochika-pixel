// Phase 1 的全部：把 59 個座標放上兩層皮的地圖，點一下看畫。
// ⛔ 沒有玩法、沒有進度、沒有收集——那些是 Phase 3 的事。
import { createMap } from './map.js';

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

const map = createMap($('map'), views, world.layers, places, pick);

// ── 面板 ──────────────────────────────────────────────────────
// 🔴 圖用 repo 裡的 assets/thumb（tools/make-thumbs.py 產），不連 NDL 的 IIIF。
// 直接連試過：回 429。那次是我們自己當天抓太多，但道理不變——
// 上線之後每個玩家開一次面板就打 NDL 一次，既脆弱又不禮貌。
const thumb = v => `assets/thumb/${String(v.id).padStart(2, '0')}.jpg`;
const CONF = {
  osm: ['查到地物本身', 'OSM'],
  wikidata: ['查到地物本身', 'Wikidata'],
  district: ['只到這一帶', '駅名或町名'],
  low: ['依據有缺口', ''],
  manual: ['人工定位', ''],
};
let selected = null;

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
  if (selected) selected.classList.add('sel');
  const a = v.place?.anchor ?? {};
  const [why, from] = CONF[a.confidence] ?? ['—', ''];
  const src = a.source ?? [a.osm && `OSM ${a.osm}`, a.how].filter(Boolean).join('　');
  $('body').innerHTML = `
    <h2>${v.title.ja}</h2>
    <img src="${thumb(v)}" alt="${v.title.ja}">
    <dl>
      <dt>出版</dt><dd>${v.published ?? '<span class="warn">未判讀</span>'}${
        v.published_confidence === 'blank' ? '<span class="warn">（版上的御届欄空白）</span>' : ''}</dd>
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

const on = views.filter(v => v.subject).length;
$('count').textContent = `${on} / ${views.length} 幅在圖上`;
$('sub').textContent = `小林清親《東京名所図》光線画　1876–1881　·　實心＝查到地物本身，空心＝只到那一帶`;
