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
- **Daily limits, per country** — a daily cap per category, set country by country, because a day in Hanoi is not a day in Tokyo. The Track tab checks today against the limits of wherever you actually are and says plainly whether you're under or over; every entry you add, edit or duplicate reports what that category has left for the day. Amounts are in your home currency and reset each calendar day.
- **Your own categories** — add categories the standard list doesn't cover and give them a daily limit like any other. Pin one to a country (an *HSR* limit for China, an *Onsen* limit for Japan) and it's only offered while you're there.
- **Daily limits history** — Insights keeps the day-by-day record: how many days you finished inside your limits, and for each day what you spent against the limits of the country you were in, with the days you went over named and priced.
- **Budget pace** — give the trip a start and end date and the budget bar gains a pace marker: which day of the trip you're on, how much you should have spent by tonight, whether you're under or over that line, and what's left per day for the days still to come.
- **Timeline** — newest first: entries grouped by country, most recently visited country on top, with day headers, search, and filter chips (category / card / cash / ATM). Long lists are capped with "show all".
- **Insights** — where the trip is heading (a projected finish from your burn rate, against the budget), what a day actually costs in each country, average and median day, biggest day, largest spend, category breakdown, daily spend for the last 14 days marked with your average, your five biggest spends, and a payment split. Cash spends are valued at your blended ATM rate.
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

An end-to-end Playwright suite drives the real app in Chromium — entries, cash pools, budgets, per-country daily limits and their history, your own categories, budget pace and projection, filters, undo, insights math, currency switching, share/import, backup/restore, legacy-data migration (including v2's trip-wide daily limits), and offline start via the service worker:

```sh
npm install --no-save playwright   # once; downloads may need `npx playwright install chromium`
node tests/e2e.mjs
```

## Data & migration notes

- Storage keys are versioned (`travel-expense-*-v1`) and migrations preserve data written by every earlier version of the app, including the original single-trip format, its per-country budgets, and the trip-wide daily limits of v2 (handed to each country the trip knows about). Entries whose trip record was lost are surfaced in a "Recovered entries" trip rather than hidden.
- Backups are plain JSON — keep one somewhere safe; browsers can evict site data.
