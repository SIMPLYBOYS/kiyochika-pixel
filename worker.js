// Cloudflare 的靜態資源前面唯一的一段程式：**補上 byte-range**。
//
// 🔴 為什麼需要它：Workers 的靜態資源對 `Range:` 請求一律回 200 與整個檔案，
// 既沒有 206 也沒有 Accept-Ranges（2026-09-24 實測，音檔與影片都一樣；
// 同一個檔案放在 GitHub Pages 會正常回 206）。
// 而 **Safari 播 <audio>／<video> 是靠 byte-range 的**：拿不到 206 就可能整個不播，
// 症狀就是玩家回報的「手機上音樂出不來」——桌機 Chrome 看不出問題，因為它不挑。
//
// ⚠️ 這段只做一件事，⛔ 不要在這裡加路由、改寫網址或塞任何邏輯：
// 網站其餘部分仍然是純靜態檔案，快取規則照 _headers 走。
// ⚠️ 切片是把整個檔案讀進記憶體再切 ⇒ 只對 assets/ 底下這種幾 MB 的媒體檔用，
// 最大的是 assets/audio/03.m4a（2.6MB）與 assets/plate/*.jpg（約 1MB）。

const RANGE = /^bytes=(\d*)-(\d*)$/;

export default {
  async fetch(request, env) {
    const res = await env.ASSETS.fetch(request);
    const type = res.headers.get('content-type') || '';
    const media = type.startsWith('audio/') || type.startsWith('video/');
    const range = request.headers.get('Range');

    // 媒體檔即使沒帶 Range 也要說自己支援，Safari 會先看這個再決定怎麼要資料
    if (media && !range && res.status === 200) {
      const headers = new Headers(res.headers);
      headers.set('Accept-Ranges', 'bytes');
      return new Response(res.body, { status: 200, headers });
    }
    if (!range || res.status !== 200) return res;

    const m = RANGE.exec(range.trim());
    if (!m) return res;                       // 多段 range（bytes=0-1,5-6）不處理，整包回去就好
    const buf = await res.arrayBuffer();
    const size = buf.byteLength;
    let start, end;
    if (m[1] === '') {                        // bytes=-N ＝ 最後 N 個 byte
      const n = Number(m[2] || 0);
      start = Math.max(0, size - n); end = size - 1;
    } else {
      start = Number(m[1]);
      end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    }
    const headers = new Headers(res.headers);
    headers.set('Accept-Ranges', 'bytes');
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
      headers.set('Content-Range', `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    headers.set('Content-Length', String(end - start + 1));
    return new Response(buf.slice(start, end + 1), { status: 206, headers });
  },
};
