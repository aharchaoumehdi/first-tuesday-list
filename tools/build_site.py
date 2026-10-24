"""Build the public data for one sale into website/site/.

Only FREE columns (see website/docs/free-paid-split.md) go into the public
JSON. Member fields (values, loan, balance, equity, beds, sq ft, year built,
lender names) never leave website/data/ until logins exist; the public stats
file carries only counts, as the split allows.

The sale date, countdown, filing deadline and calendar on the home and map
pages come from the data too: the elements marked data-sale="..." and
data-s="..." in site/index.html and site/map.html, their titles and
descriptions, and site/data/current.json (read by site.js on every page).

Usage:
  python build_site.py <sale-date> <data_tab.csv> <aerial_dir>
  e.g. python build_site.py 2026-11-03 ../data/source/sale-2026-11-03_issue-2026-10-14_v8_795.csv ../data/aerial/2026-11-03
"""
import csv
import html
import json
import os
import re
import statistics
import sys
from collections import Counter
from datetime import date, datetime, timedelta, timezone

from PIL import Image

from property_pages import nice, notice_filename, write_pages

SITE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "site")
PHOTO_W = 800
NEW_SINCE_DAYS = 7
FREE_FIELDS = {"id", "addr", "city", "zip", "lat", "lon", "photo", "type", "notice", "first", "window", "location",
               "zone", "sfha", "notice_url", "repeat"}

TYPES = {"single_family": "Single family", "condo_townhome": "Condo / townhome", "multifamily": "Multifamily",
         "commercial": "Commercial", "vacant_land": "Vacant land"}

# the home and map pages' titles and descriptions
HEADS = {
    "index.html": {"title": "Harris County Foreclosure Auction List · {date} · First Tuesday List",
                   "description": "Every Harris County foreclosure going to auction on {day}: {total} properties on one map with photos, flood zones and sale details. Free list every Wednesday.",
                   "og:description": "{total} properties for the {date} sale on one map, with photos and flood zones. Free list every Wednesday."},
    "map.html": {"title": "Map of Harris County Foreclosure Auctions · {date} · First Tuesday List",
                 "description": "Map of all {total} Harris County properties going to foreclosure auction on {date}, with aerial photos, flood zones, Street View and sale details."},
}
PAST_TOTALS = {"2026-10-06": 919}  # sales from before the site kept a stats file


def num(v):
    v = (v or "").replace("$", "").replace(",", "").strip()
    try:
        return float(v)
    except ValueError:
        return None


def title(t):
    return " ".join(w if any(c.isdigit() for c in w) else w.capitalize() for w in t.split())


def central_offset(d):
    """UTC offset in hours of Houston on day d: -5 in daylight saving time, else -6."""
    mar = date(d.year, 3, 8 + (6 - date(d.year, 3, 8).weekday()) % 7)
    nov = date(d.year, 11, 1 + (6 - date(d.year, 11, 1).weekday()) % 7)
    return -5 if mar <= d < nov else -6


def central_today():
    now = datetime.now(timezone.utc)
    return (now + timedelta(hours=central_offset((now - timedelta(hours=6)).date()))).date()


def sale_day(year, month):
    """First Tuesday of the month; the Wednesday when that is Jan 1 or Jul 4 (Tex. Prop. Code 51.002)."""
    d = date(year, month, 1 + (1 - date(year, month, 1).weekday()) % 7)
    return d + timedelta(days=1) if (d.month, d.day) in ((1, 1), (7, 4)) else d


def next_sale(d, step=1):
    y, m = divmod(d.year * 12 + d.month - 1 + step, 12)
    return sale_day(y, m + 1)


