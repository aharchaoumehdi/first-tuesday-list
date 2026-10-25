"""The free spreadsheet that new subscribers get by email: site/free-list/.

Built from the same free-only rows as the website (build_site.py's `public`), so
member columns can't reach it. Two files per sale, CSV and Excel, plus stable
links that always point at the current sale:
  /free-list/latest.xlsx, /free-list/latest.csv   (site/_redirects)
The folder isn't linked from any page and is marked noindex (site/_headers): the
link is meant to travel in the beehiiv welcome email and the weekly issue.
"""
import csv
import glob
import os
from datetime import date
from urllib.parse import quote_plus

SITE_URL = "https://firsttuesdaylist.com"
TYPES = {"single_family": "Single family", "condo_townhome": "Condo / townhome", "multifamily": "Multifamily",
         "commercial": "Commercial", "vacant_land": "Vacant land"}
HEADER = ["Notice ID", "Address", "City", "ZIP", "Property type", "Sale date", "Sale time window", "Sale location",
          "Notice type", "FEMA flood zone", "High-risk flood area (SFHA)", "Posted more than once", "First seen",
          "Property page", "Notice PDF", "Google Maps"]
LINK_LABELS = {"Property page": "Photos and map", "Notice PDF": "Save PDF", "Google Maps": "Open map",
               "Appraisal (HCAD)": "HCAD record", "Tax statement": "Tax statement"}  # link columns show these words
LINK_COLS = set(LINK_LABELS)


def rows_for(sale, public):
    out = []
    for r in sorted(public, key=lambda r: (r["zip"], r["addr"])):
        maps = (f"https://www.google.com/maps/search/?api=1&query={r['lat']},{r['lon']}" if r["lat"] is not None
                else "https://www.google.com/maps/search/?api=1&query=" + quote_plus(f"{r['addr']}, {r['city']}, TX {r['zip']}"))
        out.append([r["id"], r["addr"], r["city"], r["zip"], TYPES.get(r["type"], "Other"), sale, r["window"] or "",
                    r["location"] or "", "HOA lien" if r["notice"] == "hoa" else "Mortgage foreclosure", r["zone"] or "",
                    "Yes" if r["sfha"] else "No", "Yes" if r.get("repeat") else "No", r["first"],
                    f"{SITE_URL}/property/{r['id']}", f"{SITE_URL}/notice/{r['id']}" if r["notice_url"] else "", maps])
    return out


