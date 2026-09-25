// 宣傳片的畫面素材：⛔ 不做示意圖，全部是真的遊戲畫面。
//
// 🔴 截圖用**手機直式版面**（540×960 CSS px ＠DPR2 ＝ 1080×1920），⛔ 不是把桌機畫面裁成直的——
// 裁出來的版面不是任何一個玩家看得到的東西。
// ⚠️ 結局卡直接渲染 src/finale.js（同 check-pub.mjs 的做法）：走完 63 景才會跳的卡片，
// 用玩的沒辦法在截圖腳本裡湊出來，而且兩国大火的事件卡會先蓋掉它。
//
// 用法（通常由 tools/make-promo.sh 呼叫）：
//   node tools/promo-shots.mjs shots  <輸出目錄>      遊戲截圖 ＋ 標題卡 ＋ 字幕條
//   node tools/promo-shots.mjs poster <輸出目錄>      從成片抽出的三格 → 海報（README 用）
//   node tools/promo-shots.mjs cards  <輸出目錄> <卡片key…> <字幕key…>   只出卡片與字幕條
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(process.env.HOME + '/')('playwright');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [mode, outArg] = process.argv.slice(2);
// ⚠️ 一定要絕對路徑：海報的 <img> 是相對 tools/promo-cards.html 解析的，相對路徑會找不到圖
const OUT = resolve(process.cwd(), outArg);
const PORT = 8043;
const sleep = ms => new Promise(r => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

// ── 海報：把成片抽出來的三格排成 16:9（README 放直式影片會太高）──
if (mode === 'poster') {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await p.goto(`file://${ROOT}/tools/promo-cards.html?c=poster&dir=${encodeURIComponent(OUT)}`);
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/poster.png` });
  await b.close();
  console.log('poster done');
  process.exit(0);
}

// ── 只出卡片與字幕條（第二支宣傳片用，⛔ 不必開遊戲）──
//   node tools/promo-shots.mjs cards <輸出目錄> <整頁卡的 key…> <字幕條的 key…>
if (mode === 'cards') {
  const [full, caps] = process.argv.slice(4);
  const b = await chromium.launch();
  // 🔴 deviceScaleFactor 必須是 1：卡片的尺寸就是影片的尺寸（1080×1920）。
  // 用 2 會截成 2160×3840，overlay 上去只看得到左上角那塊透明區——字幕會整批消失。
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  for (const c of (full ?? '').split(',').filter(Boolean)) {
    await p.goto(`file://${ROOT}/tools/promo-cards.html?c=${c}`);
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${OUT}/card-${c}.png` });
  }
  for (const c of (caps ?? '').split(',').filter(Boolean)) {
    await p.goto(`file://${ROOT}/tools/promo-cards.html?c=${c}`);
    await p.waitForTimeout(250);
    await p.screenshot({ path: `${OUT}/cap-${c}.png`, omitBackground: true });
  }
  await b.close();
  console.log('cards done');
  process.exit(0);
}

const srv = spawn('python3', [`${ROOT}/tools/serve.py`, String(PORT)], { cwd: ROOT, stdio: 'ignore' });
await sleep(900);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const url = `http://localhost:${PORT}/`;

// 進度直接寫進 localStorage（key 與形狀見 src/main.js 的 KEY／newState）
const seed = async (collected, yearIdx, step) => {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([c, y, s]) => {
    localStorage.setItem('kiyochika.intro.v1', '1');
    localStorage.setItem('kiyochika.music.v1', '0');   // 截圖不要出聲
    localStorage.setItem('kiyochika.v1', JSON.stringify({ step: s, collected: c, yearIdx: y, yearMark: 0 }));
  }, [collected, yearIdx, step]);
  await page.goto(url, { waitUntil: 'networkidle' });
  await sleep(1200);
};
const open = async id => {
  await page.evaluate(i => document.querySelector(`#map .mark[data-id="${i}"]`)
    .dispatchEvent(new MouseEvent('click', { bubbles: true })), id);
  await sleep(1400);
};

