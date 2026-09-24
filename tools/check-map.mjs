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
import { readFileSync } from 'node:fs';
import { yearOf, PER_YEAR } from '../src/clock.js';

const { chromium } = createRequire(process.env.HOME + '/')('playwright');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠️ 地圖上該有幾個點**從資料算**，⛔ 不寫死：收錄井上安治四幅之後從 59 變 63，寫死的數字只會讓測試跟著資料一起錯
const VIEWS = JSON.parse(readFileSync(resolve(ROOT, 'data/views.json'), 'utf8'));
const MAPPED = VIEWS.filter(v => v.include && v.subject).length;
// AI 重繪版有幾幅也**從資料算**：開場印的數字要跟 data/motion.json 對得上
const CLIPS = JSON.parse(readFileSync(resolve(ROOT, 'data/motion.json'), 'utf8')).clips.length;
const PORT = 8000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = spawn('python3', [resolve(ROOT, 'tools/serve.py'), String(PORT)],
                     { cwd: ROOT, stdio: 'ignore' });
const bye = code => { server.kill(); process.exit(code); };
await sleep(700);

let bad = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ok  ' : '  ✗   '}${msg}`); if (!cond) bad++; };

// 🔴 配樂檔要 **faststart**（moov 在 mdat 前面）：moov 是播放索引，寫在檔案最後面的話
// 瀏覽器得把整首 1–3MB 下載完才出得了聲——手機上就是「按了很久音樂才出現」（2026-09-24 玩家回報）。
// ⚠️ 這件事在畫面上完全看不出來（桌機快取一下就聽不到差別），所以只能在這裡量檔案本身。
// 順便驗每首都有 v（內容雜湊）：/assets/audio/* 是 7 天快取而檔名不變，沒有它改了也沒人收得到。
const TRACKS = JSON.parse(readFileSync(resolve(ROOT, 'data/audio-tracks.json'), 'utf8')).tracks ?? [];
const atoms = file => {                      // 只走最外層的 box，夠判斷順序了
  const b = readFileSync(resolve(ROOT, file));
  const out = [];
  for (let p = 0; p + 8 <= b.length && out.length < 8;) {
    let sz = b.readUInt32BE(p);
    out.push(b.toString('latin1', p + 4, p + 8));
    if (sz === 1) sz = Number(b.readBigUInt64BE(p + 8));
    if (sz < 8) break;
    p += sz;
  }
  return out;
};
const slow = TRACKS.filter(t => { const a = atoms(t.file); return a.indexOf('moov') > a.indexOf('mdat'); });
ok(TRACKS.length > 0 && slow.length === 0,
   `配樂 ${TRACKS.length} 首都是 faststart（moov 在 mdat 前）${slow.length ? '：' + slow.map(t => t.file).join('、') : ''}`);
ok(TRACKS.every(t => t.v), `配樂每首都有版本碼 v（${TRACKS.map(t => t.v).join('・')}）`);

