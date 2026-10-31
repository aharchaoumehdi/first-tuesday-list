"""After the daily refresh: ask the site to send today's ZIP alerts and shortlist status emails (POST /api/alerts/send).

The site works out what is new since its last run and who watches it (functions/api/alerts/send.js). This only sends
the current sale's public rows, the same free fields as site/data/sale-<date>.json.

Usage (GitHub Actions only, with `permissions: id-token: write`):
  python tools/send_alerts.py [--dry]
"""
import json
import os
import sys
import urllib.error
import urllib.request

from member_data import github_token

SITE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "site")
SITE_URL = os.environ.get("ALERTS_URL", "https://firsttuesdaylist.com").rstrip("/")
FIELDS = ("id", "addr", "city", "zip", "type", "notice", "window", "zone", "sfha")


def main(dry=False):
    cur = json.load(open(os.path.join(SITE, "data", "current.json"), encoding="utf-8"))
    sale = cur["current_sale"]
    rows = json.load(open(os.path.join(SITE, "data", f"sale-{sale}.json"), encoding="utf-8"))["rows"]
    body = {"sale": sale, "label": cur.get("label_year") or cur.get("label") or sale, "dry": dry,
            "rows": [{k: r.get(k) for k in FIELDS} for r in rows]}
    req = urllib.request.Request(SITE_URL + "/api/alerts/send", data=json.dumps(body).encode(), method="POST",
                                 headers={"Authorization": "Bearer " + github_token(), "Content-Type": "application/json", "User-Agent": "ftl-refresh"})
    try:
        res = json.load(urllib.request.urlopen(req, timeout=120))
    except urllib.error.HTTPError as err:
        sys.exit(f"alerts: {err.code} {err.read()[:300].decode('utf-8', 'replace')}")
    print(f"alerts for the {sale} sale: {res.get('fresh')} new notices, {res.get('emails')} emails, sent {res.get('sent')}, failed {res.get('failed')}"
          + (" (first run: list recorded, nothing sent)" if res.get("first_run") else "") + (" (dry run)" if res.get("dry") else ""))
    if res.get("failed"):
        sys.exit(f"alerts: {res.get('errors')}")


if __name__ == "__main__":
    main("--dry" in sys.argv[1:])
