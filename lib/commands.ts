import { actionSchema, type Action } from "./schema";
import { applyEvent, d, replay } from "./ledger";
import type { LedgerEvent } from "./schema";
import type { Metrics } from "./metrics";
import { money, percent, shares } from "./format";

type Question = { kind: "today" | "biggest" } | { kind: "allocation"; symbol: string };
export type Command = { action: Action } | { question: Question } | { error: string };

const ticker = "([a-z][a-z0-9]{0,7}(?:[.-][a-z0-9]{1,3})?)";
const number = "((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?|\\.\\d+)";
const funds = "\\$?\\s*" + number;
const clean = (input: string) => input.replaceAll(",", "").replace(/^\./, "0.");

export function parseCommand(input: string): Command {
  const command = input.trim().replace(/[’]/g, "'").replace(/[.?!]+$/, "").replace(/\s+/g, " ");
  const match = (expression: string) => command.match(new RegExp("^" + expression + "$", "i"));
  const validated = (action: Action): Command => {
    const result = actionSchema.safeParse(action);
    return result.success ? { action: result.data } : { error: "Enter a valid ticker and amount with the required precision." };
  };

  if (match("(?:show )?how much (?:i made|did i make) today|(?:show (?:me )?)?(?:my )?(?:today's|daily) (?:profit|gain|p/l|profit/loss)")) {
    return { question: { kind: "today" } };
  }
  if (match("(?:what(?:'s| is) )?(?:my )?(?:biggest|largest) (?:holding|position)")) {
    return { question: { kind: "biggest" } };
  }
  const allocation = match("(?:show (?:my )?allocation (?:in|to) |how much of my portfolio is (?:invested in|allocated to) )" + ticker);
  if (allocation) return { question: { kind: "allocation", symbol: allocation[1].toUpperCase() } };

  const trade = match("(buy|add|sell) " + number + " shares?(?: of)? " + ticker + " (?:at|@) " + funds + "(?: (?:per share|each))?");
  if (trade) return validated({
    kind: trade[1].toLowerCase() === "sell" ? "sell" : "buy",
    shares: clean(trade[2]), symbol: trade[3].toUpperCase(), price: clean(trade[4]),
  });
  const dollarTrade = match("buy " + funds + " (?:worth of|of) " + ticker + " (?:at|@) " + funds + "(?: (?:per share|each))?");
  if (dollarTrade) {
    const amount = clean(dollarTrade[1]);
    const price = clean(dollarTrade[3]);
    if (amount.length > 37 || price.length > 37 || d(price).lte(0)) return { error: "Enter a valid amount and a positive price per share." };
    return validated({
      kind: "buy", amount, price, symbol: dollarTrade[2].toUpperCase(),
      shares: d(amount).div(price).toDecimalPlaces(24).toFixed(),
    });
  }
  const quantity = match("(?:set|change|update) (?:my )?" + ticker + " (?:position |shares )?to " + number + " shares?");
  if (quantity) return validated({ kind: "quantity", symbol: quantity[1].toUpperCase(), shares: clean(quantity[2]) });
  const basis = match("(?:set|change|update) (?:my )?" + ticker + " (?:average cost|avg cost|average acquisition cost) to " + funds + "(?: per share)?");
  if (basis) return validated({ kind: "basis", symbol: basis[1].toUpperCase(), price: clean(basis[2]) });
  const remove = match("(?:remove|delete) " + ticker + "(?: from (?:my |the )?portfolio)?");
  if (remove) return validated({ kind: "remove", symbol: remove[1].toUpperCase() });
  const cash = match("(add|deposit|withdraw|remove) " + funds + "(?: (?:cash|to cash|from cash))");
  if (cash) return validated({
    kind: /^(withdraw|remove)$/i.test(cash[1]) ? "withdrawal" : "deposit", amount: clean(cash[2]),
  });
  const cashExplicit = match("(deposit|withdraw) \\$\\s*" + number);
  if (cashExplicit) return validated({
    kind: cashExplicit[1].toLowerCase() === "deposit" ? "deposit" : "withdrawal", amount: clean(cashExplicit[2]),
  });
  if (/^(buy|sell|add)\b/i.test(command)) {
    return { error: "Specify the ticker, shares or dollar amount, and execution price. Example: Buy 2 shares of NVDA at $185." };
  }
  return { error: "Which holding or cash change did you mean? Try an example below, or specify the ticker and change in one command." };
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
  if (action.kind === "buy" || action.kind === "sell") return shares(d(action.shares)) + " shares at " + money(d(action.price));
  if (action.kind === "deposit" || action.kind === "withdrawal") return money(d(action.amount));
  if (action.kind === "quantity") return shares(d(action.shares)) + " shares";
  if (action.kind === "basis") return money(d(action.price)) + " per share";
  return "Remove all shares from the tracker";
}

export function previewAction(action: Action, events: LedgerEvent[]) {
  const state = replay(events);
  const beforeCash = state.cash;
  const before = "symbol" in action ? state.positions.get(action.symbol) : undefined;
  applyEvent(state, action);
  const after = "symbol" in action ? state.positions.get(action.symbol) : undefined;
  return { beforeCash, afterCash: state.cash, before, after };
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
