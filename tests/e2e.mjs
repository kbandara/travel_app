/* End-to-end verification of the Travel Expenses app. */
import { chromium } from "playwright";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8899;
const BASE = `http://localhost:${PORT}/`;
const SHOTS = path.join(os.tmpdir(), "travel-expenses-e2e");
fs.mkdirSync(SHOTS, { recursive: true });

/* AUD-based reference table; per-base tables derived so cross rates stay consistent */
const TBL = { AUD: 1, VND: 16000, USD: 0.65, THB: 23, EUR: 0.6, JPY: 97, LKR: 195 };
function ratesFor(base) {
  const out = {};
  for (const k of Object.keys(TBL)) out[k] = TBL[k] / TBL[base];
  return out;
}

let failures = 0;
function ok(cond, msg) {
  if (cond) { console.log("  ✓ " + msg); }
  else { failures++; console.error("  ✗ FAIL: " + msg); }
}
async function textOf(page, sel) {
  return (await page.locator(sel).first().textContent()) || "";
}
async function noHScroll(page, label) {
  const over = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
  ok(over <= 1, `no horizontal overflow on ${label} (delta ${over}px)`);
}

function collectErrors(page, bucket) {
  page.on("pageerror", (e) => bucket.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") bucket.push("console.error: " + m.text()); });
}

async function mockRates(context) {
  await context.route("https://open.er-api.com/**", (route) => {
    const url = route.request().url();
    const m = url.match(/latest\/([A-Z]{3})/);
    const base = m ? m[1] : "AUD";
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ result: "success", base_code: base, rates: ratesFor(base) }) });
  });
}

const server = spawn("python3", ["-m", "http.server", String(PORT), "--directory", APP_DIR], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 900));

let browser;
try {
  browser = await chromium.launch();
} catch (e) {
  browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
}

