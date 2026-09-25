// 配樂。五首公有領域的早期唱片，接著放、放完回到第一首。
//
// 🔴 **這不是「明治九年的聲音」**：1876–1881 沒有錄音存在（留聲機 1877 年才發明，
// 日本最早的商業錄音是 1903 年）。這五首是 1925–31 年錄的**當時仍在演奏的曲目**——
// 端唄・雅樂・尺八本曲・新內・追分。⛔ 面板上就照這樣寫，不含糊。
//
// ⚠️ 瀏覽器不准沒有使用者動作就出聲（autoplay policy）⇒ 一定要等一次點擊。
// ⛔ 不要在載入時就 play()，那只會得到一個被擋掉的 promise 與一個沉默的 bug。
//
// 🔴 這一支被 Safari 教過三次（2026-09-24／25／26），三條結論寫在這裡，
// 因為 **headless Chromium 看不出來**——它對這幾條路徑一律放行，連
// `--autoplay-policy=document-user-activation-required` 都照樣過：
//
//   ① play() 必須**同步**發生在手勢那一拍裡。中間插一個 await（例如等 AudioContext
//      resume）就不算使用者啟用了 ⇒ 先 play()，之後才接 WebAudio。
//   ② ⛔ **不要把元素接進一個跑不起來的 AudioContext**。createMediaElementSource 一旦接上，
//      聲音就只從那張圖出來；圖沒在跑＝完全沒聲音，而元素的 currentTime 照走
//      ——看起來「在播」卻什麼都聽不到。⇒ 先確認 state === 'running' 才接，
//      接不上就退回元素自己播（沒有淡入，但**有聲音**）。
//   ③ 關掉再開要**接著播同一首**。舊版呼叫 next()：換一首＝換一個網址＝重新下載，
//      手機上就是又一次幾秒的沉默與又一次失敗的機會。

const KEY = 'kiyochika.music.v1';
const FADE = 1.6;                     // 秒。78 轉唱片本來就有雜訊底，硬切會很刺耳

