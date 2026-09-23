// 兩層閘門唯一的災難是**鎖死**，而鎖死不會噴錯——只會讓玩家卡住。
// edo-hyakkei 真的發生過：時間除了收景沒有別的推進手段，所有模擬在無景可收時
// 都寫 day++，補了一個遊戲裡不存在的動作，於是模擬說得完、實際卡在 89/118。
//
// 所以這支**只用遊戲裡真的存在的兩個動作**：收一景、等一刻。
// 兩者都推進同一個 step，年份只由收景推進。改動任何一個數字（PER_YEAR、
// 天候輪轉、閘門規則）之後跑這支——它會在幾秒內告訴你還走不走得完。
//
// 用法： node tools/check-pub.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { clockOf, collectable, blocked, yearOf, tick, newState, TIMES, WEATHERS, YEARS } from '../src/clock.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 🔴 模擬的世界要跟遊戲的世界**一模一樣**：能收的只有畫得到地圖上的（有 subject）。
// 原本這裡只濾 include，於是模擬說 69/69 走得完，而遊戲最多只到 59/69——
// 這是 edo-hyakkei 那個坑的新版本（那次是模擬多了一個遊戲沒有的動作，
// 這次是模擬的景比遊戲多 10 幅）。⇒ 兩邊的取景規則只能有一份。
const all = JSON.parse(readFileSync(resolve(ROOT, 'data/views.json'), 'utf8'));
const views = all.filter(v => v.include && v.subject);

let bad = 0;
const ok = (c, m) => { console.log(`${c ? '  ok  ' : '  ✗   '}${m}`); if (!c) bad++; };

// ── 資料面 ────────────────────────────────────────────────────
const years = views.map(yearOf).filter(y => y != null);
// ⚠️ 範圍取自 clock.js 的 YEARS，⛔ 不寫死：收錄安治之後多了 1882，寫死的 1881 就會把合法的資料判成錯
ok(years.every(y => y >= YEARS[0] && y <= YEARS.at(-1)), `年份都落在 ${YEARS[0]}–${YEARS.at(-1)}（${years.length} 幅有年份）`);
const undated = views.filter(v => yearOf(v) == null);
ok(undated.length > 0, `年代未詳 ${undated.length} 幅——一直可收，這是誠實的空白不是缺口`);
const fire = views.filter(v => (v.conditions || {}).weather === 'fire');
ok(fire.length === 4, `大火四幅（${fire.map(v => v.id).join('・')}）由事件開門，不由天候`);

// ── 走一遍 ────────────────────────────────────────────────────
// 貪心：能收就收，收不到就等。等是遊戲裡真的有的動作（見檔頭）。
const state = newState();
let waits = 0, maxWait = 0, run = 0;
const log = [];
for (let guard = 0; guard < 20000; guard++) {
  if (state.collected.length >= views.length) break;
  const clock = clockOf(state);
  if (clock.year >= 1881) state.fire = true;      // 事件在年份翻到 1881 時觸發
  const pick = views.find(v => collectable(v, clock, state));
  if (pick) {
    state.collected.push(pick.id);
    log.push({ id: pick.id, ...clock });
    maxWait = Math.max(maxWait, run);
    run = 0;
  } else {
    waits++; run++;
    // 等超過一整輪（4 刻 × 4 天）還是沒有任何一幅可收 ⇒ 就是鎖死了
    if (run > TIMES.length * WEATHERS.length + 1) break;
  }
  state.step++;
  tick(state, views);
}
const done = state.collected.length;
ok(done === views.length, `走得完：${done} / ${views.length} 幅`);
ok(views.every(v => v.subject), '模擬的每一景都畫得到地圖上（沒座標的不算進度）');
console.log(`  ——收錄 ${all.filter(v => v.include).length} 幅，其中 `
  + `${all.filter(v => v.include && !v.subject).length} 幅沒座標、不進遊戲`);
if (done < views.length) {
  const clock = clockOf(state);
  const stuck = views.filter(v => !state.collected.includes(v.id))
    .map(v => `${v.id}(${JSON.stringify(blocked(v, clock, state))})`);
  console.log('   卡住的:', stuck.slice(0, 8).join(' '), stuck.length > 8 ? `…共 ${stuck.length}` : '');
}
ok(maxWait <= TIMES.length * WEATHERS.length,
   `最長要等 ${maxWait} 刻（上限一輪 ${TIMES.length * WEATHERS.length} 刻；再久玩家會以為壞了）`);

// 年份真的有推進，而且順序合理
const seen = [...new Set(log.map(l => l.year))];
ok(seen.length === YEARS.length && seen[0] === YEARS[0] && seen.at(-1) === YEARS.at(-1), `年份走過 ${seen.join('→')}`);
// 事件要在 1881 之前沒觸發、之後觸發得到
const firstFire = log.find(l => fire.some(f => f.id === l.id));
ok(firstFire && firstFire.year >= 1881, `大火四幅都在 1881 之後才收得到（第一幅在 ${firstFire?.year}）`);

// ── 結局卡（src/finale.js）────────────────────────────────────
// 🔴 收滿之後那張卡是這一局唯一的收束，而它**只有走到最後才看得到** ⇒ 沒有測試就等於沒驗過。
// 這裡驗的是「色帶講的跟資料一致」：每一年一列、每一幅四格、年代未詳另外一列、
// 1882 那列標明是安治。⛔ 不驗顏色好不好看。
const palettes = JSON.parse(readFileSync(resolve(ROOT, 'data/palettes.json'), 'utf8'));
const { finaleHtml } = await import('../src/finale.js');
const html = finaleHtml({ views, yearOf, palettes, who: v => v.attribution, waits });
const rows = html.match(/class="fin-row"/g)?.length ?? 0;
const cells = html.match(/<i style="background:/g)?.length ?? 0;
const yearsIn = [...new Set(views.map(yearOf).filter(y => y != null))];
const noYear = views.filter(v => yearOf(v) == null).length;
ok(rows === yearsIn.length + (noYear ? 1 : 0),
   `結局卡：${rows} 列（${yearsIn.length} 個年份${noYear ? ' ＋ 年代未詳一列' : ''}）`);
ok(cells === views.length * 4, `結局卡：${cells} 格色塊（${views.length} 幅 × 4）`);
const yas = views.filter(v => v.attribution === 'inoue-yasuji');
ok(!yas.length || /明治十五年[^<]*<\/span>\s*<span class="fin-bar">[^]*?井上安治|井上安治/.test(html),
   `結局卡：安治那 ${yas.length} 幅有標明畫師`);
ok(html.includes(`清親 ${views.length - yas.length} 幅`) && html.includes('data-act="emaki"'),
   `結局卡：分開講清親與安治的幅數，並給得出「打開畫卷」`);

console.log(`\n一場 ${state.step} 刻 ＝ ${Math.floor(state.step / 4)} 日（收 ${done} 景、等 ${waits} 刻）`);
console.log(bad ? `${bad} 項不過` : '全過');
process.exit(bad ? 1 : 0);
