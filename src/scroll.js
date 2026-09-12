// 畫卷。收進畫帖的景照畫帖順序連成一卷，**由右往左**展讀——同東海道那一作的繪卷，
// 也同這批版畫原本的樣子：《清親畫帖》是三冊裝訂的冊子，翻的方向就是右起。
//
// ⛔ 這一格刻意不是「圖鑑格狀清單」。橫幅錦繪一張接一張排開，看得到的是
// **清親那五年的光線在變**：1876 的銀座是晴天白日，到 1881 只剩火與夜。
// 格狀清單看不出那件事，一卷連幅看得出來。
//
// 🔴 還沒收的也留一格（只印編號與題名），⛔ 不跳過——跳過的話卷長會隨進度變，
// 玩家就看不出「還差哪幾幅」。空格本身是資訊，同這個 repo 其餘各處的做法。
const KANSUJI = n => {                      // 1–99 → 漢數字（直書的標籤用）
  const d = '一二三四五六七八九';
  return (n >= 20 ? d[(n / 10 | 0) - 1] : '') + (n >= 10 ? '十' : '') + (n % 10 ? d[n % 10 - 1] : '');
};

const PX_PER_SEC = 90;                      // 自動展卷的速度。比東海道略快，因為這裡的卷更長

/**
 * @param views   要排進卷裡的景（已照畫帖順序）
 * @param got     判斷某一景收了沒
 * @param onPick  點某一景要做的事（開面板）
 * @param src     取圖：(view, mode) → 檔名，mode 是 'plate' 或 'pixel'
 */
