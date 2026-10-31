"""Member data for a sale: never written under site/, never committed. The daily refresh builds it in the runner's
temp folder and uploads it to the site's private storage (Cloudflare KV, behind /api/member/...).

  python tools/member_data.py <sale> <data_tab.csv> <out_dir> [--upload]

Writes to <out_dir>:
  sale-<sale>.json                           member fields per property, for the map and the property pages
  first-tuesday-list-members-<sale>.csv/.xlsx  the member spreadsheet: every free column plus the numbers
Only properties the public site lists are included (site/data/sale-<sale>.json, so run build_site.py first), and only
the member columns of docs/free-paid-split.md: never lien_position_guess, risk_notes, or borrower and owner names.
Lenders, servicers and trustees that read like a private person's name are replaced with a label.

--upload sends the files to https://firsttuesdaylist.com/api/upload/<name> with the run's GitHub OIDC token (keyless:
the site checks the token comes from this repository's main branch). MEMBER_UPLOAD_URL overrides the address.
"""
import csv
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from free_list import SITE_URL, TYPES, write_xlsx  # noqa: E402

SITE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "site")
AUDIENCE = "firsttuesdaylist.com/upload"

# Estimated monthly rent: HUD's FY2027 Small Area Fair Market Rents (by ZIP and bedroom count) for the Houston metro.
# Refresh each October from https://www.huduser.gov/portal/datasets/fmr/smallarea/index.html (FY27_safmrs.xlsx).
RENT_TABLE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "hud_safmr_fy2027_houston.csv")
RENT_SOURCE = "HUD Small Area Fair Market Rent, FY2027"
RENT_TYPES = {"single_family", "condo_townhome"}  # a whole home with one rent; multifamily, land and commercial get none

# the same guard as the Research Brief (ftl-ops tools/research_brief.py): businesses keep their name, people don't
BUSINESS = re.compile(r"\b(inc|llc|l\.l\.c|lp|l\.p|llp|ltd|corp|corporation|company|co|n\.a|na|bank|bancorp|trust|trustee|"
                      r"mortgage|financial|finance|credit|union|association|assoc|fund|capital|services|servicing|lending|loans?|"
                      r"federal|national|homes|partners|group|investments?|holdings|properties|realty|equity|savings|fsb|cu|plc|"
                      r"department|secretary|housing|authority|county|city|state)\b", re.I)
STEMS = ("bank", "lend", "fund", "financ", "servic", "mortgage", "invest", "propert", "capital", "hud", "cooper", ".com",
         "law", "pllc", "firm", "network", "title", "legal", "&", "estate")
PERSON = re.compile(r"^(?:mr\.?|mrs\.?|ms\.?|dr\.?)?\s*[a-z][a-z'\-]+\.?(?:\s+[a-z]\.?)?(?:\s+[a-z][a-z'\-]+){1,3}"
                    r"(?:\s+(?:and|&)\s+[a-z][a-z'\-]+\.?(?:\s+[a-z]\.?)?(?:\s+[a-z][a-z'\-]+){0,3})?$", re.I)


def entity(name, person_label):
    name = (name or "").strip()
    if not name:
        return ""
    if BUSINESS.search(name) or any(s in name.lower() for s in STEMS) or "," in name or len(name.split()) == 1:
        return name
    return person_label if PERSON.match(name) else name


def num(v):
    try:
        return float(str(v).replace(",", "").replace("$", "")) if str(v).strip() else None
    except ValueError:
        return None


def whole(v):
    n = num(v)
    return None if n is None else round(n)


def yes(v):
    v = str(v).strip().lower()
    return True if v in ("yes", "true", "1") else False if v in ("no", "false", "0") else None


_rents = None


def hud_rent(zip_code, beds, ptype):
    """HUD fair market rent for a home with this many bedrooms in this ZIP, or None. Above 4 bedrooms HUD adds 15% of the
    4-bedroom rent per extra bedroom. Missing or zero bedrooms (HCAD often leaves them blank) get no estimate."""
    global _rents
    if _rents is None:
        _rents = {r["zip"]: [int(r[f"br{i}"]) for i in range(5)] for r in csv.DictReader(open(RENT_TABLE, encoding="utf-8"))}
    row = _rents.get((zip_code or "").strip()[:5])
    if ptype not in RENT_TYPES or not row or not beds or beds < 1:
        return None
    return row[beds] if beds <= 4 else int(round(row[4] * (1 + 0.15 * (beds - 4)), -1))


