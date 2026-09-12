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
  // 🔴 **關掉瀏覽器的原生圖片拖曳**。不關的話：按下去拖第一下有反應，接著瀏覽器
  // 認定這是「把圖片拖出去」的手勢，接管指標、後面的 pointermove 全部不送——
  // 症狀就是「放大之後拖不動」（實測拖 220px 只移動 22px＝只有第一個事件生效）。
  img.draggable = false;

  let k = 1, x = 0, y = 0, fit = 1;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  /** 位移的合法範圍。🔴 **不能假設圖是置中的**：
   *  容器是 place-items:center，但 grid 對「比容器大的元素」是**靠左上排**的
   *  （實測放大三倍時 left=0、top=0）。第一版照「置中」去夾（±(w-視窗)/2），
   *  於是只走得到一半——**看得到左上角，永遠到不了右下角**（Aaron 回報「卡在一些地方」）。
   *  ⇒ 改成從**實際的排版位置**算：offsetLeft/offsetTop 不受 transform 影響，正好拿來當基準。 */
  const span = (base, size, view) => {
    if (size <= view) {                       // 比視窗小：就待在原地（grid 已經置中了）
      const c = (view - size) / 2 - base;
      return [c, c];
    }
    return [view - base - size, -base];       // 比視窗大：左緣最多到 0、右緣最少到視窗邊
  };
  const apply = () => {
    const w = img.naturalWidth * k, h = img.naturalHeight * k;
    // 🔴 縮放要改**排版尺寸**，不能只用 transform: scale()（見下面那段註解）。
    // ⚠️ 而且要先設寬度再量 offset——量到的才是這個尺寸下的排版位置。
    img.style.width = `${Math.round(w)}px`;
    const [xlo, xhi] = span(img.offsetLeft, w, innerWidth);
    const [ylo, yhi] = span(img.offsetTop, img.getBoundingClientRect().height || h, innerHeight);
    x = clamp(x, xlo, xhi);
    y = clamp(y, ylo, yhi);
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

  /** 繞著某一點縮放：把那一點底下的畫面內容留在原處。
   *  ⚠️ 錨點要用「相對於圖的排版原點」算，⛔ 不是相對於視窗中心——
   *  圖不是置中的（見 span 那段），拿視窗中心當原點會愈縮愈偏。 */
  const zoomAt = (nk, px, py) => {
    const bx = img.offsetLeft, by = img.offsetTop;
    const f = nk / k;
    x = px - bx - (px - bx - x) * f;
    y = py - by - (py - by - y) * f;
    k = nk;
    apply();
  };

  lb.onwheel = e => {
    e.preventDefault();
    zoomAt(clamp(k * Math.exp(-e.deltaY * 0.0015), fit * 0.9, 4), e.clientX, e.clientY);
  };
  let drag = null;
  lb.onpointerdown = e => { if (e.target === img) drag = { x: e.clientX - x, y: e.clientY - y }; };
  lb.onpointermove = e => { if (drag) { x = e.clientX - drag.x; y = e.clientY - drag.y; apply(); } };
  addEventListener('pointerup', () => { drag = null; });

  const shut = () => { lb.remove(); removeEventListener('keydown', key); removeEventListener('resize', refit); };
  // 方向鍵也要能移動：放大之後用鍵盤看畫的人不該被排除在外。
  // ⚠️ 一定要 preventDefault ＋ stopPropagation——否則同一下按鍵會順便把**底下的地圖**
  // 也推走（地圖的方向鍵是掛在 window 上的）。
  const STEP = 90;
  const key = e => {
    if (e.key === 'Escape') return shut();
    const d = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    const step = STEP * (e.shiftKey ? 3 : 1);   // 按住 shift 走快一點
    x += d[0] * step;
    y += d[1] * step;
    apply();
  };
  addEventListener('keydown', key);
  lb.onclick = e => { if (e.target === lb || e.target.classList.contains('ltip')) shut(); };
  lb.querySelector('.lzoom').onclick = e => {
    const z = e.target.dataset.z;
    if (!z) return;
    if (z === 'fit') { k = fit; x = y = 0; apply(); }
    else zoomAt(clamp(k * (z === 'in' ? 1.6 : 1 / 1.6), fit * 0.9, 4), innerWidth / 2, innerHeight / 2);
  };
  return shut;
}
