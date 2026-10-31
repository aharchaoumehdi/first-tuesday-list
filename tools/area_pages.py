"""Area pages for search engines: one static page per ZIP code and per city in the current sale, plus an index.

  /zip/<zip>     e.g. /zip/77449   "Katy (77449) foreclosure auctions: Nov 3, 2026"
  /city/<slug>   e.g. /city/katy   "Katy, TX foreclosure auctions: Nov 3, 2026"
  /areas         every city and ZIP code with a count

Each page has a data-driven intro (counts, types, flood zones, notice types, filing dates, sale windows), a map of
its pins, the properties as cards linking to /property/<id>, nearby areas, a sign-up block (source "area:<zip>" or
"area:<slug>") and the membership line. SEO: unique title and description, canonical, Open Graph, schema.org
BreadcrumbList + ItemList.

Only FREE fields are used (the public site/data/*.json files): no value, loan, balance, equity, lender or owner.
Area-level public data: HUD Small Area Fair Market Rents by ZIP (tools/assets/hud_safmr_fy2027_houston.csv).

URLs never carry the sale date, so a page keeps its address (and its search ranking) from sale to sale. A ZIP or city
that was on an earlier list and has no notice this month keeps its page, as a "none this month" page (noindex) that
still collects sign-ups; data/areas-seen.json remembers every area ever listed.

Also written:
  index.html        the home page's "Busiest ZIP codes" list, as plain links (between <!--areas:zips--> markers)
  sitemap.xml       the site's existing URLs plus every indexable area page
  data/zips-<sale>.json   the small ZIP index for the "Watch my area" alert widget (assets/zipalerts.js)
  data/hud-rent.json      HUD rents by ZIP for the map's rent lens and the home page's Rent by ZIP

tools/build_site.py calls write_area_pages(SITE, SITE) after write_sitemap(); property_pages.py writes the
property pages' own links to these pages. Standalone: python area_pages.py [--site <site dir>] [--today 2026-10-31]
"""
import argparse
import csv
import html
import json
import math
import os
import re
import shutil
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
SITE_DEFAULT = os.path.join(os.path.dirname(HERE), "site")
HUD_CSV = os.path.join(HERE, "assets", "hud_safmr_fy2027_houston.csv")
HUD_URL = "https://www.huduser.gov/portal/datasets/fmr/smallarea/index.html"
SITE_URL = "https://firsttuesdaylist.com"
CARD_LIMIT = 60          # above this many properties a page lists compact rows grouped by ZIP instead of photo cards

TYPES = {"single_family": "Single family", "condo_townhome": "Condo / townhome", "multifamily": "Multifamily",
         "commercial": "Commercial", "vacant_land": "Vacant land"}
COLORS = {"single_family": "#1E5BD8", "condo_townhome": "#8A4FD1", "multifamily": "#F28C1B", "commercial": "#D2141C",
          "vacant_land": "#3E9B47"}
NOUN = {"single_family": ("single-family home", "single-family homes"), "condo_townhome": ("condo or townhome", "condos or townhomes"),
        "multifamily": ("multifamily property", "multifamily properties"), "commercial": ("commercial property", "commercial properties"),
        "vacant_land": ("vacant lot", "vacant lots"), "other": ("other property", "other properties")}
WORDS = "zero one two three four five six seven eight nine ten".split()

e = html.escape


# ---------- small helpers ----------

def nice(d, weekday=False, year=False):
    d = date.fromisoformat(d) if isinstance(d, str) else d
    s = d.strftime("%a, %b ") + str(d.day) if weekday else d.strftime("%b ") + str(d.day)
    return s + (d.strftime(", %Y") if year else "")


def long_day(d):
    d = date.fromisoformat(d)
    return d.strftime("%A, %B ") + str(d.day) + d.strftime(", %Y")


def slug(city):
    return re.sub(r"[^a-z0-9]+", "-", city.lower()).strip("-") or "unknown"


def kind(t):
    return TYPES.get(t, "Other")


def tkey(t):
    return t if t in NOUN else "other"


def pl(n, one, many):
    return one if n == 1 else many


def num(n, cap=False):
    """Small counts as words ("three"), larger as digits."""
    s = WORDS[n] if 0 <= n <= 10 else f"{n:,}"
    return s[:1].upper() + s[1:] if cap else s


def an(noun):
    return ("an " if noun[0] in "aeiou" else "a ") + noun


def ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def pct(a, b):
    return round(100 * a / b) if b else 0


def join(parts):
    parts = [p for p in parts if p]
    return parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1] if parts else ""


def short_window(w):
    """'10:00 AM - 1:00 PM' -> '10 AM – 1 PM'"""
    if not w:
        return "time not stated"
    return " – ".join(p.strip().replace(":00", "") for p in w.split("-"))


def miles(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 3958.8 * 2 * math.asin(math.sqrt(h))


def centroid(rows):
    pts = [(r["lat"], r["lon"]) for r in rows if r["lat"] is not None]
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)) if pts else None


def central_today():
    now = datetime.now(timezone.utc) - timedelta(hours=6)
    return now.date()


def jdump(o):
    # safe inside <script>: no "</" can close the tag early
    return json.dumps(o, separators=(",", ":"), ensure_ascii=False).replace("</", "<\\/")


# ---------- data ----------

def load(site):
    cur = json.load(open(os.path.join(site, "data", "current.json"), encoding="utf-8"))
    sale = cur["current_sale"]
    rows = json.load(open(os.path.join(site, "data", f"sale-{sale}.json"), encoding="utf-8"))["rows"]
    stats = json.load(open(os.path.join(site, "data", f"stats-{sale}.json"), encoding="utf-8"))
    return cur, rows, stats


def load_hud():
    out = {}
    if os.path.exists(HUD_CSV):
        for r in csv.DictReader(open(HUD_CSV, encoding="utf-8")):
            out[r["zip"]] = {k: int(v) for k, v in r.items() if k != "zip" and v}
    return out


class Area:
    """A ZIP code or a city, with its rows for the current sale."""

    def __init__(self, kind_, key, name, rows):
        self.kind, self.key, self.name, self.rows = kind_, key, name, sorted(rows, key=lambda r: (r["zip"], r["addr"]))
        self.n = len(rows)
        self.center = centroid(rows)

    @property
    def path(self):
        return f"/zip/{self.key}" if self.kind == "zip" else f"/city/{self.key}"

    @property
    def label(self):
        return f"{self.name} ({self.key})" if self.kind == "zip" else self.name


