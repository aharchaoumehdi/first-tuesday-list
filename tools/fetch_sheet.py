"""Export the newest issue sheet's data tab for the current sale to a CSV.

Runs in the daily GitHub Actions job. The sheet holds member-only columns
(values, loan, balance, equity, lender), so the CSV goes to a folder outside
the repo (the runner's temp folder) and is never committed; build_site.py
keeps only the free columns.

Access: the read-only service account ftl-site-refresh (scope drive.readonly),
which the Ops issues/ folder is shared with. No key exists: the GitHub job
signs in through Workload Identity Federation (see README), so there is no
secret to store or leak.

Which file: any sheet named sale-..._issue-..._v<N>_<rows> anywhere under Ops/issues/
(FILING.md files them in issues/sale-YYYY-MM-DD/issue-YYYY-MM-DD/). The sale is the earliest one that hasn't
happened yet (Central time) and has an issue sheet; if none has, the latest
sale with one. Within it, the newest issue folder, then the highest v.
Files in _superseded/ are never read. SALE=YYYY-MM-DD picks the sale by hand.

Usage: python fetch_sheet.py <out_dir>
Prints sale=..., csv=..., name=... lines (for $GITHUB_OUTPUT).
Env: GOOGLE_APPLICATION_CREDENTIALS (set by the auth step), DRIVE_ISSUES_FOLDER_ID, SALE,
     MIN_KEEP (default 0.7: refuse a sheet with fewer rows than 70% of the
     list already on the site for the same sale).
"""
import csv
import io
import json
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone

ISSUES_FOLDER = "1kf5nT4iqpntPjaxPmfC8GLjkBODdgI3X"  # First Tuesday List Ops/issues
SITE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "site")
DRIVE = "https://www.googleapis.com/drive/v3/files"
SHEETS = "https://sheets.googleapis.com/v4/spreadsheets"
SHEET_MIME = "application/vnd.google-apps.spreadsheet"
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
FOLDER_MIME = "application/vnd.google-apps.folder"
# FILING.md names issues ..._v<N>_<rows>; files made before it was written use ..._<rows>_v<N>. Accept both.
ISSUE_RE = re.compile(r"^sale-(\d{4}-\d{2}-\d{2})_issue-(\d{4}-\d{2}-\d{2})_(?:v(\d+)_(\d+)|(\d+)_v(\d+))(\.xlsx)?$")


def version_rows(m):
    """(version, rows) from an ISSUE_RE match, whichever order the name uses."""
    return int(m.group(3) or m.group(6)), int(m.group(4) or m.group(5))
# the columns build_site.py and fetch_aerials.py read
NEEDED = {"doc_id", "property_address", "zip", "property_type", "notice_type", "first_seen", "sale_date", "sale_time_window",
          "sale_location", "fema_flood_zone", "in_special_flood_hazard_area", "notice_pdf_url", "repeat_posting", "hcad_account",
          "market_value", "est_equity"}


def central_today():
    """Today's date in Houston (US Central, with daylight saving time)."""
    now = datetime.now(timezone.utc)
    y = now.year
    # DST: second Sunday of March 2:00 to first Sunday of November 2:00 local
    mar = date(y, 3, 8 + (6 - date(y, 3, 8).weekday()) % 7)
    nov = date(y, 11, 1 + (6 - date(y, 11, 1).weekday()) % 7)
    start = datetime(y, mar.month, mar.day, 8, tzinfo=timezone.utc)
    end = datetime(y, nov.month, nov.day, 7, tzinfo=timezone.utc)
    return (now - timedelta(hours=5 if start <= now < end else 6)).date()


def session():
    # Keyless: in GitHub Actions, google-github-actions/auth trades the run's OIDC token for short-lived
    # credentials of the ftl-site-refresh service account (Workload Identity Federation) and points
    # GOOGLE_APPLICATION_CREDENTIALS at them. Locally, `gcloud auth application-default login` works too.
    import google.auth
    from google.auth.transport.requests import AuthorizedSession
    creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/drive.readonly"])
    return AuthorizedSession(creds)


