# First Tuesday List website

Public site for [firsttuesdaylist.com](https://firsttuesdaylist.com): every Harris County property going to foreclosure auction, on a live map with photos, flood zones and sale details, plus the free weekly list.

## Layout

- `site/`: the static site Cloudflare Pages serves (HTML, `assets/`, `data/`, `photos/`).
- `tools/build_site.py`: builds `site/data/` (free columns only) and the web photos for a sale.
- `tools/fetch_aerials.py`: fetches one aerial photo per property from HCAD imagery, framed on its lot.
- `tools/serve_site.py`: local preview on http://localhost:8787 (reads the Maps key from `.env`).
- `tools/write_config.py`: writes `site/config.js` from the `GOOGLE_MAPS_KEY` environment variable (deploy build step).

## Local preview

```
cp .env.example .env        # then paste the Google Maps key
python tools/serve_site.py
```

## Deploy (Cloudflare Pages)

- Build command: `python tools/write_config.py`
- Build output directory: `site`
- Environment variable: `GOOGLE_MAPS_KEY`

Public data files contain only the free columns. Member fields (values, loans, equity) are never committed.
