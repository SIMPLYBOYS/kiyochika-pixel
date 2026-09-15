// 兩層閘門與它的兩個鐘。**純函式，沒有 DOM**——tools/check-pub.mjs 直接 import 這裡
// 跑模擬，驗的是這個機制唯一的災難：**鎖死**。
//
// 鎖死不會噴錯，只會讓玩家卡住（edo-hyakkei 真的發生過一次，卡在 89/118）。
//
//   年份 → 這一幅**什麼時候出現**在地圖上。清親的光線画是 1876–1881 五年間陸續畫的，
//          不是連載，所以年份不是日曆而是進度：收得越多，走過的年份越多。
//   光線 → 這一幅**什麼時候可收**。題名寫著「夜」「暁」「雪」的那些，得等到對的光。
//
// 資料覆蓋見 README：年份 55/73（其餘標年代未詳，一直可收）、光線 41/73。

// 🔴 **1882 是安治的年**。清親的光線画停在 1881；弟子井上安治接著畫，收錄的 83 京橋勧業場之景
// 館方與奧付都是明治十五年（1882）。年份閘門是「那一年才出現」，只到 1881 的話它永遠不會出現
// ⇒ 走不完（check-pub 當場抓到：62/63，卡在 83）。⛔ 不把它夾回 1881——那等於改了它的年份。
export const YEARS = [1876, 1877, 1878, 1879, 1880, 1881, 1882];
export const TIMES = ['dawn', 'day', 'dusk', 'night'];
// ponytail: 天候按日固定輪轉，不做季節也不擲骰。
// 固定＝可預測（玩家等得到）也可模擬（check-pub 能證明不會鎖死）；
// 要做季節的話這裡換成「日 → 季 → 天候分佈」，閘門那側不用動。
export const WEATHERS = ['clear', 'snow', 'clear', 'rain'];
export const PER_YEAR = 8; // 收幾景翻一年（玩法頁也讀這個數字）

export const newState = () => ({ step: 0, collected: [], yearIdx: 0, yearMark: 0, fire: false });

export const clockOf = state => ({
  step: state.step,
  day: Math.floor(state.step / TIMES.length),
  time: TIMES[state.step % TIMES.length],
  weather: WEATHERS[Math.floor(state.step / TIMES.length) % WEATHERS.length],
  year: YEARS[Math.min(YEARS.length - 1, state.yearIdx)],
});

/** 每收一景或等一刻之後叫一次。年份只由這裡推進。
 *
 * 🔴 **第二個條件是防鎖死的，不是裝飾。** 第一版只有「收滿 PER_YEAR 景翻一年」，
 * 撞上資料分佈不均就走不完——1876–78 三年加起來只有 6 幅有年份，
 * 連同年代未詳的 17 幅也才 23 景，湊不滿翻到 1879 需要的 24 景 ⇒ 卡在 22/69。
 * check-pub.mjs 當場抓到。
 * ⇒ **當下已經沒有任何出現中的畫可收時，時間也要往前走**：
 * 等下去不會有新的畫，那就過一年。這條讓「走不完」在結構上不可能發生。 */
export function tick(state, views) {
  if (state.yearIdx >= YEARS.length - 1) return;
  const since = state.collected.length - state.yearMark;
  // 🔴 「還有沒有東西可收」要問的是**光等就等得到的**，不是「出現中的」。
  // 大火那四幅是年代未詳（＝出現中）但等的是事件，而事件等的是年份 ⇒ 循環，
  // 年份永遠不前進，卡在 22/69。check-pub 第二次又抓到同一個死結的另一面。
  const clock = clockOf(state);
  const left = views.some(v => {
    const b = blocked(v, clock, state);
    return b === null || b.why === 'time' || b.why === 'weather';
  });
  if (since >= PER_YEAR || !left) {
    state.yearIdx++;
    state.yearMark = state.collected.length;
  }
}

/** 這一幅的年份。館方斷代優先（51 幅），其次奧付判讀，都沒有就是年代未詳。 */
export const yearOf = v =>
  v.published_year ?? (v.published ? +String(v.published).slice(0, 4) : null);

/** 出現了沒有。年代未詳的一律出現——那不是資料缺口，是誠實的空白（同 edo-hyakkei）。 */
export const visible = (v, clock) => {
  const y = yearOf(v);
  return y == null || y <= clock.year;
};

/** 收得到嗎。回傳 null ＝ 收得到；否則回傳擋住它的理由（要說得出來，才能告訴玩家）。 */
export function blocked(v, clock, state) {
  if (!visible(v, clock)) return { why: 'year', need: yearOf(v) };
  if (state.collected.includes(v.id)) return { why: 'got' };
  const c = v.conditions || {};
  // 大火那四幅由事件開門，不由天候——它們畫的是 1881/01/26 那一場，
  // 不是「下雨天」那種可以等到的天候。
  if (c.weather === 'fire') {
    return state.fire ? null : { why: 'event' };
  }
  if (c.time_of_day && c.time_of_day !== clock.time) return { why: 'time', need: c.time_of_day };
  if ((c.weather === 'snow' || c.weather === 'rain') && c.weather !== clock.weather) {
    return { why: 'weather', need: c.weather };
  }
  return null;
}

export const collectable = (v, clock, state) => blocked(v, clock, state) === null;
