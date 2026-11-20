import { normalizeFinnhub } from "./quote";
import type { MarketDataProvider, Quote, QuoteResponse } from "./types";
import { sampleHoldings } from "../schema";

class ProviderError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
const requests: number[] = [];
let blockedUntil = 0;

async function request(path: string, params: Record<string, string>, key: string): Promise<unknown> {
  const now = Date.now();
  while (requests.length && requests[0] <= now - 60_000) requests.shift();
  if (now < blockedUntil || requests.length >= 48 || requests.filter((at) => at > now - 1000).length >= 24) {
    throw new ProviderError("Quote budget is cooling down.", 429);
  }
  requests.push(now);
  const url = new URL("https://finnhub.io/api/v1/" + path);
  url.search = new URLSearchParams(params).toString();
  const response = await fetch(url, {
    headers: { "X-Finnhub-Token": key },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (response.status === 429) blockedUntil = Date.now() + 60_000;
  if (!response.ok) {
    const message = response.status === 401 || response.status === 403 ? "Finnhub denied access. Check the key and symbol coverage."
      : response.status === 429 ? "Finnhub rate limit reached." : "Finnhub is temporarily unavailable.";
    throw new ProviderError(message, response.status);
  }
  return response.json();
}

export function finnhub(key: string): MarketDataProvider {
  return {
    async quote(symbol) {
      for (let attempt = 0; ; attempt++) {
        let raw: unknown;
        try {
          raw = await request("quote", { symbol }, key);
        } catch (error) {
          if (attempt || (error instanceof ProviderError && error.status < 500)) throw error;
          await new Promise((resolve) => setTimeout(resolve, 450));
          continue;
        }
        return normalizeFinnhub(symbol, raw, Date.now());
      }
    },
    async name(symbol) {
      const result = await request("search", { q: symbol }, key) as { result?: unknown[] };
      if (!Array.isArray(result.result)) return;
      for (const match of result.result) {
        if (match && typeof match === "object" && "symbol" in match && match.symbol === symbol
          && "description" in match && typeof match.description === "string") {
          return match.description.slice(0, 140);
        }
      }
    },
  };
}

interface CacheEntry {
  quote?: Quote;
  next: number;
  issue?: string;
  pending?: Promise<void>;
}
const cache = new Map<string, CacheEntry>();
const names = new Map<string, { name?: string; retryAt: number }>();

export async function retrieveQuotes(symbols: string[], key: string, force = false): Promise<QuoteResponse> {
  const provider = finnhub(key);
  const now = Date.now();
  for (const [symbol, entry] of cache) {
    if (!entry.pending && entry.next < now - 3 * 86_400_000) cache.delete(symbol);
  }
  const entries = symbols.map((symbol) => {
    let entry = cache.get(symbol);
    if (!entry) {
      entry = { next: 0 };
      if (cache.size < 2000) cache.set(symbol, entry);
    }
    return { symbol, entry };
  }).sort((a, b) => a.entry.next - b.entry.next);

  // Batch in waves so the quote endpoint never opens one connection per holding.
  for (let start = 0; start < entries.length; start += 8) {
    await Promise.all(entries.slice(start, start + 8).map(async ({ symbol, entry }) => {
      if (entry.pending) return entry.pending;
      if (entry.next > now && (!force || entry.issue)) return;
      entry.pending = (async () => {
        try {
          const quote = await provider.quote(symbol);
          if (!entry.quote || quote.at >= entry.quote.at) {
            entry.quote = quote;
            entry.issue = undefined;
          } else entry.issue = "Provider returned an older mark. Using the last valid quote.";
          entry.next = Date.now() + 15_000;
        } catch (error) {
          entry.issue = error instanceof Error && error.name === "Error"
            ? error.message : "Quote request failed. Retrying automatically.";
          entry.next = Date.now() + (error instanceof ProviderError && error.status === 429 ? 30_000 : 45_000);
        } finally {
          entry.pending = undefined;
        }
      })();
      await entry.pending;
    }));
  }
  // Name lookup is lower priority than quote retrieval, and is cached independently.
  await Promise.all(entries.filter(({ symbol, entry }) =>
    entry.quote && !Object.hasOwn(sampleHoldings, symbol) && (names.get(symbol)?.retryAt ?? 0) <= now
  ).slice(0, 3).map(async ({ symbol }) => {
    if (names.size >= 2000) names.delete(names.keys().next().value!);
    names.set(symbol, { retryAt: now + 120_000 });
    try {
      const name = await provider.name(symbol);
      names.set(symbol, { name, retryAt: now + 86_400_000 });
    } catch {
      // The ticker remains available if a name lookup fails.
    }
  }));
  const quotes: Quote[] = [];
  const issues: Record<string, string> = {};
  for (const { symbol, entry } of entries) {
    if (entry.quote) quotes.push({ ...entry.quote, name: names.get(symbol)?.name });
    if (entry.issue) issues[symbol] = entry.issue;
  }
  return { quotes, issues, configured: true };
}