const browser = await chromium.launch();
for (const [name, size] of [['桌機 1440×900', { width: 1440, height: 900 }],
                            ['直式手機 390×844', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 2 });
  const errs = [];
  page.on('console', m => m.type() === 'error' && errs.push(m.text()));
  page.on('pageerror', e => errs.push(String(e)));
  page.on('response', r => r.status() >= 400 && errs.push(`HTTP ${r.status} ${r.url()}`));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await sleep(600);
  // 開場：第一次進來會擋在前面，先驗它再進場（後面的檢查都要點得到地圖）
  const intro = await page.evaluate(() => {
    const el = document.querySelector('.intro');
    if (!el) return null;
    return { reel: el.querySelectorAll('.ireel img').length,
             title: el.querySelector('h1')?.textContent,
             src: /CC BY-SA/.test(el.textContent),
             ai: (el.textContent.match(/AI 重繪版\s*(\d+) 幅/) || [])[1],
             aiSays: /非原作/.test(el.textContent) && /差異/.test(el.textContent) };
  });
  ok(intro && intro.reel === 6 && intro.title === '東京名所圖' && intro.src,
     `開場：六幅依年份淡入、標題與出處都在`);
  // 🔴 開場也要講 AI 重繪那一層，而且**數字從 data/motion.json 算**、⛔ 不寫死；
  // 講法要跟面板一致：非原作、列出差異（⛔ 不能只說「有 AI 動畫」就算了）。
  ok(intro && +intro.ai === CLIPS && intro.aiSays,
     `開場講了 AI 重繪版 ${intro?.ai} 幅（motion.json 有 ${CLIPS}）、寫明非原作並會列出差異`);
  await page.locator('.intro [data-act="enter"]').click();
  await sleep(600);
  ok(await page.locator('.intro').count() === 0, '按「入場」關得掉開場');
  await sleep(300);
  console.log(`\n${name}`);

  const { width: vwHalf0, height: vhHalf0 } = page.viewportSize();
  const vwHalf = vwHalf0 / 2, vhHalf = vhHalf0 / 2;
  const marks = await page.locator('#map .mark').count();
  ok(marks === MAPPED, `標記 ${marks} 個（views.json 裡有座標的就是 ${MAPPED}）`);
  ok(errs.length === 0, `主控台乾淨${errs.length ? '：' + errs.slice(0, 3).join(' / ') : ''}`);

  // 圓點與地名的畫面尺寸。寫死 7px/13px 在 CSS 裡，map.js 每次縮放用 scale 抵銷
  // viewBox——這兩個數字對不上，就是那個 slice 倍率又算錯了。
  const r = await page.locator('#map .mark circle.dot').first().boundingBox();
  ok(r && r.width > 9 && r.width < 26, `圓點直徑 ${r ? r.width.toFixed(1) : '?'} CSS px（該在 14 上下，窄螢幕 ×0.8）`);

  // 🔴 開場看得到幾個景，由**閘門**決定而不是取景——1876 年只有那一年的與年代未詳的
  // 已經出版。所以這裡不能再寫死一個下限（Phase 1 寫的是 ≥20，改成年份閘門之後就紅了），
  // 要拿 clock.js 的規則算出期待值來比。看得到的比期待多，代表閘門沒生效。
  const views = JSON.parse(readFileSync(resolve(ROOT, 'data/views.json'), 'utf8')).filter(v => v.include);
  const want = views.filter(v => v.subject && (yearOf(v) == null || yearOf(v) <= 1876)).length;
  // 🔴 可收的點要一眼找得到。`.pulse` 的 CSS 寫了一個月，**元素從來沒生出來**——
  // 於是「可收」與「收不了」的差別只剩填色，59 個點裡找 6 個金點。這一項驗那三圈都在。
  const dots = await page.evaluate(() => {
    const o = document.querySelector('#map .mark.open'), c = document.querySelector('#map .mark.closed');
    if (!o || !c) return null;
    const op = e => +getComputedStyle(e).opacity;
    return { halo: !!o.querySelector('.halo') && op(o.querySelector('.halo')) > 0,
             pulse: !!o.querySelector('.pulse') && getComputedStyle(o.querySelector('.pulse')).animationName !== 'none',
             stagger: new Set([...document.querySelectorAll('#map .mark.open .pulse')]
                        .map(e => e.style.animationDelay)).size > 1,
             pop: op(o.querySelector('circle.dot')) - op(c.querySelector('circle.dot')) >= 0.5 };
  });
  ok(dots && dots.halo && dots.pulse && dots.stagger && dots.pop,
     `可收的點有靜態暈圈＋漣漪（錯開起始）、且明顯比收不了的亮 ${JSON.stringify(dots)}`);

  // 跑馬燈：作品介紹＋每一幅的題名年份，橫著跑。
  // 🔴 它是「浮在畫面上的一條」⇒ 不能壓到 HUD／年代列／縮放鈕（手機上 HUD 會折行，
  // 寫死位置就會被壓住——實測過，所以位置是量出來的）。
  const tick = await page.evaluate(() => {
    const t = document.querySelector('#ticker');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    const hits = sel => {
      const e = document.querySelector(sel); if (!e) return false;
      const b = e.getBoundingClientRect();
      return !(r.bottom <= b.top || r.top >= b.bottom || r.right <= b.left || r.left >= b.right);
    };
    return { runs: t.querySelectorAll('.tk').length, over: hits('#hud') || hits('#bar') || hits('#zoom'),
             x: t.querySelector('.tk').getBoundingClientRect().x };
  });
  await sleep(1200);
  const tickMoved = await page.evaluate(() => document.querySelector('#ticker .tk').getBoundingClientRect().x);
  // 🔴 HUD 一列裝不下也不能折行：折了就從 44px 長到 123px，把地圖壓掉一大塊
  const hudH = await page.locator('#hud').evaluate(e => Math.round(e.getBoundingClientRect().height));
  ok(hudH < 60, `HUD 維持一列（${hudH}px）`);
  ok(tick && tick.runs === 2 && !tick.over && tickMoved < tick.x,
     `跑馬燈在跑（${Math.round(tick.x)} → ${Math.round(tickMoved)}）且沒壓到 HUD／年代列／縮放鈕`);

  // 沈浸模式：全螢幕＋周邊收到很淡，只留地圖。
  // 🔴 但**出處不能收**——ODbL 要求標示出處，沈浸模式也一樣 ⇒ 只縮小不隱藏。
  // ⚠️ 驗的是 class 與透明度，⛔ 不驗 fullscreenElement：iOS Safari 不給非 video 全螢幕，
  // 那種環境下周邊照樣要收得起來（不然那顆鈕按了完全沒反應）。
  const bg0 = await page.evaluate(() => ['#hud', '#bar'].map(s => getComputedStyle(document.querySelector(s)).background).join(' | '));
  await page.locator('#full').click();
  await page.mouse.move(vwHalf, vhHalf);        // 游標要離開 HUD，否則量到的是 hover 後的值
  await sleep(600);
  const imm = await page.evaluate(() => {
    const op = s => +getComputedStyle(document.querySelector(s)).opacity;
    const attr = getComputedStyle(document.querySelector('#attr'));
    return { on: document.body.classList.contains('immersive'), hud: op('#hud'), zoom: op('#zoom'),
             attrShown: attr.display !== 'none' && +attr.opacity > 0.1,
             label: document.querySelector('#full').textContent };
  });
  ok(imm.on && imm.hud <= 0.25 && imm.zoom <= 0.25 && imm.attrShown && imm.label === '離開',
     `沈浸模式收起周邊（HUD ${imm.hud}）但出處還在`);
  // 🔴 桌機也能點地圖空白處叫出選單，**叫出來的底色要跟一開始一模一樣**。第一版沈浸把 HUD 底色
  // 換成 60% 的 #0e223399、滑桿那列拿掉漸層，亮起來時比平常透明（Aaron 在桌機回報）；
  // 舊測試只量收起來的 opacity，沒量叫出來長什麼樣，所以沒抓到。
  const blank = await page.evaluate(() => {
    for (const [fx, fy] of [[.5, .5], [.3, .6], [.7, .4], [.2, .35], [.8, .65], [.45, .75]]) {
      const x = innerWidth * fx, y = innerHeight * fy, el = document.elementFromPoint(x, y);
      if (el?.closest('#map') && !el.closest('.mark')) return [x, y];
    }
  });
  const chromeLook = () => page.evaluate(() => ({
    op: ['#hud', '#zoom', '#bar label', '#eranow'].map(s => +getComputedStyle(document.querySelector(s)).opacity),
    bg: ['#hud', '#bar'].map(s => getComputedStyle(document.querySelector(s)).background).join(' | ') }));
  await page.mouse.click(...blank); await sleep(600);
  const immShown = await chromeLook();
  await page.mouse.click(...blank); await sleep(600);
  const immBack = await chromeLook();
  ok(blank && immShown.op.every(o => o === 1) && immShown.bg === bg0 && immBack.op[0] <= 0.25,
     `桌機：點地圖空白處叫出選單（${immShown.op.join('/')}）、底色跟一開始一樣${immShown.bg === bg0 ? '' : `（✗ ${immShown.bg} ≠ ${bg0}）`}、再點收回去（${immBack.op[0]}）`);
  // 🔴 年代滑桿不是周邊，是這一作的主題（1880 ⇄ 2026）。第一版把它一起壓到 0.18，
  // 技術上還拉得動，但在花花的地圖上看不見、又只有 16px 高 ⇒ 實際上不能用。
  const era = await page.locator('#era');
  const eraLook = await era.evaluate(e => ({ op: +getComputedStyle(e).opacity,
                                             h: Math.round(e.getBoundingClientRect().height) }));
  const box = await era.boundingBox();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.up();
  await sleep(300);
  const pulled = +await era.inputValue();
  ok(eraLook.op >= 0.4 && eraLook.h >= 22 && pulled > 600 && pulled < 900,
     `沈浸時年代滑桿看得見（${eraLook.op}／${eraLook.h}px）也拉得動（→ ${pulled}）`);
  await era.evaluate(e => { e.value = 1000; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.keyboard.press('f');
  await sleep(500);
  ok(await page.evaluate(() => !document.body.classList.contains('immersive')), '按 F 離開沈浸模式');

  // 天候層：只動氛圍（雪・雨・夜的燈火明滅），而且**只在資料說得出來的景上動**。
  // 🔴 驗的是「真的在動」——截圖看不出動態，所以取兩次畫面的總亮度比對。
  // ⚠️ 也要驗「沒有條件的景不動」：那是這一層的分寸，動了就是替清親決定畫面。
  const wxOf = async title => {
    await page.evaluate(t => {
      const g = [...document.querySelectorAll('#map .mark')].find(e => e.querySelector('text')?.textContent === t);
      g?.querySelector('circle.dot').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, title);
    await sleep(900);
    return page.evaluate(() => {
      const c = document.querySelector('#art .wx');
      if (!c) return null;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      for (let i = 3; i < d.length; i += 4) sum += d[i];
      return sum;
    });
  };
  const snow1 = await wxOf('海運橋（第一銀行雪）');
  await sleep(600);
  const snow2 = await page.evaluate(() => {
    const c = document.querySelector('#art .wx');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 3; i < d.length; i += 4) sum += d[i];
    return sum;
  });
  const plain = await wxOf('東京銀座街日報社');
  ok(snow1 > 0 && snow2 > 0 && snow1 !== snow2 && plain === null,
     `天候層：雪景在下雪（${snow1} → ${snow2}），沒寫天候的景不動`);
  // ⚠️ 這一段開過面板 ⇒ 收乾淨再走。面板開著時 HUD 會收起一部分，
  // 下一項要點的 #music 就變成「點得到但到不了」（實測卡在這裡 30 秒逾時）。
  // **會改變狀態的檢查，要自己把狀態還原。**
  await page.keyboard.press('Escape');
  await sleep(300);

  // 配樂。🔴 這一項驗的是**聽得到**，⛔ 不是「在播放」——兩者是兩回事：
  // AudioContext 還 suspended 的話媒體元素的 currentTime 照走，但增益卡在 0，一點聲音都沒有。
  // ⚠️ 而且預設是開的（第一版預設關，玩家入場之後什麼也沒聽到 ⇒ 回報「聲音沒出來」），
  // 開場的「入場」那一下就是瀏覽器要的使用者動作。
  await sleep(2500);
  const snd = await page.evaluate(() => {
    const a = document.querySelector('audio');
    return { ...window.__music.debug(), on: document.querySelector('#music').classList.contains('on'),
             src: a?.getAttribute('src'), label: document.querySelector('#nowplaying').textContent };
  });
  ok(snd.on && snd.ctx === 'running' && snd.gain > 0.2 && snd.paused === false && snd.t > 0.5
     && /audio\/\d\d\.m4a(\?v=[0-9a-f]{8})?$/.test(snd.src || '') && snd.label.startsWith('♪'),
     `配樂聽得到（${snd.src}　${snd.label}　增益 ${(snd.gain ?? 0).toFixed(2)}　${(snd.t ?? 0).toFixed(1)}s）`);
  await page.locator('#music').click();
  await sleep(300);
  ok(!await page.evaluate(() => document.querySelector('#music').classList.contains('on')), '配樂關得掉');
  await page.locator('#music').click();   // 關掉會寫進 localStorage，下一輪還要用，轉回開著
  await sleep(200);

  const vis = await page.locator('#map .mark:not(.unpub)').count();
  ok(vis === want, `開場出現 ${vis} 個景（1876 年＋年代未詳，閘門算出來該有 ${want}）`);

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
  await page.locator('#map .mark circle.dot').first().click();
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

  // ── 玩法：收一景、等一刻 ───────────────────────────────────
  // ⚠️ 要點**可收的**那種（.open），不是隨便第一個——被光線閘門擋著收不了是正常行為，
  // 第一版點第一個就紅了，而紅的是測試不是遊戲。
  await page.keyboard.press('Escape');      // 先關掉上面那一輪開著的面板，它蓋住地圖
  await sleep(200);
  const openMark = page.locator('#map .mark.open circle.dot').first();
  ok(await openMark.count() === 1, '開場有可收的景（金點）');
  await openMark.click();
  await sleep(250);
  const before = await page.locator('#count').textContent();
  const take = page.locator('#panel #take');
  if (await take.count()) {
    await take.click();
    await sleep(250);
    const after = await page.locator('#count').textContent();
    ok(after !== before, `收得下去：${before} → ${after}`);
    // 🔴 預設看到的是**真跡**（像素版的資訊嚴格少於真跡，沒理由預設給降過質的），
  // 像素版是明講的一個選擇；⛔ pixelated 也只能套在像素版上。
  const view = async () => page.evaluate(() => ({
    src: document.querySelector('#panel #art img').getAttribute('src'),
    px: document.querySelector('#panel #art').classList.contains('px'),
    label: document.querySelector('#panel #flip')?.textContent,
    pal: document.querySelectorAll('#panel .pal .chips i').length,
    cap: document.querySelector('#panel .pal p')?.textContent ?? '',
  }));
  const v0 = await view();
  await page.locator('#panel #flip').click();
  await sleep(400);
  const v1 = await view();
  ok(/thumb/.test(v0.src) && !v0.px && /16 色/.test(v0.label)
     && /pixel/.test(v1.src) && v1.px && /真跡/.test(v1.label),
     `預設真跡、按鈕說得出按下去會看到什麼（${v0.label} → ${v1.label}）`);
  // 生成的那一層：🔴 **沒有片子就不該有那顆鈕**。
  const gen = await page.evaluate(async () => {
    const m = await fetch('data/motion.json').then(r => r.json()).catch(() => ({ clips: [] }));
    const id = +document.querySelector('#map .mark.sel')?.dataset.id;
    return { clips: (m.clips || []).map(c => ({ id: c.id, kind: c.kind ?? 'atmosphere',
                                                n: (c.differs || []).length })),
             hasClip: (m.clips || []).some(c => c.id === id),
             btn: !!document.querySelector('#panel #anim') };
  });
  ok(gen.btn === gen.hasClip,
     gen.clips.length ? `AI 重繪版：有片子的景才有那顆鈕（clips ${gen.clips.length}）`
                      : 'AI 重繪版：還沒有片子，所以那顆鈕不存在（⛔ 不留按了沒東西的鈕）');
  // 🔴 承認重畫了，就得說得出重畫了什麼。⛔ kind=reinterpretation 而 differs 是空的＝
  // 掛了牌卻不講內容，那跟沒掛一樣（規矩寫在 data/motion.json 的 _rule）。
  if (gen.clips.length) {
    ok(gen.clips.every(c => c.kind === 'atmosphere' ? c.n === 0 : c.n > 0),
       `重繪版列得出差異（${gen.clips.map(c => `no.${c.id} ${c.kind} ${c.n} 條`).join('、')}）`);
  }
  // 十六色：quantize.py 算出來的那 16 色，⚠️ palettes.json 產出至今沒人讀過
  ok(v0.pal === 16 && /平均明度 \d+/.test(v0.cap),
     `十六色色盤畫得出來（${v0.pal} 色・${(v0.cap.match(/平均明度 \d+/) || [''])[0]}）`);
  await page.locator('#panel #flip').click();     // 轉回真跡，後面的檢查照原樣
  await sleep(300);
  } else {
    ok(false, '第一個點開的景收不了（開場該有可收的）');
  }
  // 標註：收過的畫把清親畫的東西標在原位（座標算在像素版上，見 apply-details.py）
  const det = await page.evaluate(() => {
    const id = +document.querySelector('#map .mark.sel')?.dataset.id;
    return (window.__views || []).find(v => v.id === id)?.details ?? null;
  });
  const shown = () => page.locator('#panel .spot:visible').count();
  ok(det?.length > 0 && await shown() === det.length,
     `標註全標出來（${det?.length ?? 0} 個：${(det ?? []).map(d => d.label).join('・')}）`);
  await page.locator('#panel #mark').click();
  await sleep(200);
  ok(await shown() === 0, '關得掉（標註）');
  await page.locator('#panel #mark').click();
  await sleep(200);
  // 像素版與真跡是**同一張和紙**（2026/09/12 廢掉畫心那一層）⇒ 框一樣、標註兩邊通用。
  // 這一項驗的就是那個不變量：長寬比對不上就表示又有人在中間多裁了一刀。
  const ratio = () => page.locator('#panel #art img').evaluate(e => e.naturalWidth / e.naturalHeight);
  const rPixel = await ratio();
  await page.locator('#panel #flip').click();
  await sleep(500);
  const rPlate = await ratio();
  ok(Math.abs(rPixel - rPlate) / rPlate < 0.02 && await shown() === det.length,
     `像素版與真跡同框，標註兩邊都在（${rPixel.toFixed(2)} vs ${rPlate.toFixed(2)}）`);
  await page.locator('#panel #flip').click();
  await sleep(500);

  // 原寸檢視：看的是 assets/plate（1527–1690px），不是面板裡的 720px 縮圖
  await page.locator('#panel #big').click();
  await sleep(900);
  const lb = await page.locator('.lightbox img').evaluate(
    e => ({ nat: e.naturalWidth, ok: e.complete && e.naturalWidth > 0 })).catch(() => null);
  ok(lb?.ok && lb.nat > 1200, `原寸檢視載得起來且夠大（${lb?.nat ?? '?'}px）`);
  // 🔴 放大之後要拖得動、方向鍵也要能走。兩個都壞過：
  //   · 瀏覽器的**原生圖片拖曳**會在第一個 pointermove 之後接管指標（拖 220px 只動 22px）
  //   · 方向鍵在這一層根本沒接；而且沒 preventDefault 的話會把底下的地圖一起推走
  const tf = () => page.locator('.lightbox img').evaluate(e => e.style.transform);
  const vbNow = () => page.locator('#map').evaluate(e => e.getAttribute('viewBox'));
  await page.locator('.lightbox [data-z="in"]').click();
  await page.locator('.lightbox [data-z="in"]').click();
  await sleep(350);
  const vb0 = await vbNow();
  const { width: lw, height: lh } = page.viewportSize();
  await page.mouse.move(lw * 0.5, lh * 0.5);
  await page.mouse.down();
  await page.mouse.move(lw * 0.5 - 200, lh * 0.5 - 90, { steps: 10 });
  await page.mouse.up();
  await sleep(250);
  const dragged = await tf();
  await page.keyboard.press('ArrowLeft');
  await sleep(250);
  const keyed = await tf();
  // ⚠️ 別比對死值：位移會被夾在邊界內，直式手機上圖的高度剛好塞得下 ⇒ y 恆為 0，
  // 而 x 也可能夾在 -180 而不是 -200。要驗的是「**走了一大段**」，不是「走了多少」。
  const px = t => (t.match(/-?\d+(\.\d+)?/g) || []).map(Number);
  const [dx] = px(dragged), [kx] = px(keyed);
  ok(Math.abs(dx) > 100 && kx !== dx && await vbNow() === vb0,
     `原寸檢視拖得動也按得動（拖曳 ${dragged}／方向鍵 ${keyed}），而且沒推到底下的地圖`);
  // 🔴 **四個角都要到得了。** 第一版的夾限假設圖是置中的（±(w-視窗)/2），
  // 但 grid 對「比容器大的元素」是靠左上排的 ⇒ 只走得到一半，右下角永遠到不了
  // （Aaron：「會卡在一些地方過不去」）。這一項就是驗那件事。
  const corner = async (fromX, fromY, toX, toY) => {
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(fromX, fromY);
      await page.mouse.down();
      await page.mouse.move(toX, toY, { steps: 5 });
      await page.mouse.up();
    }
    await sleep(200);
    return page.locator('.lightbox img').evaluate(e => {
      const r = e.getBoundingClientRect();
      return { l: Math.round(r.left), t: Math.round(r.top),
               r: Math.round(r.right), b: Math.round(r.bottom), W: innerWidth, H: innerHeight };
    });
  };
  const br = await corner(lw * 0.8, lh * 0.8, lw * 0.2, lh * 0.2);   // 往左上拖＝看右下角
  const tl = await corner(lw * 0.2, lh * 0.2, lw * 0.8, lh * 0.8);   // 反過來＝看左上角
  ok(br.r <= br.W + 1 && br.b <= br.H + 1 && tl.l >= -1 && tl.t >= -1,
     `原寸檢視四個角都到得了（右下 ${br.r}/${br.b}、左上 ${tl.l}/${tl.t}）`);

  await page.locator('.lightbox [data-z="fit"]').click();
  await sleep(200);
  await page.keyboard.press('Escape');
  await sleep(300);
  // ⚠️ Esc 只該關掉最上面那層。主程式的監聽先註冊先執行，不擋就會一次關兩層
  ok(await page.locator('.lightbox').count() === 0 && await page.locator('#panel.on').count() === 1,
     'Esc 只關原寸檢視，面板還在');

  // 介面文字一律繁中（多語系補上之前的過渡狀態）。只掃**操作與欄名**——
  // ⛔ 不掃 dd／h2／地圖標籤／出處：那些是題名、地名與館名，本來就該是日文。
  const kana = await page.evaluate(() => [...document.querySelectorAll(
      '#hud button, #zoom button, #panel button, #panel dt, #panel .hint, #panel .gate,'
      + ' #open, #now, #card h2, #card button')]
    .map(e => e.textContent.trim()).filter(t => /[ぁ-んァ-ヶ]/.test(t)));
  ok(kana.length === 0, `介面文字沒有殘留的日文${kana.length ? '：' + kana.join('／') : ''}`);

  // 解說層：文字是維基百科導言逐字引用 ⇒ **出處與授權必須跟著出現**，
  // 這一項驗的是那件事（引用而不標出處，是這一層唯一不能出的錯）。
  const read = await page.evaluate(() => {
    const sec = document.querySelector('#panel .read');
    if (!sec) return null;
    // 解說本文要是繁中（日文原文留在 topics-text.json，多語系那次再上）。
    // ⚠️ 只掃本文與標題，⛔ 不掃引號裡的日文詞（「ホーム」「釣り橋」那些是被解釋的對象）。
    const body = [...sec.querySelectorAll('summary, p')]
      .map(e => e.textContent).join('').replace(/[「『][^」』]*[」』]/g, '')
      .replace(/譯自維基百科日本語版/g, '').replace(/維基百科（日文原文）/g, '');
    // 🔴 同一條目不能在一幅裡出現兩次：有 5 幅的「地方」與「畫裡的東西」指同一條
    const names = [...sec.querySelectorAll('summary')].map(e => e.firstChild.textContent.trim());
    return { kana: /[ぁ-んァ-ヶ]/.test(body),
             dup: names.length !== new Set(names).size,
             n: sec.querySelectorAll('details').length,
             src: (sec.querySelector('.src')?.textContent || '').includes('CC BY-SA'),
             links: [...sec.querySelectorAll('a')].every(a => a.href.startsWith('https://ja.wikipedia.org/')) };
  });
  ok(read && read.n >= 1 && read.src && read.links && !read.kana && !read.dup,
     `解說有 ${read?.n ?? 0} 條、不重複、是繁中、標了出處與授權、連得回維基百科`);

  // 🔴 換一幅畫，欄寬不能跳。倍率該由視窗決定，不由那一幅的高度決定——
  // 原本 58 新橋ステンション（480×312）顯示 480px、矮一點的畫顯示 960px。
  const colOf = () => page.locator('#panel #art img').evaluate(e => e.getBoundingClientRect().width);
  const w1 = await colOf();
  const other = await page.evaluate(() => {
    const cur = document.querySelector('#map .mark.sel');
    const g = [...document.querySelectorAll('#map .mark')].find(e => e !== cur);
    g.querySelector('circle.dot').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return g.querySelector('text')?.textContent;
  });
  await sleep(600);
  const w2 = await colOf();
  ok(w1 === w2, `換一幅畫欄寬不變（${w1} → ${w2}，「${other}」）`);

  const t0 = await page.locator('#now').textContent();
  await page.locator('#wait').click();
  await sleep(200);
  const t1 = await page.locator('#now').textContent();
  ok(t0 !== t1, `等一刻會走：${t0.trim()} → ${t1.trim()}`);

  await page.keyboard.press('Escape');
  await sleep(150);
  ok(await page.locator('#panel.on').count() === 0, 'Esc 關得掉');

  // 清親是誰、光線畫是什麼——一場看一次，放 HUD
  await page.locator('#who').click();
  await sleep(300);
  const card = await page.locator('#card.on #card-body').innerText().catch(() => '');
  // ⚠️ 繁中之後是「光線畫」不是「光線画」。生平要有三節（出身・成為繪師・弟子），
  // ⛔ 不是導言那兩句——那兩句講不出他是誰。延伸閱讀是連結，⛔ 不抄文章的字。
  ok(card.includes('小林清親') && card.includes('光線畫') && card.includes('CC BY-SA')
     && card.includes('鳥羽・伏見') && card.includes('井上安治')
     && card.includes('延伸閱讀') && card.includes('魏格曼'),
     '清親卡片有小傳三節、師承的來源衝突、延伸閱讀與出處');
  // 🔴 卡片裡的連結本來沒設色，落回瀏覽器預設的藍——深藍底上幾乎看不見（實際發生過）
  const blue = await page.locator('#card a').first().evaluate(e => getComputedStyle(e).color);
  ok(blue !== 'rgb(0, 0, 238)', `卡片的連結看得見（${blue}）`);
  await page.locator('#card-close').click();
  await sleep(200);

  // 玩法頁：給玩家查的。🔴 驗的是**它講的跟遊戲做的一樣**——
  // 數字從規則本身來（地圖上幾幅、幾景翻一年），圖例是真的 .mark、吃的是地圖那套 CSS
  // ⇒ 金點的顏色要跟地圖上金點的顏色一模一樣，⛔ 不是另外畫一份示意圖。
  await page.keyboard.press('?');
  await sleep(300);
  // ⚠️ 掃日文之前先拿掉畫的題名：題名本來就是日文（面板的 h2 也不掃）。
  // 玩法頁列出 AI 重繪版的題名，no.10「瀧の川の圖」的「の」曾讓這一項誤判（2026-09-17）。
  const titles = VIEWS.map(v => v.title.ja);
  const guide = await page.evaluate(titles => {
    const body = document.querySelector('#card.on #card-body');
    if (!body) return null;
    const fill = s => { const e = document.querySelector(s); return e && getComputedStyle(e).fill; };
    return {
      title: body.querySelector('h2')?.textContent,
      text: titles.reduce((t, n) => t.split(n).join(''), body.innerText),
      states: ['open', 'closed', 'got'].map(k => body.querySelectorAll(`.legend .mark.${k}`).length),
      legendGold: fill('#card .legend .mark.open.exact circle.dot'),
      mapGold: fill('#map .mark.open.exact circle.dot'),
      mapped: window.__views.length,
    };
  }, titles);
  ok(guide && guide.title === '玩法'
     && guide.text.includes(`地圖上的 ${guide.mapped} 幅`) && guide.text.includes(`每收 ${PER_YEAR} 幅進入下一年`)
     && guide.states.every(n => n === 2) && guide.mapGold && guide.legendGold === guide.mapGold
     && !/[ぁ-んァ-ヶ]/.test(guide.text),
     `玩法頁（? 叫得出來）：數字跟規則一致（${guide?.mapped} 幅・每 ${PER_YEAR} 幅一年）、`
     + `圖例三種點各實心空心、金點跟地圖同色（${guide?.legendGold}）、沒有日文`);
  await page.keyboard.press('Escape');
  await sleep(200);
  ok(await page.locator('#card.on').count() === 0, 'Esc 關得掉玩法頁');

  // 畫卷：收到的景連成一卷、由右往左展讀；沒收的留空格（卷長不隨進度變）
  // 🔴 先把面板打開再開畫卷：Esc 只該收卷、面板要留著（第一版的守衛漏了畫卷，
  // 而當時的測試沒開面板 ⇒ 兩層一起關也照樣綠燈。測試要有兩層才測得到分層）。
  await page.locator('#map .mark circle.dot').first().click();
  await sleep(500);
  // 🔴 面板開著時 HUD 的每一顆鈕都要**按得到**，⛔ 不是「看得到」：面板加寬後從 top:0
  // 蓋下來，清親・畫卷・開場・沈浸・♪ 全壓在底下（1280 寬連等一刻也是），直到加了
  // 「玩法」把畫卷推進去才被下面那一下點擊抓到。⇒ 逐顆問瀏覽器：點中心會點到誰。
  const buried = await page.evaluate(() => [...document.querySelectorAll('#hud button')]
    .filter(e => getComputedStyle(e).display !== 'none')
    .filter(e => { const r = e.getBoundingClientRect();
                   return r.right <= innerWidth && !e.contains(document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2)); })
    .map(e => e.textContent.trim()));
  ok(buried.length === 0, `面板開著時 HUD 的鈕都按得到${buried.length ? `（被蓋住：${buried.join('・')}）` : ''}`);
  await page.locator('#emaki').click();
  await sleep(700);
  const roll = await page.evaluate(() => {
    const r = document.querySelector('.sroll');
    if (!r) return null;
    const x0 = r.scrollLeft;
    return { spans: r.querySelectorAll('.span').length, got: r.querySelectorAll('.span:not(.blank)').length,
             jiku: r.querySelectorAll('.jiku').length, rtl: getComputedStyle(r).flexDirection === 'row-reverse',
             x0 };
  });
  ok(roll && roll.spans === MAPPED && roll.got >= 1 && roll.jiku === 2 && roll.rtl,
     `畫卷 ${roll?.spans} 格（收到的 ${roll?.got} 格有圖）、兩端有軸木、由右往左`);
  // 🔑 一卷 59 幅、兩萬多像素，**自動展卷只適合看不適合找** ⇒ 手動三條路都要通。
  // ⚠️ 方向要對：這一卷右起，往下滾＝往左走（照瀏覽器預設會變成退回卷首）。
  const sx = () => page.evaluate(() => Math.round(document.querySelector('.sroll').scrollLeft));
  const seat = () => page.evaluate(() => {       // 右緣對齊的是第幾幅
    const r = document.querySelector('.sroll').getBoundingClientRect();
    return [...document.querySelectorAll('.sroll .span')]
      .map((e, i) => [i + 1, Math.abs(e.getBoundingClientRect().right - r.right)])
      .sort((a, b) => a[1] - b[1])[0][0];
  });
  const s0 = await seat();
  await page.keyboard.press('ArrowLeft'); await sleep(600);
  const s1 = await seat();
  await page.keyboard.press('ArrowRight'); await sleep(600);
  const s2 = await seat();
  await page.mouse.move(page.viewportSize().width / 2, page.viewportSize().height / 2);
  await page.mouse.wheel(0, 600); await sleep(400);
  const wheeled = await sx();
  await page.keyboard.press('Home'); await sleep(500);
  const h1 = await sx();
  ok(s1 === s0 + 1 && s2 === s0 && wheeled < 0 && h1 === 0,
     `手動翻閱：← → 一次一幅（${s0}→${s1}→${s2}）、滾輪往左走（${wheeled}）、Home 回卷首`);
  // 拖曳要能拉卷，而且放開那一下**不能**被當成點畫。
  // ⚠️ 要往「卷還有東西」的那一邊拉：上一步 Home 已經回到卷首，
  // 再往那個方向拉是拉到底了不會動——第一版就是這樣自己把自己判成紅燈。
  // ⚠️ 座標要跟著視窗算：直式手機只有 390px 寬，寫死 900 根本點在畫面外
  const { width: vw, height: vh } = page.viewportSize();
  await page.mouse.move(vw * 0.25, vh * 0.55); await page.mouse.down();
  await page.mouse.move(vw * 0.8, vh * 0.55, { steps: 8 }); await page.mouse.up();
  await sleep(300);
  ok(await sx() !== 0 && await page.locator('.scroll-view').count() === 1,
     '拖曳拉得動卷，而且不會被當成點畫');

  await page.locator('.scroll-view [data-act="play"]').click();
  await sleep(1200);
  const moved = await page.evaluate(() => document.querySelector('.sroll').scrollLeft);
  ok(moved < roll.x0, `自動展卷往左走（${Math.round(roll.x0)} → ${Math.round(moved)}）`);
  await page.keyboard.press('Escape');
  await sleep(300);
  // ⚠️ Esc 只該收卷。主程式的監聽先註冊、先執行，所以它自己要問「上面有沒有蓋著東西」
  ok(await page.locator('.scroll-view').count() === 0 && await page.locator('#panel.on').count() === 1,
     'Esc 只收卷，面板還在');
  await page.keyboard.press('Escape');
  await sleep(200);

  // 帶我去：HUD 那行按下去，地圖要**滑到**下一個金點並把它標出來。
  // ⛔ 連按不能在兩點之間乒乓——帶過去之後離中心最近的就是剛離開的那個（實測過）。
  const centreOf = () => page.locator('#map').evaluate(e => {
    const v = e.getAttribute('viewBox').split(' ').map(Number);
    return [Math.round(v[0] + v[2] / 2), Math.round(v[1] + v[3] / 2)];
  });
  const c0 = await centreOf();
  const led = [];
  for (let i = 0; i < 4; i++) {
    await page.locator('#open').click();
    await sleep(800);
    led.push(await page.locator('#map .mark.lead text').textContent().catch(() => null));
  }
  const c1 = await centreOf();
  ok(led.every(Boolean) && new Set(led).size === led.length && String(c0) !== String(c1),
     `帶我去：連按四次走了四個不同的景（${led.join('・')}）`);

  await page.close();
}