try {
  /* ================= main functional pass (SW blocked for deterministic routing) ================= */
  console.log("\n== Main functional pass ==");
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    serviceWorkers: "block", acceptDownloads: true,
  });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:" + PORT });
  await mockRates(ctx);
  const errors = [];
  const page = await ctx.newPage();
  collectErrors(page, errors);
  page.on("dialog", (d) => d.accept());

  await page.goto(BASE);
  await page.waitForSelector("text=Your trips");
  ok(true, "home screen renders");
  ok((await page.title()) === "Travel Expenses", "title set");
  ok(await page.locator('link[rel="manifest"][href="manifest.webmanifest"]').count() === 1, "static manifest linked");
  await page.waitForSelector("text=Live · just now");
  ok(true, "live rates fetched on load (mocked)");
  await noHScroll(page, "home");
  await page.screenshot({ path: path.join(SHOTS, "1-home-empty.png") });

  /* create trip */
  await page.click("text=New trip");
  await page.fill("#new-trip", "Vietnam Adventure");
  await page.keyboard.press("Enter");
  await page.waitForSelector("text=Tap to rename");
  ok((await textOf(page, ".t-appbar")).includes("Vietnam Adventure"), "trip created and opened");

  /* card expense with auto-filled live rate */
  await page.fill("#f-country", "Vietnam");
  await page.waitForFunction(() => document.querySelector("#f-currency").value === "VND");
  ok(true, "currency auto-set from country");
  await page.waitForFunction(() => document.querySelector("#f-rate").value === "16000");
  ok(true, "live rate auto-filled (16000)");
  await page.fill("#f-desc", "Pho lunch");
  await page.fill("#f-amt", "160000");
  await page.waitForSelector("text=A$10.00");
  ok(true, "home-currency preview shown (A$10.00)");
  await page.click("button.t-btn-cta:has-text('Add expense')");
  await page.waitForSelector(".t-toast");
  ok((await textOf(page, ".t-toast")).includes("A$10.00"), "add toast with converted amount");

  /* ATM cash-out */
  await page.click(".t-seg button:has-text('ATM cash-out')");
  await page.fill("#f-wlocal", "1600000");
  await page.fill("#f-whome", "100");
  ok((await page.locator("text=1 AUD = 16,000 VND").count()) > 0, "effective ATM rate displayed");
  await page.click("button.t-btn-cta:has-text('Add cash-out')");
  await page.waitForSelector("text=Cash on hand");
  ok((await textOf(page, "body")).includes("1,600,000 VND"), "cash pool created with 1,600,000 VND");

  /* cash expense drawing the pool */
  await page.locator('.t-seg button').filter({ hasText: /^Add expense$/ }).click();
  await page.locator('.t-seg button').filter({ hasText: /^Cash$/ }).click();
  await page.fill("#f-desc", "Beer");
  await page.fill("#f-amt", "200000");
  await page.waitForSelector("text=Drawn from cash");
  await page.click("button.t-btn-cta:has-text('Add expense')");
  await page.waitForFunction(() => document.body.innerText.includes("1,400,000 VND"));
  ok(true, "cash pool drawn down to 1,400,000 VND");

  /* hero total = card 10 + ATM 100 */
  ok((await textOf(page, ".t-big")).trim() === "A$110.00", "hero total A$110.00 (card + ATM, cash not double-counted)");

  /* trip budget */
  await page.click('[aria-label="Trip menu"]');
  await page.click(".t-menu button:has-text('trip budget')");
  await page.fill("#trip-budget", "1000");
  await page.click("button:has-text('Save')");
  await page.waitForSelector("text=A$890.00 left");
  ok(true, "trip budget bar shows A$890.00 left");
  await page.screenshot({ path: path.join(SHOTS, "2-trip-track.png") });
  await noHScroll(page, "trip track");

  /* timeline: country budget */
  await page.click(".t-seg button:has-text('Timeline')");
  await page.waitForSelector("text=Pho lunch");
  ok(true, "timeline lists entries");
  await page.click("text=+ Set budget");
  await page.fill('input[id^="budget-"]', "500");
  await page.click("button:has-text('Save')");
  await page.waitForSelector("text=A$390.00 left");
  ok(true, "country budget shows A$390.00 left");

  /* single-day range label (fmtRange same-day fix) */
  const groupHead = await textOf(page, ".t-card:has-text('Vietnam') >> nth=0");
  ok(!groupHead.includes("–"), "same-day range renders as a single date");

  /* search + filters */
  await page.fill('input[type="search"]', "pho");
  await page.waitForSelector("text=1 of 3 entries");
  ok(true, "search narrows to 1 of 3 entries");
  await page.fill('input[type="search"]', "");
  await page.click(".t-fchip:has-text('ATM')");
  await page.waitForSelector("text=1 of 3 entries");
  ok((await page.locator("text=ATM withdrawal").count()) > 0, "ATM filter shows the withdrawal");
  await page.click(".t-fchip:has-text('ATM')");
  await page.waitForSelector("text=Cash on hand", { state: "hidden" }).catch(() => {});
  await page.screenshot({ path: path.join(SHOTS, "3-trip-timeline.png") });
  await noHScroll(page, "timeline");

  /* edit the cash expense: 200000 -> 250000 */
  const beerRow = page.locator(".t-item", { hasText: "Beer" });
  await beerRow.hover();
  await beerRow.locator('[aria-label^="Edit"]').click();
  await page.waitForSelector("text=Editing entry");
  ok(true, "edit prefills the entry card");
  await page.fill("#f-amt", "250000");
  await page.click("button:has-text('Save changes')");
  await page.waitForFunction(() => document.body.innerText.includes("1,350,000 VND"));
  ok(true, "edited amount reflows the cash pool (1,350,000 VND left)");

  /* duplicate + undo delete */
  await page.click(".t-seg button:has-text('Timeline')");
  const phoRow = page.locator(".t-item", { hasText: "Pho lunch" }).first();
  await phoRow.hover();
  await phoRow.locator('[aria-label^="Duplicate"]').click();
  await page.waitForFunction(() => document.body.innerText.includes("4 entries"));
  ok((await textOf(page, ".t-big")) === "A$120.00", "duplicate adds to total (A$120.00)");
  const dupRow = page.locator(".t-item", { hasText: "Pho lunch" }).first();
  await dupRow.hover();
  await dupRow.locator('[aria-label^="Delete"]').click();
  await page.waitForSelector(".t-toastact");
  await page.click(".t-toastact");
  await page.waitForFunction(() => document.body.innerText.includes("4 entries"));
  ok(true, "undo restores the deleted entry");
  const dupRow2 = page.locator(".t-item", { hasText: "Pho lunch" }).first();
  await dupRow2.hover();
  await dupRow2.locator('[aria-label^="Delete"]').click();
  await page.waitForFunction(() => document.body.innerText.includes("3 entries"));
  ok((await textOf(page, ".t-big")) === "A$110.00", "delete sticks when not undone (A$110.00)");

  /* insights */
  await page.click(".t-seg button:has-text('Insights')");
  await page.waitForSelector("text=Where it went");
  ok((await page.locator("text=Avg per day").count()) > 0, "insight tiles render");
  const insightsText = await textOf(page, "body");
  ok(insightsText.includes("A$25.63"), "category bar values cash at blended ATM rate (Food A$25.63)");
  ok(insightsText.includes("ATM withdrawn"), "payment split section present");
  ok(insightsText.includes("Daily spend"), "daily spend section present");
  await page.screenshot({ path: path.join(SHOTS, "4-trip-insights.png") });
  await noHScroll(page, "insights");

  /* back home: card shows stats */
  await page.click('[aria-label="Back to trips"]');
  await page.waitForSelector("text=Your trips");
  const cardText = await textOf(page, ".t-trip");
  ok(cardText.includes("A$110.00") && cardText.includes("Vietnam Adventure"), "home card shows name and total");
  await page.screenshot({ path: path.join(SHOTS, "5-home-trip.png") });

  /* settings: switch home currency -> totals convert with ≈ */
  await page.click('[aria-label="Settings"]');
  await page.waitForSelector("text=Home currency");
  await page.selectOption("#set-home", "USD");
  await page.waitForSelector("text=Base USD");
  await page.click('[aria-label="Close settings"]');
  await page.waitForFunction(() => document.body.innerText.includes("≈"));
  const cardUsd = await textOf(page, ".t-trip");
  ok(cardUsd.includes("≈") && cardUsd.includes("71.50"), "totals convert to USD with ≈ marker ($71.50)");
  await page.click('[aria-label="Settings"]');
  await page.selectOption("#set-home", "AUD");
  await page.click('[aria-label="Close settings"]');
  await page.waitForFunction(() => document.body.innerText.includes("A$110.00"));
  const cardAud = await textOf(page, ".t-trip");
  ok(!cardAud.includes("≈"), "switching back to AUD restores exact totals");

  /* persistence across reload */
  await page.reload();
  await page.waitForSelector("text=Vietnam Adventure");
  ok((await textOf(page, ".t-trip")).includes("A$110.00"), "data persists across reload");

  /* share -> import */
  await page.click(".t-trip");
  await page.waitForSelector("text=Tap to rename");
  await page.click('[aria-label="Trip menu"]');
  await page.click("text=Share trip");
  await page.waitForSelector(".t-toast");
  const link = await page.evaluate(() => navigator.clipboard.readText());
  ok(link.includes("#trip="), "share link copied to clipboard");
  await page.goto(link);
  await page.waitForSelector("text=A trip was shared with you");
  await page.click("text=Import trip");
  await page.waitForSelector("text=Trip imported");
  await page.click('[aria-label="Back to trips"]');
  await page.waitForFunction(() => document.querySelectorAll(".t-trip").length === 2);
  ok(true, "shared trip imported as a copy (2 trips)");
  ok((await textOf(page, "body")).includes("All trips"), "all-trips combined total appears");

  /* backup -> wipe -> restore */
  await page.click('[aria-label="Settings"]');
  const dlPromise = page.waitForEvent("download");
  await page.click("text=Back up everything");
  const dl = await dlPromise;
  const backupPath = path.join(SHOTS, "backup.json");
  await dl.saveAs(backupPath);
  const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  ok(backup.app === "travel-expenses" && backup.trips.length === 2 && backup.txns.length === 6, "backup file contains 2 trips / 6 entries");

  await page.click("text=Erase all data");
  await page.waitForSelector("text=No trips yet");
  ok(true, "erase-all wipes to a fresh state");

  await page.click('[aria-label="Settings"]');
  const chooser = page.waitForEvent("filechooser");
  await page.click("text=Restore / import file");
  await (await chooser).setFiles(backupPath);
  await page.waitForSelector("text=Backup restored");
  await page.waitForFunction(() => document.querySelectorAll(".t-trip").length === 2);
  ok((await textOf(page, "body")).includes("A$110.00"), "restore brings both trips back with correct totals");

  /* dark mode + persistence of theme */
  await page.click('[aria-label="Toggle dark mode"]');
  await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "dark");
  ok(true, "dark mode applies");
  await page.reload();
  await page.waitForSelector("text=Your trips");
  ok((await page.evaluate(() => document.documentElement.getAttribute("data-theme"))) === "dark", "theme persists (and pre-boot applies it before React)");
  await page.screenshot({ path: path.join(SHOTS, "6-home-dark.png") });
  await page.click('[aria-label="Toggle dark mode"]');

  ok(errors.length === 0, "no console/page errors in main pass" + (errors.length ? "\n    " + errors.join("\n    ") : ""));
  await ctx.close();

  /* ================= migration pass: legacy single-trip data ================= */
  console.log("\n== Migration pass (v0 flat data + config budgets) ==");
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await mockRates(ctx2);
  const errors2 = [];
  const page2 = await ctx2.newPage();
  collectErrors(page2, errors2);
  await ctx2.addInitScript(() => {
    localStorage.setItem("travel-expense-config-v1", JSON.stringify({ homeCurrency: "AUD", autoRates: true, budgets: { Vietnam: 500 } }));
    localStorage.setItem("travel-expense-data-v1", JSON.stringify([
      { description: "Old noodle", amountTrip: 50000, tripCurrency: "VND", amountHome: 5, homeCurrency: "AUD", category: "Food" }
    ]));
  });
  await page2.goto(BASE);
  await page2.waitForSelector("text=My Trip");
  ok(true, "legacy data migrated into a 'My Trip' trip");
  ok((await textOf(page2, ".t-trip")).includes("A$5.00"), "legacy entry total preserved (A$5.00)");
  await page2.click(".t-trip");
  await page2.click(".t-seg button:has-text('Timeline')");
  await page2.waitForSelector("text=Old noodle");
  ok((await textOf(page2, "body")).includes("A$495.00 left"), "legacy per-country budget carried over (A$495.00 left)");
  ok(errors2.length === 0, "no console/page errors in migration pass" + (errors2.length ? "\n    " + errors2.join("\n    ") : ""));
  await ctx2.close();

  /* ================= orphan recovery pass ================= */
  console.log("\n== Orphan recovery pass ==");
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await mockRates(ctx3);
  const errors3 = [];
  const page3 = await ctx3.newPage();
  collectErrors(page3, errors3);
  await ctx3.addInitScript(() => {
    localStorage.setItem("travel-expense-trips-v1", JSON.stringify([{ id: "t1", name: "Kept trip", colorIndex: 0, budgets: {}, createdAt: 1 }]));
    localStorage.setItem("travel-expense-data-v1", JSON.stringify([
      { id: "a", tripId: "t1", type: "expense", payment: "card", country: "Japan", description: "Ramen", category: "Food", amountTrip: 970, tripCurrency: "JPY", amountHome: 10, homeCurrency: "AUD", rate: 97, timestamp: "2026-07-01T03:00:00.000Z" },
      { id: "b", tripId: "GONE", type: "expense", payment: "card", country: "Japan", description: "Lost sushi", category: "Food", amountTrip: 1940, tripCurrency: "JPY", amountHome: 20, homeCurrency: "AUD", rate: 97, timestamp: "2026-07-02T03:00:00.000Z" }
    ]));
  });
  await page3.goto(BASE);
  await page3.waitForSelector("text=Recovered entries");
  ok(true, "orphaned entries surface in a 'Recovered entries' trip");
  ok((await textOf(page3, "body")).includes("A$20.00"), "orphaned entry value visible");
  ok(errors3.length === 0, "no console/page errors in orphan pass" + (errors3.length ? "\n    " + errors3.join("\n    ") : ""));
  await ctx3.close();

  /* ================= service worker / offline pass ================= */
  console.log("\n== Service worker & offline pass ==");
  const ctx4 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const errors4 = [];
  const page4 = await ctx4.newPage();
  collectErrors(page4, errors4);
  await page4.goto(BASE);
  await page4.waitForSelector("text=Your trips");
  const swActive = await page4.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return "unsupported";
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 8000))]);
    return reg && reg.active ? "active" : "timeout";
  });
  ok(swActive === "active", "service worker registered and active (got: " + swActive + ")");
  await page4.reload();
  await page4.waitForSelector("text=Your trips");
  await ctx4.setOffline(true);
  await page4.reload();
  await page4.waitForSelector("text=Your trips", { timeout: 10000 });
  ok(true, "app loads fully OFFLINE via service worker");
  await ctx4.setOffline(false);
  const swErrors = errors4.filter((e) => !/open\.er-api\.com|Failed to fetch|ERR_INTERNET_DISCONNECTED|ERR_FAILED/i.test(e));
  ok(swErrors.length === 0, "no unexpected errors in SW pass" + (swErrors.length ? "\n    " + swErrors.join("\n    ") : ""));
  await ctx4.close();
} finally {
  await browser.close();
  server.kill();
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
