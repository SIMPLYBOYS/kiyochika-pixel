// 開場與跑馬燈。
//
// 🔑 **開場放的是這部作品本身的弧線**：清親的光線畫從 1876 年的銀座（晴天白日）
// 走到 1881 年的兩国大火（只剩火與夜），五年就停筆。開場依年份挑六幅淡入淡出，
// 玩家還沒開始玩就先看見那條線——⛔ 不是隨機輪播漂亮圖。
//
// ⛔ 介紹文不是我寫的感想：作者與畫風兩段逐字取自維基百科（同面板的〈解說〉，
// 見 tools/fetch-topics.py），其餘是這個 repo 自己數得出來的事實（幾幅、哪幾年、
// 館藏編號）。**這一作不寫沒有出處的話**，開場也一樣。

const KANSUJI = n => {
  const d = '一二三四五六七八九';
  return (n >= 20 ? d[(n / 10 | 0) - 1] : '') + (n >= 10 ? '十' : '') + (n % 10 ? d[n % 10 - 1] : '');
};

const KEY = 'kiyochika.intro.v1';
export const introSeen = () => { try { return !!localStorage.getItem(KEY); } catch { return false; } };
const markSeen = () => { try { localStorage.setItem(KEY, '1'); } catch { /* 無痕 */ } };

/** 依年份挑開場要放的幾幅：最早的一路到最後那場火。⛔ 不挑「好看的」，挑「講得出順序的」。 */
function pickReel(views, yearOf) {
  const dated = views.filter(v => yearOf(v) != null).sort((a, b) => yearOf(a) - yearOf(b));
  if (dated.length < 4) return views.slice(0, 5);
  const want = 6;
  const step = (dated.length - 1) / (want - 1);
  return Array.from({ length: want }, (_, i) => dated[Math.round(i * step)]);
}

/**
 * @param opts.views    要放的景（已照畫帖順序）
 * @param opts.yearOf   取年份
 * @param opts.src      取圖 (view) → 檔名
 * @param opts.topic    取解說 (名稱) → {title, text, url} 或 null
 * @param opts.total    畫帖收錄幾幅（⚠️ 不等於地圖上的幅數：10 幅沒查到座標）
 * @param opts.onDone   關掉之後要做的事
 */
export function playIntro({ views, total, yearOf, src, topic, onDone }) {
  const reel = pickReel(views, yearOf);
  const who = topic('小林清親'), how = topic('光線画');
  const el = document.createElement('div');
  el.className = 'intro';
  el.innerHTML = `
    <div class="ireel">${reel.map((v, i) => `
      <img src="${src(v)}" alt="" style="animation-delay:${i * 3.4}s">`).join('')}</div>
    <div class="iveil"></div>
    <div class="itext">
      <h1>東京名所圖</h1>
      <div class="isub">光線畫　明治九年–十四年　1876–1881</div>
      <p class="iwho">小林清親</p>
      ${who ? `<p>${who.text}</p>` : ''}
      ${how ? `<p>${how.text}</p>` : ''}
      <p class="ifact">國立國會圖書館《清親畫帖》三冊・公有領域<br>
        收錄 ${total ?? views.length} 幅，地圖上 ${views.length} 幅——走過清親的五年</p>
      <p class="ifact">配樂　端唄・雅樂・尺八本曲・新內・追分
        <small>入場後開始播放，按 ♪ 或 M 可關</small></p>
      <p class="isrc">人物與畫風兩段譯自維基百科日本語版（CC BY-SA 4.0）</p>
    </div>
    <div class="ibtn">
      <button data-act="enter">入場</button>
    </div>`;
  document.body.append(el);

  // ⛔ 關掉動態效果的人不該被關在開場裡：直接把文字擺好，⛔ 不跑淡入與上捲。
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) el.classList.add('still');

  const shut = () => {
    markSeen();
    el.classList.add('out');
    // 等淡出跑完再移除，⚠️ 但別靠 transitionend——被中斷就永遠不會觸發
    setTimeout(() => { el.remove(); removeEventListener('keydown', key); onDone?.(); }, 420);
  };
  const key = e => {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); shut(); }
  };
  addEventListener('keydown', key);
  el.onclick = e => { if (e.target.closest('[data-act="enter"]') || e.target === el) shut(); };
  return shut;
}

/**
 * 跑馬燈：作品本身的介紹＋每一幅的題名與年份，橫著跑。
 * 🔴 內容全部來自資料（題名、年份、館藏），⛔ 不寫宣傳詞。
 * ⚠️ 無縫靠「同一份內容排兩次、位移到一半再從頭」——⛔ 不要用 JS 每幀去挪，
 * 那會跟地圖的 rAF 搶同一條時間線，地圖一忙跑馬燈就抖。
 */
export function startTicker(el, { views, yearOf, blurb }) {
  const items = [
    ...blurb,
    ...views.map((v, i) => {
      const y = yearOf(v);
      return `${KANSUJI(i + 1)}　${v.title.ja}　<i>${y ? `明治${y - 1867}年（${y}）` : '年代未詳'}</i>`;
    }),
  ];
  const run = `<span class="tk">${items.join('<em>・</em>')}<em>・</em></span>`;
  el.innerHTML = run + run;                       // 兩份：位移到 -50% 時畫面上的內容跟起點一樣
  // 速度定成「每秒走幾像素」，⛔ 不是固定秒數——不然內容一長就會飛快
  const w = el.firstElementChild.getBoundingClientRect().width;
  el.style.setProperty('--tk-dur', `${Math.round(w / 42)}s`);
}
