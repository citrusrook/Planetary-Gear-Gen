#!/usr/bin/env python3
"""Static dev server for the web app (serves the repo root; open /web/).

Also accepts `PUT /upload/<name>.stl` (saved to build/) and `PUT /upload/<case>/<name>.stl|json`
(saved to build/v3/<case>/), so STLs exported in the browser can be checked with trimesh
(tests/test_stl_export.py, tests/test_stl_v3.py).

    python3 tools/serve_web.py [port] [--host 0.0.0.0]

--host 0.0.0.0 makes it reachable from other machines (e.g. a headless Debian box);
the upload endpoint then accepts files from the whole network, so only do that on a trusted LAN.
"""
import http.server
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "build")


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript"}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_PUT(self):
        # /upload/<name>.stl or /upload/<case>/<name>.(stl|json) - names are plain words only
        m = re.fullmatch(r"/upload/(?:([\w\-]+)/)?([\w.\-]+\.(?:stl|json))", self.path)
        if not m or ".." in self.path:
            self.send_error(404)
            return
        n = int(self.headers.get("Content-Length", 0))
        folder = os.path.join(OUT, "v3", m.group(1)) if m.group(1) else OUT
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, m.group(2))
        with open(path, "wb") as f:
            f.write(self.rfile.read(n))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(path.encode())


if __name__ == "__main__":
    args = sys.argv[1:]
    host = "127.0.0.1"
    if "--host" in args:
        i = args.index("--host")
        host = args[i + 1]
        del args[i:i + 2]
    port = int(args[0]) if args else 8765
    srv = http.server.ThreadingHTTPServer((host, port), Handler)
    shown = "localhost" if host in ("127.0.0.1", "0.0.0.0", "::") else host
    print("serving %s on http://%s:%d/web/  (Ctrl-C to stop)" % (ROOT, shown, port))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
