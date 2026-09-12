// 讓畫動起來的第一層：**只動氛圍，不動內容**。
//
// 🔴 規矩就這一條。雪落、雨斜、燈火明滅——這些動起來不會替清親多決定任何事；
// ⛔ 人物走動、船前進、火車進站就不行，那等於讓程式（或模型）替他決定畫面上發生了什麼，
// 而這部作品的價值正是「1876–81 的東京真的長這樣」。
//
// 🔑 **動什麼、在哪裡動，全部來自既有資料**，⛔ 不是我看圖猜的：
//   · 下不下雪、下不下雨 ← `conditions.weather`，只從題名判（見 tools/derive-light.py）
//   · 燈火在哪一點 ← `details` 裡人工挑過、名字帶「燈／火／光」的那幾個標註座標
// ⇒ 沒有資料的景就不動，跟這個 repo 其餘各處一樣：空白是資訊。
//
// ⛔ 不用 WebGL、不用函式庫：一張 canvas、兩種粒子、一個 rAF。

const FLAKES = 90;                 // 雪。再多就從「下雪」變成「暴風雪」
const DROPS = 70;
const LIGHT = /燈|灯|火|光|明/;    // 標註名字帶這些字的才當成燈火

const rnd = (a, b) => a + Math.random() * (b - a);

/**
 * @param art   面板裡那個 #art 容器（canvas 疊在圖上）
 * @param v     這一景
 * @returns 停止函式
 */
export function weather(art, v) {
  const c = v.conditions || {};
  const kind = c.weather === 'snow' ? 'snow' : c.weather === 'rain' ? 'rain' : null;
  // 夜與夕才點燈；而且要真的有人挑過的燈火座標
  const lamps = ['night', 'dusk'].includes(c.time_of_day)
    ? (v.details ?? []).filter(d => LIGHT.test(d.label ?? '')) : [];
  if (!kind && !lamps.length) return () => {};

  const cv = document.createElement('canvas');
  cv.className = 'wx';
  art.append(cv);
  const ctx = cv.getContext('2d');

  let w = 0, h = 0, bits = [];
  const size = () => {
    const img = art.querySelector('img');
    if (!img) return false;
    const r = img.getBoundingClientRect();
    if (!r.width) return false;
    // ⚠️ canvas 要照裝置像素比放大，否則在 Retina 上雪片是糊的方塊
    const dpr = Math.min(2, devicePixelRatio || 1);
    w = r.width; h = r.height;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.width = `${w}px`;
    cv.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bits = kind === 'snow'
      ? Array.from({ length: FLAKES }, () => ({ x: rnd(0, w), y: rnd(0, h), r: rnd(0.7, 2.1),
                                                vy: rnd(8, 26), drift: rnd(-14, 14), p: rnd(0, 6.3) }))
      : kind === 'rain'
        ? Array.from({ length: DROPS }, () => ({ x: rnd(0, w), y: rnd(0, h), len: rnd(7, 18),
                                                 vy: rnd(220, 420), a: rnd(0.12, 0.3) }))
        : [];
    return true;
  };

  // ⛔ 關掉動態效果的人：畫一格靜態的就停，⛔ 不是什麼都不畫（那會讓雪景少一層東西）
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0, last = 0, t0 = performance.now();

  const draw = now => {
    if (!w && !size()) { raf = requestAnimationFrame(draw); return; }
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    ctx.clearRect(0, 0, w, h);

    if (kind === 'snow') {
      ctx.fillStyle = '#fffdf5';
      for (const f of bits) {
        f.y += f.vy * dt;
        f.p += dt;
        f.x += Math.sin(f.p) * f.drift * dt;
        if (f.y > h) { f.y = -4; f.x = rnd(0, w); }
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, 6.284);
        ctx.fill();
      }
    } else if (kind === 'rain') {
      ctx.strokeStyle = '#dce6ee';
      ctx.lineWidth = 1;
      for (const d of bits) {
        d.y += d.vy * dt;
        d.x += d.vy * dt * 0.18;               // 雨斜著下，角度跟速度綁著才不會像滑動的線
        if (d.y > h) { d.y = -d.len; d.x = rnd(-20, w); }
        ctx.globalAlpha = d.a;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.len * 0.18, d.y - d.len);
        ctx.stroke();
      }
    }

    // 燈火：在人工挑過的那幾個座標上做**很輕**的明滅。
    // ⛔ 不畫光暈形狀——那會蓋掉版畫本來的筆觸；只疊一層極淡的暖色。
    if (lamps.length) {
      const s = (now - t0) / 1000;
      for (const [i, d] of lamps.entries()) {
        const x = d.x * w, y = d.y * h, r = Math.max(10, d.r * w * 1.4);
        // ⚠️ 0.10±0.06 在截圖上根本看不見（實測）。明滅本來就該輕，但要輕得**看得出來**。
        const a = 0.16 + 0.10 * Math.sin(s * 2.1 + i * 1.7);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(255,214,140,${a})`);
        g.addColorStop(1, 'rgba(255,214,140,0)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 6.284);
        ctx.fill();
      }
    }
    if (!still) raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);

  // ⚠️ 只在第一幀量一次不夠：**圖還沒載完**時它的高度只有佔位的那點（實測量到 240px，
  // 實際 620px），雪就只下在最上面一條。⇒ 讓 ResizeObserver 盯著那張圖，尺寸一變就重量。
  // （這是本月第二次同型：HUD 的高度也是這樣才對的。）
  const onResize = () => { w = 0; };          // 下一幀自己重新量
  addEventListener('resize', onResize);
  const ro = new ResizeObserver(onResize);
  const img = art.querySelector('img');
  if (img) ro.observe(img);
  return () => {
    cancelAnimationFrame(raf);
    removeEventListener('resize', onResize);
    ro.disconnect();
    cv.remove();
  };
}
