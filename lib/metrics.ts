import type Decimal from "decimal.js";
import { applyEvent, d, replay, stored, tradeValue, type LedgerState } from "./ledger";
import { eastern, easternTime, lastRegularDate, marketClock, REGULAR_OPEN, offsetDate, tradingDay } from "./market/calendar";
import { quoteFreshness } from "./market/quote";
import type { Quote } from "./market/types";
import { sampleHoldings, type LedgerEvent, type PortfolioDocument, type Snapshot } from "./schema";

export type Quotes = Record<string, Quote | undefined>;
function sum(values: Decimal[]) {
  return values.reduce((total, value) => total.plus(value), d());
}
function completeSum(values: (Decimal | null)[]) {
  return values.some((value) => value === null) ? null : sum(values as Decimal[]);
}

export function quoteSymbols(state: LedgerState, events: LedgerEvent[], date: string) {
  return [...new Set([
    ...Object.keys(sampleHoldings),
    ...state.positions.keys(),
    ...events.filter(({ at, action }) => at > 0 && eastern(at).date === date && "symbol" in action && action.kind !== "basis")
      .map(({ action }) => "symbol" in action ? action.symbol : ""),
  ])].filter(Boolean).sort();
}

function dayGains(events: LedgerEvent[], quotes: Quotes, now: number) {
  const clock = marketClock(now);
  const gains = new Map<string, Decimal | null>();
  if (!clock.scheduled || clock.minutes < REGULAR_OPEN) return { gains, total: null };
  const start = easternTime(clock.date, 0);
  const end = easternTime(clock.date, clock.close);
  const initial = replay(events.filter(({ at }) => at < start)).positions;
  const today = new Map<string, LedgerEvent[]>();
  for (const event of events) {
    const { at, action } = event;
    if (at < start || at > end || !("symbol" in action) || action.kind === "basis") continue;
    const group = today.get(action.symbol) ?? [];
    group.push(event);
    today.set(action.symbol, group);
  }

  for (const symbol of new Set([...initial.keys(), ...today.keys()])) {
    const openingShares = initial.get(symbol)?.shares ?? d();
    const quote = quotes[symbol];
    const dayEvents = today.get(symbol) ?? [];
    // Once an intraday position correction enters the ledger, the original exposure is unknown.
    if (!quote || eastern(quote.at).date !== clock.date || (!openingShares.isZero() && !quote.previousClose)
      || dayEvents.some(({ action }) => action.kind === "quantity" || action.kind === "remove")) {
      gains.set(symbol, null);
      continue;
    }
    let shares = openingShares;
    let tradeCash = d();
    for (const { at, action } of dayEvents) {
      if (at > quote.at) break;
      if (action.kind === "buy") {
        shares = shares.plus(action.shares);
        tradeCash = tradeCash.minus(tradeValue(action));
      } else if (action.kind === "sell") {
        shares = shares.minus(action.shares);
        tradeCash = tradeCash.plus(tradeValue(action));
      }
    }
    const carry = openingShares.times(quote.previousClose ?? 0);
    gains.set(symbol, shares.times(quote.price).plus(tradeCash).minus(carry));
  }
  return { gains, total: completeSum([...gains.values()]) };
}

