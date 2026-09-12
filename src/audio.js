// 配樂。五首公有領域的早期唱片，接著放、放完回到第一首。
//
// 🔴 **這不是「明治九年的聲音」**：1876–1881 沒有錄音存在（留聲機 1877 年才發明，
// 日本最早的商業錄音是 1903 年）。這五首是 1925–31 年錄的**當時仍在演奏的曲目**——
// 端唄・雅樂・尺八本曲・新內・追分。⛔ 面板上就照這樣寫，不含糊。
//
// ⚠️ 瀏覽器不准沒有使用者動作就出聲（autoplay policy）⇒ 一定要等一次點擊。
// 這一作剛好有現成的那一下：開場的「入場」。⛔ 不要在載入時就 play()，
// 那只會得到一個被擋掉的 promise 與一個沉默的 bug。

const KEY = 'kiyochika.music.v1';
const FADE = 1.6;                     // 秒。78 轉唱片本來就有雜訊底，硬切會很刺耳

export function createMusic(tracks, { onTrack } = {}) {
  let i = -1, on = false, el = null, ctx = null, gain = null, timer = 0;
  try { on = localStorage.getItem(KEY) === '1'; } catch { /* 無痕 */ }

  // ⚠️ WebAudio 的 GainNode 才做得出平順的淡入淡出（HTMLMediaElement.volume 在
  // Safari 上是階梯狀的）。但 AudioContext 也要等使用者動作才能建，所以延到播放時建。
  const wire = () => {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    ctx.createMediaElementSource(el).connect(gain);
  };
  const ramp = to => {
    if (!gain) return;
    const t = ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(to, t + FADE);
  };

  const next = () => {
    i = (i + 1) % tracks.length;
    const t = tracks[i];
    el.src = t.file;
    el.play().catch(() => { /* 還沒拿到使用者動作就先擱著 */ });
    onTrack?.(t);
    // 自己排下一首，⛔ 不用 loop 屬性：五首要輪流，而且要淡出再換
    clearTimeout(timer);
    if (t.seconds) {
      timer = setTimeout(() => { ramp(0); setTimeout(next, FADE * 1000); },
                         Math.max(1000, (t.seconds - FADE) * 1000));
    }
    ramp(0.55);
  };

  const start = () => {
    if (!el) {
      el = new Audio();
      el.preload = 'none';            // ⛔ 沒開配樂就別下載 7MB
      el.crossOrigin = 'anonymous';
      el.onended = next;              // seconds 對不上時的保險（⚠️ 不要只靠計時器）
      // ⚠️ 掛進 DOM：`new Audio()` 不在文件裡，瀏覽器的媒體控制與驗收腳本都看不到它
      //（第一版就是這樣，測試只能證明「按鈕變色」證明不了「有沒有在放」）。
      el.hidden = true;
      document.body.append(el);
    }
    wire();
    ctx.resume?.();
    next();
  };

  const stop = () => {
    clearTimeout(timer);
    ramp(0);
    setTimeout(() => el?.pause(), FADE * 1000);
  };

  return {
    get on() { return on; },
    /** 使用者按下去才會呼叫到這裡 ⇒ autoplay policy 過得了。 */
    toggle() {
      on = !on;
      try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* 無痕 */ }
      on ? start() : stop();
      return on;
    },
    /** 上次開著的話，**等使用者第一次動作**（點畫面或按鍵）就接著放。
     *  🔴 不能在載入時直接 play()：瀏覽器不准沒有使用者動作就出聲。
     *  ⚠️ 而且不能只靠開場的「入場」——回訪的人不會再看到開場，
     *  那樣按鈕顯示「開著」卻沒有聲音，玩家按下去反而變成關掉（實測到的狀況）。 */
    armResume() {
      if (!on) return;
      const go = () => { removeEventListener('pointerdown', go); removeEventListener('keydown', go); start(); };
      addEventListener('pointerdown', go);
      addEventListener('keydown', go);
    },
    get track() { return i < 0 ? null : tracks[i]; },
  };
}