# ---------- the intro paragraph: written from the data, so no two pages read alike ----------

def type_sentence(rows, n):
    c = Counter(tkey(r["type"]) for r in rows)
    if len(c) == 1:
        k = next(iter(c))
        return f"All {num(n)} are {NOUN[k][1]}." if n > 2 else f"Both are {NOUN[k][1]}."
    parts = [f"one is {an(NOUN[k][0])}" if v == 1 else f"{num(v)} are {NOUN[k][1]}" for k, v in c.most_common()]
    s = join(parts)
    return s[:1].upper() + s[1:] + "."


def notice_sentence(rows, n, county_hoa_share):
    h = sum(1 for r in rows if r["notice"] == "hoa")
    hud = sum(1 for r in rows if r["notice"] == "hud")
    if h == 0:
        s = f"Every one is a mortgage foreclosure under a deed of trust" if n > 2 else "Both are mortgage foreclosures under a deed of trust"
        return s + (f", {num(hud)} of them on a HUD-insured loan." if hud else ".")
    if h == n:
        return (f"All {num(n)} are HOA lien sales: a homeowners association foreclosing for unpaid assessments, not a mortgage lender."
                if n > 1 else "")
    share = pct(h, n)
    tail = f", well above the {county_hoa_share}% share countywide" if share >= 2 * county_hoa_share and n >= 5 else ""
    return (f"{num(h, True)} {pl(h, 'is an HOA lien sale', 'are HOA lien sales')} (a homeowners association foreclosing for unpaid "
            f"assessments){tail}; the other {num(n - h)} {pl(n - h, 'is a mortgage foreclosure', 'are mortgage foreclosures')}.")


def flood_sentence(rows, n, county_sfha_share):
    s = [r for r in rows if r["sfha"]]
    zones = Counter(r["zone"] for r in s if r["zone"])
    x = sum(1 for r in rows if r["zone"] == "X")
    if not s:
        tail = f"; all {num(n)} are mapped in zone X" if x == n and n > 2 else "; both are mapped in zone X" if x == n == 2 else ""
        return f"None is in a FEMA high-risk flood zone{tail} (countywide, {county_sfha_share}% of this month's properties are)."
    zl = ("zone " if len(zones) == 1 else "zones ") + join([z for z, _ in zones.most_common()])
    if len(s) == n:
        return f"Every one sits in a FEMA special flood hazard area ({zl}), where federally backed loans require flood insurance."
    share = pct(len(s), n)
    cmp = "above" if share > county_sfha_share else "below" if share < county_sfha_share else "in line with"
    return (f"{num(len(s), True)} ({share}%) {pl(len(s), 'sits', 'sit')} in a FEMA special flood hazard area ({zl}), "
            f"{cmp} the {county_sfha_share}% share countywide.")


def filing_sentence(rows, n, stats, phase):
    firsts = sorted(r["first"] for r in rows)
    new = sum(1 for r in rows if r["first"] >= stats["new_since"])
    rep = sum(1 for r in rows if r.get("repeat"))
    if firsts[0] == firsts[-1]:
        s = f"All {num(n)} notices were filed on {nice(firsts[0])}" if n > 2 else f"Both notices were filed on {nice(firsts[0])}"
    else:
        s = f"The notices were filed between {nice(firsts[0])} and {nice(firsts[-1])}"
        if 0 < new < n:
            when = "in the past week" if phase == "open" else f"in the last week before the filing deadline (since {nice(stats['new_since'])})"
            s += f", {num(new)} of them {when}"
        elif new == n:
            s += ", all of them in the final week of filings"
    s += "."
    if rep:
        s += f" {num(rep, True)} {pl(rep, 'was', 'were')} posted more than once for this sale."
    return s


def window_sentence(rows, n):
    w = Counter(short_window(r["window"]) for r in rows)
    top, k = w.most_common(1)[0]
    if len(w) == 1:
        return f"All are scheduled to sell in the {top} window." if n > 2 else f"Both are scheduled to sell in the {top} window."
    more = sum(v for _, v in w.most_common()[4:])
    rest = join([f"{num(v)} at {t}" for t, v in w.most_common()[1:4]] + ([f"{num(more)} at other times"] if more else []))
    return f"{num(k, True)} {pl(k, 'is', 'are')} set to sell in the {top} window; {rest}."


