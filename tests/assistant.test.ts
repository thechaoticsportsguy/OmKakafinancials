import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmCommand, parseCommand, prepareCommand } from "../lib/commands";
import { d, formatShares, readDocument, replay, tradeValue } from "../lib/ledger";
import { portfolioMetrics } from "../lib/metrics";
import { resolveTradePrice } from "../lib/transaction-parser";
import type { Action, PortfolioDocument, TradeAction } from "../lib/schema";

function action(input: string): Action {
  const result = parseCommand(input);
  assert.ok("action" in result, input);
  return result.action;
}

function trade(input: string): TradeAction {
  const result = action(input);
  assert.ok(result.kind === "buy" || result.kind === "sell", input);
  return result;
}

function seeded(): PortfolioDocument {
  return {
    version: 1,
    events: [
      { id: "initial-cash", at: 10, action: { kind: "deposit", amount: "500" } },
      { id: "initial-position", at: 20, action: { kind: "buy", symbol: "SPMO", shares: "10", price: "1.25" } },
    ],
    snapshots: [{ at: 21, value: "500", ledgerLength: 2, marks: "existing" }],
  };
}

test("the supplied share trades and cash language parse to the intended values", () => {
  for (const [input, kind, symbol, shares, price, total] of [
    ["add 20 60 cents bought for spmo", "buy", "SPMO", "20", "0.6", "12"],
    ["bought 5 spy at 735", "buy", "SPY", "5", "735", "3675"],
    ["add 2.5 shares qqqm at 210", "buy", "QQQM", "2.5", "210", "525"],
    ["sold 3 schd for 29 each", "sell", "SCHD", "3", "29", "87"],
    ["add 20 shares of spmo at 60 cents", "buy", "SPMO", "20", "0.6", "12"],
    ["bought 10 spmo at 60.25", "buy", "SPMO", "10", "60.25", "602.5"],
    ["bought 10 spmo at $60", "buy", "SPMO", "10", "60", "600"],
    ["please, I bougth 0.25 shraes of $SPMO at 25 cetns each!", "buy", "SPMO", "0.25", "0.25", "0.0625"],
    ["add 0.1 BRK.B at 60¢", "buy", "BRK.B", "0.1", "0.6", "0.06"],
    ["bought 1 INTC at $30", "buy", "INTC", "1", "30", "30"],
    ["sold 2 CAT at $100", "sell", "CAT", "2", "100", "200"],
  ]) {
    const parsed = trade(input);
    assert.deepEqual(parsed, { kind, symbol, shares, price }, input);
    assert.equal(tradeValue(parsed).toFixed(), total, input);
  }
  assert.deepEqual(action("deposit 500 dollars cash"), { kind: "deposit", amount: "500" });
  assert.deepEqual(action("withdrew 50 cents from cash"), { kind: "withdrawal", amount: "0.5" });
});

test("dollar purchases and sales preserve the exact dollar amount", () => {
  const buy = trade("invested $100 in vht at 170");
  assert.equal(buy.kind, "buy");
  assert.equal(buy.symbol, "VHT");
  assert.equal(buy.price, "170");
  assert.equal(buy.shares, "0.588235294117647058823529");
  assert.equal(formatShares(d(buy.shares), 24), buy.shares);
  assert.equal(formatShares(d("12345.123456789"), 24), "12,345.123456789");
  assert.equal(tradeValue(buy).toFixed(), "100");

  const sell = trade("sold $10 worth of SPMO at 7");
  assert.equal(sell.kind, "sell");
  assert.equal(sell.shares, "1.428571428571428571428571");
  assert.equal(tradeValue(sell).toFixed(), "10");
  const doc = seeded();
  const prepared = prepareCommand(sell, doc.events, "sell-1");
  const preview = prepared.preview;
  const basisSold = d(sell.shares).times("1.25");
  assert.equal(preview.transactionValue?.toFixed(), "10");
  assert.equal(preview.afterCash.toFixed(), "497.5");
  assert.equal(preview.after?.shares.toFixed(), "8.571428571428571428571429");
  assert.equal(preview.realized?.toFixed(), d(10).minus(basisSold).toFixed());
  const updated = confirmCommand(doc, prepared, 22);
  const restored = readDocument(JSON.parse(JSON.stringify(updated)));
  assert.deepEqual(restored.events.at(-1)?.action, sell);
  assert.equal(replay(restored.events).cash.toFixed(), "497.5");
  assert.equal(replay(restored.events).positions.get("SPMO")?.basis?.toFixed(), d("12.5").minus(basisSold).toFixed());
});

