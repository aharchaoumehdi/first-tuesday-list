"""Check that no member value from the source sheet reached the public site.

Every column of the data tab that isn't a free column (docs/free-paid-split.md)
is member data: values, loan, balance, equity, lender, servicer, trustee,
legal description, notes, building facts, HCAD account and any column the
bots add later (borrower names, lien_position_guess, risk_notes...). This
scans every text file under site/ for those values:
- text values (lenders, notes, URLs...): anywhere on the site; categories
  (school district, loan status...): on that property's page
- numbers and dates (values, loans, sq ft, deed dates...): on that property's
  page and in its row of the sale JSON, where a match would mean a leak
- member column names anywhere, and the keys of every public JSON file
Values that also occur in the free data (an address number equal to a
year built, say) can't be told apart from it and are skipped.

Usage: python check_public.py <data_tab.csv> <sale-date>
Exits 1 on any finding. The daily job runs it before committing.
"""
import csv
import json
import os
import re
import sys

SITE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "site")
FREE_COLUMNS = {"doc_id", "property_address", "zip", "property_type", "notice_type", "first_seen", "sale_date", "sale_time_window",
                "sale_location", "fema_flood_zone", "in_special_flood_hazard_area", "notice_pdf_url", "repeat_posting"}
ROW_KEYS = {"id", "addr", "city", "zip", "lat", "lon", "photo", "type", "notice", "first", "window", "location", "zone", "sfha", "notice_url", "repeat"}
STATS_KEYS = {"sale", "updated", "total", "new_this_week", "new_since", "sfha", "hoa", "types", "zips", "total_value_m", "median_value",
              "equity_known", "equity_100k_plus", "equity_buckets", "starts", "deadline"}
CURRENT_KEYS = {"current_sale", "label", "label_day", "label_year", "starts", "deadline", "deadline_label", "next_label", "total", "updated"}
ALWAYS_MEMBER = {"lien_position_guess", "risk_notes", "borrower", "borrower_name", "borrower_names", "owner", "owner_name"}
TEXT_EXT = (".html", ".js", ".json", ".svg", ".css", ".txt", ".xml")
NUM = re.compile(r"^\$?-?[\d,]+(\.\d+)?%?$")
# placeholder words a bot writes when it doesn't know (sale_status "unknown"): they say nothing about a property,
# and the pages use the same words for free fields ("Flood zone unknown")
GENERIC = {"unknown", "not_stated", "not stated", "none", "n/a", "pending", "unverified", "not_found", "not found", "missing"}
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$|^\d{1,2}/\d{1,2}/\d{2,4}$")


FREE_LIST_HEADER = ["Notice ID", "Address", "City", "ZIP", "Property type", "Sale date", "Sale time window", "Sale location",
                    "Notice type", "FEMA flood zone", "High-risk flood area (SFHA)", "Posted more than once", "First seen",
                    "Property page", "Notice PDF", "Google Maps"]


def xlsx_text(path):
    from openpyxl import load_workbook
    wb = load_workbook(path)
    lines = []
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            lines.append(",".join("" if c.value is None else str(c.value) for c in row)
                         + "".join("," + c.hyperlink.target for c in row if c.hyperlink and c.hyperlink.target))
    return "\n".join(lines)


def site_files():
    out = {}
    for dirpath, _, names in os.walk(SITE):
        for n in names:
            p = os.path.join(dirpath, n)
            rel = os.path.relpath(p, SITE).replace(os.sep, "/")
            if rel.startswith("free-list/") and n.lower().endswith(".csv"):
                out[rel] = open(p, encoding="utf-8-sig", errors="replace").read()
            elif rel.startswith("free-list/") and n.lower().endswith(".xlsx"):
                out[rel] = xlsx_text(p)  # every cell and hyperlink, scanned like any page
            elif n.lower().endswith((".csv", ".tsv", ".xlsx", ".xls")):
                out[rel] = None  # outside free-list/, a spreadsheet has no business in site/
            elif n.endswith(TEXT_EXT) and rel != "config.js":
                out[rel] = open(p, encoding="utf-8", errors="replace").read()
    return out


