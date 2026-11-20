import Decimal from "decimal.js";
import { type Action, type LedgerEvent, type PortfolioDocument, type TradeAction, documentSchema } from "./schema";

const Money = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_EVEN });
export const d = (value: Decimal.Value = 0) => new Money(value);
export const stored = (value: Decimal) => value.toFixed();
export const TRADE_SHARE_DECIMALS = 24;

export function tradeValue(action: TradeAction) {
  const computed = d(action.shares).times(action.price);
  if (action.amount === undefined) return computed;
  const amount = d(action.amount);
  // Dollar-sized orders retain exact proceeds or cost after fractional shares are rounded.
  const tolerance = d(action.price).times("1e-" + TRADE_SHARE_DECIMALS);
  if (computed.minus(amount).abs().gt(tolerance)) throw new Error("Trade amount does not match shares and price.");
  return amount;
}

export interface Position {
  shares: Decimal;
  basis: Decimal | null;
}
export interface LedgerState {
  positions: Map<string, Position>;
  cash: Decimal;
  realized: Decimal;
  unknownRealized: boolean;
  disposedBasis: Decimal;
  deposits: Decimal;
  withdrawals: Decimal;
}

export function replay(events: readonly LedgerEvent[]): LedgerState {
  const state: LedgerState = {
    positions: new Map(), cash: d(), realized: d(), unknownRealized: false,
    disposedBasis: d(), deposits: d(), withdrawals: d(),
  };
  for (const event of events) applyEvent(state, event.action);
  return state;
}

export function applyEvent(state: LedgerState, action: Action) {
  if (action.kind === "deposit" || action.kind === "withdrawal") {
    const amount = d(action.amount);
    if (action.kind === "deposit") {
      state.cash = state.cash.plus(amount);
      state.deposits = state.deposits.plus(amount);
    } else {
      if (amount.gt(state.cash)) throw new Error("Withdrawal exceeds available cash.");
      state.cash = state.cash.minus(amount);
      state.withdrawals = state.withdrawals.plus(amount);
    }
    return;
  }
  const { symbol } = action;
  const current = state.positions.get(symbol);
  if (action.kind === "buy") {
    const shares = d(action.shares);
    const cost = tradeValue(action);
    state.cash = state.cash.minus(cost);
    state.positions.set(symbol, {
      shares: (current?.shares ?? d()).plus(shares),
      basis: current ? current.basis?.plus(cost) ?? null : cost,
    });
    return;
  }
  if (action.kind === "quantity") {
    const shares = d(action.shares);
    if (shares.isZero()) state.positions.delete(symbol);
    else state.positions.set(symbol, {
      shares,
      basis: current?.basis?.times(shares).div(current.shares) ?? null,
    });
    return;
  }
  if (!current) throw new Error("There is no open " + symbol + " position.");
  if (action.kind === "basis") {
    state.positions.set(symbol, { ...current, basis: current.shares.times(action.price) });
    return;
  }
  if (action.kind === "remove") {
    state.positions.delete(symbol);
    return;
  }
  const shares = d(action.shares);
  const proceeds = tradeValue(action);
  if (shares.gt(current.shares) || (action.amount !== undefined && proceeds.gt(current.shares.times(action.price)))) {
    throw new Error("Sale exceeds the shares owned.");
  }
  const remaining = current.shares.minus(shares);
  const soldBasis = current.basis?.times(shares).div(current.shares) ?? null;
  state.cash = state.cash.plus(proceeds);
  if (soldBasis === null) state.unknownRealized = true;
  else {
    state.realized = state.realized.plus(proceeds.minus(soldBasis));
    state.disposedBasis = state.disposedBasis.plus(soldBasis);
  }
  if (remaining.isZero()) state.positions.delete(symbol);
  else state.positions.set(symbol, { shares: remaining, basis: soldBasis === null ? null : current.basis!.minus(soldBasis) });
}

export function readDocument(input: unknown): PortfolioDocument {
  const data = documentSchema.parse(input);
  const ids = new Set<string>();
  let lastAt = 0;
  for (const event of data.events) {
    if (ids.has(event.id) || event.at < lastAt || (event.sample && (event.at !== 0 || event.action.kind !== "quantity"))) {
      throw new Error("Invalid transaction order or duplicate ID.");
    }
    ids.add(event.id);
    lastAt = event.at;
  }
  replay(data.events);
  let previousAt = -1;
  let previousLength = 0;
  for (const snapshot of data.snapshots) {
    const { at, ledgerLength } = snapshot;
    if (at <= previousAt || ledgerLength < previousLength || ledgerLength > data.events.length
      || (ledgerLength > 0 && data.events[ledgerLength - 1].at > at)
      || (ledgerLength < data.events.length && data.events[ledgerLength].at < at)) {
      throw new Error("Invalid portfolio snapshot order.");
    }
    previousAt = at;
    previousLength = ledgerLength;
  }
  return data;
}

export function appendEvent(document: PortfolioDocument, event: LedgerEvent): PortfolioDocument {
  if (document.events.some((item) => item.id === event.id)) return document;
  if (document.events.length >= 25000) throw new Error("The portfolio ledger is full.");
  const state = replay(document.events);
  applyEvent(state, event.action);
  const at = Math.max(event.at, document.events.at(-1)?.at ?? 0, document.snapshots.at(-1)?.at ?? 0);
  return { ...document, events: [...document.events, { ...event, at }] };
}

export function formatShares(value: Decimal, decimalPlaces = 8) {
  const minimum = d(10).pow(-decimalPlaces);
  if (value.gt(0) && value.lt(minimum)) return "<" + minimum.toFixed();
  const [whole, fraction] = value.toDecimalPlaces(decimalPlaces).toFixed().split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : grouped + "." + fraction;
}