def sale_info(sale, rows):
    """Dates, place and phase of the sale, for current.json and the page stamps."""
    d = date.fromisoformat(sale)
    window = Counter(r["sale_time_window"] for r in rows if r["sale_time_window"]).most_common(1)
    window = window[0][0] if window else "10:00 AM - 1:00 PM"
    m = re.match(r"(\d+):(\d+)\s*([AP]M)", window, re.I)
    hh, mm = (int(m.group(1)) % 12 + (12 if m.group(3).upper() == "PM" else 0), m.group(2)) if m else (10, "00")
    place = Counter(r["sale_location"] for r in rows if r["sale_location"]).most_common(1)
    parts = [p.strip() for p in (place[0][0] if place else "Bayou City Event Center, 9401 Knight Rd, Houston, TX 77045").split(",")]
    street = next((i for i, p in enumerate(parts) if p[:1].isdigit()), len(parts))
    deadline = d - timedelta(days=21)  # notices must be filed at least 21 days before the sale
    today = central_today()
    phase = "Filings open" if today <= deadline else "List complete" if today < d else "Sale today" if today == d else "Sale over"
    return {
        "current_sale": sale, "label": nice(sale), "label_day": nice(sale, weekday=True), "label_year": nice(sale, year=True),
        "full": d.strftime("%A, %B ") + str(d.day) + d.strftime(", %Y"),
        "starts": f"{sale}T{hh:02d}:{mm}:00{central_offset(d):+03d}:00",
        "deadline": deadline.isoformat(), "deadline_label": nice(deadline.isoformat()), "next_label": nice(next_sale(d).isoformat()),
        "window": " – ".join(p.strip().replace(":00", "") for p in window.split("-")),
        "place": ", ".join(parts[:street]), "street": ", ".join(parts[street:]), "phase": phase,
    }


def calendar(info, stats):
    """The sale calendar cards on the home page: last sale, this one, the next three."""
    d = date.fromisoformat(info["current_sale"])
    prev = next_sale(d, -1).isoformat()
    path = os.path.join(SITE, "data", f"stats-{prev}.json")
    prev_total = json.load(open(path, encoding="utf-8"))["total"] if os.path.exists(path) else PAST_TOTALS.get(prev)

    def card(label, day, note, now=False):
        return (f'<div class="card{" now" if now else ""}"><div style="font-size:12px;font-weight:700;text-transform:uppercase;'
                f'{"opacity:.8" if now else "color:var(--muted)"}">{label}</div><div class="disp" style="font-size:30px;font-weight:800">{nice(day)}</div>'
                f'<div style="font-size:14px">{note}</div></div>')
    open_now = info["phase"] == "Filings open"
    cards = [card("Past", prev, f"{prev_total} notices" if prev_total else "&nbsp;"),
             card("Next sale", info["current_sale"], f"{stats['total']} notices · " + (f"filings open until {info['deadline_label']}" if open_now else "list complete"), True)]
    for i in (1, 2, 3):
        n = next_sale(d, i)
        due = nice((n - timedelta(days=21)).isoformat())
        cards.append(card("Filings open" if i == 1 and not open_now else str(n.year), n.isoformat(), f"notices due by {due}" if i == 1 else f"notices due {due}"))
    return "\n" + "\n".join(cards) + "\n"


