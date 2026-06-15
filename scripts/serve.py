#!/usr/bin/env python3
"""Dev static server with correct ES-module MIME + aggressive no-cache headers.

The no-build/ES-module discipline (HANDOVER §intro) means the browser fetches every module
directly. `python3 -m http.server` sends Last-Modified and the browser will happily 304 a stale
module — the #1 cause of "I edited it but nothing changed" in dev. This wrapper sends
`Cache-Control: no-store` on everything so the module graph is always fresh during development.
Production uses the layered cache-busting toolkit (scripts/bust.sh) instead.

Usage: python3 scripts/serve.py [port]   (default 8173)
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8173


class NoCacheHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
        ".webmanifest": "application/manifest+json",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # quiet


if __name__ == "__main__":
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), NoCacheHandler)
    print(f"PazoruKore dev server → http://127.0.0.1:{PORT}/  (no-store; Ctrl-C to stop)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped.")