export function createMusic(tracks, { onTrack } = {}) {
  // 🔴 **沒設定過就是開著**。第一版預設關，而那顆 ♪ 在一排 HUD 按鈕裡很不起眼——
  // 玩家入場之後什麼也沒聽到，只會以為壞了。
  // ⚠️ 預設開不等於自動播放：仍然要等使用者動作，而明確關過的人（存成 '0'）就維持關。
  let i = -1, on = true, el = null, ctx = null, gain = null;
  let timer = 0, pauseTimer = 0, started = false, rearm = null;
  try { const v = localStorage.getItem(KEY); if (v !== null) on = v === '1'; } catch { /* 無痕 */ }

  // ⚠️ 網址帶內容雜湊：/assets/audio/* 是 7 天快取而檔名不變，重新轉檔之後沒有這個碼的人收不到。
  const url = t => t.file + (t.v ? `?v=${t.v}` : '');

  const make = () => {
    if (el) return;
    el = new Audio();
    el.preload = 'none';              // ⛔ 沒開配樂就別下載 7MB
    el.crossOrigin = 'anonymous';
    el.onended = () => next();        // seconds 對不上時的保險（⚠️ 不要只靠計時器）
    // 🔴 「開始播了嗎」只能由媒體元素自己說。⛔ 不要樂觀假設——iOS 上 play() 很可能被拒，
    // 旗標卻記成開過了，接著按 ♪ 就變成把它關掉，玩家要按兩次才有聲音。
    el.addEventListener('playing', () => { started = true; });
    // ⚠️ 掛進 DOM：`new Audio()` 不在文件裡，瀏覽器的媒體控制與驗收腳本都看不到它。
    el.hidden = true;
    document.body.append(el);
  };

  // ⚠️ iOS 16.4+ 才有：不設的話，手機側邊的靜音鍵一開就完全沒聲音——
  // 而玩家不會想到是那個開關，只會覺得「這個網站沒聲音」。
  const session = () => {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* 沒有就算了 */ }
  };

  // 🔴 同步、在手勢那一拍裡呼叫 play()（見檔頭 ①）。
  const playNow = () => {
    const p = el.play();
    if (p?.catch) p.catch(() => { started = false; arm(); });   // 被擋掉就等下一次互動再試
  };

  // WebAudio 只為了平順的淡入淡出（HTMLMediaElement.volume 在 iOS 上是唯讀的）。
  // 🔴 但它是**加分項不是必需品**：接不上就退回元素自己播（見檔頭 ②）。
  const wire = async () => {
    if (gain) {                                    // 已經接好，只要確保它在跑
      if (ctx.state !== 'running') await ctx.resume?.().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || ctx === false) return;               // ctx === false ＝ 試過接不上，⛔ 不再試
    try {
      const c = new AC();
      if (c.state !== 'running') await c.resume();
      // ⚠️ Safari 還有 'interrupted' 這個狀態（來電、鬧鐘…）⇒ 只認 running
      if (c.state !== 'running') { c.close?.(); ctx = false; return; }
      const g = c.createGain();
      g.gain.value = el.volume;                     // 從現在的音量接手，⛔ 不要跳一下
      g.connect(c.destination);
      c.createMediaElementSource(el).connect(g);
      ctx = c; gain = g;
      // 被系統中斷之後要能自己回來；回不來就在下一次互動再試
      c.onstatechange = () => { if (c.state !== 'running') arm(); };
      ramp(on ? 0.55 : 0);
    } catch { ctx = false; }                        // ⛔ 接不上就維持「元素自己播」
  };

  const ramp = to => {
    if (!gain) { try { el.volume = to; } catch { /* iOS 唯讀：沒有淡入，但有聲音 */ } return; }
    const t = ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(to, t + FADE);
  };

  // 自己排下一首，⛔ 不用 loop 屬性：五首要輪流，而且要淡出再換
  const schedule = t => {
    clearTimeout(timer);
    if (!t?.seconds) return;
    timer = setTimeout(() => { ramp(0); setTimeout(() => next(), FADE * 1000); },
                       Math.max(1000, (t.seconds - FADE) * 1000));
  };

  const next = () => {
    i = (i + 1) % tracks.length;
    const t = tracks[i];
    el.preload = 'auto';              // 已經要播了，讓它盡量往前抓
    // 🔴 已經在載同一首就**不要再指派 src**：重新指派會再發一個請求，而第二個會卡在
    // 第一個的 HTTP 快取鎖上 ⇒ 實測 400kbps 下要多等 16 秒才出聲。
    const want = url(t);
    if (!el.src.endsWith(want)) el.src = want;
    playNow();
    onTrack?.(t);
    schedule(t);
    ramp(0.55);
  };

  const start = () => {
    make();
    session();
    clearTimeout(pauseTimer);         // 🔴 上一次關掉排的那個 pause 不能落在剛開始的播放上
    // 🔴 關掉再開＝**接著播同一首**，⛔ 不是換下一首（見檔頭 ③）
    if (el.src && i >= 0) {
      el.preload = 'auto';
      playNow();
      onTrack?.(tracks[i]);
      schedule(tracks[i]);
      ramp(0.55);
    } else next();
    wire();                           // ⚠️ 非同步，一定要排在 play() 後面
  };

  const stop = () => {
    clearTimeout(timer);
    ramp(0);
    clearTimeout(pauseTimer);
    pauseTimer = setTimeout(() => el?.pause(), FADE * 1000);
  };

  const off = () => { removeEventListener('click', go); removeEventListener('keydown', go); };
  function go(e) {
    // ⛔ 不要接那顆 ♪ 自己的那一下：它自己會處理，兩邊都接會變成「開始播又立刻關掉」。
    if (rearm && e.target?.closest?.(rearm)) return;
    start();
    // ⚠️ **成功了才拆掉**：第一次很可能是無效的手勢（被系統選單吃掉的那一下），
    // 留著就會在下一次互動自動再試，⛔ 不要讓玩家自己去按開關。
    setTimeout(() => { if (started && (ctx === false || !ctx || ctx.state === 'running')) off(); }, 800);
  }
  /** 等下一次使用者互動再試一次。⚠️ 可以重複呼叫，內部只留一組 handler。 */
  const arm = (ignore = rearm) => {
    if (!on) return;
    rearm = ignore;
    off();
    // 🔴 用 **click**，⛔ 不要用 pointerdown：iOS Safari 的自動播放政策不吃 touchstart
    // 那一階段，只有 click／touchend 算「使用者啟用」。掛在 pointerdown 上的後果是
    // 第一次觸碰就 start()、play() 被拒、旗標卻記成開過了 ⇒ 按 ♪ 反而是把它關掉。
    addEventListener('click', go);
    addEventListener('keydown', go);
  };

  // 🔴 手機上「聲音過很久才出現」的另一半：preload='none' ⇒ 按下去才開始下載。
  // 配樂預設開著，所以先把**第一首的檔頭**抓下來（faststart 之後 moov 在最前面，29–72KB），
  // 按下去時只剩音訊資料要補。⛔ 不用 'auto'：那會在還沒人要聽的時候就拉滿 7MB。
  if (on && tracks[0]) { make(); el.preload = 'metadata'; el.src = url(tracks[0]); i = 0; }

  return {
    get on() { return on; },
    /** 使用者按下去才會呼叫到這裡 ⇒ autoplay policy 過得了。 */
    toggle() {
      // 🔴 顯示「開著」但還沒響過（在等使用者第一次動作）時，按下去是**開始播**，⛔ 不是關掉。
      // 不然玩家看到一顆亮著的 ♪、按下去卻是把它關掉——而且什麼都還沒聽到。
      if (on && !started) { start(); return on; }
      on = !on;
      try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* 無痕 */ }
      if (on) { started = false; start(); } else { off(); stop(); }
      return on;
    },
    /** 上次開著的話，**等使用者第一次動作**（點畫面或按鍵）就接著放。
     *  ⚠️ 不能只靠開場的「入場」——回訪的人不會再看到開場。 */
    armResume(ignore) { if (on) arm(ignore); },
    get track() { return i < 0 ? null : tracks[i]; },
    /** 驗收用：⚠️ 「在播放」跟「聽得到」是兩回事——AudioContext 沒在跑的話，
     *  媒體元素的 currentTime 照走，但一點聲音都沒有。⇒ 要驗的是這幾個。
     *  ⚠️ ctx==='bypass' ＝ 試過接不上，改用元素自己播（那時音量看的是 el.volume）。 */
    debug: () => ({ ctx: ctx === false ? 'bypass' : ctx?.state ?? null,
                    gain: gain ? gain.gain.value : (el?.volume ?? null),
                    paused: el?.paused ?? null, t: el?.currentTime ?? null }),
  };
}