test("missing or ambiguous prices require clarification before anything can be prepared", () => {
  const doc = seeded();
  const before = JSON.stringify(doc);
  const result = parseCommand("remove $10 worth of spmo");
  assert.ok("clarification" in result);
  assert.match(result.clarification.question, /price per share.*sell \$10 of SPMO/i);
  assert.equal(resolveTradePrice(result.clarification, "whatever it's trading at"), undefined);
  assert.ok("error" in resolveTradePrice(result.clarification, "0")!);
  const reply = resolveTradePrice(result.clarification, "at $5 each");
  assert.ok(reply && "action" in reply);
  assert.deepEqual(reply.action, { kind: "sell", symbol: "SPMO", amount: "10", shares: "2", price: "5" });
  const preview = prepareCommand(reply.action, doc.events, "sale");
  assert.equal(preview.preview.transactionValue?.toFixed(), "10");
  assert.equal(JSON.stringify(doc), before);

  const ambiguous = parseCommand("sold 3 SCHD for 29");
  assert.ok("clarification" in ambiguous);
  assert.match(ambiguous.clarification.question, /price per share/i);
  assert.ok("clarification" in parseCommand("buy $40 worth of SPY"));
  for (const input of ["add 20 60 spmo", "invested 100 in VHT at 170", "add $25", "buy 2 SPMO at $60 cents", "buy 2 SPMO at 0", "buy 20 shares"]) {
    assert.ok("error" in parseCommand(input), input);
  }
});

test("buy preview uses the entered price and computes shares, invested amount, average basis and cash", () => {
  const doc = seeded();
  const buy = trade("add 20 60 cents bought for spmo");
  const { preview } = prepareCommand(buy, doc.events, "purchase");
  assert.equal(preview.transactionValue?.toFixed(), "12");
  assert.equal(preview.after?.shares.toFixed(), "30");
  assert.equal(preview.after?.basis?.toFixed(), "24.5");
  assert.equal(preview.averageCost?.toFixed(), d("24.5").div(30).toFixed());
  assert.equal(preview.beforeCash.toFixed(), "487.5");
  assert.equal(preview.afterCash.toFixed(), "475.5");

  const updated = confirmCommand(doc, prepareCommand(buy, doc.events, "purchase"), 22);
  const state = replay(updated.events);
  const quote = { symbol: "SPMO", source: "Fixture", session: "regular" as const, at: 22, fetchedAt: 22, price: "124", previousClose: null };
  const metrics = portfolioMetrics(state, updated.events, { SPMO: quote }, 23);
  assert.equal(metrics.value?.toFixed(), "4195.5");
  assert.equal(metrics.invested?.toFixed(), "24.5");
  const recorded = updated.events.at(-1)?.action;
  assert.equal(recorded?.kind === "buy" && recorded.price, "0.6");
});

test("invalid tickers, oversells and withdrawals without cash never produce a confirmable preview", () => {
  for (const input of ["buy 3 1234 at $40", "buy 3 A@PL at $40", "buy 3 ABCDEFGHI at $40", "buy 3 SPMO! at $40"]) {
    assert.ok("error" in parseCommand(input), input);
  }
  const { events } = seeded();
  assert.throws(() => prepareCommand(trade("sold 11 SPMO at 5"), events, "blocked"), /shares owned/);
  assert.throws(() => prepareCommand(trade("remove $51 worth of SPMO at $5"), events, "blocked"), /shares owned/);
  const roundedOversell = trade("sell $990.000000000000000000000001 worth of SPMO at $99");
  assert.equal(roundedOversell.shares, "10");
  assert.throws(() => prepareCommand(roundedOversell, events, "blocked"), /shares owned/);
  assert.throws(() => prepareCommand(trade("sold 1 UNKNOWN at 5"), events, "blocked"), /no open UNKNOWN/);
  assert.throws(() => prepareCommand(action("withdraw $501 cash"), events, "blocked"), /available cash/);
});

test("confirmation appends once, preserves prior records and rejects a stale preview", () => {
  const original = seeded();
  const serialized = JSON.stringify(original);
  const prepared = prepareCommand(trade("bought 2 spmo at 60 cents"), original.events, "same-id");
  const stale = prepareCommand(action("deposit 20 dollars cash"), original.events, "stale");
  assert.equal(JSON.stringify(original), serialized, "preparing or discarding a preview leaves storage data alone");
  const updated = confirmCommand(original, prepared, 25);
  assert.equal(updated.events.length, original.events.length + 1);
  assert.deepEqual(updated.events.slice(0, -1), original.events);
  assert.equal(updated.snapshots, original.snapshots);
  assert.equal(confirmCommand(updated, prepared, 26), updated);
  assert.throws(() => confirmCommand(updated, stale, 26), /portfolio changed/);
});
