# CGT Tours — Package Costing CRM

Your team and network agents build package quotations (flights + hotels + transfers + sightseeing), share them by WhatsApp or as a branded PDF, and request bookings. Admin or operations staff then process those bookings. All data is stored in a Google Sheet.

## What's inside

| Area | What it does |
|---|---|
| **Package types** | Ticket only · Ticket + Hotel · Complete package (ticket + hotel + transfers + sightseeing) · Land package (no ticket) |
| **Costing steps** | 1 Dates, cities, nights, rooms → 2 Flights → 3 Transfers → 4 Day-wise tours → 5 Hotels → 6 Cart → save quotation |
| **Quotation** | WhatsApp text (copy / open WhatsApp) · PDF itinerary with the agent's own logo and agency details · duplicate · edit |
| **Booking** | Agent clicks *Process booking* and enters passport names → it appears under **Bookings** → admin/ops book each service through the API (or mark it confirmed manually with the supplier reference) → issue ticket |
| **Admin** | Team & agent logins with logo/agency details · margin % per service (default and per agent) · exchange rates · notes/excludes · destinations list |
| **Privacy** | Agents see selling prices only. Supplier net prices and profit are visible to admin, and to anyone you tick "can see net". |

## Files (all files sit in the main folder, with no subfolders)
- `server.js` main server · `db.js` Google Sheet database · `auth.js` logins · `pricing.js` margins & currency
- **Suppliers (replaceable):** `prov-flights.js` (AIQS air), `prov-hotels.js`, `prov-transfers.js`, `prov-activities.js` (Hotelbeds), `hotelbeds.js` (Hotelbeds keys), `providers.js` (chooses which supplier file is used)
- Web app: `index.html`, `app.js`, `app.css`, `print.html` (PDF), `airports.js`
- `Code.gs` goes into Google Apps Script (not GitHub)

### Changing a supplier later
Each supplier file has the same functions (`search`, `makeItem`, `book`, `cancel`). To add a different hotel supplier (e.g. RateHawk), create `prov-hotels-ratehawk.js` with those functions and add one line in `providers.js`. Then set `PROVIDER_HOTELS=ratehawk` on Render. Nothing else changes.

Without a supplier key, that service shows **demo data**, so the system keeps working.

## Settings (Render → Environment)
| Key | Meaning |
|---|---|
| `APP_SECRET` | Long random text used to sign logins. Keep it secret and never change it after launch. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | The first admin login (created only once, on the first start) |
| `SHEETS_WEBHOOK_URL` / `SHEETS_WEBHOOK_SECRET` | The Google Sheet database (Apps Script web app URL + secret) |
| `AIQS_*` | Flight API (test environment). For live: production URLs + `AIQS_TARGET=Production` |
| `HB_URL` | `https://api.test.hotelbeds.com` now · `https://api.hotelbeds.com` after Hotelbeds certifies you |
| `HB_HOTEL_*`, `HB_ACTIVITY_*`, `HB_TRANSFER_*`, `HB_BUNDLE_*` | Hotelbeds keys. If a key reaches its daily limit, the Bundle key is used automatically. |

## Good to know
- **Test keys:** Hotelbeds evaluation keys have daily limits (the hotel key allows 50 requests a day). Searches are remembered for 15–30 minutes to save quota. Test bookings are not real.
- **Render free plan:** it sleeps after 15 minutes without visitors, so the first page after a break is slow. For a team, use a paid instance so it is always on.
- **Backups:** the Google Sheet *is* your backup. Use File → Version history, or make a copy now and then.