export function portfolioMetrics(state: LedgerState, events: LedgerEvent[], quotes: Quotes, now: number) {
  const daily = dayGains(events, quotes, now);
  const holdings = [...state.positions.entries()].map(([symbol, position]) => {
    const quote = quotes[symbol];
    const seed = sampleHoldings[symbol as keyof typeof sampleHoldings];
    const value = quote ? position.shares.times(quote.price) : null;
    const unrealized = value && position.basis ? value.minus(position.basis) : null;
    const dailyPercent = quote?.previousClose ? d(quote.price).div(quote.previousClose).minus(1).times(100) : null;
    return {
      symbol, name: seed?.name ?? quote?.name, ...position, quote, value, unrealized, dailyPercent,
      avg: position.basis?.div(position.shares) ?? null,
      unrealizedPercent: unrealized && position.basis?.gt(0) ? unrealized.div(position.basis).times(100) : null,
      daily: daily.gains.get(symbol) ?? null,
      freshness: quote ? quoteFreshness(quote, now) : "Unavailable",
    };
  });
  const invested = completeSum(holdings.map((holding) => holding.basis));
  const equities = completeSum(holdings.map((holding) => holding.value));
  const value = equities?.plus(state.cash) ?? null;
  const unrealized = completeSum(holdings.map((holding) => holding.unrealized));
  const realized = state.unknownRealized ? null : state.realized;
  const totalGain = unrealized && realized ? unrealized.plus(realized) : null;
  const netContributions = state.deposits.minus(state.withdrawals);
  const allRecent = holdings.every(({ freshness }) => freshness === "Recent quote" || freshness === "Last regular quote");
  return {
    holdings, invested, equities, value, unrealized, realized, totalGain, daily: daily.total,
    cash: state.cash, netContributions, allRecent,
  };
}
export type Metrics = ReturnType<typeof portfolioMetrics>;

export const periods = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "ALL"] as const;
export type Period = typeof periods[number];

export function periodStart(period: Period, now: number) {
  const date = eastern(now).date;
  if (period === "ALL") return 0;
  if (period === "1D" || period === "5D") {
    let tradingDate = lastRegularDate(now);
    for (let remaining = period === "1D" ? 0 : 4; remaining > 0;) {
      tradingDate = offsetDate(tradingDate, -1);
      if (tradingDay(tradingDate)) remaining--;
    }
    return easternTime(tradingDate, 0);
  }
  if (period === "YTD") return easternTime(date.slice(0, 4) + "-01-01", 0);
  const months = { "1M": 1, "3M": 3, "6M": 6, "1Y": 12 }[period];
  const parts = date.split("-").map(Number);
  const target = new Date(Date.UTC(parts[0], parts[1] - 1 - months, 1, 12));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
  target.setUTCDate(Math.min(parts[2], lastDay));
  return easternTime(target.toISOString().slice(0, 10), 0);
}

export function captureSnapshot(document: PortfolioDocument, metrics: Metrics, now: number): PortfolioDocument {
  if (!metrics.value || !metrics.allRecent || (!document.events.length && !metrics.holdings.length)) return document;
  const marks = metrics.holdings.map(({ symbol, quote }) => [symbol, quote!.at].join(":")).sort().join("|");
  const previous = document.snapshots.at(-1);
  if (previous?.marks === marks && previous.ledgerLength === document.events.length && previous.value === stored(metrics.value)) return document;
  const at = Math.max(now, (previous?.at ?? -1) + 1, document.events.at(-1)?.at ?? 0);
  return { ...document, snapshots: [...document.snapshots, {
    at, value: stored(metrics.value), ledgerLength: document.events.length, marks,
  }] };
}

// Modified Dietz weights each external flow by the fraction of the window it was invested.
export function investmentReturn(points: Snapshot[], events: LedgerEvent[]) {
  if (points.length < 2) return null;
  const start = points[0];
  const end = points[points.length - 1];
  const duration = end.at - start.at;
  if (duration <= 0 || d(start.value).lte(0)) return null;
  let total = d();
  let weighted = d();
  const state = replay(events.slice(0, start.ledgerLength));
  for (const event of events.slice(start.ledgerLength, end.ledgerLength)) {
    const { action, at } = event;
    let flow = d();
    if (action.kind === "deposit" || action.kind === "withdrawal") {
      flow = d(action.amount).times(action.kind === "deposit" ? 1 : -1);
    } else if (action.kind === "quantity" || action.kind === "remove") {
      const before = state.positions.get(action.symbol)?.shares ?? d();
      const change = (action.kind === "quantity" ? d(action.shares) : d()).minus(before);
      if (!change.isZero() && !event.mark) return null;
      flow = change.times(event.mark ?? 0);
    }
    applyEvent(state, action);
    total = total.plus(flow);
    weighted = weighted.plus(flow.times(Math.max(0, end.at - at)).div(duration));
  }
  const capital = d(start.value).plus(weighted);
  return capital.gt(0) ? d(end.value).minus(start.value).minus(total).div(capital).times(100) : null;
}
