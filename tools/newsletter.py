"""This week's First Tuesday Brief, filled in from the site's free data: site/free-list/brief.html.

The Publisher starts from it every Wednesday: numbers, four example properties, photos, ZIP
codes and the sale-day checklist come from the same rows as the website and the free
spreadsheet, so the email can't drift from the site. Only the "what changed" lines need the
bots' postponement and cancellation data (see the EDIT note in tools/assets/brief_template.html).
"""
import html
import os
from collections import Counter
from datetime import date, timedelta

SITE_URL = "https://firsttuesdaylist.com"
TEMPLATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "brief_template.html")
PICK_TYPES = [("single_family", "Single family"), ("condo_townhome", "Condo / townhome"),
              ("multifamily", "Multifamily"), ("commercial", "Commercial")]
TYPES = dict(PICK_TYPES) | {"vacant_land": "Vacant land"}
OSWALD = "font-family:Oswald,'Arial Narrow',Arial,sans-serif"
e = html.escape


def md(d):
    return d.strftime("%b ") + str(d.day)


def tile(number, label, warm=False):
    bg, fg = ("#FFF1F1", "#D2141C") if warm else ("#F4F6F9", "#13294B")
    return (f'<td width="25%" style="background:{bg};border-radius:10px;padding:12px;text-align:center">'
            f'<div style="{OSWALD};font-size:28px;color:{fg};font-weight:700">{number}</div>'
            f'<div style="font-size:12px;color:#4A5568">{label}</div></td>')


def pick_four(public):
    """One property per type: the newest notices outside the high-risk flood zone, with a photo."""
    ok = [r for r in public if r["photo"] and not r["sfha"]]
    newest = lambda rs: sorted(rs, key=lambda r: (r["first"], r["zip"], r["addr"]), reverse=True)
    picks = []
    for t, _ in PICK_TYPES:
        c = newest([r for r in ok if r["type"] == t and r not in picks])
        if not c:  # no such type this sale: vacant land, then another single family
            c = newest([r for r in ok if r["type"] in ("vacant_land", "single_family") and r not in picks])
        if c:
            picks.append(c[0])
    return picks


def card(r, left):
    pad = "0 6px 12px 0" if left else "0 0 12px 6px"
    return (f'<td width="50%" valign="top" style="padding:{pad}">'
            f'<a href="{SITE_URL}/property/{e(r["id"])}" style="text-decoration:none;color:#1F2A3C">'
            f'<img src="{SITE_URL}{e(r["photo"])}" width="258" alt="Aerial photo of {e(r["addr"])}" '
            f'style="display:block;width:100%;height:150px;object-fit:cover;border-radius:10px">'
            f'<div style="font-weight:700;font-size:15px;margin-top:8px">{e(r["addr"])}</div>'
            f'<div style="font-size:13px;color:#4A5568">{e(r["city"])} {e(r["zip"])} · {TYPES.get(r["type"], "Other")} · Flood zone {e(r["zone"] or "—")}</div>'
            f'<div style="font-size:13px;font-weight:700;color:#13294B;margin-top:4px">Photos, map and notice →</div></a></td>')


