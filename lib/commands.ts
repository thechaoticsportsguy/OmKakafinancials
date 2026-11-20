import { appendEvent, applyEvent, d, replay } from "./ledger";
import type { Action, LedgerEvent, PortfolioDocument } from "./schema";
import type { Metrics } from "./metrics";
import { money, percent, quotePrice, shares } from "./format";
import { cleanNumber, parseMoney, parseTransaction, validateAction, type TransactionResult } from "./transaction-parser";

type Question = { kind: "today" | "biggest" } | { kind: "allocation"; symbol: string };
export type Command = TransactionResult | { question: Question };

const ticker = "([a-z][a-z0-9]{0,7}(?:[.-][a-z0-9]{1,3})?)";
const number = "((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?|\\.\\d+)";

export function parseCommand(input: string): Command {
  const command = input.trim().replace(/[’]/g, "'").replace(/[.?!]+$/, "").replace(/\s+/g, " ");
  if (command.length > 200) return { error: "Enter one command under 200 characters." };
  const match = (expression: string) => command.match(new RegExp("^(?:" + expression + ")$", "i"));

  if (match("(?:show )?how much (?:i made|did i make) today|(?:show (?:me )?)?(?:my )?(?:today's|daily) (?:profit|gain|p/l|profit/loss)")) {
    return { question: { kind: "today" } };
  }
  if (match("(?:what(?:'s| is) )?(?:my )?(?:biggest|largest) (?:holding|position)")) {
    return { question: { kind: "biggest" } };
  }
  const allocation = match("(?:show (?:my )?allocation (?:in|to) |how much of my portfolio is (?:invested in|allocated to) )" + ticker);
  if (allocation) return { question: { kind: "allocation", symbol: allocation[1].toUpperCase() } };

  const quantity = match("(?:set|change|update) (?:my )?" + ticker + " (?:position |shares )?to " + number + " shares?");
  if (quantity) return validateAction({ kind: "quantity", symbol: quantity[1].toUpperCase(), shares: cleanNumber(quantity[2]) });
  const basis = match("(?:set|change|update) (?:my )?" + ticker + " (?:average cost|avg cost|average acquisition cost) to (.+?)(?: per share)?");
  if (basis) {
    const price = parseMoney(basis[2]);
    return price
      ? validateAction({ kind: "basis", symbol: basis[1].toUpperCase(), price })
      : { error: "What is the average cost per share? Enter a dollar or cents amount." };
  }
  const remove = match("(?:remove|delete) " + ticker + "(?: from (?:my |the )?portfolio)?");
  if (remove) return validateAction({ kind: "remove", symbol: remove[1].toUpperCase() });
  return parseTransaction(command);
}
export function eventTitle(action: Action) {
  switch (action.kind) {
    case "buy": return "Buy " + action.symbol;
    case "sell": return "Sell " + action.symbol;
    case "quantity": return "Adjust " + action.symbol + " shares";
    case "basis": return "Set " + action.symbol + " average cost";
    case "remove": return "Remove " + action.symbol;
    case "deposit": return "Deposit cash";
    case "withdrawal": return "Withdraw cash";
  }
}

export function actionDetail(action: Action) {
  if (action.kind === "buy" || action.kind === "sell") return shares(d(action.shares)) + " shares at " + quotePrice(d(action.price));
  if (action.kind === "deposit" || action.kind === "withdrawal") return money(d(action.amount));
  if (action.kind === "quantity") return shares(d(action.shares)) + " shares";
  if (action.kind === "basis") return quotePrice(d(action.price)) + " per share";
  return "Remove all shares from the tracker";
}

export function previewAction(action: Action, events: LedgerEvent[]) {
  const state = replay(events);
  const beforeCash = state.cash;
  const beforeRealized = state.realized;
  const before = "symbol" in action ? state.positions.get(action.symbol) : undefined;
  applyEvent(state, action);
  const after = "symbol" in action ? state.positions.get(action.symbol) : undefined;
  const transactionValue = action.kind === "buy" ? beforeCash.minus(state.cash)
    : action.kind === "sell" ? state.cash.minus(beforeCash) : null;
  const realized = action.kind === "sell" && before?.basis ? state.realized.minus(beforeRealized) : null;
  return {
    beforeCash, afterCash: state.cash, before, after, transactionValue, realized,
    averageCost: after?.basis?.div(after.shares) ?? null,
  };
}

export function prepareCommand(action: Action, events: LedgerEvent[], id: string) {
  return { action, id, ledger: JSON.stringify(events), preview: previewAction(action, events) };
}
export type PreparedCommand = ReturnType<typeof prepareCommand>;

export function confirmCommand(document: PortfolioDocument, pending: PreparedCommand, at: number, mark?: string) {
  if (document.events.some((event) => event.id === pending.id)) return document;
  if (JSON.stringify(document.events) !== pending.ledger) {
    throw new Error("The portfolio changed. Run the command again to review its effects.");
  }
  return appendEvent(document, { action: pending.action, id: pending.id, at, mark });
}

export function answerQuestion(question: Question, metrics: Metrics): string {
  if (question.kind === "today") return metrics.daily === null
    ? "Today's regular-session P/L is unavailable. This needs today's quotes and a known opening exposure."
    : "Today's regular-session P/L is " + money(metrics.daily, true) + ".";
  if (question.kind === "allocation") {
    const holding = metrics.holdings.find(({ symbol }) => symbol === question.symbol);
    if (!holding) return "There is no open " + question.symbol + " position.";
    if (!metrics.value?.gt(0) || !holding.value) return "Account allocation needs a complete, positive account value.";
    return question.symbol + " is " + percent(holding.value.div(metrics.value).times(100)) + " of account value, including cash.";
  }
  if (!metrics.holdings.length) return "There are no open holdings.";
  if (metrics.equities === null) return "Prices for every holding are needed to identify the largest.";
  const largest = metrics.holdings.reduce((top, holding) => holding.value!.gt(top.value!) ? holding : top);
  return largest.symbol + " is the largest holding at " + money(largest.value) + ".";
}