def intro(area, ctx):
    rows, n, stats, cur = area.rows, area.n, ctx["stats"], ctx["cur"]
    total, day, place = stats["total"], long_day(cur["current_sale"]), ctx["place_short"]
    county_sfha, county_hoa = pct(stats["sfha"], total), pct(stats["hoa"], total)
    if n == 0:
        return (f"No foreclosure notice in {area.label} is on the list for the {cur['label_year']} Harris County auction"
                f"{' yet' if ctx['phase'] == 'open' else ''}. {total:,} properties across the county are. Notices are filed with "
                f"the County Clerk until 21 days before each sale; get the free Wednesday email to hear when one lands here.")
    if area.kind == "zip":
        rank = 1 + sum(1 for a in ctx["zips"].values() if a.n > n)
        if rank == 1:
            where = ", the most of any ZIP code on this month's list"
        elif rank <= 10:
            where = f", the {ordinal(rank)} most of the {len(ctx['zips'])} ZIP codes on this month's list"
        else:
            where = ""
        if n == 1:
            r = rows[0]
            first = (f"One property in ZIP code {area.key} ({area.name}) is scheduled for the Harris County foreclosure auction on "
                     f"{day} at {place}: {an(NOUN[tkey(r['type'])][0])} at {r['addr']}.")
            hoa = r["notice"] == "hoa"
            second = (f"It is {'an HOA lien sale, a homeowners association foreclosing for unpaid assessments' if hoa else 'a mortgage foreclosure under a deed of trust'}, "
                      f"and the lot is in FEMA flood zone {r['zone'] or 'not mapped'}"
                      f"{', a high-risk area' if r['sfha'] else ', outside the high-risk area' if r['zone'] == 'X' else ''}.")
            third = f"The notice was filed on {nice(r['first'])} and the sale is set for the {short_window(r['window'])} window."
            return " ".join([first, second, third])
        first = (f"{n} properties in ZIP code {area.key} ({area.name}) are scheduled for the Harris County foreclosure auction on "
                 f"{day} at {place}{where}" + (f" ({100 * n / total:.1f}% of all {total:,} notices)." if rank <= 3 else "."))
        others = Counter(r["city"] for r in rows if r["city"] != area.name)
        if others:
            first += " " + join([f"{num(v, True) if i == 0 else num(v)} {pl(v, 'is', 'are')} listed under {c}" for i, (c, v) in enumerate(others.items())]) + "."
    else:
        zc = Counter(r["zip"] for r in rows)
        rank = 1 + sum(1 for a in ctx["cities"].values() if a.n > n)
        share = pct(n, total)
        if n == 1:
            r = rows[0]
            return (f"One property in {area.name} is on the list for the Harris County foreclosure auction on {day} at {place}: "
                    f"{an(NOUN[tkey(r['type'])][0])} at {r['addr']}, ZIP code {r['zip']}. "
                    f"It is in FEMA flood zone {r['zone'] or 'not mapped'}, the notice was filed on {nice(r['first'])}, and the sale is set for "
                    f"the {short_window(r['window'])} window.")
        first = f"{n} of the {total:,} Harris County properties going to the foreclosure auction on {day} are in {area.name}"
        if share >= 40:
            first += f", more than {'half' if share >= 50 else 'two in five'} of the county's list"
        elif rank <= 5:
            first += f", the {'most' if rank == 1 else ordinal(rank) + ' most'} of any city"
        if len(zc) == 1:
            first += f", all in ZIP code {next(iter(zc))}."
        else:
            top = zc.most_common(3)
            first += f", spread over {num(len(zc))} ZIP codes. {top[0][0]} has the most ({top[0][1]})"
            first += f", followed by {join([f'{z} ({c})' for z, c in top[1:]])}." if len(top) > 1 else "."
    return " ".join(s for s in [first, type_sentence(rows, n), notice_sentence(rows, n, county_hoa), flood_sentence(rows, n, county_sfha),
                                filing_sentence(rows, n, stats, ctx["phase"]), window_sentence(rows, n)] if s)


def meta_description(area, ctx):
    n, rows, cur = area.n, area.rows, ctx["cur"]
    if n == 0:
        return f"Harris County foreclosure auctions in {area.label}: none on the {cur['label_year']} list. Get the free list every Wednesday."
    sf = sum(1 for r in rows if r["type"] == "single_family")
    fl = sum(1 for r in rows if r["sfha"])
    bits = [f"{sf} single-family" if sf and sf != n else "all single-family" if sf == n and n > 1 else "",
            f"{fl} in a flood zone" if fl else "none in a flood zone" if n > 1 else ""]
    head = (f"{n} {pl(n, 'property', 'properties')} in {area.label}, TX going to foreclosure auction on {cur['label_year']}"
            + (f" ({join([b for b in bits if b])})" if any(bits) else "") + ".")
    return head + " Free photos, map, sale times and county notices."


# ---------- page pieces ----------

HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
{robots}<link rel="canonical" href="{url}">
<meta property="og:title" content="{og_title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{site}/assets/og.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="First Tuesday List">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.png"><link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Public+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/site.css?v=3"><link rel="stylesheet" href="/assets/map.css?v=3"><link rel="stylesheet" href="/assets/zipalerts.css"><link rel="stylesheet" href="/assets/area.css">
<script type="application/ld+json">{jsonld}</script>
</head>
<body data-page="areas">
<main class="area">
{body}
</main>
<script src="/config.js"></script>
<script src="/assets/site.js?v=3"></script>
<script src="/assets/zipalerts.js"></script>
<script src="/assets/area.js"></script>
</body>
</html>
"""


def page(title, desc, path, crumbs, items, body, og_title=None, index=True):
    url = SITE_URL + path
    graph = [{"@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": name, "item": SITE_URL + href} for i, (name, href) in enumerate(crumbs)]}]
    if items:
        graph.append({"@type": "ItemList", "name": og_title or title, "numberOfItems": len(items), "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "url": SITE_URL + href, "name": name} for i, (name, href) in enumerate(items)]})
    graph.insert(0, {"@type": "WebPage", "@id": url, "url": url, "name": og_title or title, "description": desc,
                     "isPartOf": {"@type": "WebSite", "name": "First Tuesday List", "url": SITE_URL + "/"}})
    return HEAD.format(title=e(title), desc=e(desc), url=e(url), og_title=e(og_title or title), site=SITE_URL,
                       robots="" if index else '<meta name="robots" content="noindex, follow">\n',
                       jsonld=jdump({"@context": "https://schema.org", "@graph": graph}), body=body)


def crumbs_html(crumbs):
    out = [f'<a href="{e(h)}">{e(n)}</a>' for n, h in crumbs[:-1]] + [f'<span aria-current="page">{e(crumbs[-1][0])}</span>']
    return f'<nav class="crumbs" aria-label="Breadcrumb">{" / ".join(out)}</nav>'


def signup_card(area, ctx):
    """The sign-up is a free alert for this area (assets/zipalerts.js, mounted by area.js): a ZIP, or all of a city's ZIPs."""
    what = area.key if area.kind == "zip" else area.name
    return f"""<aside class="a-sign" id="signup" aria-label="Free alerts for {e(what)}">
<div data-zip-alerts data-areas="{e(what)}"></div>
</aside>"""


def stat_boxes(area, stats):
    rows, n = area.rows, area.n
    vals = [(n, pl(n, "property", "properties")),
            (sum(1 for r in rows if r["type"] == "single_family"), "single family"),
            (sum(1 for r in rows if r["first"] >= stats["new_since"]), "new this week"),
            (sum(1 for r in rows if r["sfha"]), "in a flood zone"),
            (sum(1 for r in rows if r["notice"] == "hoa"), "HOA lien sales")]
    return '<div class="a-stats">' + "".join(f"<div><b>{v}</b><span>{e(l)}</span></div>" for v, l in vals) + "</div>"


