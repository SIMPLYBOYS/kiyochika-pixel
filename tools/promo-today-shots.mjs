// 第二支宣傳片的素材：**同一個畫框裡的「原畫 ⇄ 今天」**。
//
// 🔴 兩張截的是同一個框（#art）：一張是真跡，一張是按下「看今天」之後的街景 iframe。
// 框一樣，剪接時才會是「同一個地點換了 146 年」，⛔ 不是兩張不相干的圖並排。
// ⚠️ 需要 data/config.json 的 mapsKey，而且執行的那台機器的 referrer 要在金鑰的白名單裡
//（本機 localhost 不在 ⇒ 這支腳本跑的是**正式站**，不是本機 serve.py）。
//
//   node tools/promo-today-shots.mjs <輸出目錄> [id,id,id]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const { chromium } = createRequire(process.env.HOME + '/')('playwright');
const OUT = resolve(process.cwd(), process.argv[2]);
const IDS = (process.argv[3] ?? '4,58,82').split(',').map(Number);
const SITE = 'https://kiyochika-pixel.ferrari828.workers.dev/';
mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch();
// ⚠️ 直式手機版面（540×960＠2x ＝ 1080×1920），跟第一支同一個尺度
const ctx = await browser.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(SITE, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => { localStorage.setItem('kiyochika.intro.v1', '1');
                            localStorage.setItem('kiyochika.music.v1', '0'); });

for (const id of IDS) {
  await page.goto(SITE, { waitUntil: 'networkidle' });
  await sleep(1200);
  const ok = await page.evaluate(i => {
    const m = document.querySelector(`#map .mark[data-id="${i}"]`);
    if (!m) return false;
    m.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  }, id);
  if (!ok) { console.log(`no.${id} 不在地圖上，跳過`); continue; }
  await sleep(1800);
  const art = page.locator('#panel #art');
  await art.screenshot({ path: `${OUT}/pair-${id}-then.png` });
  const today = page.locator('#panel #today');
  if (!await today.count()) { console.log(`no.${id} 沒有「看今天」（金鑰沒填？）`); continue; }
  await today.click();
  await sleep(7000);                      // 街景要載完才截，⚠️ 太早截會是灰底
  await art.screenshot({ path: `${OUT}/pair-${id}-now.png` });
  const title = await page.locator('#panel h2').textContent();
  console.log(`no.${id} ${title?.trim()}　→ pair-${id}-then.png／-now.png`);
}
await browser.close();
