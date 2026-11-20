import { eastern, regularClose, REGULAR_OPEN, tradingDay, marketClock, lastRegularDate } from "./calendar";
import { QUOTE_REFRESH_INTERVAL } from "./refresh";
import type { Quote } from "./types";

export function quoteFreshness(quote: Quote, now: number) {
  const { date, minutes } = eastern(quote.at);
  const market = marketClock(now);
  if (market.session === "regular" && date === market.date) {
    return now - quote.at <= QUOTE_REFRESH_INTERVAL + 60_000 ? "Recent quote" : "Stale quote";
  }
  if (date === lastRegularDate(now) && minutes >= regularClose(date) - 5) return "Last regular quote";
  return "Stale quote";
}

export function normalizeFinnhub(symbol: string, raw: unknown, fetchedAt: number): Quote {
  if (!raw || typeof raw !== "object") throw new Error("Quote unavailable.");
  const { c, pc, t } = raw as Record<string, unknown>;
  if (typeof c !== "number" || !Number.isFinite(c) || c <= 0 || typeof t !== "number" || !Number.isInteger(t)
    || t * 1000 < Date.UTC(2020, 0, 1) || t * 1000 > fetchedAt + 5_000) {
    throw new Error("No valid price and timestamp returned.");
  }
  const { date, minutes, seconds } = eastern(t * 1000);
  if (!tradingDay(date) || minutes < REGULAR_OPEN || minutes * 60 + seconds > regularClose(date) * 60) {
    throw new Error("No verifiable regular-session mark returned.");
  }
  return {
    symbol, source: "Finnhub", session: "regular", at: t * 1000, fetchedAt,
    price: String(c),
    previousClose: typeof pc === "number" && Number.isFinite(pc) && pc > 0 ? String(pc) : null,
  };
}
