import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCommand, previewAction } from "../lib/commands";
import { money, quotePrice, quoteTime } from "../lib/format";
import { appendEvent, d, readDocument, replay } from "../lib/ledger";
import { captureSnapshot, investmentReturn, periodStart, portfolioMetrics, quoteSymbols } from "../lib/metrics";
import { easternTime } from "../lib/market/calendar";
import { samplePortfolio, type Action, type LedgerEvent, type PortfolioDocument, type Snapshot } from "../lib/schema";
import type { Quote } from "../lib/market/types";

const at = easternTime("2026-11-19", 11 * 60);
const yesterday = easternTime("2026-11-18", 15 * 60 + 59);
let sequence = 0;
function entry(action: Action, date = yesterday, mark?: string): LedgerEvent {
  return { action, id: String(++sequence), at: date, ...(mark ? { mark } : {}) };
}
function empty(): PortfolioDocument {
  return { version: 1, events: [], snapshots: [] };
}
function sessionQuote(price = "125", previousClose = "100", date = at): Quote {
  return { symbol: "SPY", source: "Fixture", session: "regular", at: date, fetchedAt: date, price, previousClose };
}
function point(value: string, time: number, ledgerLength = 0): Snapshot {
  return { value, at: time, ledgerLength, marks: "" };
}

test("fractional buys and average-cost partial sales preserve cash, remaining basis and realized gain", () => {
  const events = [
    entry({ kind: "deposit", amount: "1000" }),
    entry({ kind: "buy", symbol: "SPY", shares: "1.1", price: "100.1" }),
    entry({ kind: "buy", symbol: "SPY", shares: "0.9", price: "200.1" }),
    entry({ kind: "sell", symbol: "SPY", shares: "0.5", price: "180.1" }),
    entry({ kind: "withdrawal", amount: "10" }),
  ];
  const state = replay(events);
  const holding = state.positions.get("SPY")!;
  assert.equal(holding.shares.toFixed(), "1.5");
  assert.equal(holding.basis?.toFixed(), "217.65");
  assert.equal(state.realized.toFixed(), "17.5");
  assert.equal(state.cash.toFixed(), "789.85");
  assert.equal(state.deposits.toFixed(), "1000");
  assert.equal(state.withdrawals.toFixed(), "10");
  const metrics = portfolioMetrics(state, events, { SPY: sessionQuote("210") }, at);
  assert.equal(metrics.unrealized?.toFixed(), "97.35");
  assert.equal(metrics.totalGain?.toFixed(), "114.85");
  assert.equal(metrics.value?.toFixed(), "1104.85");
});

test("selling past the position and overdrawing cash are rejected without changing history", () => {
  const original = samplePortfolio();
  assert.throws(() => appendEvent(original, entry({ kind: "sell", symbol: "SPY", shares: "3", price: "1" })), /exceeds/);
  assert.throws(() => appendEvent(original, entry({ kind: "withdrawal", amount: "1" })), /cash/);
  assert.equal(original.events.length, 6);
});

test("unknown basis propagates through additions and disposals; an adjustment preserves earlier entries", () => {
  const original = samplePortfolio();
  assert.equal(replay(original.events).positions.get("SPY")?.basis, null);
  const buy = entry({ kind: "buy", symbol: "SPY", shares: "1", price: "300" });
  const sale = entry({ kind: "sell", symbol: "SPY", shares: "1", price: "325" });
  const adjusted = appendEvent(appendEvent(appendEvent(original, buy), sale),
    entry({ kind: "basis", symbol: "SPY", price: "200" }));
  assert.deepEqual(adjusted.events.slice(0, original.events.length), original.events);
  assert.equal(replay(adjusted.events).positions.get("SPY")?.basis?.toFixed(), "408.544");
  const metrics = portfolioMetrics(replay(adjusted.events), adjusted.events, {}, at);
  assert.equal(metrics.realized, null);
  assert.equal(metrics.invested, null);
  assert.equal(metrics.value, null);
});

test("quantity corrections retain average basis while removal is not a sale", () => {
  const events = [
    entry({ kind: "buy", symbol: "SPY", shares: "1", price: "100" }),
    entry({ kind: "quantity", symbol: "SPY", shares: "0.25" }),
  ];
  assert.equal(replay(events).positions.get("SPY")?.basis?.toFixed(), "25");
  const removed = replay([...events, entry({ kind: "remove", symbol: "SPY" })]);
  assert.equal(removed.positions.size, 0);
  assert.equal(removed.cash.toFixed(), "-100");
  assert.equal(removed.realized.toFixed(), "0");
});

