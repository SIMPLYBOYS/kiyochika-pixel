// Phase 1 的驗收。跑 `node tools/check-map.mjs`（需要 playwright 的 chromium）。
//
// 這支盯的是三件自動化以外看不出來、而且壞掉都不會噴錯的事：
//
//   一、**直式手機**。preserveAspectRatio 是 slice，縮放倍率取
//       max(視窗寬/vb.w, 視窗高/vb.h)——「哪一邊綁住」由視窗寬高比決定，
//       桌機是寬邊、直式手機是高邊。edo-hyakkei 在這裡錯過兩次（開場只框到
//       該有的一半、地名被畫成 22px 而不是 12px），兩次在桌機上都看不出來。
//   二、**年代滑桿的兩端**。1880 那側該消失的（現代鐵路幹道）與該出現的
//       （1872 新橋鐵道、明治 15 区）如果反了，畫面仍然是一張好看的地圖。
//   三、**點得到**。標記是 <g> 不是 <circle>，pointerdown 若被 svg 攔走
//       就永遠不會觸發 onclick——edo-hyakkei 為此寫過「不要 setPointerCapture」。
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const { chromium } = createRequire(process.env.HOME + '/')('playwright');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = spawn('python3', [resolve(ROOT, 'tools/serve.py'), String(PORT)],
                     { cwd: ROOT, stdio: 'ignore' });
const bye = code => { server.kill(); process.exit(code); };
await sleep(700);

let bad = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ok  ' : '  ✗   '}${msg}`); if (!cond) bad++; };

const browser = await chromium.launch();
for (const [name, size] of [['桌機 1440×900', { width: 1440, height: 900 }],
                            ['直式手機 390×844', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 2 });
  const errs = [];
  page.on('console', m => m.type() === 'error' && errs.push(m.text()));
  page.on('pageerror', e => errs.push(String(e)));
  page.on('response', r => r.status() >= 400 && errs.push(`HTTP ${r.status} ${r.url()}`));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await sleep(400);
  console.log(`\n${name}`);

  const marks = await page.locator('#map .mark').count();
  ok(marks === 59, `標記 ${marks} 個（views.json 裡有座標的就是 59）`);
  ok(errs.length === 0, `主控台乾淨${errs.length ? '：' + errs.slice(0, 3).join(' / ') : ''}`);

  // 圓點與地名的畫面尺寸。寫死 7px/13px 在 CSS 裡，map.js 每次縮放用 scale 抵銷
  // viewBox——這兩個數字對不上，就是那個 slice 倍率又算錯了。
  const r = await page.locator('#map .mark circle').first().boundingBox();
  ok(r && r.width > 9 && r.width < 26, `圓點直徑 ${r ? r.width.toFixed(1) : '?'} CSS px（該在 14 上下，窄螢幕 ×0.8）`);

  // 開場要看得到景，而且不是只看得到一兩個
  const vis = await page.locator('#map .mark').evaluateAll(
    (gs, vp) => gs.filter(g => { const b = g.getBoundingClientRect();
      return b.x > 0 && b.y > 0 && b.x < vp.width && b.y < vp.height; }).length, size);
  ok(vis >= 20, `開場畫面內有 ${vis} 個景（太少代表取景又縮到只剩一小塊）`);

  // 年代滑桿兩端。1880 那側：現代設施消失、1872 鐵道出現、明治区名出現
  const op = sel => page.locator(sel).evaluate(e => +getComputedStyle(e).opacity);
  const kuOn = () => page.locator('#places .ku').evaluateAll(
    ts => ts.filter(t => getComputedStyle(t).display !== 'none').length);
  const cityOn = () => page.locator('#places .city').evaluateAll(
    ts => ts.filter(t => getComputedStyle(t).display !== 'none').length);

  await page.locator('#era').evaluate(e => { e.value = 1000; e.dispatchEvent(new Event('input')); });
  await sleep(250);
  ok(await op('#modern') < 0.05, '1880：現代鐵路與幹道消失');
  ok(await op('#rail1872') > 0.9, '1880：新橋—横浜鐵道（1872）出現');
  ok(await op('#reclaimed') > 0.9, '1880：填海地變回海');
  const ku1880 = await kuOn(), city1880 = await cityOn();

  await page.locator('#era').evaluate(e => { e.value = 0; e.dispatchEvent(new Event('input')); });
  await sleep(250);
  ok(await op('#modern') > 0.9, '2026：現代鐵路與幹道回來');
  ok(await op('#rail1872') < 0.05, '2026：1872 那條收起來（它併進現代路網了）');
  const ku2026 = await kuOn(), city2026 = await cityOn();
  ok(ku1880 > 0 && ku2026 === 0, `明治 15 区只在 1880 側（1880:${ku1880} / 2026:${ku2026}）`);
  ok(city2026 > 0 && city1880 === 0, `現代区名只在 2026 側（1880:${city1880} / 2026:${city2026}）`);

  // 點得到，而且面板裡的圖真的載得起來（IIIF 網址壞掉不會有任何錯誤訊息）
  // 點圓本身不點 <g>：<g> 的 bbox 含右邊那條景名（pointer-events:none），
  // 中心會落在標籤那一半的空白上，測起來像「點不到」但人是點得到的。
  await page.locator('#map .mark circle').first().click();
  await sleep(200);
  ok(await page.locator('#panel.on').count() === 1, '點標記會開面板');
  // 等它真的載完，不是等它「可見」——面板是滑進來的，可見不等於圖到了。
  // （第一版只等可見，於是這條一直紅，而 curl 拉同一個網址是好的。
  //  真正的原因是 <img loading="lazy"> ＋ 面板一開始在畫面外 ⇒ 瀏覽器延後載入。）
  const loaded = await page.waitForFunction(
    () => { const i = document.querySelector('#panel img'); return i && i.complete && i.naturalWidth > 0; },
    null, { timeout: 20000 }).then(() => true, () => false);
  ok(loaded, '面板的圖載得起來（assets/thumb，不連 NDL）');
  // 現代地址與街景連結（derive-place.py 的產物；59/59 都該有）
  const hasHere = await page.locator('#panel dt', { hasText: '現在' }).count();
  ok(hasHere === 1, '面板有「現在」那一列（現代区名＋町名）');
  const pano = await page.locator('#panel a[href*="map_action=pano"]').getAttribute('href').catch(() => null);
  ok(/viewpoint=35\.\d+,139\.\d+/.test(pano || ''), `街景連結帶得出座標 ${pano ? pano.slice(-24) : '（沒有）'}`);
  // 當時的市街圖：只連出去（reference-maps.json 說明為什麼不收進 repo）
  const ref = await page.locator('#hud #refmap').getAttribute('href').catch(() => null);
  ok(/^https:\/\//.test(ref || ''), '當時的市街圖有連結');

  await page.keyboard.press('Escape');
  await sleep(150);
  ok(await page.locator('#panel.on').count() === 0, 'Esc 關得掉');

  await page.close();
}
await browser.close();
console.log(bad ? `\n${bad} 項不過` : '\n全過');
bye(bad ? 1 : 0);
