"""Local dev server with CORS proxy for the Reputation Rocket prototype.

Serves static files AND proxies /api/* requests to Fly.io with proper CORS.
Usage: python serve.py
"""
import http.server
import json
import urllib.request
import urllib.error
from functools import partial

API_BASE = "https://factor8-agent-sdk.fly.dev"
PORT = 8888


class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self.send_response(200)
        self._cors_headers()
        self.end_headers()

    def do_POST(self):
        if self.path.startswith("/api/"):
            self._proxy_request()
        else:
            self.send_error(404)

    def _proxy_request(self):
        """Forward request to Fly.io API."""
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b""

        url = API_BASE + self.path
        req = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "X-API-Key": self.headers.get("X-API-Key", ""),
            },
        )

        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                data = resp.read()
                self.send_response(resp.status)
                self._cors_headers()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self._cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(e.read())
        except Exception as e:
            self.send_response(502)
            self._cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-API-Key")

    def log_message(self, format, *args):
        first = str(args[0]) if args else ""
        if "/api/" in first:
            print(f"[PROXY] {first}")
        elif "favicon" not in first:
            super().log_message(format, *args)


if __name__ == "__main__":
    handler = partial(ProxyHandler, directory=".")
    with http.server.HTTPServer(("", PORT), handler) as server:
        print(f"Reputation Rocket prototype: http://localhost:{PORT}/index.html")
        print(f"API proxy: http://localhost:{PORT}/api/* -> {API_BASE}/api/*")
        print("Press Ctrl+C to stop.")
        server.serve_forever()