def member_row(r):
    value, equity = whole(r["market_value"]), whole(r["est_equity"])
    beds = whole(r["bedrooms"])
    rent = hud_rent(r["zip"], beds, r["property_type"])
    return {
        "rent": rent, "rent_beds": beds if rent else None,
        "rent_yield": round(rent * 12 / value, 3) if rent and value else None,
        "value": value, "appraised": whole(r["appraised_value"]), "loan": whole(r["original_loan_amount"]),
        "loan_status": r["loan_amount_status"] or None, "dot": r["deed_of_trust_date"] or None,
        "vtl": num(r["value_to_loan"]), "balance": whole(r["est_current_balance"]), "equity": equity,
        "share": round(equity / value, 3) if equity is not None and value else None,
        "beds": whole(r["bedrooms"]), "baths": whole(r["full_baths"]), "half": whole(r["half_baths"]),
        "sqft": whole(r["building_sqft"]), "year": whole(r["year_built"]), "lot": whole(r["lot_size"]),
        "school": (r["school_district"] or "").title().replace("Isd", "ISD") or None, "occ": yes(r["owner_occupied_guess"]),
        "hcad": r["hcad_account"] or None, "hcad_url": r["hcad_account_url"] or None, "tax_url": r["tax_statement_url"] or None,
        "lender": entity(r["current_mortgagee"], "Private individual lender") or None,
        "servicer": entity(r["mortgage_servicer"], "Private individual") or None,
        "trustee": entity(r["substitute_trustee_firm"], "Individual trustee (named on the notice)") or None,
        "legal": r["legal_description"] or None, "notes": r["notes"] or None, "conf": num(r["confidence"]),
    }


HEADER = ["Notice ID", "Address", "City", "ZIP", "Property type", "Sale date", "Sale time window", "Notice type",
          "FEMA flood zone", "High-risk flood area (SFHA)", "Posted more than once",
          "Market value", "Original loan", "Deed of trust date", "Value / loan", "Est. balance", "Est. equity", "Equity share",
          "Est. monthly rent (HUD)", "Gross rent yield",
          "Beds", "Full baths", "Half baths", "Living area (sq ft)", "Year built", "Lot (sq ft)", "Owner-occupied (estimate)",
          "School district", "Lender", "Servicer", "Substitute trustee", "HCAD account", "First seen",
          "Property page", "Notice PDF", "Appraisal (HCAD)", "Tax statement", "Confidence", "Notes", "Legal description"]
MONEY = {"Market value", "Original loan", "Est. balance", "Est. equity", "Est. monthly rent (HUD)"}
WIDTHS = {"Market value": 13, "Original loan": 13, "Est. balance": 13, "Est. equity": 13, "Equity share": 9, "Value / loan": 9, "Est. monthly rent (HUD)": 11, "Gross rent yield": 9,
          "Deed of trust date": 12, "Beds": 6, "Full baths": 6, "Half baths": 6, "Living area (sq ft)": 10, "Year built": 7,
          "Lot (sq ft)": 9, "Owner-occupied (estimate)": 11, "School district": 18, "Lender": 36, "Servicer": 30,
          "Substitute trustee": 30, "HCAD account": 16, "Appraisal (HCAD)": 13, "Tax statement": 13, "Confidence": 9,
          "Notes": 40, "Legal description": 50}
README = [
    ("WHAT'S IN IT", "heading", None),
    ("Every property scheduled for this sale, with the free columns plus the member numbers: value, original loan, estimated "
     "balance and equity, lender, servicer and trustee, and the building facts. Sorted by estimated equity, highest first; "
     "use the arrows in the header to filter and sort.", "text", None),
    ("", "text", None),
    ("HOW WE ESTIMATE", "heading", None),
    ("Market value is the 2026 Harris County Appraisal District value. Original loan and deed of trust date come from the "
     "notice and county records. Estimated balance assumes the loan was paid as scheduled at the average 30-year rate of its "
     "year (Freddie Mac survey); estimated equity is value minus that balance. Second liens, unpaid taxes, HOA dues and "
     "missed payments aren't in it: the opening bid can be close to the full debt. Ask the trustee.", "text", None),
    ("Estimated monthly rent is HUD's Small Area Fair Market Rent (FY2027) for the property's ZIP code and bedroom count: "
     "a typical rent for a modest home there, utilities included, not a quote. Single-family homes, condos and townhomes "
     "only, when the bedroom count is known. Gross rent yield is a year of that rent divided by the market value, before "
     "taxes, insurance, repairs and vacancy.", "text", None),
    ("", "text", None),
    ("FOR MEMBERS ONLY", "heading", None),
    ("This file is licensed to you as a member. Please don't share or resell it (Terms of Use).", "text", None),
    ("Member home", "link", f"{SITE_URL}/members"),
    ("", "text", None),
    ("Compiled from public records. Not verified. Do your own title and lien research before bidding.", "warn", None),
    ("First Tuesday List is not a law firm, title company, broker or auctioneer and does not give legal or investment advice.", "small", None),
]


