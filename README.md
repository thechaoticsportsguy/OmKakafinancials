# OM Terminal

OM Terminal is a private, browser-local USD portfolio tracker built with Next.js App Router, strict TypeScript, Tailwind CSS, and TradingView Lightweight Charts. It starts with six editable example ETF positions. Their acquisition prices and cost bases are blank.

## Run locally

Requires Node.js 22 or newer.

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). To enable quotes, get a [free Finnhub personal API key](https://finnhub.io/register), set `FINNHUB_API_KEY` in `.env.local`, and restart the dev server. The key stays in the Next.js server process. The ledger, assistant, and backup features work without a key. Use the same browser profile and origin to reopen your portfolio. `localhost` and `127.0.0.1` have separate storage.

For a production build on your own machine, run `npm run build` and then `npm start`. Both server scripts bind to loopback for private personal use.

## Quotes and sessions

- The [Finnhub free plan](https://finnhub.io/pricing) lists personal use, US equity/ETF coverage and 60 API calls per minute. OM Terminal uses the [REST quote endpoint](https://finnhub.io/docs/api/quote) for US-listed USD instruments. Symbol and exchange coverage can vary. Alpha Vantage's free [Global Quote](https://www.alphavantage.co/documentation/) updates at end of day with a [25-request daily quota](https://www.alphavantage.co/support/api-key/). Twelve Data's [Basic tier](https://twelvedata.com/pricing) lists internal non-display use.
- The browser checks SPY, SCHD, VHT, JIVE, QQQM, SPMO and other held symbols on open and every 60 minutes across market sessions. Each batch immediately updates portfolio values. The dashboard shows the latest provider timestamp, the last successful check, and the next scheduled check. **Refresh Now** makes an extra request without moving the hourly schedule. If the browser suspends the page, an overdue check runs when it becomes active again.
- The server coalesces requests, shares successful quotes for 15 seconds, preserves the last valid mark during an error, retries transient failures once, and backs off after failures. Refresh Now bypasses the successful-quote cache and respects the backoff and limits of 48 requests per rolling minute and 24 per rolling second per server process.
- Each mark shows its timestamp, source, regular session, and freshness. During regular hours, a same-day mark is recent for one hour plus a minute of scheduling tolerance. Outside that session, a mark from the last scheduled day within five minutes of its close is labeled as the last regular quote. Older marks are labeled stale. Portfolio totals using those marks may be stale. Recording new market valuations requires complete coverage for every open position in that check.
- The clock runs in America/New_York and uses recurring U.S. stock-market holidays and the [NYSE's published early closes](https://www.nyse.com/trade/hours-calendars) through 2028. It uses a 4:00 AM premarket start, a 9:30 AM regular open, and normally a 4:00 PM regular close and 8:00 PM end to after-hours. The reference late session ends at 5:00 PM on early-close days. The overnight label indicates the 8:00 PM to 4:00 AM reference window leading into a trading day, regardless of individual venue availability.
- This integration uses only marks identified by a regular-session timestamp. Premarket, after-hours, and overnight prices are shown as unavailable. Off-hours valuations use the last available regular-session mark, with its own timestamp and freshness. A last quote is not a confirmed official closing print. Day percentage compares a quote with the preceding close for that quoted session.
- Finnhub's [terms of service](https://finnhub.io/terms-of-service) restrict the data and results to qualifying individual personal use and prohibit sharing or redistributing them without approval. Keep this app and backups containing Finnhub-derived values private. If access to that data ends, remove it as required by the terms, including applicable local history and backup files. The source repository contains no quote data or credentials.

## Ledger and calculations

Enter a command, review the share and cash changes, then choose **Confirm entry** to save it. Example commands include:

- `Add 2 shares of NVDA at $185`
- `Buy $500 worth of SPY at $735`
- `Sell 1 share of SPY at $740`
- `Change my SCHD position to 30 shares`
- `Set my VHT average cost to $165`
- `Remove JIVE from my portfolio`
- `Add $1,000 cash` or `Withdraw $50 cash`
- `Show how much I made today`
- `What's my biggest holding?`
- `How much of my portfolio is invested in QQQM?`

The assistant uses a deterministic parser. It records entries in a local ledger and cannot send orders to a brokerage.

- The ledger uses decimal arithmetic and moving-average acquisition cost. A sale realizes proceeds minus the proportional cost basis. Position quantity edits preserve a known average cost, and a removal makes an in-kind adjustment without sale proceeds. Setting an average cost establishes the basis for the currently held shares. A disposal that was recorded with unknown basis leaves aggregate realized P/L unknown.
- Account value includes cash and all marked holdings. Invested capital is the open cost basis of all holdings. Unknown aggregates remain unavailable. Contributions and withdrawals are tracked separately from trades. Recording a purchase without sufficient tracked cash can create a visible cash deficit until you record the funding. Withdrawals beyond tracked cash and sales beyond owned shares are rejected.
- Today's portfolio P/L uses the preceding regular-session close, today's accepted regular-session quotes, and trades entered through each quote's timestamp. Sales of fully closed positions can affect this number. Cash flows are excluded. When an intraday position adjustment makes the opening exposure uncertain, the affected daily result is unavailable.
- The line chart connects actual recorded account values, including cash, at their observation times. Distinct quote timestamps and ledger changes can produce a valuation. Repeated unchanged quotes outside regular hours do not add points. Existing and new valuations stay in local storage without pruning. Browser storage quotas still apply, and a failed save leaves the existing history intact. Investment return uses Modified Dietz over the recorded interval and adjusts for deposits, withdrawals, and in-kind position changes with a contemporaneous mark. Periods without two observations, reliable flow valuations, or positive capital show an unavailable return.
- These calculations cover the recorded assets and cash in USD. The allocation chart uses equity weights; the assistant's allocation answer uses account value including cash. The tracker has no dividend accounting, automatic corporate-action reconciliation, fee fields, tax-lot reporting, or currency conversion.

## Backup and verification

Settings supports export, import, and reset. Import validates the versioned JSON, ledger order, quantities, and snapshot references before asking to replace browser data. Other tabs on the same origin see saved changes. Browser storage limits and privacy settings may affect how much history can be saved.

```text
npm run lint
npm run typecheck
npm test
npm run build
```

- `app/` contains the App Router shell, styles, and same-origin quote route.
- `components/` contains the dashboard, charts, command interface, dialogs, and browser hooks.
- `lib/` contains the versioned schema, ledger, portfolio calculations, market calendar, provider, and parser.
- `tests/` covers the ledger, returns, snapshots, parser, market sessions, and quote handling using isolated fixtures.

Chart attribution is in [NOTICE](NOTICE). [TradingView Lightweight Charts](https://www.tradingview.com/).