test("running an action preview leaves its source ledger unchanged", () => {
  const original = samplePortfolio();
  const serialized = JSON.stringify(original);
  const preview = previewAction({ kind: "quantity", symbol: "SCHD", shares: "30" }, original.events);
  assert.equal(preview.before?.shares.toFixed(), "28.5229");
  assert.equal(preview.after?.shares.toFixed(), "30");
  assert.equal(preview.afterCash.toFixed(), "0");
  assert.equal(JSON.stringify(original), serialized);
});

test("day P/L includes today's trade proceeds, costs and closed-out exposure, excluding cash flows", () => {
  const events = [
    entry({ kind: "buy", symbol: "SPY", shares: "2", price: "90" }),
    entry({ kind: "sell", symbol: "SPY", shares: "2", price: "110" }, at - 60_000),
    entry({ kind: "deposit", amount: "1000" }, at - 20_000),
  ];
  const state = replay(events);
  const metrics = portfolioMetrics(state, events, { SPY: sessionQuote() }, at);
  assert.equal(metrics.daily?.toFixed(), "20");
  assert.equal(metrics.realized?.toFixed(), "40");
  assert.equal(metrics.value?.toFixed(), "1040");
  assert.equal(portfolioMetrics(state, events, { SPY: sessionQuote("100", "95", yesterday) }, at).daily, null);
});

test("day P/L uses the quote cutoff and will not fabricate exposure after a correction", () => {
  const events = [
    entry({ kind: "buy", symbol: "SPY", shares: "1", price: "90" }),
    entry({ kind: "buy", symbol: "SPY", shares: "1", price: "120" }, at + 100),
  ];
  const quote = sessionQuote("125");
  const beforeTrade = portfolioMetrics(replay(events), events, { SPY: quote }, at + 200);
  assert.equal(beforeTrade.daily?.toFixed(), "25");
  const afterTrade = portfolioMetrics(replay(events), events, { SPY: { ...quote, at: at + 500 } }, at + 500);
  assert.equal(afterTrade.daily?.toFixed(), "30");
  events.push(entry({ kind: "quantity", symbol: "SPY", shares: "3" }, at + 600));
  assert.equal(portfolioMetrics(replay(events), events, { SPY: quote }, at + 700).daily, null);
});

test("cash-flow-adjusted return weights deposits and withdrawals and keeps account value separate", () => {
  const events = [
    entry({ kind: "deposit", amount: "100" }, 2000),
    entry({ kind: "withdrawal", amount: "40" }, 2500),
  ];
  const points = [point("100", 1000), point("175", 3000, 2)];
  assert.equal(investmentReturn(points, events)?.toFixed(), d(15).div(140).times(100).toFixed());
  assert.equal(investmentReturn([point("100", 1000), point("160", 3000, 2)], events)?.toFixed(), "0");
  assert.equal(investmentReturn(points.slice(0, 1), events), null);
});

test("in-kind adjustments are treated as flows only with a recorded mark", () => {
  const events = [
    entry({ kind: "quantity", symbol: "SPY", shares: "1" }, 1000),
    entry({ kind: "quantity", symbol: "SPY", shares: "2" }, 2000, "100"),
  ];
  const points = [point("100", 1000, 1), point("200", 3000, 2)];
  assert.equal(investmentReturn(points, events)?.toFixed(), "0");
  assert.equal(investmentReturn(points, [events[0], { ...events[1], mark: undefined }]), null);
});

test("valuation snapshots require full fresh quotes and suppress repeat observations", () => {
  const data = appendEvent(empty(), entry({ kind: "quantity", symbol: "SPY", shares: "0.5" }));
  const holdingState = replay(data.events);
  const noPrices = portfolioMetrics(holdingState, data.events, {}, at);
  assert.equal(captureSnapshot(data, noPrices, at), data);
  const metrics = portfolioMetrics(holdingState, data.events, { SPY: sessionQuote() }, at);
  const captured = captureSnapshot(data, metrics, at);
  assert.equal(captured.snapshots.length, 1);
  assert.equal(captured.snapshots[0].value, "62.5");
  assert.equal(captureSnapshot(captured, metrics, at + 1000), captured);
  assert.deepEqual(readDocument(JSON.parse(JSON.stringify(captured))), captured);
  const stale = portfolioMetrics(holdingState, data.events, { SPY: sessionQuote("99", "100", at - 3_661_000) }, at);
  assert.equal(stale.value?.toFixed(), "49.5");
  assert.equal(captureSnapshot(data, stale, at), data);
});