def stamp_pages(info, stats):
    """Write this sale's dates and counts into the home and map pages, so they read right before any script runs."""
    e = lambda t: html.escape(str(t), quote=True)
    vals = {"date": info["label_year"], "day": info["full"].split(",")[0] + ", " + info["label_year"], "total": stats["total"]}
    texts = {"date_full": info["full"], "date_year": info["label_year"], "date_short": info["label"],
             "when": f"{info['label_day']} · most sales {info['window']}", "place": info["place"], "street": info["street"], "phase": info["phase"]}
    for page, heads in HEADS.items():
        path = os.path.join(SITE, page)
        s = open(path, encoding="utf-8").read()
        for k, tpl in heads.items():
            t = e(tpl.format(**vals))
            if k == "title":
                s = re.sub(r"<title>.*?</title>", lambda m: f"<title>{t}</title>", s, count=1)
            else:
                attr = "property" if ":" in k else "name"
                s = re.sub(rf'(<meta {attr}="{re.escape(k)}" content=")[^"]*(")', lambda m: m.group(1) + t + m.group(2), s, count=1)
        for attr, table in (("data-sale", texts), ("data-s", stats)):
            def fill(m, table=table):
                key = m.group(3)
                return m.group(1) + e(table[key]) + m.group(4) if key in table and not isinstance(table[key], (list, dict)) else m.group(0)
            s = re.sub(rf'(<(\w+)\b[^>]*\b{attr}="(\w+)"[^>]*>)[^<]*(</\2>)', fill, s)
        s = re.sub(r"(<!--sale:calendar-->).*?(<!--/sale:calendar-->)", lambda m: m.group(1) + calendar(info, stats) + m.group(2), s, flags=re.S)
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(s)


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
    other = [r["doc_id"] for r in rows if r["sale_date"] != sale]
    if other:
        print(f"skipping {len(other)} rows for another sale date: {', '.join(other[:5])}")
        rows = [r for r in rows if r["sale_date"] == sale]
    assert rows, f"no rows for the {sale} sale"
    idx = {r["doc_id"]: r for r in csv.DictReader(open(os.path.join(aerial_dir, "index.csv"), encoding="utf-8"))}
    photo_out = os.path.join(SITE, "photos", sale)
    os.makedirs(photo_out, exist_ok=True)
    latest_first = max(r["first_seen"] for r in rows)
    new_cut = (date.fromisoformat(latest_first) - timedelta(days=NEW_SINCE_DAYS - 1)).isoformat()

    public = []
    for r in rows:
        loc = idx.get(r["doc_id"], {})
        a = [p.strip() for p in r["property_address"].split(",")]
        photo = None
        if loc.get("photo"):
            src = os.path.join(aerial_dir, loc["photo"])
            dst = os.path.join(photo_out, loc["photo"])
            # a photo already on the site has no original in a fresh checkout: keep its web copy
            if os.path.exists(src) and (not os.path.exists(dst) or os.path.getmtime(dst) < os.path.getmtime(src)):
                im = Image.open(src).convert("RGB")
                im.thumbnail((PHOTO_W, PHOTO_W))
                im.save(dst, quality=80, optimize=True, progressive=True)
            if os.path.exists(dst):
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
    info = sale_info(sale, rows)
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
        "starts": info["starts"], "deadline": info["deadline"],
    }
    os.makedirs(os.path.join(SITE, "data"), exist_ok=True)
    json.dump({"sale": sale, "rows": public}, open(os.path.join(SITE, "data", f"sale-{sale}.json"), "w", encoding="utf-8"), separators=(",", ":"))
    json.dump(stats, open(os.path.join(SITE, "data", f"stats-{sale}.json"), "w", encoding="utf-8"), separators=(",", ":"))
    current = {k: info[k] for k in ("current_sale", "label", "label_day", "label_year", "starts", "deadline", "deadline_label", "next_label")}
    json.dump(current | {"total": len(rows), "updated": latest_first}, open(os.path.join(SITE, "data", "current.json"), "w", encoding="utf-8"), separators=(",", ":"))
    # every public field must be on the free list; anything else is member data
    leaked = set().union(*public) - FREE_FIELDS
    assert not leaked, f"member fields in public data: {leaked}"
    # what /notice/<id> may fetch, and the file name it saves under (functions/notice/[id].js)
    notices = {r["id"]: {"u": r["notice_url"], "f": notice_filename(r)} for r in public if r["notice_url"]}
    json.dump(notices, open(os.path.join(SITE, "data", "notices.json"), "w", encoding="utf-8"), separators=(",", ":"))
    write_backdrop(public)
    stamp_pages(info, stats)
    pages = write_pages(SITE, sale, public, stats)
    print(f"{pages} property pages in site/property/")
    print(f"{len(public)} properties, {sum(1 for p in public if p['photo'])} photos, new this week {stats['new_this_week']} (since {new_cut})")


if __name__ == "__main__":
    main(*sys.argv[1:4])
