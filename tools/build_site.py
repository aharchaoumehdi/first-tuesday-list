"""Build the public data for one sale into website/site/.

Only FREE columns (see website/docs/free-paid-split.md) go into the public
JSON. Member fields (values, loan, balance, equity, beds, sq ft, year built,
lender names) never leave website/data/ until logins exist; the public stats
file carries only counts, as the split allows.

Usage:
  python build_site.py <sale-date> <data_tab.csv> <aerial_dir>
  e.g. python build_site.py 2026-11-03 ../data/source/sale-2026-11-03_issue-2026-10-14_v8_795.csv ../data/aerial/2026-11-03
"""
import csv
import json
import os
import statistics
import sys
from collections import Counter

from PIL import Image

from property_pages import notice_filename, write_pages

SITE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "site")
PHOTO_W = 800
NEW_SINCE_DAYS = 7
FREE_FIELDS = {"id", "addr", "city", "zip", "lat", "lon", "photo", "type", "notice", "first", "window", "location",
               "zone", "sfha", "notice_url", "repeat"}

TYPES = {"single_family": "Single family", "condo_townhome": "Condo / townhome", "multifamily": "Multifamily",
         "commercial": "Commercial", "vacant_land": "Vacant land"}


def num(v):
    v = (v or "").replace("$", "").replace(",", "").strip()
    try:
        return float(v)
    except ValueError:
        return None


def title(t):
    return " ".join(w if any(c.isdigit() for c in w) else w.capitalize() for w in t.split())


def write_backdrop(public):
    """site/assets/backdrop.svg: the Census TIGER county map (public domain) with every pin of the sale."""
    import math
    R = 6378137.0
    merc = lambda lon, lat: (math.radians(lon) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R)
    (x0, y0), (x1, y1) = merc(-95.98, 29.47), merc(-94.88, 30.19)  # the basemap's extent, 1000 x 755
    colors = {"single_family": "#1E5BD8", "condo_townhome": "#8A4FD1", "multifamily": "#F28C1B", "commercial": "#D2141C", "vacant_land": "#3E9B47"}
    pins = []
    for r in public:
        if r["lat"] is None:
            continue
        x, y = merc(r["lon"], r["lat"])
        pins.append(f'<circle cx="{(x - x0) / (x1 - x0) * 1000:.1f}" cy="{(y1 - y) / (y1 - y0) * 755:.1f}" r="2.6" fill="{colors.get(r["type"], "#8A97AA")}"/>')
    base = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "county_basemap.svg"), encoding="utf-8").read()
    svg = base.replace("</svg>", '<g stroke="#fff" stroke-width=".8">' + "".join(pins) + "</g></svg>")
    open(os.path.join(SITE, "assets", "backdrop.svg"), "w", encoding="utf-8").write(svg)


def main(sale, data_csv, aerial_dir):
    rows = list(csv.DictReader(open(data_csv, encoding="utf-8")))
    idx = {r["doc_id"]: r for r in csv.DictReader(open(os.path.join(aerial_dir, "index.csv"), encoding="utf-8"))}
    photo_out = os.path.join(SITE, "photos", sale)
    os.makedirs(photo_out, exist_ok=True)
    latest_first = max(r["first_seen"] for r in rows)
    from datetime import date, timedelta
    new_cut = (date.fromisoformat(latest_first) - timedelta(days=NEW_SINCE_DAYS - 1)).isoformat()

    public = []
    for r in rows:
        loc = idx.get(r["doc_id"], {})
        a = [p.strip() for p in r["property_address"].split(",")]
        photo = None
        if loc.get("photo"):
            src = os.path.join(aerial_dir, loc["photo"])
            dst = os.path.join(photo_out, loc["photo"])
            if not os.path.exists(dst) or os.path.getmtime(dst) < os.path.getmtime(src):
                im = Image.open(src).convert("RGB")
                im.thumbnail((PHOTO_W, PHOTO_W))
                im.save(dst, quality=80, optimize=True, progressive=True)
            photo = f"/photos/{sale}/{loc['photo']}"
        public.append({
            "id": r["doc_id"], "addr": title(a[0]), "city": title(a[1]) if len(a) > 1 else "", "zip": r["zip"],
            "lat": float(loc["lat"]) if loc.get("lat") else None, "lon": float(loc["lon"]) if loc.get("lon") else None,
            "photo": photo, "type": r["property_type"], "notice": r["notice_type"], "first": r["first_seen"],
            "window": r["sale_time_window"], "location": r["sale_location"], "zone": r["fema_flood_zone"],
            "sfha": r["in_special_flood_hazard_area"] == "yes", "notice_url": r["notice_pdf_url"],
            "repeat": r["repeat_posting"] == "yes",
        })

    mv = sorted(v for v in (num(r["market_value"]) for r in rows) if v)
    eq = [v for v in (num(r["est_equity"]) for r in rows) if v is not None]
    zips = Counter((r["zip"], title(r["property_address"].split(",")[1].strip()) if "," in r["property_address"] else "") for r in rows)
    stats = {
        "sale": sale, "updated": latest_first, "total": len(rows),
        "new_this_week": sum(1 for r in rows if r["first_seen"] >= new_cut), "new_since": new_cut,
        "sfha": sum(1 for r in rows if r["in_special_flood_hazard_area"] == "yes"),
        "hoa": sum(1 for r in rows if r["notice_type"] == "hoa"),
        "types": [[TYPES.get(k, "Other"), v] for k, v in Counter(r["property_type"] for r in rows).most_common()],
        "zips": [[z, c, n] for (z, c), n in zips.most_common(10)],
        "total_value_m": round(sum(mv) / 1e6), "median_value": round(statistics.median(mv)) if mv else None,
        # counts only: which properties these are is member data
        "equity_known": len(eq), "equity_100k_plus": sum(1 for v in eq if v >= 100000),
        "equity_buckets": [["< $0", sum(1 for v in eq if v < 0)], ["$0–50k", sum(1 for v in eq if 0 <= v < 50000)],
                           ["$50–100k", sum(1 for v in eq if 50000 <= v < 100000)], ["$100–200k", sum(1 for v in eq if 100000 <= v < 200000)],
                           ["$200k+", sum(1 for v in eq if v >= 200000)]],
    }
    os.makedirs(os.path.join(SITE, "data"), exist_ok=True)
    json.dump({"sale": sale, "rows": public}, open(os.path.join(SITE, "data", f"sale-{sale}.json"), "w", encoding="utf-8"), separators=(",", ":"))
    json.dump(stats, open(os.path.join(SITE, "data", f"stats-{sale}.json"), "w", encoding="utf-8"), separators=(",", ":"))
    json.dump({"current_sale": sale}, open(os.path.join(SITE, "data", "current.json"), "w", encoding="utf-8"))
    # every public field must be on the free list; anything else is member data
    leaked = set(public[0]) - FREE_FIELDS
    assert not leaked, f"member fields in public data: {leaked}"
    # what /notice/<id> may fetch, and the file name it saves under (functions/notice/[id].js)
    notices = {r["id"]: {"u": r["notice_url"], "f": notice_filename(r)} for r in public if r["notice_url"]}
    json.dump(notices, open(os.path.join(SITE, "data", "notices.json"), "w", encoding="utf-8"), separators=(",", ":"))
    write_backdrop(public)
    pages = write_pages(SITE, sale, public, stats)
    print(f"{pages} property pages in site/property/")
    print(f"{len(public)} properties, {sum(1 for p in public if p['photo'])} photos, new this week {stats['new_this_week']} (since {new_cut})")


if __name__ == "__main__":
    main(*sys.argv[1:4])