def static_map(area, ctx):
    """An SVG preview of the area's pins (no key, no script needed). Other properties of the sale show as grey dots,
    neighbouring ZIP codes as labels. area.js swaps in the Google map when it can."""
    pts = [r for r in area.rows if r["lat"] is not None]
    lat0 = area.center[0]
    k = math.cos(math.radians(lat0))
    xs, ys = [r["lon"] * k for r in pts], [-r["lat"] for r in pts]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    span = max(maxx - minx, maxy - miny, 0.014)
    cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    # a 3:2 frame around the pins, with room for the pin heads
    w = max(maxx - minx, (maxy - miny) * 1.5, span) * 1.4
    h = w / 1.5
    cy -= h * 0.04  # pins point down from their heads: leave a little more room at the top
    W, H = 1000, 667
    sx = lambda lon: (lon * k - (cx - w / 2)) / w * W
    sy = lambda lat: (-lat - (cy - h / 2)) / h * H
    # the frame fills a wider or taller box than 3:2, so draw the context well past the viewBox
    inside = lambda x, y: -W <= x <= 2 * W and -H <= y <= 2 * H
    ids = {r["id"] for r in pts}
    dots = []
    for r in ctx["rows"]:
        if r["lat"] is None or r["id"] in ids:
            continue
        x, y = sx(r["lon"]), sy(r["lat"])
        if inside(x, y):
            dots.append(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="5"/>')
    labels = []
    for z in (ctx["zips"].values() if len(pts) <= 150 else []):  # a city-wide map is too dense for labels
        if z.center and (area.kind != "zip" or z.key != area.key):
            x, y = sx(z.center[1]), sy(z.center[0])
            if inside(x, y):
                labels.append(f'<text x="{x:.0f}" y="{y:.0f}" text-anchor="middle">{e(z.key)}</text>')
    pins = []
    big = len(pts) > 150
    for r in sorted(pts, key=lambda r: -r["lat"]):
        x, y = sx(r["lon"]), sy(r["lat"])
        c = COLORS.get(r["type"], "#8A97AA")
        shape = (f'<circle cx="{x:.1f}" cy="{y:.1f}" r="7" fill="{c}" stroke="#fff" stroke-width="2"/>' if big else
                 f'<use href="#pin" x="{x:.1f}" y="{y:.1f}" fill="{c}"/>')
        pins.append(shape if big else f'<a href="/property/{e(r["id"])}" tabindex="-1"><title>{e(r["addr"])}</title>{shape}</a>')
    grid = "".join(f'<path d="M{i} {-H}V{2 * H}"/>' for i in range(-W, 2 * W, 100)) + "".join(f'<path d="M{-W} {j}H{2 * W}"/>' for j in range(-H, 2 * H, 100))
    return (f'<svg class="a-static" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">'
            f'<defs><symbol id="pin" viewBox="-14 -36 28 37" width="28" height="37" x="-14" y="-36" overflow="visible">'
            f'<path d="M0 0C-3-8-12-13-12-22a12 12 0 1 1 24 0C12-13 3-8 0 0Z" stroke="#fff" stroke-width="2.6"/>'
            f'<circle cx="0" cy="-22" r="4.6" fill="#fff"/></symbol></defs>'
            f'<rect x="{-W}" y="{-H}" width="{3 * W}" height="{3 * H}" fill="#E9EDF0"/><g stroke="#DCE2E8" stroke-width="1">{grid}</g>'
            f'<g fill="#A9B3C1" stroke="#fff" stroke-width="1.5">{"".join(dots)}</g><g>{"".join(labels)}</g>'
            f'<g style="filter:drop-shadow(0 2px 2px rgba(14,26,43,.35))">{"".join(pins)}</g></svg>')


def map_block(area, ctx):
    pts = [r for r in area.rows if r["lat"] is not None]
    if not pts:
        return ""
    new_since = ctx["stats"]["new_since"]
    # one array per pin, in the order area.js reads them (PIN_FIELDS)
    data = [[r["id"], r["addr"], r["city"], r["zip"], round(r["lat"], 6), round(r["lon"], 6), r["type"], r["photo"] or "", r["window"] or "",
             r["zone"] or "", int(r["sfha"]), int(r["first"] >= new_since)] for r in pts]
    types = Counter(r["type"] for r in pts)
    legend = "".join(f'<span><span class="dot" style="background:{COLORS.get(t, "#8A97AA")}"></span>{e(kind(t))}</span>' for t, _ in types.most_common())
    q = area.key if area.kind == "zip" else area.name
    return (f'<div class="fm" id="areaMap" data-day="{e(ctx["cur"]["label_day"])}" role="region" aria-label="Map of the {area.n} {pl(area.n, "property", "properties")} in {e(area.label)}">'
            f'{static_map(area, ctx)}<div class="fm-map"></div>'
            f'<div class="a-legend">{legend}<span><span class="dot" style="background:#A9B3C1"></span>Elsewhere in the sale</span></div>'
            f'<div class="a-maphint">Map preview · <a href="/map?q={e(q)}">Open the full map</a></div>'
            f'<div class="fm-card" aria-live="polite"></div></div>'
            f'<script type="application/json" id="areaPins">{jdump(data)}</script>')


def sale_card(area, ctx):
    cur, rows = ctx["cur"], area.rows
    w = Counter(short_window(r["window"]) for r in rows)
    top = w.most_common(4)
    rest = sum(w.values()) - sum(v for _, v in top)
    lis = "".join(f'<li><span>{e(t)}</span><span class="mono">{v}</span></li>' for t, v in top + ([("Other times", rest)] if rest else []))
    phase = ctx["phase"]
    status = {"open": f"Notices can still be filed until {nice(cur['deadline'])}, so this list can grow.",
              "complete": f"The list is final: the filing deadline passed on {nice(cur['deadline'])}. Sales can still be postponed or cancelled.",
              "today": "The sale is today.", "over": f"This sale is over. The {cur['next_label']} list is coming."}[phase]
    return f"""<div class="card sale">
<div class="lbl">Auction · Harris County</div>
<div class="disp when">{e(cur['label_day'])}</div>
<p>{e(ctx['place'])}</p>
{f'<ul aria-label="Sale windows">{lis}</ul>' if rows else ''}
<p>{e(status)}</p>
</div>"""


def facts_card(area, ctx):
    rows = area.rows
    hud = ctx["hud"]
    lines = []
    if area.kind == "zip" and area.key in hud:
        r = hud[area.key]
        for b in ("br2", "br3", "br4"):
            if b in r:
                lines.append((f"HUD fair rent, {b[2]} BR", f"${r[b]:,}/mo"))
        note = f"HUD Small Area Fair Market Rents, FY2027, for ZIP code {area.key}: an area benchmark, not the rent of any property here."
    elif area.kind == "city":
        zs = sorted({r["zip"] for r in rows} & set(hud))
        vals = [hud[z]["br3"] for z in zs if "br3" in hud[z]]
        if vals:
            lines.append(("HUD fair rent, 3 BR", f"${min(vals):,}–{max(vals):,}/mo" if min(vals) != max(vals) else f"${vals[0]:,}/mo"))
        note = f"HUD Small Area Fair Market Rents, FY2027, across {area.name}'s ZIP codes on this list: an area benchmark, not the rent of any property here."
    else:
        note = ""
    county = ctx["stats"]
    lines.insert(0, ("Share of the county's list", f"{round(100 * area.n / county['total'], 1)}%"))
    zones = Counter(r["zone"] or "not mapped" for r in rows)
    lines.append(("Flood zones", ", ".join(f"{z} ({v})" for z, v in zones.most_common(3))))
    if area.kind == "city":
        lines.insert(1, ("ZIP codes with a notice", str(len({r["zip"] for r in rows}))))
    dl = "".join(f"<dt>{e(a)}</dt><dd>{e(b)}</dd>" for a, b in lines)
    return f'<div class="card facts"><div class="h3">Area facts</div><dl>{dl}</dl>{f"<small>{e(note)}</small>" if note else ""}</div>'


def prop_card(r, ctx, i):
    page = f"/property/{e(r['id'])}"
    new = r["first"] >= ctx["stats"]["new_since"]
    hoa = r["notice"] == "hoa"
    return f"""<article class="prop-card" data-type="{e(tkey(r['type']))}" data-new="{int(new)}" data-sfha="{int(r['sfha'])}" data-notice="{e(r['notice'])}">
<a class="ph" href="{page}" tabindex="-1" aria-hidden="true"><img loading="lazy" src="{e(r['photo'] or '')}" alt="" width="400" height="170">{f'<span class="tag tag-new">New {e(nice(r["first"]))}</span>' if new else ''}<span class="lbl">Aerial · HCAD 2026</span></a>
<div class="body"><a class="addr" href="{page}">{e(r['addr'])}</a><div class="meta">{e(r['city'])} {e(r['zip'])} · {e(kind(r['type']))}</div>
<div style="display:flex;gap:5px;flex-wrap:wrap"><span class="tag {'tag-flood' if r['sfha'] else 'tag-plain'}">Flood zone {e(r['zone'] or '—')}</span><span class="tag tag-plain">{e(short_window(r['window']))}</span>{'<span class="tag tag-plain">HOA lien</span>' if hoa else ''}</div>
<div class="lock"><span>Est. equity</span><span class="redact"><i style="--d:{(i % 6) * 0.25:.2f}s"></i></span><a href="/pricing" style="margin-left:auto;font-weight:700;white-space:nowrap">Members</a></div></div></article>"""


def prop_row(r, ctx):
    new = r["first"] >= ctx["stats"]["new_since"]
    tag_new = '<span class="tag tag-new">New</span>' if new else ""
    tag_hoa = '<span class="tag tag-plain">HOA</span>' if r["notice"] == "hoa" else ""
    return (f'<a class="a-row" href="/property/{e(r["id"])}" data-type="{e(tkey(r["type"]))}" data-new="{int(new)}" data-sfha="{int(r["sfha"])}" data-notice="{e(r["notice"])}">'
            f'<span><strong>{e(r["addr"])}</strong><span class="m"> · {e(r["city"])} {e(r["zip"])}</span></span>'
            f'<span class="m">{e(kind(r["type"]))} · {e(short_window(r["window"]))}</span>'
            f'<span class="t">{tag_new}<span class="tag {"tag-flood" if r["sfha"] else "tag-plain"}">Flood {e(r["zone"] or "—")}</span>'
            f'{tag_hoa}</span></a>')


def list_block(area, ctx):
    rows, n = area.rows, area.n
    if not n:
        return ""
    types = Counter(tkey(r["type"]) for r in rows)
    chips = [("all", f"All {n}")] + [(t, f"{kind(t) if t != 'other' else 'Other'} ({v})") for t, v in types.most_common() if len(types) > 1]
    new = sum(1 for r in rows if r["first"] >= ctx["stats"]["new_since"])
    dry = sum(1 for r in rows if not r["sfha"])
    hoa = sum(1 for r in rows if r["notice"] == "hoa")
    if 0 < new < n:
        chips.append(("new", f"New this week ({new})"))
    if 0 < dry < n:
        chips.append(("dry", f"Outside flood zone ({dry})"))
    if 0 < hoa < n:
        chips.append(("hoa", f"HOA lien ({hoa})"))
    filt = ('<div class="a-filter" data-k="filter" role="group" aria-label="Filter the list">' +
            "".join(f'<button class="chip" type="button" data-f="{f}" aria-pressed="{str(f == "all").lower()}">{e(l)}</button>' for f, l in chips) + "</div>") if n > 3 else ""
    if n <= CARD_LIMIT:
        inner = '<div class="grid3">' + "".join(prop_card(r, ctx, i) for i, r in enumerate(rows)) + "</div>"
    else:
        groups = defaultdict(list)
        for r in rows:
            groups[r["zip"]].append(r)
        inner = '<div class="a-rows">' + "".join(
            f'<div data-group="{z}"><h3 class="disp">{z} <a href="/zip/{z}">{len(g)} in {e(ctx["zips"][z].name)} {z} with photos and map ›</a></h3>'
            + "".join(prop_row(r, ctx) for r in g) + "</div>"
            for z, g in sorted(groups.items(), key=lambda x: (-len(x[1]), x[0]))) + "</div>"
    head = f"{n} {pl(n, 'property', 'properties')} in {area.label}"
    return f"""<section class="wrap sec" id="list" aria-labelledby="list-h">
<div class="a-listhead"><div><div class="eyebrow">{e(ctx['cur']['label_year'])} sale · every notice filed</div><h2 class="disp" id="list-h">{e(head)}</h2></div>{filt}</div>
<p class="a-count" data-k="shown" role="status"></p>
<div id="areaList">{inner}</div>
<p class="a-note">Compiled from public records. Not verified. Do your own title and lien research before bidding. Sales can be postponed or cancelled up to the day of the auction.</p>
</section>"""


def member_block(area, ctx):
    n = area.n
    if not n:
        return ""
    what = f"all {n} properties in {area.label}" if n > 1 else f"the property in {area.label}"
    return f"""<section class="wrap sec" aria-labelledby="mem-h">
<div class="card a-mem">
<div class="txt"><div class="h3" id="mem-h"><span class="ico-lock"></span>The numbers for {e(area.label)} <span class="tag tag-plain">Members</span></div>
<p>Members see the appraised value, the original loan, the estimated balance and equity, and the estimated rent for {e(what)}, with the method behind every number. Sort the sale by equity, then do your own title and lien research.</p>
<a class="btn btn-red" href="/pricing" data-join>Become a member</a>
<div class="price">$49 a month · founding members $39 a month for the first 100.</div></div>
<div class="nums" aria-label="Member fields, locked">
<div><span>HCAD market value</span><span class="redact"><i></i></span></div>
<div><span>Estimated loan balance</span><span class="redact"><i style="--d:.22s"></i></span></div>
<div><span>Estimated monthly rent</span><span class="redact"><i style="--d:.44s"></i></span></div>
<div class="tot"><span>Estimated equity</span><span class="redact"><i style="--d:.66s;width:110px;height:16px"></i></span></div>
</div></div></section>"""


def tiles(items):
    zero = ' class="zero"'
    return '<div class="a-tiles">' + "".join(
        f'<a href="{e(a.path)}"{zero if not a.n else ""}><span><strong>{e(a.key if a.kind == "zip" else a.name)}</strong>'
        f'<small>{e(sub)}</small></span><span class="mono">{a.n}</span></a>' for a, sub in items) + "</div>"


def nearby_block(area, ctx):
    zips, cities = ctx["zips"], ctx["cities"]
    parts = []
    if area.kind == "zip":
        if area.center:
            near = sorted((z for z in zips.values() if z.key != area.key and z.n and z.center), key=lambda z: miles(area.center, z.center))[:8]
            parts.append(("Nearby ZIP codes on this list", tiles([(z, f"{z.name} · {miles(area.center, z.center):.0f} mi") for z in near])))
        cs = Counter(r["city"] for r in area.rows) or Counter({area.name: 0})
        parts.append((f"{'Cities' if len(cs) > 1 else 'City'} for {area.key}", tiles([(cities[slug(c)], f"{cities[slug(c)].n} on the list · whole city") for c in cs if slug(c) in cities])))
    else:
        zc = Counter(r["zip"] for r in area.rows)
        if zc:
            parts.append((f"ZIP codes in {area.name}", tiles([(zips[z], zips[z].name if zips[z].name != area.name else f"{area.name}") for z, _ in sorted(zc.items(), key=lambda x: (-x[1], x[0]))])))
        if area.center:
            near = sorted((c for c in cities.values() if c.key != area.key and c.n and c.center), key=lambda c: miles(area.center, c.center))[:8]
            parts.append(("Nearby cities", tiles([(c, f"{miles(area.center, c.center):.0f} mi away") for c in near])))
    body = "".join(f'<h2 class="disp" style="font-size:30px;margin:24px 0 12px">{e(t)}</h2>{h}' for t, h in parts)
    return f'<section class="wrap sec" aria-label="Other areas">{body}<p class="a-note"><a href="/areas" style="font-weight:700">Every city and ZIP code on the {e(ctx["cur"]["label"])} list ›</a></p></section>'


def brief_band(area):
    return f"""<section class="brief" aria-label="Free weekly email">
<div class="wrap">
<div style="flex:1 1 520px;min-width:0"><h2 class="disp" style="margin:0 0 8px;font-size:44px">The First Tuesday Brief</h2>
<p style="margin:0;font-size:17px;color:#C9D3E0">Free every Wednesday: what was filed this week{' in ' + e(area.key if area.kind == 'zip' else area.name) + ' and the rest of Harris County' if area else ''}, what got postponed, and the full list as a spreadsheet. No spam, and we never sell your email.</p></div>
<div style="flex:1 1 420px;min-width:0;display:flex;flex-direction:column;gap:8px">
<div class="bh-form" data-source="{e('area:' + area.key if area else 'area:index')}"></div>
</div></div></section>"""


def area_page(area, ctx):
    cur = ctx["cur"]
    date_y = cur["label_year"]
    if area.kind == "zip":
        h1 = f'{e(area.name)} ({e(area.key)}) foreclosure auctions<span>: {e(date_y)}</span>'
        title = f"{area.name} TX {area.key} Foreclosure Auctions · {date_y} · First Tuesday List"
        og = f"{area.name} ({area.key}) foreclosure auctions: {date_y}"
        city = ctx["cities"].get(slug(area.name))
        crumbs = [("Home", "/"), ("Areas", "/areas")] + ([(area.name, city.path)] if city else []) + [(area.key, area.path)]
    else:
        h1 = f'{e(area.name)}, TX foreclosure auctions<span>: {e(date_y)}</span>'
        title = f"{area.name} TX Foreclosure Auctions · {date_y} · First Tuesday List"
        og = f"{area.name}, TX foreclosure auctions: {date_y}"
        crumbs = [("Home", "/"), ("Areas", "/areas"), (area.name, area.path)]
    desc = meta_description(area, ctx)
    items = [(f"{r['addr']}, {r['city']}, TX {r['zip']}", f"/property/{r['id']}") for r in area.rows]
    hero = f"""<section class="a-hero">
<div class="wrap">
<div class="main">
{crumbs_html(crumbs)}
<div class="chips"><span class="tag">Harris County foreclosure auction</span><span class="tag">{e(long_day(cur['current_sale']))}</span><span class="tag">Updated {e(nice(ctx['stats']['updated']))} from the County Clerk</span></div>
<h1 class="disp">{h1}</h1>
<p class="lead">{e(intro(area, ctx))}</p>
{stat_boxes(area, ctx['stats']) if area.n else ''}
</div>
{signup_card(area, ctx)}
</div>
</section>"""
    mapsec = (f'<section class="wrap sec" aria-label="Map and sale details"><div class="a-mapgrid">{map_block(area, ctx)}'
              f'<aside>{sale_card(area, ctx)}{facts_card(area, ctx) if area.n else ""}</aside></div></section>') if area.n else \
             f'<section class="wrap sec"><div class="card a-empty">No notice in {e(area.label)} for the {e(cur["label"])} sale. <a href="/map">See all {ctx["stats"]["total"]} properties on the map</a>.</div></section>'
    body = hero + mapsec + list_block(area, ctx) + member_block(area, ctx) + nearby_block(area, ctx) + brief_band(area)
    return page(title, desc, area.path, crumbs, items, body, og_title=og, index=area.n > 0)


def index_page(ctx):
    cur, stats = ctx["cur"], ctx["stats"]
    cities = sorted((c for c in ctx["cities"].values() if c.n), key=lambda c: (-c.n, c.name))
    zips = sorted((z for z in ctx["zips"].values() if z.n), key=lambda z: z.key)
    top = sorted(zips, key=lambda z: -z.n)[:3]
    lead = (f"The {stats['total']:,} Harris County properties going to the foreclosure auction on {long_day(cur['current_sale'])} sit in "
            f"{len(zips)} ZIP codes and {len(cities)} cities. Houston has the most ({ctx['cities']['houston'].n if 'houston' in ctx['cities'] else 0}); "
            f"the busiest ZIP codes are {join([f'{z.key} in {z.name} ({z.n})' for z in top])}. Pick an area for its map, its list with photos, "
            f"flood zones and sale times, and a free weekly email.")
    crumbs = [("Home", "/"), ("Areas", "/areas")]

    def tile(a, sub):
        find = f"{a.key} {a.name}".lower() if a.kind == "zip" else f"{a.name} {' '.join(sorted({r['zip'] for r in a.rows}))}".lower()
        return (f'<a href="{e(a.path)}" data-find="{e(find)}"><span><strong>{e(a.key if a.kind == "zip" else a.name)}</strong><small>{e(sub)}</small></span>'
                f'<span class="mono">{a.n}</span></a>')
    city_tiles = '<div class="a-tiles">' + "".join(tile(c, f"{len({r['zip'] for r in c.rows})} ZIP code{'s' if len({r['zip'] for r in c.rows}) > 1 else ''}") for c in cities) + "</div>"
    zip_tiles = '<div class="a-tiles">' + "".join(tile(z, z.name) for z in zips) + "</div>"
    body = f"""<section class="a-hero">
<div class="wrap">
<div class="main">
{crumbs_html(crumbs)}
<div class="chips"><span class="tag">Harris County foreclosure auction</span><span class="tag">{e(long_day(cur['current_sale']))}</span></div>
<h1 class="disp">Foreclosure auctions by city and ZIP<span>: {e(cur['label_year'])}</span></h1>
<p class="lead">{e(lead)}</p>
</div>
<aside class="a-sign" id="signup"><div class="disp h">Get the free list every Wednesday</div><p>The spreadsheet of every property for this sale, emailed right away. Then what's new, postponed and cancelled every Wednesday.</p><div class="bh-form" data-source="area:index"></div><div class="signup-note">No card. Unsubscribe in one click.</div></aside>
</div>
</section>
<section class="wrap sec" aria-labelledby="cities-h">
<div class="a-find"><label for="areaFind" style="font-weight:700">Find your area</label><input id="areaFind" type="search" placeholder="City or ZIP code, e.g. Katy or 77449" data-k="find" autocomplete="off"></div>
<p data-k="nomatch" hidden class="a-note" role="status">No city or ZIP code on this month's list matches. <a href="/map">Search the map</a>.</p>
<h2 class="disp" id="cities-h">Cities</h2>
{city_tiles}
<h2 class="disp" style="margin-top:32px">ZIP codes</h2>
{zip_tiles}
<p class="a-note">Compiled from public records. Not verified. Do your own title and lien research before bidding.</p>
</section>
{brief_band(None)}"""
    items = [(f"{c.name}, TX foreclosure auctions", c.path) for c in cities] + [(f"{z.name} ({z.key}) foreclosure auctions", z.path) for z in zips]
    title = f"Harris County Foreclosure Auctions by City and ZIP · {cur['label_year']} · First Tuesday List"
    desc = (f"Every city and ZIP code in the {cur['label_year']} Harris County foreclosure auction: {stats['total']} properties in "
            f"{len(zips)} ZIP codes. Maps, photos, flood zones and sale times, free.")
    return page(title, desc, "/areas", crumbs, items, body, og_title=f"Harris County foreclosure auctions by city and ZIP: {cur['label_year']}")


# ---------- internal links from existing pages ----------

def stamp_home(site, out, ctx):
    """The home page's "Busiest ZIP codes" list as plain links, so search engines follow them before any script runs."""
    src = os.path.join(out, "index.html")
    if not os.path.exists(src):
        src = os.path.join(site, "index.html")
    s = open(src, encoding="utf-8").read()
    if "<!--areas:zips-->" not in s:
        return False
    links = "".join(f'<a href="/zip/{e(z)}" title="{e(c)} {e(z)} foreclosure auctions"><span><strong>{e(z)}</strong> <span style="color:var(--muted)">{e(c)}</span></span>'
                    f'<span class="mono">{n}</span></a>' for z, c, n in ctx["stats"]["zips"])
    s = re.sub(r"<!--areas:zips-->.*?<!--/areas:zips-->", lambda m: f"<!--areas:zips-->{links}<!--/areas:zips-->", s, flags=re.S)
    with open(os.path.join(out, "index.html"), "w", encoding="utf-8", newline="") as f:
        f.write(s)
    return True


def write_sitemap(site, out, ctx, today):
    """The site's sitemap plus every indexable area page."""
    path = os.path.join(site, "sitemap.xml")
    existing = re.findall(r"<url>.*?</url>", open(path, encoding="utf-8").read(), flags=re.S) if os.path.exists(path) else []
    existing = [u for u in existing if not re.search(r"<loc>[^<]*/(areas|zip/|city/)", u)]
    area_urls = [("/areas", "daily", "0.8")]
    area_urls += [(c.path, "daily", "0.7") for c in sorted(ctx["cities"].values(), key=lambda c: c.key) if c.n]
    area_urls += [(z.path, "daily", "0.7") for z in sorted(ctx["zips"].values(), key=lambda z: z.key) if z.n]
    new = [f"<url><loc>{SITE_URL}{u}</loc><lastmod>{today}</lastmod><changefreq>{c}</changefreq><priority>{p}</priority></url>" for u, c, p in area_urls]
    # main pages first, then the area pages, then the property pages
    head = [u for u in existing if "/property/" not in u]
    tail = [u for u in existing if "/property/" in u]
    with open(os.path.join(out, "sitemap.xml"), "w", encoding="utf-8", newline="\n") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                + "\n".join(head + new + tail) + "\n</urlset>\n")
    return len(head) + len(new) + len(tail), len(new)


