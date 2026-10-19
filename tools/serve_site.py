"""Local preview of the public site (website/site) on http://localhost:8787/.

Builds /config.js from website/.env (GOOGLE_MAPS_KEY=...) so the key never sits
in a page file, and serves /map, /pricing ... like Cloudflare Pages does
(clean URLs without .html).
"""
import http.server
import json
import os
import socketserver
import urllib.parse
import urllib.request

WEBSITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.join(WEBSITE, "site")
PORT = int(os.environ.get("PORT", "8787"))


def maps_key():
    path = os.path.join(WEBSITE, ".env")
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            name, _, value = line.strip().partition("=")
            if name.strip() == "GOOGLE_MAPS_KEY":
                return value.strip().strip('"').strip("'")
    return ""


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/config.js":
            body = ("window.FTL_CONFIG = " + json.dumps({"mapsKey": maps_key()}) + ";\n").encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path.startswith("/notice/"):
            self.send_notice(path.rsplit("/", 1)[-1])
            return
        if "." not in os.path.basename(path) and path != "/" and os.path.exists(os.path.join(ROOT, path.strip("/") + ".html")):
            self.path = path + ".html"
        elif not os.path.exists(os.path.join(ROOT, path.lstrip("/"))) and path != "/":
            self.path = "/404.html"
        super().do_GET()


    def end_headers(self):
        # like Cloudflare Pages: always revalidate, so edits show on reload
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_notice(self, doc_id):
        """Local stand-in for functions/notice/[id].js: the county PDF, saved under the address."""
        notices = json.load(open(os.path.join(ROOT, "data", "notices.json"), encoding="utf-8"))
        n = notices.get(doc_id)
        if not n or urllib.parse.urlparse(n["u"]).hostname != "cclerk.hctx.net":
            self.send_error(404, "Notice not found")
            return
        req = urllib.request.Request(n["u"], headers={"User-Agent": "FirstTuesdayList/1.0 (+https://firsttuesdaylist.com)"})
        with urllib.request.urlopen(req, timeout=30) as res:
            body = res.read()
        ascii_name = n["f"].encode("ascii", "ignore").decode().replace('"', "")
        self.send_response(200)
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Content-Disposition", f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{urllib.parse.quote(n['f'])}")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


socketserver.ThreadingTCPServer.allow_reuse_address = True
socketserver.ThreadingTCPServer.daemon_threads = True
with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), Handler) as httpd:
    print(f"Site on http://localhost:{PORT}/ (maps key loaded: {'yes' if maps_key() else 'no'})", flush=True)
    httpd.serve_forever()
