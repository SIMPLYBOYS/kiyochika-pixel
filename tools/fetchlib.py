"""館藏站共用的取用層。

抽出來的唯一理由：外部館藏站都會限速，429 一定要退讓重試（實測 Commons 併發
會被關進冷卻期）。這段邏輯只要有一份沒照 Retry-After，那支腳本就會半路斷掉。
"""
import json, struct, time, urllib.error, urllib.request


def fetch(url, ua, timeout=60, retry_on=(429,), headers=None):
    """retry_on 要可指定：不是每家都用 429 表示節流。
    實測 AIC（artic.edu）用 **403** 節流——同一個 URL 隔一秒重試就會過，
    而一般情況下 403 是不該重試的，所以只在明知如此的來源放行。"""
    h = {"User-Agent": ua, **(headers or {})}
    for attempt in range(6):
        try:
            return urllib.request.urlopen(
                urllib.request.Request(url, headers=h), timeout=timeout)
        except urllib.error.HTTPError as e:
            if e.code not in retry_on or attempt == 5:
                raise
            wait = int(e.headers.get("Retry-After") or 0) or 5 * 2 ** attempt
            print(f"    429，等 {wait}s…", flush=True)
            time.sleep(wait)
    raise RuntimeError("unreachable")


def get_json(url, ua, timeout=60):
    return json.load(fetch(url, ua, timeout))


def jpeg_size(p):
    """讀 JPEG 的 SOF 標記取尺寸。不是 HTTP 的事，但三支腳本都要比大小，
    複製到第三份就該收起來了；只為了比尺寸不值得裝 Pillow。"""
    if not p.exists():
        return 0, 0
    d, i = p.read_bytes(), 2
    while i < len(d) - 9:
        if d[i] != 0xFF:
            i += 1
            continue
        if d[i + 1] in range(0xC0, 0xD0) and d[i + 1] not in (0xC4, 0xC8, 0xCC):
            h, w = struct.unpack(">HH", d[i + 5:i + 9])
            return w, h
        i += 2 + struct.unpack(">H", d[i + 2:i + 4])[0]
    return 0, 0