// ── 觸控裝置的沈浸模式 ─────────────────────────────────────────
// 🔴 上面兩輪用的是滑鼠（viewport 縮成手機大小 ≠ 手機）。桌機靠 :hover 把周邊叫亮，
// **觸控沒有 hover** ⇒ 點一下地圖，HUD 與跑馬燈就卡在 0.18：看不清、卻還按得到
// （Aaron 在手機上回報「透明反白狀態」）。⇒ 觸控只准兩種狀態：**全亮或整個收起來**，
// 點地圖空白處切換（相簿、影片播放器都是這樣）。
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 },
                                         deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => localStorage.setItem('kiyochika.intro.v1', '1'));
  await page.goto(`http://localhost:${PORT}/`);
  await sleep(1500);
  const look = () => page.evaluate(() => {
    const els = ['#hud', '#ticker', '#zoom', '#bar label', '#eranow'].map(s => document.querySelector(s)).filter(Boolean);
    const st = e => getComputedStyle(e);
    const attr = st(document.querySelector('#attr'));
    return {
      shown: els.filter(e => st(e).visibility !== 'hidden' && +st(e).opacity >= 0.9).length,
      hidden: els.filter(e => st(e).visibility === 'hidden').length,
      ghost: els.filter(e => st(e).visibility !== 'hidden' && +st(e).opacity < 0.9).map(e => e.id || e.tagName),
      n: els.length,
      attr: attr.display !== 'none' && +attr.opacity > 0.1,
      on: document.body.classList.contains('immersive'),
    };
  });
  const map = () => page.touchscreen.tap(200, 450);   // 地圖空白處（這一點底下沒有景點）
  await page.tap('#full');
  await sleep(700);
  const s0 = await look();
  await map(); await sleep(700);
  const s1 = await look();
  await map(); await sleep(700);
  const s2 = await look();
  ok(s0.on && s0.hidden === s0.n && !s0.ghost.length && s0.attr,
     `觸控：進沈浸就整個收起來，不留半透明（收 ${s0.hidden}/${s0.n}${s0.ghost.length ? `・半透明 ${s0.ghost}` : ''}）、出處還在`);
  ok(s1.shown === s1.n && s2.hidden === s2.n && !s1.ghost.length && !s2.ghost.length,
     `觸控：點地圖空白處叫出來（全亮 ${s1.shown}/${s1.n}）、再點收回去（收 ${s2.hidden}/${s2.n}）`);
  await map(); await sleep(700);
  await page.tap('#full');
  await sleep(500);
  ok(await page.evaluate(() => !document.body.classList.contains('immersive')),
     '觸控：叫出來之後按「離開」出得去');
  await ctx.close();
}
// ── 畫師要照實標：井上安治四幅 ─────────────────────────────────
// 🔴 收錄弟子的畫之後，最容易出的錯是**把它們說成清親的**——面板、解說、差異清單的主詞都一樣。
// 81 還多一層：版面欄外印的畫工是小林清親，館方著錄卻是井上安治 ⇒ 兩個都要看得到。
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('kiyochika.intro.v1', '1'); });
  await page.goto(`http://localhost:${PORT}/`);
  await sleep(1500);
  const panelOf = async id => {
    await page.evaluate(id => document.querySelector(`#map .mark[data-id="${id}"]`)
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true })), id);
    await sleep(700);
    return page.evaluate(() => {
      const dt = [...document.querySelectorAll('#panel dt')].find(e => e.textContent === '畫師');
      return { artist: dt?.nextElementSibling?.textContent ?? null,
               cards: [...document.querySelectorAll('#panel .read summary')].map(e => e.textContent),
               img: document.querySelector('#panel #art img')?.naturalWidth ?? 0 };
    });
  };
  const k1 = await panelOf(1), y81 = await panelOf(81), y82 = await panelOf(82);
  const yas = VIEWS.filter(v => v.include && v.attribution === 'inoue-yasuji');
  ok(yas.length === 4 && yas.every(v => v.subject) && k1.artist === '小林清親'
     && /井上安治（清親的弟子）/.test(y81.artist) && /欄外印的畫工署名是「小林清親」/.test(y81.artist)
     && /井上安治/.test(y82.artist) && !/欄外/.test(y82.artist)
     && y81.cards.some(c => /畫這幅的人/.test(c)) && !k1.cards.some(c => /畫這幅的人/.test(c))
     && y81.img > 0 && y82.img > 0,
     `畫師照實標：no.1「${k1.artist}」／no.81「${y81.artist}」／no.82「${y82.artist}」；安治的畫先講畫的人`);
  await page.close();
}

