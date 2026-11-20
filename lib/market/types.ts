export interface Quote {
  symbol: string;
  source: string;
  session: "regular";
  at: number;
  fetchedAt: number;
  price: string;
  previousClose: string | null;
  name?: string;
}

export interface QuoteResponse {
  quotes: Quote[];
  issues: Record<string, string>;
  configured: boolean;
  message?: string;
}

export interface MarketDataProvider {
  quote(symbol: string): Promise<Quote>;
  name(symbol: string): Promise<string | undefined>;
}
