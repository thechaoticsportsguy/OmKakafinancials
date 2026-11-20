import { z } from "zod";

export const symbolPattern = /^[A-Z][A-Z0-9]{0,7}(?:[.-][A-Z0-9]{1,3})?$/;
export const symbolSchema = z.string().regex(symbolPattern);
const decimalText = z.string().regex(/^\d{1,12}(?:\.\d{1,24})?$/);
const positive = decimalText.refine((value) => /[1-9]/.test(value));
export const actionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("buy"), symbol: symbolSchema, shares: positive, price: positive, amount: positive.optional() }),
  z.object({ kind: z.literal("sell"), symbol: symbolSchema, shares: positive, price: positive, amount: positive.optional() }),
  z.object({ kind: z.literal("deposit"), amount: positive }),
  z.object({ kind: z.literal("withdrawal"), amount: positive }),
  z.object({ kind: z.literal("quantity"), symbol: symbolSchema, shares: decimalText }),
  z.object({ kind: z.literal("basis"), symbol: symbolSchema, price: decimalText }),
  z.object({ kind: z.literal("remove"), symbol: symbolSchema }),
]);
export type Action = z.infer<typeof actionSchema>;
export type TradeAction = Extract<Action, { kind: "buy" | "sell" }>;

export const eventSchema = z.object({
  id: z.string().min(1).max(100),
  at: z.number().int().min(0).max(253402300799000),
  action: actionSchema,
  mark: positive.optional(),
  sample: z.literal(true).optional(),
});
export type LedgerEvent = z.infer<typeof eventSchema>;

export const snapshotSchema = z.object({
  at: z.number().int().min(0).max(253402300799000),
  value: z.string().max(90).regex(/^-?\d+(?:\.\d+)?$/),
  ledgerLength: z.number().int().nonnegative(),
  marks: z.string(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export const documentSchema = z.object({
  version: z.literal(1),
  events: z.array(eventSchema).max(25000),
  snapshots: z.array(snapshotSchema),
});
export type PortfolioDocument = z.infer<typeof documentSchema>;

export const sampleHoldings = {
  SPY: { shares: "2.04272", name: "SPDR S&P 500 ETF Trust" },
  SCHD: { shares: "28.52290", name: "Schwab U.S. Dividend Equity ETF" },
  VHT: { shares: "2.50489", name: "Vanguard Health Care ETF" },
  JIVE: { shares: "7.05639", name: "JPMorgan International Value ETF" },
  QQQM: { shares: "1.83506", name: "Invesco NASDAQ 100 ETF" },
  SPMO: { shares: "3.56181", name: "Invesco S&P 500 Momentum ETF" },
};

export function samplePortfolio(): PortfolioDocument {
  return {
    version: 1,
    events: Object.entries(sampleHoldings).map(([symbol, holding]) => ({
      id: "sample-" + symbol,
      at: 0,
      sample: true,
      action: { kind: "quantity", symbol, shares: holding.shares },
    })),
    snapshots: [],
  };
}