test("new valuations retain every existing snapshot and repeated closes do not add points", () => {
  const data = appendEvent(empty(), entry({ kind: "quantity", symbol: "SPY", shares: "1" }));
  data.snapshots = Array.from({ length: 6502 }, (_, index) => point("100", at - 20 * 86_400_000 + index));
  const close = easternTime("2026-11-19", 960);
  const quotes = { SPY: sessionQuote("125", "100", close) };
  const state = replay(data.events);
  const firstCheck = close + 15 * 60_000;
  const valuation = portfolioMetrics(state, data.events, quotes, firstCheck);
  const updated = captureSnapshot(data, valuation, firstCheck);
  assert.equal(updated.snapshots.length, 6503);
  assert.deepEqual(updated.snapshots.slice(0, -1), data.snapshots);
  assert.equal(updated.snapshots.at(-1)?.at, firstCheck);
  assert.deepEqual(readDocument(updated), updated);

  const overnight = easternTime("2026-11-19", 1250);
  assert.equal(captureSnapshot(updated, portfolioMetrics(state, data.events, quotes, overnight), overnight), updated);
});

test("hourly checks always include the six ETFs and continue to price edited holdings", () => {
  const events = [entry({ kind: "buy", symbol: "NVDA", shares: "1", price: "100" })];
  assert.deepEqual(quoteSymbols(replay(events), events, "2026-11-19"), ["JIVE", "NVDA", "QQQM", "SCHD", "SPMO", "SPY", "VHT"]);
});

test("1D and 5D use the most recent trading sessions", () => {
  const weekend = easternTime("2026-11-28", 720);
  assert.equal(periodStart("1D", weekend), easternTime("2026-11-27", 0));
  assert.equal(periodStart("5D", weekend), easternTime("2026-11-20", 0));
});

test("backups enforce version, event IDs, sell limits and snapshot order", () => {
  const data = samplePortfolio();
  assert.throws(() => readDocument({ ...data, version: 7 }));
  assert.throws(() => readDocument({ ...data, events: [...data.events, data.events[0]] }), /duplicate/);
  assert.throws(() => readDocument({ ...data, events: [...data.events, entry({ kind: "sell", symbol: "SPY", shares: "9", price: "1" })] }), /exceeds/);
  assert.throws(() => readDocument({ ...data, snapshots: [point("5", at, 7)] }), /snapshot/);
});

test("parser supports the brief's language and asks for missing or ambiguous details", () => {
  const examples = [
    ["Add 2 shares of NVDA at $185.", "buy"], ["Buy $500 worth of SPY at $735.", "buy"],
    ["Sell 1 share of SPY at $740.", "sell"], ["Change my SCHD position to 30 shares.", "quantity"],
    ["Set my VHT average cost to $165.", "basis"], ["Remove JIVE from my portfolio.", "remove"],
    ["Add $1,000 cash.", "deposit"], ["Withdraw $100 from cash", "withdrawal"],
  ];
  for (const [text, kind] of examples) {
    const parsed = parseCommand(text);
    assert.equal("action" in parsed && parsed.action.kind, kind, text);
  }
  for (const command of ["Show how much I made today", "What's my biggest holding?", "How much of my portfolio is invested in QQQM?"]) {
    assert.ok("question" in parseCommand(command));
  }
  for (const command of ["Buy some SPY", "Sell 5 shares", "Buy $500 of SPY at $0", "Buy 1,00 shares SPY at $70", "Sell 2 shares of SPY at $10 and buy NVDA"]) {
    assert.ok("error" in parseCommand(command));
  }
  const trade = parseCommand(examples[1][0]);
  assert.ok("action" in trade);
  assert.equal(replay([entry(trade.action)]).cash.toFixed(), "-500");
});

test("money formatting retains cents beyond binary floating-point precision", () => {
  assert.equal(money(d("999999999999999999.01")), "$999,999,999,999,999,999.01");
  assert.equal(money(d("-0.001")), "$0.00");
});

test("quote formatting preserves fractional cents and second-level Eastern timestamps", () => {
  assert.equal(quotePrice(d("90.0207")), "$90.0207");
  assert.equal(quotePrice(d("1234.2")), "$1,234.20");
  assert.match(quoteTime(Date.parse("2026-11-19T21:00:05Z")), /4:00:05 PM EST/);
});
