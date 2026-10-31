"""One static page per property: site/property/<id>.html, served at /property/<id>.

Pages carry only the FREE columns (see docs/free-paid-split.md). Member fields
appear as locked rows with a grey bar, never with a value: the public build has
no member data to leak.
"""
import html
import re
import math
import os
import shutil
from datetime import date, timedelta
from urllib.parse import quote, quote_plus

TYPES = {"single_family": "Single family", "condo_townhome": "Condo / townhome", "multifamily": "Multifamily",
         "commercial": "Commercial", "vacant_land": "Vacant land"}
FAV = "https://www.google.com/s2/favicons?sz=64&domain="
DL = ('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" '
      'stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>')
SITE_URL = "https://firsttuesdaylist.com"

e = html.escape


def notice_filename(r):
    """e.g. "934 Autumn Oaks Dr, Houston TX 77079 - foreclosure notice FRCL-2026-7447.pdf" """
    name = f"{r['addr']}, {r['city']} TX {r['zip']} - {'HOA lien' if r['notice'] == 'hoa' else 'foreclosure'} notice {r['id']}.pdf"
    return re.sub(r'[<>:"/\|?*#]+', ' ', name).replace('  ', ' ')


def kind(r):
    return TYPES.get(r["type"], "Other")


def nice(d, weekday=False, year=False):
    d = date.fromisoformat(d)
    s = d.strftime("%a, %b ") + str(d.day) if weekday else d.strftime("%b ") + str(d.day)
    return s + (d.strftime(", %Y") if year else "")


