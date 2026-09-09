# New England Gutters — QuoteIQ Dashboard

A small dashboard that shows sales pipeline, revenue, and scheduling data pulled
from [QuoteIQ](https://myquoteiq.com), New England Gutters' CRM.

## How data gets in

QuoteIQ's public API is a **webhook push** model, not a query/pull API — there's
no endpoint to ask "give me all jobs this month." So this app gets data two ways:

1. **Live, going forward:** QuoteIQ posts events (`Estimate Created/Updated/Deleted`,
   `Schedule Created/Updated/Deleted`) to `POST /webhooks/quoteiq` on this server.
2. **Backfill, one-time:** the `/admin.html` page lets you upload a CSV export of
   your existing jobs/estimates from QuoteIQ and map its columns to the dashboard's
   fields.

Every webhook payload is also logged verbatim into the `webhook_log` table, so if
the automatic field-mapping in `server/lib/extract.js` misses something (QuoteIQ's
exact field names aren't published), you can inspect real payloads there and refine
the mapping.

## Stack

- Node.js + Express (`server/`)
- Postgres (Railway's Postgres plugin — attach it and Railway sets `DATABASE_URL`
  automatically)
- Plain HTML/CSS/JS frontend (`public/`), Chart.js via CDN, no build step

## Local setup

```bash
npm install
cp .env.example .env
# edit .env: set a local DATABASE_URL, DASHBOARD_USER/PASSWORD, QUOTEIQ_WEBHOOK_SECRET
npm start
```

Visit `http://localhost:3000` (browser will prompt for the basic-auth login you set).

## Deploying on Railway

1. **Push this repo to GitHub**, then in Railway: New Project → Deploy from GitHub repo,
   pick this repo. Railway auto-detects Node (`npm start`).
2. **Add Postgres:** in the same Railway project, "New" → "Database" → "Add PostgreSQL".
   Then in your app service's Variables tab, link/reference the Postgres plugin's
   `DATABASE_URL` (Railway usually offers this as a one-click "Add Reference").
3. **Set environment variables** on the app service (Variables tab):
   - `QUOTEIQ_WEBHOOK_SECRET` — a secret string. QuoteIQ's webhook setup screen
     (Settings → API Integrations, when you register the URL) may show you a
     signing secret to use, or let you set your own — use whatever it gives you.
     See the note below if it turns out to be an HMAC signature instead of a
     plain shared value.
   - `DASHBOARD_USER` / `DASHBOARD_PASSWORD` — login for viewing the dashboard.
4. **Deploy**, then grab the public Railway URL (Settings → Networking → Generate
   Domain if you haven't already).
5. In QuoteIQ, register the webhook URL as `https://<your-railway-domain>/webhooks/quoteiq`.
6. Open `https://<your-railway-domain>/admin.html` to run the CSV backfill for
   historical jobs/estimates.

## Open item: webhook authentication

QuoteIQ's public help docs don't specify exactly how outbound webhook calls are
authenticated (a static shared secret in a header/query param vs. an HMAC
signature over the payload). This app currently checks for a shared secret in one
of these, in order: `x-quoteiq-secret` header, `x-webhook-secret` header,
`x-quoteiq-signature` header (treated as a plain value, not verified as an HMAC),
or a `?secret=` query param — compared against `QUOTEIQ_WEBHOOK_SECRET`.

When you register the webhook URL in QuoteIQ and see what it actually sends,
check the `webhook_log` table (or server logs) for the real header QuoteIQ uses.
If it turns out to be an HMAC signature (a hash rather than the plain secret),
`server/routes/webhooks.js`'s `secretMatches()` function needs a small update to
verify it that way instead of a direct string comparison — flag it and it's a
quick fix.

## Project structure

```
server/
  index.js          Express app, auth, startup
  db.js             Postgres pool + schema (auto-created on boot)
  lib/extract.js     Best-effort field extraction from QuoteIQ webhook payloads
  routes/webhooks.js  POST /webhooks/quoteiq
  routes/api.js       GET /api/summary, /api/revenue-trend, /api/estimates,
                       /api/schedule; POST /api/import/estimates, /api/import/schedule
public/
  index.html          The dashboard
  admin.html          Webhook URL + CSV backfill tool
```