await seed([1, 4, 21], 1, 12);
await page.screenshot({ path: `${OUT}/02-map.png` });

await open(1);
await page.screenshot({ path: `${OUT}/03-panel.png` });
await page.locator('#panel #flip').click();                 // 真跡 → 16 色
await sleep(900);
await page.evaluate(() => document.querySelector('#panel .pal')?.scrollIntoView({ block: 'center' }));
await sleep(500);
await page.screenshot({ path: `${OUT}/04-pixel.png` });
await page.locator('#panel #flip').click();
await sleep(600);

await page.locator('#panel #anim').click();                 // AI 重繪版：掛牌＋差異清單
await sleep(2600);
await page.screenshot({ path: `${OUT}/06-ai-differs.png` });

await page.locator('#panel #big').click();                  // 原寸檢視
await sleep(1600);
await page.evaluate(() => document.querySelector('.lightbox img')
  ?.dispatchEvent(new WheelEvent('wheel', { deltaY: -600, clientX: 270, clientY: 420, bubbles: true })));
await sleep(900);
await page.screenshot({ path: `${OUT}/10-zoom.png` });
await page.keyboard.press('Escape');
await sleep(500);

// 畫卷：收過的景連成一卷，⚠️ 沒收的留白紙，所以要先塞一批進度
const many = [1, 2, 4, 5, 8, 11, 13, 14, 17, 18, 21, 22, 24, 26, 27, 29, 33, 35, 36, 39,
              41, 42, 44, 46, 47, 49, 50, 52, 55, 57, 58, 59, 60, 61, 62, 63, 64, 67, 68, 69, 70, 71];
await seed(many, 5, 60);
await page.locator('#emaki').click();
await sleep(1800);
await page.screenshot({ path: `${OUT}/07-emaki.png` });
await page.keyboard.press('Escape');
await sleep(500);

// 結局卡：直接渲染 finale.js（純函式，不碰 DOM 以外的狀態）
await page.evaluate(async () => {
  const [views0, palettes] = await Promise.all([
    fetch('data/views.json').then(r => r.json()),
    fetch('data/palettes.json').then(r => r.json())]);
  const { finaleHtml } = await import('/src/finale.js');
  const { yearOf } = await import('/src/clock.js');
  const views = views0.filter(v => v.include && v.subject);
  document.getElementById('card-body').innerHTML =
    '<h2>光線畫到這裡為止</h2>' + finaleHtml({ views, yearOf, palettes, who: v => v.attribution, waits: 9 });
  document.getElementById('card').classList.add('on');
});
await sleep(800);
await page.screenshot({ path: `${OUT}/09-finale.png` });

// 標題卡與字幕條（字幕用透明底，疊在畫面上；卡片是整頁）
// 🔴 這一頁的 deviceScaleFactor 必須是 1：遊戲截圖那個 context 是 DPR2（540×960 → 1080×1920），
// 沿用它會把卡片截成 2160×3840，overlay 到 1080×1920 的影片上就只看得到左上角那一塊透明的地方
// ——字幕會整批消失，而且三道機器檢查都不會有反應（實際踩過）。
const cardCtx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
const cards = await cardCtx.newPage();
for (const c of ['title', 'end']) {
  await cards.goto(`file://${ROOT}/tools/promo-cards.html?c=${c}`);
  await cards.waitForTimeout(300);
  await cards.screenshot({ path: `${OUT}/card-${c}.png` });
}
for (let i = 1; i <= 9; i++) {
  await cards.goto(`file://${ROOT}/tools/promo-cards.html?c=c${i}`);
  await cards.waitForTimeout(250);
  await cards.screenshot({ path: `${OUT}/cap-${i}.png`, omitBackground: true });
}

await browser.close(); srv.kill();
console.log('shots done');