# ---------- the build ----------

def build_context(site, out, today):
    cur, rows, stats = load(site)
    d = date.fromisoformat(cur["current_sale"])
    phase = "open" if today <= date.fromisoformat(cur["deadline"]) else "complete" if today < d else "today" if today == d else "over"
    place = Counter(r["location"] for r in rows if r["location"]).most_common(1)[0][0]
    by_zip, by_city = defaultdict(list), defaultdict(list)
    for r in rows:
        by_zip[r["zip"]].append(r)
        by_city[slug(r["city"])].append(r)
    zips = {z: Area("zip", z, Counter(r["city"] for r in rs).most_common(1)[0][0], rs) for z, rs in by_zip.items()}
    cities = {s: Area("city", s, rs[0]["city"], rs) for s, rs in by_city.items()}
    # areas from earlier sales keep their pages (with no properties) so their URLs never break
    seen_path = os.path.join(out, "data", "areas-seen.json")
    seen = json.load(open(seen_path, encoding="utf-8")) if os.path.exists(seen_path) else {"zips": {}, "cities": {}}
    for z, name in seen.get("zips", {}).items():
        zips.setdefault(z, Area("zip", z, name, []))
    for s, name in seen.get("cities", {}).items():
        cities.setdefault(s, Area("city", s, name, []))
    seen = {"zips": {z: a.name for z, a in sorted(zips.items())}, "cities": {s: a.name for s, a in sorted(cities.items())}}
    return {"cur": cur, "rows": rows, "stats": stats, "phase": phase, "zips": zips, "cities": cities, "hud": load_hud(),
            "place": place, "place_short": place.split(",")[0], "seen": seen, "seen_path": seen_path}


