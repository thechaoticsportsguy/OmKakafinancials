import { d, TRADE_SHARE_DECIMALS } from "./ledger";
import { actionSchema, symbolSchema, type Action } from "./schema";

type Sizing = { shares: string } | { amount: string };
type TradeDraft = { kind: "buy" | "sell"; symbol: string } & Sizing;
export type TradeClarification = { draft: TradeDraft; question: string };
export type TransactionResult = { action: Action } | { clarification: TradeClarification } | { error: string };

const number = "(?:(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?|\\.\\d+)";
const cents = "(?:cents?|cetns?|\u00a2)";
const currency = "(?:" + cents + "|dollars?|usd)";
const money = "(?:\\$\\s*)?" + number + "(?:\\s*" + currency + ")?";
const markedMoney = "(?:\\$\\s*" + number + "(?:\\s*" + currency + ")?|" + number + "\\s*" + currency + ")";
const shareWord = "(?:shares?|shraes?|shres?|shars?)";
const each = "(?:each|(?:per|pre) " + shareWord + "|/" + shareWord + ")";
const ticker = "(?<cashtag>\\$)?(?<symbol>[a-z][a-z0-9]*(?:[.-][a-z0-9]+)?)";
const tail = "(?<tail>(?:\\s+.*|@.*)?)";
const rule = (source: string) => new RegExp("^(?:" + source + ")$", "i");

const buyVerbs = new Set(["buy", "bought", "bougth", "bot", "add", "added", "purchase", "purchased", "invest", "invested"]);
const sellVerbs = new Set(["sell", "sold", "sld", "sel", "remove", "removed"]);
const depositVerbs = new Set(["deposit", "deposited", "depsoit", "add", "added"]);
const withdrawalVerbs = new Set(["withdraw", "withdrew", "withdrawal", "withdrawl", "remove", "removed"]);

const cashBody = rule("(?<amount>" + money + ")(?: (?:to |into |from )?cash(?: balance| account)?)?");
const explicitCash = /\bcash(?: balance| account)?$/i;
const sizedTrades = [
  rule("(?<amount>" + money + ") worth of " + ticker + tail),
  rule("(?<amount>" + markedMoney + ") (?:in|of) " + ticker + tail),
  rule("(?<shares>" + number + ")(?: " + shareWord + "(?: of| in)?)? " + ticker + tail),
  rule(ticker + " (?<shares>" + number + ") " + shareWord + tail),
];
const reordered = rule("(?<shares>" + number + ")(?: " + shareWord + ")? (?:(?:at|@) (?<atPrice>" + money
  + ")|(?<markedPrice>" + markedMoney + "))(?: " + each + ")? (?<link>bought for|for|of|in) " + ticker);
const atPrice = rule("(?:at\\s+|@\\s*)(?<price>" + money + ")(?: " + each + ")?");
const forEachPrice = rule("for (?<price>" + money + ") " + each);
const ambiguousFor = rule("for " + money + "(?: total)?");
const replyPrice = rule("(?:(?:at|for|it was|price was) )?(?<price>" + money + ")(?: " + each + ")?");
const moneyParts = rule("(?<dollar>\\$\\s*)?(?<value>" + number + ")(?:\\s*(?<unit>" + currency + "))?");
const sizingWord = rule(shareWord + "|" + currency + "|at|for|of|in|each|total");
const centsUnit = rule(cents);

export function cleanNumber(input: string) {
  return input.replaceAll(",", "").replace(/^\./, "0.");
}

export function parseMoney(input: string) {
  const parts = moneyParts.exec(input)?.groups;
  if (!parts) return;
  if (centsUnit.test(parts.unit ?? "")) {
    if (parts.dollar) return;
    return d(cleanNumber(parts.value)).div(100).toFixed();
  }
  return cleanNumber(parts.value);
}

export function validateAction(action: Action): TransactionResult {
  const result = actionSchema.safeParse(action);
  return result.success ? { action: result.data } : { error: "Use a valid ticker and positive amounts within the supported precision." };
}