def main(data_csv, sale):
    rows = [r for r in csv.DictReader(open(data_csv, encoding="utf-8")) if r.get("sale_date") == sale]
    header = list(rows[0])
    member = [c for c in header if c not in FREE_COLUMNS]
    files = site_files()
    problems = [f"spreadsheet file in site/: {p}" for p, t in files.items() if t is None]
    files = {p: t for p, t in files.items() if t is not None}

    # public JSON keys
    data = json.loads(files[f"data/sale-{sale}.json"])
    for r in data["rows"]:
        extra = set(r) - ROW_KEYS
        if extra:
            problems.append(f"data/sale-{sale}.json row {r['id']}: non-free keys {sorted(extra)}")
    for name, allowed in ((f"data/stats-{sale}.json", STATS_KEYS), ("data/current.json", CURRENT_KEYS)):
        extra = set(json.loads(files[name])) - allowed
        if extra:
            problems.append(f"{name}: unexpected keys {sorted(extra)}")
    for k, v in json.loads(files["data/notices.json"]).items():
        if set(v) - {"u", "f"}:
            problems.append(f"data/notices.json {k}: unexpected keys {sorted(set(v) - {'u', 'f'})}")

    # member column names anywhere (as JSON keys or text)
    for col in sorted(set(member) | ALWAYS_MEMBER):
        if len(col) < 6:
            continue
        for p, t in files.items():
            if re.search(rf"\b{re.escape(col)}\b", t):
                problems.append(f"{p}: mentions member column name {col!r}")

    # the free spreadsheet: exactly the free columns, one row per property, and each row is checked like a property page
    free_rows = {}
    for p in [p for p in files if p.startswith("free-list/") and p.endswith(".csv")]:
        table = list(csv.reader(files[p].splitlines()))
        if table[0] != FREE_LIST_HEADER:
            problems.append(f"{p}: columns {table[0]} are not the free-list columns")
        free_rows.update({row[0]: ",".join(row) for row in table[1:] if row})
    for p in [p for p in files if p.startswith("free-list/") and p.endswith(".xlsx")]:
        for line in files[p].splitlines():
            key = line.split(",", 1)[0]
            free_rows[key] = free_rows.get(key, "") + "\n" + line
    by_id = {r["id"]: r for r in data["rows"]}
    row_text = {i: json.dumps(r) for i, r in by_id.items()}
    free_text = json.dumps(data["rows"]).lower()
    free_tokens = set(re.findall(r"[\w.,/-]+", free_text)) | set(re.findall(r"\d+", free_text))
    corpus = "\n".join(files.values()).lower()
    distinct = {c: len({r[c].strip() for r in rows}) for c in member}

    checked, skipped, seen_text = {c: 0 for c in member}, 0, set()
    for r in rows:
        page = files.get(f"property/{r['doc_id']}.html", "")
        for c in member:
            v = (r.get(c) or "").strip()
            if not v or v.lower() in GENERIC:
                continue
            if NUM.match(v) or DATE.match(v):
                if NUM.match(v):
                    digits = v.replace("$", "").replace(",", "").replace("%", "").lstrip("-").split(".")[0]
                    if len(digits) < 4:
                        continue
                    forms = {digits, f"{int(digits):,}"}
                else:
                    forms = {v}
                if any(f.lower() in free_tokens for f in forms):
                    skipped += 1
                    continue
                checked[c] += 1
                for f in forms:
                    pat = re.compile(rf"(?<![\d.,]){re.escape(f)}(?![\d])")
                    for where, text in ((f"property/{r['doc_id']}.html", page), (f"data/sale-{sale}.json row {r['doc_id']}", row_text.get(r["doc_id"], "")),
                                        (f"free-list row {r['doc_id']}", free_rows.get(r["doc_id"], ""))):
                        if pat.search(text):
                            problems.append(f"{where}: {c} value {f!r}")
            elif len(v) >= 6 and distinct[c] <= 40:  # a category (school district, loan status): only on its own property it says something
                if v.lower() in row_text.get(r["doc_id"], "").lower() + page.lower() + free_rows.get(r["doc_id"], "").lower() and v.lower() not in json.dumps(by_id.get(r["doc_id"], {})).lower():
                    problems.append(f"property/{r['doc_id']}.html: {c} value {v!r}")
                checked[c] += 1
            elif len(v) >= 6:
                key = v.lower()
                if key in seen_text:
                    continue
                seen_text.add(key)
                if key in free_text:
                    skipped += 1
                    continue
                checked[c] += 1
                if key in corpus:
                    where = next(p for p, t in files.items() if key in t.lower())
                    problems.append(f"{where}: {c} value {v[:60]!r}")

    print(f"{len(rows)} rows, {len(member)} member columns, {len(files)} site files scanned")
    print("values checked per column:", {c: n for c, n in checked.items() if n})
    print("member columns with no checkable values (empty or too short, covered by the key checks):",
          sorted(c for c, n in checked.items() if not n))
    print(f"skipped {skipped} values that also occur in the free data")
    if problems:
        print(f"\nFOUND {len(problems)} PROBLEMS:")
        for p in problems[:200]:
            print(" ", p)
        sys.exit(1)
    print("OK: no member values in site/")


if __name__ == "__main__":
    main(*sys.argv[1:3])
