# First Tuesday List website

Public site for [firsttuesdaylist.com](https://firsttuesdaylist.com): every Harris County property going to foreclosure auction, on a live map with photos, flood zones and sale details, plus the free weekly list.

## Layout

- `site/`: the static site Cloudflare Pages serves (HTML, `assets/`, `data/`, `photos/`).
- `tools/build_site.py`: builds `site/data/` (free columns only), the web photos and one page per property (`site/property/<id>.html`, via `tools/property_pages.py`) for a sale.
- `tools/fetch_aerials.py`: fetches one aerial photo per property from HCAD imagery, framed on its lot.
- `tools/fetch_sheet.py`, `tools/check_public.py`: the daily refresh's Drive export and member-data check (see below).
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

## Membership

Paid membership ($49/month or $490/year; founding $39/$390 for the first 100, kept for as long as they stay):

- `functions/api/`: Cloudflare Pages Functions. `checkout` (Stripe Checkout), `claim` (the welcome page signs the buyer in),
  `stripe-webhook` (subscription changes), `login` (one-time sign-in link by email), `logout`, `portal` (Stripe billing page),
  `status`, `member/*` (member data and downloads, members only), `upload/*` (member data in, keyless from GitHub Actions).
- `lib/members.js`: the shared code, and the list of KV keys and settings.
- Pages: `site/pricing.html`, `site/welcome.html`, `site/signin.html`, `site/members.html`; `site/assets/property.js` and
  `mapapp.js` unlock the numbers for members. The static pages never contain member values: members' browsers fetch them.
- `tools/member_data.py`: the daily refresh builds the member fields and the member spreadsheet in the runner's temp folder
  and uploads them (GitHub's OIDC token for this repo's main branch is the proof, no key). The monthly Research Brief job in
  ftl-ops uploads the member edition the same way.

Until the settings below exist, membership stays closed: the pricing page shows "Opening soon" and every member endpoint answers 503.

### One-time setup

1. **Cloudflare** (dash.cloudflare.com → Workers & Pages):
   - Storage & Databases → KV → Create namespace `ftl-members`.
   - The Pages project → Settings → Bindings → Add → KV namespace: variable name `MEMBERS`, namespace `ftl-members` (Production).
2. **Stripe** (start in test mode, then repeat with live keys):
   - Developers → API keys → Secret key → Cloudflare Pages → Settings → Variables and secrets → add secret `STRIPE_SECRET_KEY`.
   - Developers → Webhooks → Add endpoint `https://firsttuesdaylist.com/api/stripe-webhook`, events `checkout.session.completed`,
     `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` → its Signing secret →
     Cloudflare secret `STRIPE_WEBHOOK_SECRET`.
   - Settings → Billing → Customer portal: allow updating the payment method, viewing invoices and canceling (at period end). Save.
   - Settings → Branding: logo and colors (#13294B, #D2141C).
   - The product and its four prices are created automatically on the first checkout (lookup keys `ftl_member_monthly`,
     `ftl_member_yearly`, `ftl_founding_monthly`, `ftl_founding_yearly`).
   - Optional: Stripe Tax registered for Texas → Cloudflare variable `STRIPE_TAX` = `on`.
   - Cloudflare variable `SALES` = `closed` pauses new sign-ups (pricing shows "Opening soon"); members keep access. Delete it to open.
3. **Resend** (sign-in emails): add and verify the domain `firsttuesdaylist.com` (it writes the DNS records in Cloudflare),
   API key with sending access → Cloudflare secret `RESEND_API_KEY`. Optional `EMAIL_FROM`
   (default `First Tuesday List <members@firsttuesdaylist.com>`).
4. Cloudflare Pages → Deployments → Retry the latest deployment, so the new settings apply.

Local test: `npx wrangler pages dev site --kv MEMBERS --binding STRIPE_SECRET_KEY=... --binding STRIPE_WEBHOOK_SECRET=... --binding DEV=1`
(with `DEV=1` and no Resend key, sign-in emails are printed to the console).

## Daily data refresh

`.github/workflows/data-refresh.yml` runs every morning at 6 AM Houston time, summer and winter and on demand (Actions → Daily data refresh → Run workflow, with an optional sale date and a dry-run box):

1. `tools/fetch_sheet.py` finds the current sale's newest issue sheet in Drive (`Ops/issues/sale-YYYY-MM-DD/issue-YYYY-MM-DD/`, highest `v`, never `_superseded/`) and exports its **Data** tab to a CSV in the runner's temp folder. The current sale is the next one that has an issue sheet; on the day after a sale it moves on as soon as the bots file the next sale's sheet. It stops if the sheet lost more than 30% of the rows the site already lists.
2. `tools/fetch_aerials.py` fetches HCAD aerials only for properties without a photo on the site yet (HCAD parcel by `HCAD_NUM`, never the owner field; Census geocoder as fallback).
3. `tools/build_site.py` writes the free-only JSON, property pages, `notices.json`, `backdrop.svg`, `current.json`, and the sale date, deadline, countdown and calendar into `index.html` and `map.html`.
4. `tools/check_public.py` scans everything under `site/` against the sheet's member columns and fails the run on any match.
5. If `site/` changed, the job commits it and Cloudflare redeploys. The sheet export is deleted and never committed.

The bots must keep the tab named `Data`, its column names, and `YYYY-MM-DD` dates.

### One-time setup (keyless)

The job signs in to Google without any key: GitHub proves to Google that the run belongs to this repository (Workload Identity Federation), and Google lets it act as the read-only `ftl-site-refresh` service account for up to an hour. There's no secret to store. (The organization policy that blocks service-account keys stays on.)

In Google Cloud Shell (console.cloud.google.com → the `>_` button, as mehdi.aharchaou@, project **First Tuesday List**):

```
PROJECT_ID=first-tuesday-list
REPO=aharchaoumehdi/first-tuesday-list
SA=ftl-site-refresh@$PROJECT_ID.iam.gserviceaccount.com
gcloud config set project $PROJECT_ID
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
gcloud services enable drive.googleapis.com sheets.googleapis.com iamcredentials.googleapis.com sts.googleapis.com
gcloud iam service-accounts describe $SA >/dev/null 2>&1 || gcloud iam service-accounts create ftl-site-refresh --display-name="Site daily refresh (read-only)"
gcloud iam workload-identity-pools create github --location=global --display-name="GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc first-tuesday-list --location=global --workload-identity-pool=github   --display-name="first-tuesday-list repo" --issuer-uri="https://token.actions.githubusercontent.com"   --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository"   --attribute-condition="assertion.repository=='$REPO'"
gcloud iam service-accounts add-iam-policy-binding $SA --role=roles/iam.workloadIdentityUser   --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"
echo "projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/first-tuesday-list"
```

The last line prints the provider name that `workload_identity_provider:` in `.github/workflows/data-refresh.yml` uses.

In Google Drive (as leads@firsttuesdaylist.com):

- First Tuesday List Ops → right-click **issues** → Share → add `ftl-site-refresh@first-tuesday-list.iam.gserviceaccount.com` as **Viewer**, untick Notify, Share. Share only `issues/`: the rest of Ops (leads, prospects, raw notices) isn't needed. New issue files inherit the share, even while they're Restricted to everyone else. If Drive warns that the address is outside firsttuesdaylist.com, choose Share anyway; if it refuses, allow sharing outside the domain in the Admin console (Apps → Google Workspace → Drive and Docs → Sharing settings).
- Optional: a repository variable `DRIVE_ISSUES_FOLDER_ID`, only if the issues folder is ever replaced (the default is the current `issues/` folder ID).

Then in GitHub → Actions → Daily data refresh → Run workflow with **dry run** ticked. The log should name the issue sheet, the number of new photos, `OK: no member values in site/` and `Dry run: not committing`. After that it runs on its own every morning.

Run the same steps locally (CSV kept outside the repo):

```
python tools/build_site.py 2026-11-03 data/source/<issue>.csv data/aerial/2026-11-03
python tools/check_public.py data/source/<issue>.csv 2026-11-03
```