export function openScroll(views, got, onPick, src) {
  const el = document.createElement('div');
  el.className = 'scroll-view';
  el.innerHTML = `
    <div class="sbar">
      <button data-act="prev" title="前一幅（→）">◀</button>
      <button data-act="next" title="後一幅（←）">▶</button>
      <button data-act="play" title="自動展卷（空白鍵）">▶ 自動展卷</button>
      <button data-act="flip">像素 ／ 真跡</button>
      <span class="stip">由右往左展讀・← → 翻幅・Home/End 卷首卷尾・滾輪或拖曳・點畫開面板・Esc 收卷</span>
      <button data-act="close" aria-label="收卷">✕</button>
    </div>
    <div class="sroll">
      <div class="jiku"></div>
      ${views.map(v => got(v) ? `
        <div class="span" data-id="${v.id}">
          <img loading="lazy" src="${src(v, 'plate')}" alt="${v.title.ja}">
          <b class="slabel">${KANSUJI(v.n)}　${v.title.ja}</b>
        </div>` : `
        <div class="span blank">
          <b class="slabel">${KANSUJI(v.n)}　${v.title.ja}</b>
          <span class="syet">未収</span>
        </div>`).join('')}
      <div class="jiku"></div>
    </div>`;
  document.body.append(el);

  const roll = el.querySelector('.sroll');
  // 🔴 一開啟就要停在**卷首**＝最右邊。row-reverse 之下瀏覽器給的起點不一定是那裡
  //（Chrome 給 0 而 0 在左端），所以自己捲到底。
  requestAnimationFrame(() => { roll.scrollLeft = roll.scrollWidth; });

  // ── 自動展卷 ───────────────────────────────────────────────
  // 等速往左捲＝閱讀方向。到卷尾自停：夾住之後 scrollLeft 不再跟著我們給的值走，
  // 那就是到底了（同東海道的判法——⛔ 不要拿 scrollWidth 去算，捲軸的邊界值各家瀏覽器不同）。
  let raf = 0, last = 0, pos = 0, playing = false;
  const play = on => {
    playing = on;
    el.querySelector('[data-act="play"]').textContent = on ? '⏸ 暫停' : '▶ 自動展卷';
    cancelAnimationFrame(raf);
    if (!on) return;
    last = 0;
    pos = roll.scrollLeft;
    const step = t => {
      if (!playing) return;
      if (last) {
        pos -= (t - last) * PX_PER_SEC / 1000;
        roll.scrollLeft = pos;
        if (Math.abs(roll.scrollLeft - pos) > 2) return play(false);
      }
      last = t;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };
  // ── 手動翻閱 ───────────────────────────────────────────────
  // 🔑 一卷 59 幅、兩萬多像素長，**自動展卷只適合看，不適合找**。
  // 所以三條路都要通：鍵盤（← → 翻幅、Home/End 卷首卷尾）、滾輪（快轉）、拖曳（拉卷軸）。
  //
  // ⚠️ 一律用 getBoundingClientRect 算距離再 scrollBy，⛔ 不直接設 scrollLeft：
  // row-reverse 之下 scrollLeft 的正負各家瀏覽器不同（Chrome 給負值），
  // 而「相對位移」在哪一家都一樣。
  const spans = [...roll.querySelectorAll('.span')];
  const step = dir => {                     // dir=+1 往左（後一幅）、-1 往右（前一幅）
    play(false);
    const r = roll.getBoundingClientRect();
    // 正在讀的 ＝ 右緣最靠近容器右緣的那一幅
    let i = 0, best = Infinity;
    spans.forEach((el, k) => {
      const d = Math.abs(el.getBoundingClientRect().right - r.right);
      if (d < best) { best = d; i = k; }
    });
    const next = spans[Math.min(spans.length - 1, Math.max(0, i + dir))];
    roll.scrollBy({ left: next.getBoundingClientRect().right - r.right, behavior: 'smooth' });
  };
  const ends = dir => {                      // 卷首（右端）／卷尾（左端）
    play(false);
    // ⛔ 這裡不能 smooth：卷長兩萬多像素，平滑捲要好幾秒，
    // 按 Home 之後畫面還在半路（實測按完停在第 5 幅）——「跳到頭」就該是跳。
    roll.scrollBy({ left: dir * roll.scrollWidth });
  };

  // 滾輪：直向滾輪也要能翻卷（這一格只有橫向可捲），並且快一點——
  // 照瀏覽器預設一格一格捲，兩萬像素要滾到天荒地老。
  roll.addEventListener('wheel', e => {
    play(false);
    const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    // 🔴 往下滾＝往下讀＝**往左**走。這一卷是右起的，照瀏覽器預設（往下＝往右）
    // 會變成「越滾越退回卷首」。
    roll.scrollLeft -= d * 2.5;
    e.preventDefault();
  }, { passive: false });
  roll.addEventListener('touchstart', () => play(false), { passive: true });

  // 拖曳：手卷本來就是用拉的。⚠️ 拖過之後那一下 click 不能算成「點開這一幅」
  //（同 map.js 的 dragged()）——移動超過 6px 就當拖曳。
  let drag = null, moved = false;
  roll.addEventListener('pointerdown', e => {
    if (e.button) return;
    drag = { x: e.clientX, at: roll.scrollLeft };
    moved = false;
    play(false);
  });
  addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 6) moved = true;
    roll.scrollLeft = drag.at - dx;
  });
  addEventListener('pointerup', () => { drag = null; });

  let px = false;
  const shut = () => { play(false); el.remove(); removeEventListener('keydown', key); };
  const key = e => {
    if (e.key === 'Escape') { e.stopPropagation(); return shut(); }
    // 讀的方向是由右往左 ⇒ ← 是「翻到下一幅」，→ 是「回上一幅」
    if (e.key === 'ArrowLeft') { e.preventDefault(); return step(1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); return step(-1); }
    if (e.key === 'Home') { e.preventDefault(); return ends(1); }    // 卷首在右
    if (e.key === 'End') { e.preventDefault(); return ends(-1); }
    if (e.key === ' ') { e.preventDefault(); return play(!playing); }
  };
  addEventListener('keydown', key);

  el.onclick = e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close' || e.target === el) return shut();
    if (act === 'play') return play(!playing);
    if (act === 'next') return step(1);
    if (act === 'prev') return step(-1);
    if (act === 'flip') {
      px = !px;
      for (const img of roll.querySelectorAll('img')) {
        const v = views.find(v => String(v.id) === img.closest('.span').dataset.id);
        img.src = src(v, px ? 'pixel' : 'plate');
      }
      roll.classList.toggle('pixel', px);
      return;
    }
    // ⚠️ 剛剛那一下是拖曳不是點畫（拖過卷之後手一放會補一個 click）——
    // ⛔ 這個判斷只能擋「點畫」，⛔ 不能擋工具列的鈕，否則拖完卷之後第一次按鈕沒反應。
    if (moved) { moved = false; return; }
    const span = e.target.closest('.span:not(.blank)');
    if (span) {
      shut();
      onPick(views.find(v => String(v.id) === span.dataset.id));
    }
  };
  return shut;
}