def write_brief(site, sale, public, stats, info, today):
    sale_d = date.fromisoformat(sale)
    issue = today + timedelta(days=(2 - today.weekday()) % 7)  # this coming Wednesday (today if Wednesday)
    days_out = (sale_d - issue).days
    total = len(public)
    open_ = issue <= date.fromisoformat(info["deadline"])
    new_week = [r for r in public if r["first"] > (issue - timedelta(days=7)).isoformat()]

    if days_out < 0:
        headline = f"{info['next_label']} list is building"
        lede = (f"The {info['label']} sale is over. Notices for the {info['next_label']} sale are being filed now; "
                f"the spreadsheet and map switch to them as soon as the first list is ready.")
    elif open_:
        headline = f"{info['label']} list: {total} properties so far"
        lede = (f"{total} Harris County properties are scheduled for the {info['label']} sale so far. Notices can be filed "
                f"until {info['deadline_label']}, so the list is still growing. Here's what's new and four properties to start with.")
    else:
        when = "Tuesday's" if days_out <= 7 else f"the {info['label']}"
        headline = f"{info['label']} auction: {days_out} day{'s' if days_out != 1 else ''} out"
        lede = (f"{total} Harris County properties are scheduled for {when} sale. The list is final: filing closed "
                f"{info['deadline_label']}. Here's what changed this week, four properties to start with"
                + (", and your sale-day checklist." if days_out <= 14 else "."))
    subject = headline[0] + headline[1:]
    preview = (f"{total} properties go to auction {'Tuesday' if 0 <= days_out <= 7 else info['label']}. "
               f"What changed, four to start with" + (", and your sale-day checklist." if 0 <= days_out <= 14 else "."))

    stats_html = (tile(total, "on the list")
                  + '<td width="4"></td>'
                  + (tile(len(new_week), "new this week", warm=True) if open_ else tile("—", "postponed or cancelled", warm=True))
                  + '<td width="4"></td>' + tile(stats["sfha"], "in a FEMA high-risk flood zone")
                  + '<td width="4"></td>' + tile(stats["hoa"], "HOA lien sales"))

    li = lambda label, text: f"<li><strong>{label}</strong> {text}</li>"
    if open_:
        links = ", ".join(f'<a href="{SITE_URL}/property/{e(r["id"])}" style="color:#13294B">{e(r["addr"])}</a>'
                          for r in sorted(new_week, key=lambda r: r["first"], reverse=True)[:5])
        changes = li("New filings:", f"{len(new_week)} this week" + (f", including {links}." if links else "."))
    else:
        changes = li("New filings:", f"none. The {info['label']} list closed {info['deadline_label']}.")
    changes += li("Postponed and cancelled:", "we'll report them here as they're posted.")

    picks = pick_four(public)
    rows = "".join("<tr>" + card(picks[i], True) + (card(picks[i + 1], False) if i + 1 < len(picks) else "<td></td>") + "</tr>"
                   for i in range(0, len(picks), 2))

    zips = Counter((r["zip"], r["city"]) for r in public).most_common(5)
    zip_rows = "".join(
        f'<tr><td style="padding:6px 0;border-bottom:1px solid #EEF1F6"><a href="{SITE_URL}/map?q={e(z)}" style="font-weight:700;color:#13294B">{e(z)}</a> {e(c)}</td>'
        f'<td align="right" style="border-bottom:1px solid #EEF1F6">{n}</td></tr>' for (z, c), n in zips)

    checklist = ""
    if 0 <= days_out <= 14:
        row = lambda k, v: (f'<tr><td width="90" valign="top" style="font-weight:700;color:#13294B;padding:4px 0">{k}</td>'
                            f'<td style="padding:4px 0">{v}</td></tr>')
        checklist = (f'\n  <tr><td style="padding:26px 36px 0 36px">\n    <h2 style="margin:0 0 10px 0;{OSWALD};font-size:22px;color:#13294B;text-transform:uppercase">Sale-day checklist</h2>\n'
                     f'    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;line-height:1.6">'
                     + row("When", f"{sale_d.strftime('%A')}, {md(sale_d)}, most sales {e(info['window'])}")
                     + row("Where", e(", ".join(p for p in (info["place"], info["street"]) if p)))
                     + row("Bring", "Certified funds. Texas trustee sales are generally paid at the sale; confirm the terms with the trustee named on each notice.")
                     + row("Check", "Status that morning. Many sales are postponed or cancelled at the last minute.")
                     + "</table>\n  </td></tr>\n")

    # the fill-in sheet for the beehiiv template "First Tuesday Brief (weekly)": one line per [PLACEHOLDER]
    stat2 = f"{len(new_week)} new this week" if open_ else "— postponed or cancelled (fill in when known)"
    fill = [f"FIRST TUESDAY BRIEF — fill-in sheet for Wednesday {issue.isoformat()} ({info['label_year']} sale)",
            f"Built {today.isoformat()} from the site's data. In beehiiv: Posts > Template library > First Tuesday Brief (weekly) >",
            "Use template. Replace each [PLACEHOLDER] with the value below (keep the formatting), then save as a DRAFT. Never send.", "",
            f"[SUBJECT]                  {subject}",
            f"[PREVIEW TEXT]             {preview}",
            f"[ISSUE DATE]               {md(issue).upper()}",
            f"[HEADLINE]                 {headline.upper()}",
            f"[LEDE]                     {lede}",
            f"[ON THE LIST]              {total}",
            f"[POSTPONED OR NEW]         {stat2}",
            f"[FLOOD]                    {stats['sfha']}",
            f"[HOA]                      {stats['hoa']}",
            "[NEW FILINGS]               " + (f"{len(new_week)} this week: " + "; ".join(f"{r['addr']} ({SITE_URL}/property/{r['id']})" for r in sorted(new_week, key=lambda r: r['first'], reverse=True)[:5])
                                             if open_ else f"none. The {info['label']} list closed {info['deadline_label']}."),
            "[POSTPONED AND CANCELLED]   EDIT: this week's counts and up to 5 property links each. No data? Write: we'll report them here as they're posted. Never guess.", ""]
    for n, r in enumerate(picks, 1):
        fill += [f"[PICK {n} PHOTO]              replace the image (click it > Replace > Upload from URL): {SITE_URL}{r['photo']}",
                 f"[PICK {n} ADDRESS]            {r['addr']}",
                 f"[PICK {n} CITY ZIP · TYPE · FLOOD ZONE]  {r['city']} {r['zip']} · {TYPES.get(r['type'], 'Other')} · Flood zone {r['zone'] or '—'}",
                 f"[PICK {n} ID] (in the link)   {r['id']}   → link becomes {SITE_URL}/property/{r['id']}", ""]
    for n, ((z, c), cnt) in enumerate(zips, 1):
        fill.append(f"[ZIP {n}] [CITY {n}] [COUNT {n}]   {z} · {c} · {cnt}   (ZIP link: {SITE_URL}/map?q={z})")
    fill.append("")
    if checklist:
        fill += [f"[SALE DAY AND WINDOW]       {sale_d.strftime('%A')}, {md(sale_d)}, most sales {info['window']}",
                 f"[SALE LOCATION]             {', '.join(p for p in (info['place'], info['street']) if p)}"]
    else:
        fill.append("SALE-DAY CHECKLIST          more than 2 weeks before the sale: delete the checklist heading and its 4 lines this week.")
    fill += ["", "Before handing it to the CEO: every link opens, all 4 photos show, the numbers match this sheet, subject and",
             "preview text are set. Log the draft name in ops_log."]
    out = os.path.join(site, "free-list")
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "brief-fill.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(fill) + "\n")

    page = open(TEMPLATE, encoding="utf-8").read()
    for k, v in {"SUBJECT": e(subject), "PREVIEW": e(preview), "ISSUE_DAY": f"Wednesday, {md(issue)}", "HEADLINE": e(headline),
                 "LEDE": e(lede), "STATS": stats_html, "CHANGES": changes, "PICKS": rows, "ZIPS": zip_rows,
                 "CHECKLIST": checklist, "GENERATED": f"{today.isoformat()} for the {info['label_year']} sale"}.items():
        page = page.replace("{{" + k + "}}", v)
    assert "{{" not in page, "unfilled slot in the brief template"
    out = os.path.join(site, "free-list")
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "brief.html"), "w", encoding="utf-8") as f:
        f.write(page)
    return issue, len(picks)