def write_zip_index(site, ctx):
    """data/zips-<sale>.json for the "Watch my area" widget: per ZIP its count, new this week, centre and the 3 newest
    properties (free fields only). The widget falls back to the full sale file if this is missing."""
    since, zips = ctx["stats"]["new_since"], []
    for z, a in ctx["zips"].items():
        if not a.n:
            continue
        geo = [r for r in a.rows if r.get("lat") is not None]
        newest = sorted(a.rows, key=lambda r: (r["first"] or "", r["addr"]), reverse=True)[:3]
        zips.append({"z": z, "c": a.name, "n": a.n, "nw": sum(1 for r in a.rows if (r["first"] or "") >= since),
                     "lat": round(sum(r["lat"] for r in geo) / len(geo), 4) if geo else None,
                     "lon": round(sum(r["lon"] for r in geo) / len(geo), 4) if geo else None,
                     "ex": [[r["id"], r["addr"], r["city"], r["type"], r["first"]] for r in newest]})
    zips.sort(key=lambda x: (-x["n"], x["z"]))
    sale = ctx["cur"]["current_sale"]
    out = {"sale": sale, "label": ctx["cur"].get("label"), "new_since": since, "total": len(ctx["rows"]), "zips": zips}
    with open(os.path.join(site, "data", f"zips-{sale}.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    return len(zips)


def write_hud_rent(site):
    """data/hud-rent.json: HUD's rent by ZIP and bedroom count (area-level, public), for the map's rent lens."""
    zips = {}
    with open(HUD_CSV, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            zips[r["zip"].strip()[:5]] = [int(r[f"br{i}"]) for i in range(5)]
    out = {"source": "HUD Small Area Fair Market Rents, FY2027", "fy": "FY2027", "url": HUD_URL,
           "note": "Fair Market Rent: HUD's estimate of a typical (40th percentile) rent for a modest home in the ZIP, utilities included.",
           "zips": dict(sorted(zips.items()))}
    with open(os.path.join(site, "data", "hud-rent.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    return len(zips)


def write_area_pages(site, out=None, today=None):
    out = out or site
    today = today or central_today()
    ctx = build_context(site, out, today)
    for sub in ("zip", "city"):
        shutil.rmtree(os.path.join(out, sub), ignore_errors=True)
        os.makedirs(os.path.join(out, sub))
    for a in list(ctx["zips"].values()) + list(ctx["cities"].values()):
        with open(os.path.join(out, a.path.lstrip("/") + ".html"), "w", encoding="utf-8", newline="") as f:
            f.write(area_page(a, ctx))
    with open(os.path.join(out, "areas.html"), "w", encoding="utf-8", newline="") as f:
        f.write(index_page(ctx))
    os.makedirs(os.path.dirname(ctx["seen_path"]), exist_ok=True)
    json.dump(ctx["seen"], open(ctx["seen_path"], "w", encoding="utf-8"), separators=(",", ":"))
    home = stamp_home(site, out, ctx)
    total, new = write_sitemap(site, out, ctx, today.isoformat())
    return {"zips": len(ctx["zips"]), "cities": len(ctx["cities"]), "home": home, "sitemap": total, "sitemap_areas": new,
            "empty": sum(1 for a in list(ctx["zips"].values()) + list(ctx["cities"].values()) if not a.n),
            "zip_index": write_zip_index(out, ctx), "hud_zips": write_hud_rent(out)}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--site", default=SITE_DEFAULT, help="the built site (reads data/*.json, sitemap.xml, index.html; writes the pages there)")
    ap.add_argument("--today", help="YYYY-MM-DD, Houston date (default: today)")
    a = ap.parse_args()
    res = write_area_pages(a.site, a.site, date.fromisoformat(a.today) if a.today else None)
    print(f"{res['zips']} ZIP pages, {res['cities']} city pages ({res['empty']} with no notice this sale), /areas index")
    print(f"home page links: {'stamped' if res['home'] else 'no <!--areas:zips--> marker'}; sitemap.xml: {res['sitemap']} URLs ({res['sitemap_areas']} area pages)")
    print(f"ZIP alert index: {res['zip_index']} ZIPs; HUD rents: {res['hud_zips']} ZIPs")


if __name__ == "__main__":
    main()
