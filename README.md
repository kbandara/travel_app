# Travel Expenses

A multi-trip, multi-country travel spend tracker that runs entirely in the browser — no account, no server, no build step. Your data lives in `localStorage` on your device.

## Features

- **Trips** — track any number of trips, each spanning multiple countries, from one home page (with an all-trips total).
- **Three ways money leaves your pocket**
  - *Card / transfer* expenses, converted to your home currency at a live or manual rate.
  - *ATM cash-outs* — you record the local cash received and what your account was charged, capturing the true fee-inclusive rate.
  - *Cash spends* — drawn down from the matching cash pool without being double counted (the trip total = card spends + ATM withdrawals).
- **Live FX rates** from [open.er-api.com](https://open.er-api.com), cached for offline use, with a manual-rate fallback and an auto-refresh toggle.
- **Budgets** — a whole-trip budget plus per-country budgets, with progress bars and over-budget warnings.
- **Timeline** — newest first: entries grouped by country, most recently visited country on top, with day headers, search, and filter chips (category / card / cash / ATM). Long lists are capped with "show all".
- **Insights** — average per day, largest spend, category breakdown, daily spend for the last 14 days, per-country totals, and a payment split. Cash spends are valued at your blended ATM rate.
- **Editing** — edit, duplicate, or delete any entry; deletes offer a 6-second **Undo**.
- **Home-currency switching** — totals for entries recorded under a different home currency are converted at current rates and marked with ≈ (never silently mixed).
- **Backup & restore** — export *everything* as one JSON file from Settings and restore it later (also accepts per-trip JSON exports and share payloads). Per-trip CSV/JSON export too.
- **Share by link** — a trip snapshot encoded into a URL; the recipient imports a copy (no server, so it's a copy, not live sync).
- **PWA** — installable, with a service worker so the app opens with no connection; light/dark/system theme with no flash on load.

## Hosting

It's a static site: serve `index.html`, `sw.js`, `manifest.webmanifest`, and `icon.svg` from any static host (GitHub Pages works as-is). The service worker requires HTTPS (or localhost).

## Development

There is no build step — `index.html` contains React (inlined) and the application code. Edit and reload:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

When you change any cached file, bump `VERSION` in `sw.js` so installed clients pick up the update promptly.

## Tests

An end-to-end Playwright suite drives the real app in Chromium — entries, cash pools, budgets, filters, undo, insights math, currency switching, share/import, backup/restore, legacy-data migration, and offline start via the service worker:

```sh
npm install --no-save playwright   # once; downloads may need `npx playwright install chromium`
node tests/e2e.mjs
```

## Data & migration notes

- Storage keys are versioned (`travel-expense-*-v1`) and migrations preserve data written by every earlier version of the app, including the original single-trip format and its per-country budgets. Entries whose trip record was lost are surfaced in a "Recovered entries" trip rather than hidden.
- Backups are plain JSON — keep one somewhere safe; browsers can evict site data.