def children(s, folder):
    out, token = [], None
    while True:
        r = s.get(DRIVE, params={"q": f"'{folder}' in parents and trashed = false", "pageSize": 1000, "pageToken": token,
                                 "fields": "nextPageToken, files(id, name, mimeType, modifiedTime)", "corpora": "allDrives",
                                 "supportsAllDrives": "true", "includeItemsFromAllDrives": "true"})
        r.raise_for_status()
        d = r.json()
        out += d.get("files", [])
        token = d.get("nextPageToken")
        if not token:
            return out


SKIP_FOLDERS = re.compile(r"^(_superseded|_archive|internal|to_delete)$", re.I)


def issue_files(s, root, depth=4):
    """Every issue sheet under root, wherever the Publisher filed it (FILING.md plans
    issues/sale-YYYY-MM-DD/issue-YYYY-MM-DD/, but older issues sit elsewhere). Skips
    _superseded/, _archive/ and internal/. Also returns what it saw, for the error message."""
    found, seen, stack = [], {"folders": [], "items": 0}, [(root, 0, "issues")]
    while stack:
        fid, d, path = stack.pop()
        for f in children(s, fid):
            seen["items"] += 1
            if f["mimeType"] == FOLDER_MIME:
                if SKIP_FOLDERS.match(f["name"]) or d >= depth:
                    continue
                seen["folders"].append(f"{path}/{f['name']}")
                stack.append((f["id"], d + 1, f"{path}/{f['name']}"))
            elif f["mimeType"] in (SHEET_MIME, XLSX_MIME):
                m = ISSUE_RE.match(f["name"])
                if m:
                    v, rows = version_rows(m)
                    # newest issue date, then highest v, then a native Sheet over an .xlsx copy
                    found.append((m.group(1), (m.group(2), v, f["mimeType"] == SHEET_MIME, rows, f)))
    return found, seen


def diagnose(s, folder):
    """Who Drive thinks we are, and whether the folder itself is visible (no file contents)."""
    out = []
    r = s.get("https://www.googleapis.com/drive/v3/about", params={"fields": "user(emailAddress)"})
    out.append(f"Signed in as {r.json().get('user', {}).get('emailAddress') if r.ok else 'unknown (' + str(r.status_code) + ')'}.")
    r = s.get(f"{DRIVE}/{folder}", params={"fields": "name, mimeType, driveId, capabilities(canListChildren)", "supportsAllDrives": "true"})
    if r.ok:
        d = r.json()
        out.append(f"Folder visible: {d.get('name')!r}, shared drive: {'yes' if d.get('driveId') else 'no'}, "
                   f"can list: {d.get('capabilities', {}).get('canListChildren')}.")
    else:
        out.append(f"Folder not visible ({r.status_code}).")
    r = s.get(DRIVE, params={"q": "name contains 'sale-' and trashed = false", "pageSize": 5, "fields": "files(name)",
                             "corpora": "allDrives", "supportsAllDrives": "true", "includeItemsFromAllDrives": "true"})
    out.append(f"Files named sale-* visible anywhere: {len(r.json().get('files', [])) if r.ok else 'error ' + str(r.status_code)}.")
    return " ".join(out)


def pick(s, wanted=None):
    found, seen = issue_files(s, os.environ.get("DRIVE_ISSUES_FOLDER_ID") or ISSUES_FOLDER)
    best = {}
    for sale, key in found:
        if sale not in best or key[:3] > best[sale][:3]:
            best[sale] = key
    sales = sorted(best)
    if wanted:
        sales = [x for x in sales if x == wanted]
    else:
        today = central_today().isoformat()
        sales = [x for x in sales if x >= today] + [x for x in reversed(sales) if x < today]
    if sales:
        return sales[0], best[sales[0]]
    if not seen["items"]:
        sys.exit("no issue sheet found: the issues folder looks empty to the service account. "
                 "Check that Ops/issues is shared with ftl-site-refresh@first-tuesday-list.iam.gserviceaccount.com (Viewer). "
                 + diagnose(s, os.environ.get("DRIVE_ISSUES_FOLDER_ID") or ISSUES_FOLDER))
    sys.exit(f"no issue sheet found{' for sale ' + wanted if wanted else ''}: saw {seen['items']} items, "
             f"folders: {', '.join(sorted(seen['folders'])[:25]) or 'none'}. Issue sheets must be named "
             f"sale-YYYY-MM-DD_issue-YYYY-MM-DD_v<N>_<rows>.")


