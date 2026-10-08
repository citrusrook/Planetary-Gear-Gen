"""Static dev server for the web app (serves the repo root; open /web/).

Also accepts `PUT /upload/<name>.stl` and saves the body to build/, so an STL exported
in the browser can be checked with trimesh (tests/test_stl_export.py).

    python tools/serve_web.py [port]
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
        m = re.fullmatch(r"/upload/([\w.\-]+\.stl)", self.path)
        if not m:
            self.send_error(404)
            return
        n = int(self.headers.get("Content-Length", 0))
        os.makedirs(OUT, exist_ok=True)
        path = os.path.join(OUT, m.group(1))
        with open(path, "wb") as f:
            f.write(self.rfile.read(n))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(path.encode())


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print("serving %s on http://localhost:%d/web/" % (ROOT, port))
    http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