// ── AI 重繪版：沒收過也看得到 ─────────────────────────────────
// 🔴 它不進收藏不算進度 ⇒ **不是收藏的獎勵**。第一版誤放進「收了才有」那組按鈕，
// 新玩家要等到下雨天收了御厩橋雷雨才看得到（Aaron：「所以 ai 圖是被當作 reward？」）。
// ⇒ 用全新的存檔開 no.50：鈕要在，按下去必須掛著「非原作」、印出那份差異清單——
// ⛔ 說明文字裡提一句「AI 生成」不算，那講的是怎麼做的，不是哪幾樣不是清親畫的。
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('kiyochika.intro.v1', '1'); });
  await page.goto(`http://localhost:${PORT}/`);
  await sleep(1500);
  const m = await page.evaluate(() => fetch('data/motion.json').then(r => r.json()));
  for (const c of m.clips) {
    await page.evaluate(id => document.querySelector(`#map .mark[data-id="${id}"]`)
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true })), c.id);
    await sleep(600);
    const before = await page.evaluate(() => ({
      got: !!document.querySelector('#panel #mark'), anim: !!document.querySelector('#panel #anim') }));
    if (before.anim) await page.locator('#panel #anim').click();
    await sleep(300);
    const shown = await page.evaluate(() => ({
      art: document.querySelector('#panel #art img, #panel #art video')?.tagName,
      badge: document.querySelector('#panel #art .gen')?.textContent ?? '',
      items: document.querySelectorAll('#panel .differs li').length,
    }));
    ok(!before.got && before.anim && shown.art === 'VIDEO' && /非原作/.test(shown.badge)
       && shown.items === (c.differs || []).length,
       `AI 重繪版 no.${c.id}：沒收過也有那顆鈕，按下去是影片、掛著「${shown.badge}」、印出 ${shown.items} 條差異`);
  }
  await page.close();
}
await browser.close();
console.log(bad ? `\n${bad} 項不過` : '\n全過');
bye(bad ? 1 : 0);
