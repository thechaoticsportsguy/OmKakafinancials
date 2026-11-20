import assert from "node:assert/strict";
import { test } from "node:test";
import { easternTime, lastRegularDate, marketClock, regularClose, tradingDay } from "../lib/market/calendar";
import { normalizeFinnhub, quoteFreshness } from "../lib/market/quote";
import { retrieveQuotes } from "../lib/market/provider";
import { QUOTE_REFRESH_INTERVAL, scheduleQuoteRefresh } from "../lib/market/refresh";

test("market clock handles Eastern DST, session boundaries, holidays and early closes", () => {
  assert.equal(new Date(easternTime("2026-03-06", 570)).toISOString(), "2026-03-06T14:30:00.000Z");
  assert.equal(new Date(easternTime("2026-03-09", 570)).toISOString(), "2026-03-09T13:30:00.000Z");
  assert.equal(marketClock(easternTime("2026-11-19", 239)).session, "overnight");
  assert.equal(marketClock(easternTime("2026-11-19", 240)).session, "premarket");
  assert.equal(marketClock(easternTime("2026-11-19", 570)).session, "regular");
  assert.equal(marketClock(easternTime("2026-11-19", 960)).session, "after-hours");
  assert.equal(marketClock(easternTime("2026-11-19", 1200)).session, "overnight");
  assert.equal(marketClock(easternTime("2026-11-20", 1200)).session, "closed");
  assert.equal(marketClock(easternTime("2026-11-21", 720)).session, "closed");
  assert.equal(marketClock(easternTime("2026-11-22", 1199)).session, "closed");
  assert.equal(marketClock(easternTime("2026-11-22", 1200)).session, "overnight");
  assert.equal(marketClock(easternTime("2026-11-25", 1200)).session, "closed");
  assert.equal(marketClock(easternTime("2026-11-26", 720)).session, "closed");
  assert.equal(marketClock(easternTime("2026-11-26", 1200)).session, "overnight");
  assert.equal(regularClose("2026-11-27"), 780);
  assert.equal(marketClock(easternTime("2026-11-27", 780)).session, "after-hours");
  assert.equal(marketClock(easternTime("2026-11-27", 1020)).session, "closed");
  assert.equal(lastRegularDate(easternTime("2026-11-27", 400)), "2026-11-25");
  assert.equal(tradingDay("2027-12-24"), false);
  assert.equal(tradingDay("2027-12-31"), true);
  assert.equal(tradingDay("2028-04-14"), false);
});

test("quote checks start immediately and stay hourly across market sessions and a manual refresh", (t) => {
  const start = easternTime("2026-11-19", 19 * 60 + 30);
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: start });
  const requests: { at: number; manual: boolean }[] = [];
  const deadlines: number[] = [];
  const schedule = scheduleQuoteRefresh(
    (manual) => requests.push({ at: Date.now(), manual }),
    (at) => deadlines.push(at),
  );
  t.mock.timers.tick(30 * 60 * 1000);
  schedule.checkDue();
  schedule.refreshNow();
  t.mock.timers.tick(30 * 60 * 1000 - 1);
  assert.equal(requests.length, 2);
  assert.deepEqual(deadlines, [start + QUOTE_REFRESH_INTERVAL]);
  t.mock.timers.tick(1);
  assert.deepEqual(requests, [
    { at: start, manual: false },
    { at: start + QUOTE_REFRESH_INTERVAL / 2, manual: true },
    { at: start + QUOTE_REFRESH_INTERVAL, manual: false },
  ]);
  assert.deepEqual(deadlines, [start + QUOTE_REFRESH_INTERVAL, start + 2 * QUOTE_REFRESH_INTERVAL]);
  schedule.stop();
  t.mock.timers.tick(QUOTE_REFRESH_INTERVAL);
  assert.equal(requests.length, 3);
});

test("quote normalization preserves provenance and rejects missing or ambiguous data", () => {
  const close = easternTime("2026-11-19", 960);
  const payload = { c: 105, pc: 100, t: close / 1000 };
  const result = normalizeFinnhub("SPY", payload, close + 1000);
  assert.deepEqual(result, {
    symbol: "SPY", source: "Finnhub", session: "regular", price: "105", previousClose: "100", at: close, fetchedAt: close + 1000,
  });
  assert.equal(quoteFreshness(result, close + 3600_000), "Last regular quote");
  assert.equal(quoteFreshness(result, easternTime("2026-11-20", 600)), "Stale quote");
  assert.equal(normalizeFinnhub("SPY", { ...payload, pc: 0 }, close).previousClose, null);
  for (const invalid of [{}, { ...payload, c: 0 }, { ...payload, t: payload.t + 60 }, { ...payload, t: 0 }]) {
    assert.throws(() => normalizeFinnhub("SPY", invalid, close + 120_000));
  }
});

test("market service coalesces requests and only a manual refresh bypasses a successful cache", async (t) => {
  let count = 0;
  let release = () => {};
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const now = Date.now();
  const stamp = easternTime(lastRegularDate(now), 570);
  t.mock.method(globalThis, "fetch", async (url: URL, init: RequestInit) => {
    count++;
    assert.equal(url.pathname, "/api/v1/quote");
    assert.equal(url.searchParams.get("symbol"), "VHT");
    assert.equal(url.searchParams.has("token"), false);
    assert.equal(new Headers(init.headers).get("X-Finnhub-Token"), "test-only");
    await waiting;
    return Response.json({ c: 122 + count, pc: 122, t: stamp / 1000 });
  });
  const a = retrieveQuotes(["VHT"], "test-only");
  const b = retrieveQuotes(["VHT"], "test-only");
  release();
  const [first, second] = await Promise.all([a, b]);
  const cached = await retrieveQuotes(["VHT"], "test-only");
  assert.equal(count, 1);
  assert.equal(first.quotes[0].price, "123");
  assert.deepEqual(second, first);
  assert.deepEqual(cached, first);
  const forced = await retrieveQuotes(["VHT"], "test-only", true);
  assert.equal(count, 2);
  assert.equal(forced.quotes[0].price, "124");
});

test("market service retries a transient upstream error without inventing a quote", async (t) => {
  let count = 0;
  t.mock.method(globalThis, "fetch", async () => {
    count++;
    return new Response(null, { status: 503 });
  });
  const response = await retrieveQuotes(["SCHD"], "test-only");
  assert.equal(count, 2);
  assert.equal(response.quotes.length, 0);
  assert.ok(response.issues.SCHD);
  assert.deepEqual(await retrieveQuotes(["SCHD"], "test-only", true), response);
  assert.equal(count, 2);
});