def write_xlsx(path, rows, label_year, header=None, widths=None, title=None, subtitle=None, readme=None, money=()):
    """The Excel file in the site's look: logo banner, navy header, banded rows, colored flags, a Read me tab.
    Excel can't load web fonts, so Arial Narrow stands in for Barlow Condensed and Arial for Public Sans.
    The member spreadsheet (tools/member_data.py) passes its own header, widths, titles, Read me lines and money columns."""
    header = header or HEADER
    from openpyxl import Workbook
    from openpyxl.drawing.image import Image
    from openpyxl.formatting.rule import FormulaRule
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter
    navy, red, ink, muted, line, band = "13294B", "D2141C", "0E1A2B", "4A5568", "E2E7EF", "F4F6F9"
    fill = lambda c: PatternFill("solid", fgColor=c)
    cf_fill = lambda c: PatternFill("solid", start_color=c, end_color=c)  # conditional formats read the background color
    logo = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "site", "assets", "logo.png")

    def banner(ws, title, subtitle, last_col, at="C"):
        ws.sheet_view.showGridLines = False
        ws.row_dimensions[1].height, ws.row_dimensions[2].height, ws.row_dimensions[3].height = 40, 20, 4
        if os.path.exists(logo):
            from io import BytesIO
            from PIL import Image as PILImage
            small = BytesIO()
            PILImage.open(logo).resize((332, 80), PILImage.LANCZOS).save(small, "PNG", optimize=True)  # 2x for sharp screens
            img = Image(small)
            img.width, img.height = 166, 40
            ws.add_image(img, "A1")
        t, sub = ws[f"{at}1"], ws[f"{at}2"]
        t.value, sub.value = title, subtitle
        t.font, sub.font = Font(name="Arial Narrow", size=18, bold=True, color=navy), Font(name="Arial", size=10, color=muted)
        t.alignment, sub.alignment = Alignment(vertical="center"), Alignment(vertical="top")
        for col in range(1, last_col + 1):
            ws.cell(row=3, column=col).fill = fill(red)

    wb = Workbook()
    ws = wb.active
    ws.title = f"{label_year} sale"[:31]
    ws.sheet_properties.tabColor = navy
    banner(ws, title or f"HARRIS COUNTY FORECLOSURE AUCTION · {label_year.upper()}",
           subtitle or f"{len(rows)} properties · free list from First Tuesday List · built {date.today().isoformat()} · {SITE_URL}/map", len(header))
    top = 4  # the header row; rows 1-3 are the banner
    ws.append(header)
    for row in rows:
        ws.append(row)
    last = top + len(rows)
    for c in ws[top]:
        c.fill = fill(navy)
        c.font = Font(name="Arial Narrow", size=11, bold=True, color="FFFFFF")
        c.alignment = Alignment(vertical="center", wrap_text=True)
    ws.row_dimensions[top].height = 34
    edge = Border(bottom=Side(style="thin", color=line))
    body, idf = Font(name="Arial", size=10, color=ink), Font(name="Consolas", size=10, bold=True, color=navy)
    linkf = Font(name="Arial", size=10, color=navy, underline="single")
    for r in ws.iter_rows(min_row=top + 1, max_row=last):
        for c in r:
            c.font, c.border, c.alignment = body, edge, Alignment(vertical="center")
        r[0].font = idf
    widths = {"Notice ID": 16, "Address": 30, "City": 14, "ZIP": 8, "Property type": 17, "Sale date": 11, "Sale time window": 18,
              "Sale location": 50, "Notice type": 21, "FEMA flood zone": 10, "High-risk flood area (SFHA)": 12,
              "Posted more than once": 11, "First seen": 11, "Property page": 15, "Notice PDF": 12, "Google Maps": 12} | (widths or {})
    for i, h in enumerate(header, 1):
        ws.column_dimensions[get_column_letter(i)].width = widths.get(h, 14)
        if h in money:
            for cell in ws.iter_cols(min_col=i, max_col=i, min_row=top + 1):
                for c in cell:
                    c.number_format = '"$"#,##0'
                    c.font = Font(name="Consolas", size=10, color=ink)
        if h in LINK_COLS:
            for cell in ws.iter_cols(min_col=i, max_col=i, min_row=top + 1):
                for c in cell:
                    if c.value:
                        c.hyperlink, c.value, c.font = c.value, LINK_LABELS[h], linkf
    # banding and flags as rules, so they stay right when someone sorts or filters
    span = f"A{top + 1}:{get_column_letter(len(header))}{last}"
    ws.conditional_formatting.add(span, FormulaRule(formula=["MOD(ROW(),2)=0"], fill=cf_fill(band)))
    col = lambda name: get_column_letter(header.index(name) + 1)
    flags = [("High-risk flood area (SFHA)", '"Yes"', "FDECEC", "B0101A"), ("Notice type", '"HOA lien"', "FFF4DE", "8A5A00"),
             ("Posted more than once", '"Yes"', "E8EDF5", navy)]
    for name, value, bg, fg in flags:
        c = col(name)
        ws.conditional_formatting.add(f"{c}{top + 1}:{c}{last}", FormulaRule(formula=[f"{c}{top + 1}={value}"], fill=cf_fill(bg),
                                                                            font=Font(name="Arial", size=10, bold=True, color=fg)))
    ws.freeze_panes = f"C{top + 1}"
    ws.auto_filter.ref = f"A{top}:{get_column_letter(len(header))}{last}"
    ws.page_setup.orientation, ws.page_setup.fitToWidth, ws.page_setup.fitToHeight = "landscape", 1, 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_title_rows = f"{top}:{top}"
    ws.oddFooter.center.text = "First Tuesday List · firsttuesdaylist.com · Compiled from public records. Not verified."

    about = wb.create_sheet("Read me")
    about.sheet_properties.tabColor = red
    banner(about, "READ ME", f"First Tuesday List · Harris County foreclosure auction · {label_year}", 2, at="B")
    about.column_dimensions["A"].width, about.column_dimensions["B"].width = 26, 88
    about.page_setup.fitToWidth, about.page_setup.fitToHeight = 1, 0
    about.sheet_properties.pageSetUpPr.fitToPage = True
    heading = Font(name="Arial Narrow", size=13, bold=True, color=navy)
    text, small = Font(name="Arial", size=10, color=ink), Font(name="Arial", size=9, color=muted)
    lines = readme or [
        ("WHAT'S IN IT", heading, None),
        (f"{len(rows)} properties scheduled for the {label_year} sale, built {date.today().isoformat()} from notices filed with the "
         "Harris County Clerk. One row per property; filter by ZIP, type or flood zone with the arrows in the header.", text, None),
        ("", text, None),
        ("ON THE WEBSITE", heading, None),
        ("Every property has a page with aerial photos, Street View, the map and the county notice.", text, None),
        ("Open the map", linkf, f"{SITE_URL}/map"),
        ("", text, None),
        ("MEMBERS", heading, None),
        ("Members also get each property's value, loan, estimated balance and equity, and the lender.", text, None),
        ("See what members get", linkf, f"{SITE_URL}/pricing"),
        ("", text, None),
        ("Compiled from public records. Not verified. Do your own title and lien research before bidding.", Font(name="Arial", size=10, bold=True, color=red), None),
        ("First Tuesday List is not a law firm, title company, broker or auctioneer and does not give legal or investment advice.", small, None),
    ]
    # callers name the styles: heading, text, link, warn, small
    styles = {"heading": heading, "text": text, "link": linkf, "small": small, "warn": Font(name="Arial", size=10, bold=True, color=red)}
    lines = [(v, styles[f] if isinstance(f, str) else f, link) for v, f, link in lines]
    for n, (value, font, link) in enumerate(lines, 5):
        c = about.cell(row=n, column=2, value=value)
        c.font, c.alignment = font, Alignment(wrap_text=True, vertical="top")
        if link:
            c.hyperlink = link
    wb.save(path)


def write_free_list(site, sale, public, label_year):
    out = os.path.join(site, "free-list")
    os.makedirs(out, exist_ok=True)
    for old in glob.glob(os.path.join(out, "first-tuesday-list-*")):  # only the current sale is offered
        os.remove(old)
    base = f"first-tuesday-list-{sale}"
    rows = rows_for(sale, public)

    with open(os.path.join(out, base + ".csv"), "w", newline="", encoding="utf-8-sig") as f:  # BOM: Excel opens it as UTF-8
        w = csv.writer(f)
        w.writerow(HEADER)
        w.writerows(rows)

    write_xlsx(os.path.join(out, base + ".xlsx"), rows, label_year)

    # stable links for the emails, and keep the folder out of search engines
    with open(os.path.join(site, "_redirects"), "w", encoding="utf-8") as f:
        f.write(f"/free-list/latest.xlsx /free-list/{base}.xlsx 302\n/free-list/latest.csv /free-list/{base}.csv 302\n")
    with open(os.path.join(site, "_headers"), "w", encoding="utf-8") as f:
        f.write("/free-list/*\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-cache\n")
    return len(rows)
