"""Fetch one free aerial photo per notice, framed on the HCAD parcel.

Sources (all free, no account):
- HCAD public parcel map (lot outline + centroid), queried by HCAD account.
  Only HCAD_NUM and the geometry are requested; owner names are never fetched.
- US Census geocoder results (batch_out.csv) as a fallback location.
- HCAD's own aerial imagery (Aerials/Image2026, about 5 cm per pixel), the
  same photos the HCAD parcel viewer shows. Check HCAD's terms of use before
  launch; NAIP 2022 (public domain, 60 cm) is the fallback if needed.

Usage: python fetch_aerials.py <data_tab.csv> <census_batch_out.csv> <out_dir>
Writes <out_dir>/<doc_id>.jpg and <out_dir>/index.csv.
"""
import csv
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image, ImageDraw

HCAD = "https://arcweb.hcad.org/server/rest/services/public/public_query/MapServer/0/query"
IMAGERY = "https://arcweb.hcad.org/server/rest/services/Aerials/Image2026/ImageServer/exportImage"
W, H = 960, 620
MIN_WIDTH_M = 48  # ground width of the tightest frame; enough to show one house and its yard
R = 6378137.0


def merc(lon, lat):
    return (math.radians(lon) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R)


def get_json(url, params, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url + "?" + urllib.parse.urlencode(params), timeout=60) as r:
                return json.load(r)
        except Exception:
            time.sleep(2 * (i + 1))
    return None


def hcad_parcels(accounts):
    """Return {account: list of rings in lon/lat} for the given HCAD accounts."""
    out = {}
    accounts = [a for a in accounts if a]
    for i in range(0, len(accounts), 80):
        chunk = accounts[i:i + 80]
        where = "HCAD_NUM IN (" + ",".join(f"'{a}'" for a in chunk) + ")"
        d = get_json(HCAD, {"where": where, "outFields": "HCAD_NUM", "returnGeometry": "true", "outSR": 4326, "f": "json"})
        for f in (d or {}).get("features", []):
            out.setdefault(f["attributes"]["HCAD_NUM"], []).extend(f["geometry"].get("rings", []))
        time.sleep(0.5)
    return out


def frame(rings, lon=None, lat=None):
    """Mercator bbox (xmin, ymin, xmax, ymax) framing the parcel, with W:H aspect."""
    if rings:
        pts = [merc(x, y) for ring in rings for x, y in ring]
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
        span = max(max(xs) - min(xs), (max(ys) - min(ys)) * W / H) * 1.6
    else:
        cx, cy = merc(lon, lat)
        span = 0
    k = 1 / math.cos(math.radians(lat if lat is not None else 29.8))  # mercator stretch at this latitude
    width = max(span, MIN_WIDTH_M * k)
    height = width * H / W
    return cx - width / 2, cy - height / 2, cx + width / 2, cy + height / 2


def fetch(job):
    doc_id, bbox, rings, path = job
    url = IMAGERY + "?" + urllib.parse.urlencode({
        "bbox": ",".join(f"{v:.2f}" for v in bbox), "bboxSR": 3857, "imageSR": 3857, "size": f"{W},{H}",
        "format": "jpg", "compressionQuality": 85, "interpolation": "RSP_BilinearInterpolation", "f": "image"})
    for i in range(3):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                data = r.read()
            if len(data) < 2000:
                raise ValueError("tiny image")
            with open(path, "wb") as f:
                f.write(data)
            if rings:
                img = Image.open(path).convert("RGB")
                d = ImageDraw.Draw(img)
                x0, y0, x1, y1 = bbox
                for ring in rings:
                    px = [((merc(x, y)[0] - x0) / (x1 - x0) * W, (y1 - merc(x, y)[1]) / (y1 - y0) * H) for x, y in ring]
                    d.line(px + [px[0]], fill=(255, 255, 255), width=6)
                    d.line(px + [px[0]], fill=(210, 20, 28), width=3)
                img.save(path, quality=85)
            print("ok", doc_id, flush=True)
            return doc_id, True
        except Exception:
            time.sleep(2 * (i + 1))
    return doc_id, False


def main(data_csv, census_csv, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    rows = list(csv.DictReader(open(data_csv, encoding="utf-8")))
    census = {x[0]: x[5] for x in csv.reader(open(census_csv, encoding="utf-8")) if len(x) > 5 and x[2] == "Match"}
    parcels = hcad_parcels(sorted({r["hcad_account"].strip() for r in rows}))
    print("parcels found", len(parcels), flush=True)
    jobs, index = [], []
    for r in rows:
        acct, doc = r["hcad_account"].strip(), r["doc_id"]
        rings = parcels.get(acct)
        lon = lat = None
        source = ""
        if rings:
            pts = [p for ring in rings for p in ring]
            lon, lat = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
            source = "hcad_parcel"
        elif doc in census:
            lon, lat = map(float, census[doc].split(","))
            source = "census_geocoder"
        if lon is None:
            index.append({"doc_id": doc, "lat": "", "lon": "", "location_source": "none", "photo": ""})
            continue
        path = os.path.join(out_dir, f"{doc}.jpg")
        jobs.append((doc, frame(rings, lon, lat), rings, path))
        index.append({"doc_id": doc, "lat": f"{lat:.6f}", "lon": f"{lon:.6f}", "location_source": source, "photo": f"{doc}.jpg"})
    with ThreadPoolExecutor(max_workers=6) as ex:
        ok = dict(ex.map(fetch, jobs))
    for row in index:
        if row["photo"] and not ok.get(row["doc_id"]):
            row["photo"] = ""
    with open(os.path.join(out_dir, "index.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["doc_id", "lat", "lon", "location_source", "photo"])
        w.writeheader()
        w.writerows(index)
    by = {}
    for row in index:
        by[row["location_source"]] = by.get(row["location_source"], 0) + 1
    print("rows", len(rows), "parcels found", len(parcels), "locations", by, "photos", sum(1 for r in index if r["photo"]))


if __name__ == "__main__":
    main(*sys.argv[1:4])