def data_tab(names):
    for n in names:
        if n.strip().lower() == "data":
            return n
    sys.exit(f"no 'Data' tab in the sheet (tabs: {', '.join(names)})")


def export_rows(s, f):
    """Header + rows of the Data tab, as the sheet shows them (same as File > Download > CSV)."""
    if f["mimeType"] == SHEET_MIME:
        r = s.get(f"{SHEETS}/{f['id']}", params={"fields": "sheets.properties(sheetId,title)"})
        r.raise_for_status()
        tab = data_tab([t["properties"]["title"] for t in r.json()["sheets"]])
        r = s.get(f"{SHEETS}/{f['id']}/values/'{tab}'", params={"valueRenderOption": "FORMATTED_VALUE", "majorDimension": "ROWS"})
        r.raise_for_status()
        rows = r.json().get("values", [])
        width = max(map(len, rows), default=0)
        return [[str(c) for c in row] + [""] * (width - len(row)) for row in rows]
    from openpyxl import load_workbook
    r = s.get(f"{DRIVE}/{f['id']}", params={"alt": "media", "supportsAllDrives": "true"})
    r.raise_for_status()
    wb = load_workbook(io.BytesIO(r.content), read_only=True, data_only=True)
    ws = wb[data_tab(wb.sheetnames)]
    cell = lambda v: "" if v is None else v.date().isoformat() if isinstance(v, datetime) and v.time() == datetime.min.time() else str(v)
    return [[cell(v) for v in row] for row in ws.iter_rows(values_only=True)]


def main(out_dir):
    wanted = (os.environ.get("SALE") or "").strip() or None
    if wanted and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", wanted):
        sys.exit(f"SALE must look like 2026-12-01, not {wanted!r}")
    s = session()
    sale, (issue, v, is_sheet, _, f) = pick(s, wanted)
    rows = export_rows(s, f)
    header, body = [h.strip() for h in rows[0]], [r for r in rows[1:] if any(c.strip() for c in r)]
    missing = NEEDED - set(header)
    if missing:
        sys.exit(f"{f['name']}: data tab is missing columns {sorted(missing)}")
    i = header.index("doc_id")
    body = [r for r in body if r[i].strip()]
    for col in ("sale_date", "first_seen"):  # build_site.py compares these as ISO text
        j = header.index(col)
        odd = sorted({r[j] for r in body if r[j].strip() and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", r[j].strip())})
        if odd:
            sys.exit(f"{f['name']}: {col} is not YYYY-MM-DD, e.g. {odd[:3]} (check the Data tab's date format)")
    published = os.path.join(SITE, "data", f"sale-{sale}.json")
    if os.path.exists(published):
        before = len(json.load(open(published, encoding="utf-8"))["rows"])
        keep = float(os.environ.get("MIN_KEEP") or 0.7)
        if len(body) < before * keep:
            sys.exit(f"{f['name']} has {len(body)} rows but the site lists {before} for {sale}; refusing to drop that many (MIN_KEEP={keep})")
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"sale-{sale}_issue-{issue}_v{v}_{len(body)}.csv")
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(header)
        w.writerows(body)
    print(f"{f['name']} ({'Sheet' if is_sheet else 'xlsx'}, modified {f['modifiedTime']}): {len(body)} rows", file=sys.stderr)
    print(f"sale={sale}\ncsv={path}\nname={f['name']}")


if __name__ == "__main__":
    main(sys.argv[1])