def sheet_rows(sale, public, members):
    def eq(p):
        e = members[p["id"]]["equity"]
        return -(e if e is not None else -1e12)
    out = []
    for p in sorted(public, key=lambda p: (eq(p), p["zip"], p["addr"])):
        m = members[p["id"]]
        out.append([p["id"], p["addr"], p["city"], p["zip"], TYPES.get(p["type"], "Other"), sale, p["window"] or "",
                    "HOA lien" if p["notice"] == "hoa" else "Mortgage foreclosure", p["zone"] or "",
                    "Yes" if p["sfha"] else "No", "Yes" if p.get("repeat") else "No",
                    m["value"], m["loan"], m["dot"] or "", m["vtl"], m["balance"], m["equity"],
                    f"{m['share']:.0%}" if m["share"] is not None else "",
                    m["rent"], f"{m['rent_yield']:.1%}" if m["rent_yield"] is not None else "",
                    m["beds"], m["baths"], m["half"], m["sqft"], m["year"], m["lot"],
                    {True: "Yes", False: "No"}.get(m["occ"], ""), m["school"] or "", m["lender"] or "", m["servicer"] or "",
                    m["trustee"] or "", m["hcad"] or "", p["first"],
                    f"{SITE_URL}/property/{p['id']}", f"{SITE_URL}/notice/{p['id']}" if p["notice_url"] else "",
                    m["hcad_url"] or "", m["tax_url"] or "", m["conf"], m["notes"] or "", m["legal"] or ""])
    return out


def build(sale, data_csv, out):
    public = json.load(open(os.path.join(SITE, "data", f"sale-{sale}.json"), encoding="utf-8"))["rows"]
    source = {r["doc_id"]: r for r in csv.DictReader(open(data_csv, encoding="utf-8")) if r["sale_date"] == sale}
    members = {p["id"]: member_row(source[p["id"]]) for p in public if p["id"] in source}
    public = [p for p in public if p["id"] in members]
    os.makedirs(out, exist_ok=True)
    stats = json.load(open(os.path.join(SITE, "data", f"stats-{sale}.json"), encoding="utf-8"))
    files = {f"sale-{sale}.json": None}
    with open(os.path.join(out, f"sale-{sale}.json"), "w", encoding="utf-8") as f:
        json.dump({"sale": sale, "updated": stats["updated"], "built": date.today().isoformat(), "rows": members}, f, separators=(",", ":"))
    rows = sheet_rows(sale, public, members)
    base = f"first-tuesday-list-members-{sale}"
    with open(os.path.join(out, base + ".csv"), "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(HEADER)
        w.writerows(rows)
    d = date.fromisoformat(sale)
    label_year = d.strftime("%b ") + str(d.day) + d.strftime(", %Y")
    write_xlsx(os.path.join(out, base + ".xlsx"), rows, label_year, header=HEADER, widths=WIDTHS, money=MONEY, readme=README,
               title=f"MEMBER LIST · HARRIS COUNTY FORECLOSURE AUCTION · {label_year.upper()}",
               subtitle=f"{len(rows)} properties · for First Tuesday List members only, please don't share · built {date.today().isoformat()}")
    files[base + ".csv"], files[base + ".xlsx"] = "csv", "xlsx"
    print(f"member data for {len(members)} properties ({sum(1 for m in members.values() if m['equity'] is not None)} with equity, "
          f"{sum(1 for m in members.values() if m['rent'] is not None)} with rent) in {out}")
    return files


def github_token():
    url, bearer = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL"), os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN")
    if not url:
        sys.exit("--upload runs only in GitHub Actions with `permissions: id-token: write`")
    req = urllib.request.Request(url + "&audience=" + AUDIENCE, headers={"Authorization": "Bearer " + bearer})
    return json.load(urllib.request.urlopen(req))["value"]


def upload(out, files, current=True):
    base = os.environ.get("MEMBER_UPLOAD_URL", SITE_URL).rstrip("/")
    tok = github_token()
    for name, latest in files.items():
        headers = {"Authorization": "Bearer " + tok, "Content-Type": "application/octet-stream", "User-Agent": "ftl-refresh"}
        if latest:
            headers["X-Latest"] = latest
        elif current:
            headers["X-Current"] = "1"
        req = urllib.request.Request(f"{base}/api/upload/{name}", data=open(os.path.join(out, name), "rb").read(), method="PUT", headers=headers)
        try:
            print(json.load(urllib.request.urlopen(req)))
        except urllib.error.HTTPError as e:
            # until membership is set up in Cloudflare (functions deployed, KV bound) there's nowhere to put it
            if e.code in (404, 405, 503):
                print(f"member storage not set up yet ({e.code}): skipped {name}")
                return
            raise


if __name__ == "__main__":
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    made = build(*sys.argv[1:4])
    if "--upload" in sys.argv:
        upload(sys.argv[3], made)
