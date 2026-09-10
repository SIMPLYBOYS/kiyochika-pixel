#!/usr/bin/env python3
"""開發用靜態伺服器。改完存檔、重整、就是新的——不必管快取。

🔴 為什麼不能只靠 header：**送 Cache-Control: no-store 是擋不住的**，實測兩次——

  1. 把 data/views.json 從硬碟移走，瀏覽器照樣 fetch 到 200 與完整內容
     （伺服器對缺檔確實回 404，curl 驗過）
  2. 改了 src/calendar.js 的起點月份，重整後畫面仍是舊值；
     連在網址加 ?bust=abc 都沒用——ES module 的 import 指定字是靜態的，
     模組自己沒辦法替自己加版本號

第 2 點特別惡劣：index.html 是新的、模組是舊的，**畫面看起來更新了但行為沒變**，
比完全沒更新更難察覺（實際踩過：縮放按鈕出現了但點下去沒反應）。

所以這支伺服器會**改寫送出去的內容**，替每個 import 與 <script src> 加上 ?v=<token>，
token 取 src/ 底下最新的 mtime——動過任何一個檔，整包的網址就全變，瀏覽器只能重抓。
資料檔（data/*.json）走的是另一條路：src/main.js 在 localhost 自己加 ?t=timestamp。

用法： python3 tools/serve.py [port]
"""
import errno
import re
import sys
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# from './x.js'  /  import('./x.js')  ——只動相對路徑，不碰 CDN 之類的絕對網址
IMPORT_RE = re.compile(r"""((?:\bfrom|\bimport)\s*\(?\s*)(['"])(\.[^'"]+?\.js)\2""")
SCRIPT_RE = re.compile(r"""(<script[^>]*\bsrc=["'])([^"']+?\.js)(["'])""")


def token():
    """src/ 底下最新的 mtime。改了任何一個檔，token 就變，整包重抓。"""
    return str(max((p.stat().st_mtime_ns for p in (ROOT / "src").rglob("*.js")), default=0))


class Dev(SimpleHTTPRequestHandler):
    def end_headers(self):
        # 留著當第二層。真正靠得住的是上面的網址改寫，不是這幾行。
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_GET(self):
        path = Path(self.translate_path(self.path))     # translate_path 會去掉 query
        if path.suffix in (".js", ".html") and path.is_file():
            v = token()
            text = path.read_text(encoding="utf-8")
            if path.suffix == ".js":
                text = IMPORT_RE.sub(lambda m: f"{m[1]}{m[2]}{m[3]}?v={v}{m[2]}", text)
            else:
                text = SCRIPT_RE.sub(lambda m: f"{m[1]}{m[2]}?v={v}{m[3]}", text)
            body = text.encode("utf-8")
            ctype = "text/javascript" if path.suffix == ".js" else "text/html"
            self.send_response(200)
            self.send_header("Content-Type", f"{ctype}; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


if __name__ == "__main__":
    # self-check：改寫規則錯了會讓整個站台載不起來，先驗再開
    assert IMPORT_RE.sub(lambda m: f"{m[1]}{m[2]}{m[3]}?v=9{m[2]}",
                         "import { a } from './b.js';") == "import { a } from './b.js?v=9';"
    assert SCRIPT_RE.sub(lambda m: f"{m[1]}{m[2]}?v=9{m[3]}",
                         '<script type="module" src="src/main.js"></script>') \
        == '<script type="module" src="src/main.js?v=9"></script>'
    # 絕對網址不該被動到
    assert IMPORT_RE.sub("X", "import x from 'https://cdn/y.js'") == "import x from 'https://cdn/y.js'"

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    try:
        server = HTTPServer(("", port), partial(Dev, directory=str(ROOT)))
    except OSError as e:
        if e.errno != errno.EADDRINUSE:
            raise
        # traceback 的最後一行是 socket.bind，看不出「是誰佔著」。
        # 這台通常已經在另一個視窗開著，或是被別的工具開起來忘了關。
        sys.exit(f"port {port} 已經有人在用了。\n"
                 f"  誰佔著： lsof -nP -iTCP:{port} -sTCP:LISTEN\n"
                 f"  換一個： python3 tools/serve.py {port + 1}")
    print(f"http://localhost:{port}  （import 會自動帶版本號，改完重整就好）")
    server.serve_forever()