def miles(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a["lat"], a["lon"], b["lat"], b["lon"]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 3958.8 * 2 * math.asin(math.sqrt(h))


def links(r):
    a = r["addr"].replace("#", "")
    full = f"{r['addr']}, {r['city']}, TX {r['zip']}"
    return {
        "zillow": "https://www.zillow.com/homes/" + ",-".join([a, r["city"], "TX", r["zip"]]).replace(" ", "-") + "_rb/",
        "realtor": "https://www.realtor.com/realestateandhomes-search/" + "_".join([a, r["city"], "TX", r["zip"]]).replace(" ", "-"),
        "redfin": "https://www.google.com/search?q=" + quote_plus(f"site:redfin.com {r['addr']} {r['city']} TX {r['zip']}"),
        "street": f"https://www.google.com/maps/@?api=1&map_action=pano&viewpoint={r['lat']},{r['lon']}" if r["lat"] else "",
        "directions": "https://www.google.com/maps/dir/?api=1&destination=" + quote_plus(full),
        "fema": "https://msc.fema.gov/portal/search?AddressQuery=" + quote_plus(full),
    }


def locked(label, key):
    """A member field: a grey bar for everyone; property.js fills data-m=<key> for signed-in members."""
    return f'<div><div class="k">{e(label)}</div><div class="v" data-m="{key}"><span class="redact"><span class="ico-lock"></span><i></i></span></div></div>'


def kv(label, value, mono=False):
    return f'<div><div class="k">{e(label)}</div><div class="v{" mono" if mono else ""}">{value}</div></div>'


PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{site}/property/{id}">
<meta property="og:title" content="{title}"><meta property="og:description" content="{desc}">
<meta property="og:image" content="{site}{photo}">
<link rel="icon" href="/favicon.png"><link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Public+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/site.css"><link rel="stylesheet" href="/assets/property.css">
</head>
<body data-page="property">
<main id="prop" data-id="{id}" data-sale="{sale}" data-starts="{starts}" data-lat="{lat}" data-lon="{lon}" data-addr="{addr}">
{body}
</main>
<script src="/config.js"></script>
<script src="/assets/site.js?v=2"></script>
<script src="/assets/property.js?v=2"></script>
</body>
</html>
"""


def body(r, sale, stats, nearby, prev, nxt):
    L = links(r)
    is_new = r["first"] >= stats["new_since"]
    hoa = r["notice"] == "hoa"
    deadline = (date.fromisoformat(sale) - timedelta(days=21)).isoformat()
    loc = r["location"] or "Bayou City Event Center, 9401 Knight Rd, Houston, TX 77045"
    chips = []
    if is_new:
        chips.append(f'<span class="tag tag-new">New {nice(r["first"])}</span>')
    chips.append(f'<span class="tag {"tag-flood" if r["sfha"] else "tag-plain"}">Flood zone {e(r["zone"] or "—")}{" (SFHA, high risk)" if r["sfha"] else ""}</span>')
    chips.append(f'<span class="tag tag-plain">{"HOA lien sale" if hoa else "Mortgage foreclosure"}</span>')
    if r.get("repeat"):
        chips.append('<span class="tag tag-plain">Posted more than once for this sale</span>')
    ext = (f'<a class="ext" href="{e(L["zillow"])}" target="_blank" rel="noopener"><img src="{FAV}zillow.com" alt="">Zillow</a>'
           f'<a class="ext" href="{e(L["realtor"])}" target="_blank" rel="noopener"><img src="{FAV}realtor.com" alt="">Realtor.com</a>'
           f'<a class="ext" href="{e(L["redfin"])}" target="_blank" rel="noopener"><img src="{FAV}redfin.com" alt="">Redfin</a>'
           + (f'<a class="ext" href="{e(L["street"])}" target="_blank" rel="noopener"><img src="{FAV}maps.google.com" alt="">Street View</a>' if L["street"] else ""))
    research = [("Save the foreclosure notice (PDF)", "County Clerk copy", f"/notice/{r['id']}" if r["notice_url"] else ""), ("Flood map for this address", "FEMA", L["fema"]),
                ("Street View", "Google", L["street"]), ("Directions", "Google Maps", L["directions"]),
                ("Zillow", "Listing history, if any", L["zillow"]), ("Realtor.com", "Listing history, if any", L["realtor"])]
    near = "".join(
        f'<a class="near" href="/property/{e(n["id"])}"><img loading="lazy" src="{e(n["photo"] or "")}" alt="">'
        f'<span><strong>{e(n["addr"])}</strong><small>{e(n["city"])} {e(n["zip"])} · {kind(n)}</small>'
        f'<small>{d:.1f} mi away{" · New" if n["first"] >= stats["new_since"] else ""}</small></span></a>' for n, d in nearby)
    pn = (f'<a class="btn btn-ghost" href="/property/{e(prev["id"])}">‹ {e(prev["addr"])}</a>' if prev else "<span></span>") + \
         (f'<a class="btn btn-ghost" href="/property/{e(nxt["id"])}">{e(nxt["addr"])} ›</a>' if nxt else "")
    back = f"/map#{e(r['id'])}"
    return f"""
<a class="gutter gl" href="{back}" data-back aria-label="Back to the map"><span>‹ Back to the map</span></a>
<a class="gutter gr" href="{back}" data-back aria-label="Back to the map"><span>Back to the map ›</span></a>
<div class="sheet">
<div class="backbar"><div class="wrap"><a class="btn btn-navy back" href="{back}" data-back><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>Back to the map</a><span class="hint">All {stats['total']} properties for {nice(sale)} · or press Esc</span></div></div>
<div class="wrap crumbs"><a href="/map">{nice(sale, year=True)} sale</a> / <a href="/map?q={quote(r['zip'])}">{e(r['city'])} {e(r['zip'])}</a> / <span class="mono">{e(r['id'])}</span></div>

<div class="wrap p-title">
<div style="min-width:0">
<div class="chips">{''.join(chips)}</div>
<h1 class="disp">{e(r['addr'])}</h1>
<div class="sub">{e(r['city'])}, TX {e(r['zip'])} · {kind(r)}</div>
<div class="see"><span>See it on</span>{ext}</div>
</div>
<div class="acts">
{f'<a class="btn btn-ghost" href="/notice/{e(r["id"])}" download="{e(notice_filename(r))}" title="Downloads the Harris County Clerk&#39;s official notice as {e(notice_filename(r))}">{DL}Save notice PDF</a>' if r['notice_url'] else ''}
<a class="btn btn-ghost" href="{e(L['directions'])}" target="_blank" rel="noopener">Directions</a>
{'<div class="acts-note">Saves the county clerk&#39;s official notice, named with this address.</div>' if r['notice_url'] else ''}
</div>
</div>

<div class="wrap p-top">
<div class="p-main">
<div class="gallery" data-k="gallery">
<div class="g-stage">
<img class="g-photo" src="{e(r['photo'] or '')}" alt="Aerial photo of {e(r['addr'])}, lot outlined in red">
<div class="g-pano" data-k="pano" hidden></div>
<div class="g-map" data-k="gmap" hidden></div>
<div class="g-cap" data-k="cap"><strong>Aerial photo · this lot</strong><br>Harris County Appraisal District imagery, 2026 · lot outlined in red</div>
</div>
<div class="g-tabs" role="tablist">
<button role="tab" aria-selected="true" data-tab="photo">Aerial photo</button>
<button role="tab" aria-selected="false" data-tab="pano">Street View</button>
<button role="tab" aria-selected="false" data-tab="gmap">Map</button>
</div>
</div>
<p class="note">Foreclosures sell as-is and you usually can't go inside before the sale. Every photo says where it came from and when.</p>
</div>

<aside class="p-side">
<div class="card auction">
<div class="lbl">Auction</div>
<div class="disp when">{nice(sale, weekday=True)} · {e(r['window'] or '10:00 AM - 1:00 PM')}</div>
<div class="where">{e(loc)}</div>
<div class="chips"><span class="tag" data-k="days"></span><span class="tag">{"HOA lien sale" if hoa else "Trustee sale"} · cash</span></div>
</div>
<div class="card signup-box" id="signup">
<div class="disp" style="font-size:24px;font-weight:800">Get the free list every Wednesday</div>
<div style="font-size:14px;color:#3A4A63">The spreadsheet of every property for this sale, emailed right away. Then what's new, postponed and cancelled every Wednesday.</div>
<div class="bh-form"></div>
<div class="signup-done"></div>
</div>
</aside>
</div>

<div class="wrap p-grid">
<div class="p-main">

<div class="card members">
<div class="h3"><span class="ico-lock"></span>The numbers <span class="tag tag-plain">Members</span></div>
<div class="nums">
<div><span>HCAD market value</span><span data-m="value"><span class="redact"><i></i></span></span></div>
<div><span>Estimated loan balance</span><span data-m="balance"><span class="redact"><i></i></span></span></div>
<div class="tot"><span>Estimated equity</span><span data-m="equity"><span class="redact"><i></i></span></span></div>
<div><span>Value / original loan</span><span data-m="vtl"><span class="redact"><i></i></span></span></div>
<div><span>Estimated monthly rent</span><span data-m="rent"><span class="redact"><i></i></span></span></div>
<div><span>Gross rent yield</span><span data-m="rent_yield"><span class="redact"><i></i></span></span></div>
</div>
<div class="cta"><span>Members see the value, the loan, the estimated balance and equity, and the estimated rent, with the method behind every number.</span><a class="btn btn-red" href="/pricing" data-join>Become a member</a></div>
</div>

<div class="card">
<div class="h3">Status and history</div>
<ol class="timeline">
<li><span class="dot"></span><span><strong>{nice(r['first'])}</strong> · Notice filed with the County Clerk<br><small>First seen by our daily check</small></span></li>
<li><span class="dot"></span><span><strong>{nice(deadline)}</strong> · Filing deadline for the {nice(sale)} sale<br><small>No new notices can be added for this sale after this date</small></span></li>
<li><span class="dot ok"></span><span><strong>{nice(stats['updated'])}</strong> · On the latest list<br><small>We check the county for postponements and cancellations</small></span></li>
<li><span class="dot later"></span><span><strong>{nice(sale, weekday=True)}</strong> · Scheduled sale · {e(r['window'] or '')}<br><small>{e(loc.split(',')[0])}</small></span></li>
</ol>
</div>

<div class="card">
<div class="h3">Property</div>
<div class="kv">
{kv('Address', f"{e(r['addr'])}<br>{e(r['city'])}, TX {e(r['zip'])}")}
{kv('Property type', kind(r))}
{kv('FEMA flood zone', e(r['zone'] or '—') + (' · high-risk area (SFHA)' if r['sfha'] else ' · outside the high-risk area'))}
{locked('Beds / baths', 'beds')}
{locked('Living area', 'sqft')}
{locked('Year built', 'year')}
{locked('Lot size', 'lot')}
{locked('Appraised value', 'appraised')}
{locked('School district', 'school')}
{locked('Owner-occupied (estimate)', 'occ')}
</div>
</div>

<div class="card">
<div class="h3">Loan and foreclosure</div>
<div class="kv">
{kv('Notice type', 'HOA lien (assessment)' if hoa else 'Mortgage (deed of trust)')}
{kv('Notice ID', e(r['id']), mono=True)}
{kv('Posted more than once', 'Yes' if r.get('repeat') else 'No')}
{kv('Sale window', e(r['window'] or '—'))}
{locked('Lender or HOA' if hoa else 'Current lender', 'lender')}
{locked('Servicer', 'servicer')}
{locked('Substitute trustee', 'trustee')}
{locked('Original loan', 'loan')}
{locked('Deed of trust date', 'dot')}
</div>
</div>

<div class="card unknown">
<div class="h3">What we don't know</div>
<ul>
<li>Interior condition, and whether anyone lives there now</li>
<li>Second liens, unpaid property taxes, HOA dues or IRS liens</li>
<li>Whether the lender will postpone, cancel or bid the debt</li>
<li>Title problems. Do your own title and lien research before bidding.</li>
</ul>
</div>
</div>

<aside class="p-side">
<div class="card">
<div class="h3">Research links</div>
<div class="rlinks" data-k="rlinks">{''.join(f'<a href="{e(u)}"' + (' download' if u.startswith('/notice/') else ' target="_blank" rel="noopener"') + f'><span>{e(t)}</span><small>{e(s)}</small></a>' for t, s, u in research if u)}</div>
</div>
<div class="card" data-k="tools">
<div class="h3"><span class="ico-lock"></span>Member tools</div>
<ul class="tools"><li>Max-bid calculator for this property</li><li>Watchlist with postponement and cancellation alerts</li><li>Your private notes</li><li>CSV and Excel export of the sale</li></ul>
<a class="btn btn-ghost" href="/pricing" style="width:100%">See membership</a>
</div>
</aside>
</div>

<section class="wrap sec">
<h2 class="disp" style="font-size:32px;margin:0 0 14px">Also at this sale, nearby</h2>
<div class="nearby">{near}</div>
<div class="pn">{pn}</div>
</section>
</div>
"""


def write_pages(site, sale, public, stats):
    out = os.path.join(site, "property")
    shutil.rmtree(out, ignore_errors=True)  # last sale's pages go away
    os.makedirs(out)
    located = [r for r in public if r["lat"] is not None]
    order = sorted(public, key=lambda r: (r["zip"], r["addr"]))
    for i, r in enumerate(order):
        nearby = sorted(((n, miles(r, n)) for n in located if n["id"] != r["id"]), key=lambda x: x[1])[:6] if r["lat"] is not None else []
        prev = order[i - 1] if i > 0 else None
        nxt = order[i + 1] if i + 1 < len(order) else None
        title = f"{r['addr']}, {r['city']} TX {r['zip']} · Foreclosure auction {nice(sale, year=True)} · First Tuesday List"
        desc = (f"{kind(r)} at {r['addr']}, {r['city']}, TX {r['zip']} goes to foreclosure auction on {nice(sale, weekday=True, year=True)}, "
                f"{r['window'] or ''}. Flood zone {r['zone'] or 'unknown'}. Aerial photo, Street View, map and the county notice.")
        page = PAGE.format(title=e(title), desc=e(desc), site=SITE_URL, id=e(r["id"]), photo=e(r["photo"] or "/assets/og.png"), sale=sale, starts=e(stats.get("starts", "")),
                           lat=r["lat"] or "", lon=r["lon"] or "", addr=e(f"{r['addr']}, {r['city']}, TX {r['zip']}"),
                           body=body(r, sale, stats, nearby, prev, nxt))
        with open(os.path.join(out, r["id"] + ".html"), "w", encoding="utf-8") as f:
            f.write(page)
    return len(order)


def write_sitemap(site, public, updated):
    """sitemap.xml for search engines: the main pages and this sale's property pages."""
    urls = [("/", "daily", "1.0"), ("/map", "daily", "0.9"), ("/pricing", "weekly", "0.8"),
            ("/privacy", "yearly", "0.2"), ("/terms", "yearly", "0.2")]
    urls += [(f"/property/{r['id']}", "daily", "0.6") for r in sorted(public, key=lambda r: r["id"])]
    body = "".join(f"<url><loc>{SITE_URL}{u}</loc><lastmod>{updated}</lastmod><changefreq>{c}</changefreq><priority>{pr}</priority></url>\n"
                   for u, c, pr in urls)
    with open(os.path.join(site, "sitemap.xml"), "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + body + "</urlset>\n")
    return len(urls)
