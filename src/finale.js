// 收滿之後的結局：**五年的顏色**。
//
// 🔴 色帶不是我配的：每一幅的十六色由 tools 從原畫本身取樣（data/palettes.json），
// 這裡只照年份把它們排起來——⛔ 不調色、不挑好看的、不重新排序。排出來什麼樣就什麼樣。
// 那條「1876 銀座的晴空 → 1881 只剩火與夜」的線，是這部作品本身的弧線（開場放的也是它），
// 玩家收滿之後看到的是同一條線，只是這次由他自己收出來的六十三幅畫出來。
//
// ⚠️ 年代未詳的那幾幅**另外排一列**，⛔ 不塞進任何一年：年份查不到就是查不到，
// 空白是資訊（同 places.json 的 _unresolved）。
// ⚠️ 1882 是安治的年份（清親停筆之後），列上標明是誰畫的——⛔ 不混在清親的五年裡。

const KANSUJI = n => {
  const d = '一二三四五六七八九';
  return (n >= 20 ? d[(n / 10 | 0) - 1] : '') + (n >= 10 ? '十' : '') + (n % 10 ? d[n % 10 - 1] : '');
};

/** 一幅畫在色帶上占幾格。取樣的十六色等距抽 PER_PRINT 個——⛔ 不取「最鮮豔的」。 */
const PER_PRINT = 4;

const swatches = pal => {
  if (!pal?.length) return [];
  const step = (pal.length - 1) / (PER_PRINT - 1);
  return Array.from({ length: PER_PRINT }, (_, i) => pal[Math.round(i * step)]);
};

/**
 * @param opts.views     地圖上的全部景（已照畫帖順序）
 * @param opts.yearOf    取年份（年代未詳回 null）
 * @param opts.palettes  data/palettes.json：id → 十六色
 * @param opts.who       取畫師 (view) → 'kiyochika' | 'inoue-yasuji'
 * @param opts.waits     這一場等了幾刻（step 扣掉收景數；⛔ 沒有就不寫）
 */
export function finaleHtml({ views, yearOf, palettes, who, waits }) {
  const yas = views.filter(v => who(v) === 'inoue-yasuji').length;
  const rows = [];
  const years = [...new Set(views.map(yearOf).filter(y => y != null))].sort((a, b) => a - b);
  for (const y of years) {
    const of = views.filter(v => yearOf(v) === y);
    const only = new Set(of.map(who));
    rows.push({
      label: `明治${KANSUJI(y - 1867)}年　${y}`,
      note: only.size === 1 && only.has('inoue-yasuji') ? '井上安治' : '',
      n: of.length, of,
    });
  }
  const undated = views.filter(v => yearOf(v) == null);
  if (undated.length) rows.push({ label: '年代未詳', note: '題名沒寫年份', n: undated.length, of: undated });

  const bar = of => of.map(v => swatches(palettes?.[v.id])
    .map(c => `<i style="background:${c}"></i>`).join('')).join('');

  return `<p>明治十四年，清親不畫光線畫了。石版與照片進來，木版的風景賣不動了。<br>
      清親 ${views.length - yas} 幅${yas ? `；弟子井上安治接了下來，這裡收了他 ${yas} 幅` : ''}。
      你把地圖上的 ${views.length} 幅全部收齊了${waits ? `，其間等了 ${waits} 刻` : ''}。</p>
    <h3 class="fin-h">每一年的顏色</h3>
    <div class="fin">${rows.map(r => `
      <div class="fin-row">
        <span class="fin-year">${r.label}</span>
        <span class="fin-who">${r.note}</span>
        <span class="fin-bar">${bar(r.of)}</span>
        <span class="fin-n">${r.n}</span>
      </div>`).join('')}
    </div>
    <p class="fin-note">每一格是一幅畫的取樣色，由程式從原畫本身取出來（data/palettes.json），
      一幅四格、照畫帖順序排，沒有調色也沒有重排——所以一列有多長，就是那一年有幾幅。</p>
    <p class="fin-act"><button data-act="emaki">打開畫卷，從頭讀一次</button></p>`;
}