function makeTrade(draft: TradeDraft, inputPrice: string): TransactionResult {
  const price = parseMoney(inputPrice);
  if (!price || d(price).lte(0)) {
    return { error: "Enter a positive price per share, such as $60, 60.25, or 60 cents. Use one currency unit." };
  }
  if ("shares" in draft) return validateAction({ ...draft, price });
  const shares = d(draft.amount).div(price).toDecimalPlaces(TRADE_SHARE_DECIMALS).toFixed();
  return validateAction({ ...draft, shares, price });
}

function needPrice(draft: TradeDraft, ambiguousTotal: boolean): TransactionResult {
  const direction = draft.kind === "buy" ? "buy" : "sell";
  const size = "shares" in draft ? draft.shares + " shares" : "$" + draft.amount;
  const context = direction + " " + size + " of " + draft.symbol;
  const question = ambiguousTotal
    ? "For the " + context + " entry, what was the price per share? Enter the per-share price, or rewrite the trade."
    : "What was the price per share to " + context + "?";
  return { clarification: { draft, question } };
}

function normalize(input: string) {
  return input.trim().replace(/[.?!]+$/, "").replace(/\s+/g, " ")
    .replace(/^please,? /i, "").replace(/^i /i, "").replace(/,? please$/i, "");
}

export function resolveTradePrice(clarification: TradeClarification, input: string): TransactionResult | undefined {
  const price = replyPrice.exec(normalize(input))?.groups?.price;
  return price ? makeTrade(clarification.draft, price) : undefined;
}

export function parseTransaction(input: string): TransactionResult {
  const [, verbText, body] = /^([a-z]+) (.+)$/i.exec(normalize(input)) ?? [];
  const verb = verbText?.toLowerCase();
  if (verb) {
    const cash = cashBody.exec(body)?.groups;
    const deposit = depositVerbs.has(verb);
    const withdrawal = withdrawalVerbs.has(verb);
    const implicitCash = !buyVerbs.has(verb) && !sellVerbs.has(verb);
    if (cash && (deposit || withdrawal) && (implicitCash || explicitCash.test(body))) {
      const amount = parseMoney(cash.amount);
      if (!amount) return { error: "Use one currency unit for the cash amount." };
      return validateAction({ kind: deposit ? "deposit" : "withdrawal", amount });
    }

    if (buyVerbs.has(verb) || sellVerbs.has(verb)) {
      const kind = buyVerbs.has(verb) ? "buy" : "sell";
      const reverse = reordered.exec(body)?.groups;
      const parts = reverse ?? sizedTrades.map((syntax) => syntax.exec(body)?.groups).find(Boolean);
      if (parts) {
        if (!parts.cashtag && sizingWord.test(parts.symbol)) {
          return { error: "Which ticker was traded? Include the symbol, for example SPMO or $FOR." };
        }
        const symbol = parts.symbol.toUpperCase();
        if (!symbolSchema.safeParse(symbol).success) return { error: "Enter a valid ticker symbol, such as SPMO or BRK.B." };
        if (kind === "sell" && reverse?.link.toLowerCase() === "bought for") {
          return { error: "Did you buy or sell these shares? Enter one transaction at a time." };
        }
        let sizing: Sizing;
        if (parts.amount !== undefined) {
          const amount = parseMoney(parts.amount);
          if (!amount || d(amount).lte(0)) return { error: "Enter a positive dollar amount using one currency unit." };
          sizing = { amount };
        } else {
          const shares = cleanNumber(parts.shares);
          if (d(shares).lte(0)) return { error: "Enter a positive share quantity." };
          sizing = { shares };
        }
        const draft: TradeDraft = { kind, symbol, ...sizing };
        const suffix = parts.tail?.trim() ?? "";
        const price = reverse?.atPrice ?? reverse?.markedPrice
          ?? atPrice.exec(suffix)?.groups?.price ?? forEachPrice.exec(suffix)?.groups?.price;
        if (price) return makeTrade(draft, price);
        if (!suffix || ambiguousFor.test(suffix)) return needPrice(draft, Boolean(suffix));
      }
      return { error: "Which amount is shares or dollars, and what was the price per share? Try “bought 5 SPY at $735” or “sell $10 worth of SPMO at $125 each.”" };
    }
    if (deposit || withdrawal) return { error: "What cash amount should be recorded? Try “deposit 500 dollars cash” or “withdraw $50 cash.”" };
  }
  return { error: "Which holding or cash change did you mean? Enter one command with a ticker or a cash amount." };
}
