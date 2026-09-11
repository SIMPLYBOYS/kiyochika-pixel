// 原寸檢視。這一格看的不是「遊戲畫面」，是**那張版畫本身**——
// assets/plate 是裁到和紙的掃描（1527–1690px），比面板裡的 720px 縮圖大一倍多，
// 瓦斯燈的玻璃、暖簾上的字、雪地裡的腳印都在那個尺度才看得到。
//
// ⛔ 刻意不做 edo-hyakkei 那套的旋轉：那邊有掛軸與直幅，這批全是橫幅錦繪。
//
// 連續縮放而不是「fit ⇄ 原寸」兩段跳：兩段跳點一下就衝到最大，中間沒有東西。
export function zoom(src, caption) {
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.innerHTML = `<img src="${src}" alt="">
    <div class="lzoom">
      <button data-z="in" aria-label="放大">＋</button>
      <button data-z="out" aria-label="縮小">－</button>
      <button data-z="fit">全圖</button>
    </div>
    <div class="ltip">拖曳移動・滾輪縮放　·　點背景或 Esc 關閉${caption ? `　·　${caption}` : ''}</div>`;
  document.body.append(lb);
  const img = lb.querySelector('img');

  let k = 1, x = 0, y = 0, fit = 1;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const apply = () => {
    const w = img.naturalWidth * k, h = img.naturalHeight * k;
    // 夾住位移，否則可以把圖整個拖出畫面然後找不回來
    const mx = Math.max(0, (w - innerWidth) / 2), my = Math.max(0, (h - innerHeight) / 2);
    x = clamp(x, -mx, mx);
    y = clamp(y, -my, my);
    // 🔴 縮放要改**排版尺寸**，不能只用 transform: scale()。
    // 容器是 place-items:center，但**grid 對「比容器大的元素」不會置中**——
    // 它會從左上角排起，然後 scale 繞著那個（已經偏掉的）中心縮，
    // 於是圖的右緣鑽到縮放鈕底下、下緣掉出畫面（實測 r=1407 > 視窗 1440 的按鈕 1386）。
    // 讓排版尺寸等於實際尺寸，置中就由 grid 正確處理，transform 只管平移。
    img.style.width = `${Math.round(w)}px`;
    img.style.transform = `translate(${x}px,${y}px)`;
  };
  const refit = () => {
    // 🔴 要**讓開控制列**。第一版用 0.94/0.86 的比例，結果圖伸到縮放鈕底下——
    // 鈕在上層還是按得到，但它們壓在畫面上，而這一格的重點正是那張畫。
    // 窄螢幕（<640）控制列改排在下方，所以讓開的是高度不是寬度。
    const narrow = innerWidth < 640;
    const availW = innerWidth - (narrow ? 24 : 120);
    const availH = innerHeight - (narrow ? 150 : 110);
    fit = Math.min(availW / img.naturalWidth, availH / img.naturalHeight, 1);
    k = fit; x = y = 0; apply();
  };
  img.addEventListener('load', refit);
  if (img.complete && img.naturalWidth) refit();
  addEventListener('resize', refit);

  lb.onwheel = e => {
    e.preventDefault();
    const before = k;
    k = clamp(k * Math.exp(-e.deltaY * 0.0015), fit * 0.9, 4);
    // 繞游標縮放：把游標底下那一點留在原處
    const cx = e.clientX - innerWidth / 2, cy = e.clientY - innerHeight / 2;
    x = cx - (cx - x) * (k / before);
    y = cy - (cy - y) * (k / before);
    apply();
  };
  let drag = null;
  lb.onpointerdown = e => { if (e.target === img) drag = { x: e.clientX - x, y: e.clientY - y }; };
  lb.onpointermove = e => { if (drag) { x = e.clientX - drag.x; y = e.clientY - drag.y; apply(); } };
  addEventListener('pointerup', () => { drag = null; });

  const shut = () => { lb.remove(); removeEventListener('keydown', key); removeEventListener('resize', refit); };
  const key = e => { if (e.key === 'Escape') shut(); };
  addEventListener('keydown', key);
  lb.onclick = e => { if (e.target === lb || e.target.classList.contains('ltip')) shut(); };
  lb.querySelector('.lzoom').onclick = e => {
    const z = e.target.dataset.z;
    if (!z) return;
    if (z === 'fit') { k = fit; x = y = 0; } else k = clamp(k * (z === 'in' ? 1.6 : 1 / 1.6), fit * 0.9, 4);
    apply();
  };
  return shut;
}
