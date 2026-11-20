import { ArrowDownLeft, ArrowUpRight, ChartPie, ChevronRight, CircleDollarSign, Clock3, ListFilter, PencilLine } from "lucide-react";
import { actionDetail, eventTitle } from "@/lib/commands";
import { dash, money, percent, quotePrice, shares, time, tone } from "@/lib/format";
import { d } from "@/lib/ledger";
import type { Metrics } from "@/lib/metrics";
import type { LedgerEvent } from "@/lib/schema";

const palette = ["#52e5bb", "#6798fa", "#9b82ee", "#ebac62", "#f2799b", "#49bbdc"];

export function Allocation({ metrics }: { metrics: Metrics }) {
  const { holdings, equities } = metrics;
  let start = 0;
  const assets = [];
  for (const [index, holding] of holdings.entries()) {
    const weight = equities?.gt(0) && holding.value ? holding.value.div(equities).times(100) : null;
    const boundary = start + (weight?.toNumber() ?? 0);
    const color = palette[index % palette.length];
    const segment = color + " " + start + "% " + Math.min(boundary, 100) + "%";
    start = boundary;
    assets.push({ symbol: holding.symbol, weight, color, segment });
  }
  const usable = equities?.gt(0);
  return <section className="panel allocation" aria-labelledby="allocation-title">
    <div className="panel-heading">
      <div><h2 id="allocation-title">Allocation</h2><p>Equity weights by market value</p></div>
      <ChartPie size={19} className="heading-icon" aria-hidden />
    </div>
    <div className="donut" style={usable ? { background: "conic-gradient(" + assets.map((asset) => asset.segment).join(",") + ")" } : undefined}>
      <div><strong className="mono">{holdings.length}</strong><span>{holdings.length === 1 ? "Position" : "Positions"}</span></div>
    </div>
    {assets.length ? <ul className="allocation-legend">{assets.map(({ symbol, color, weight }) => <li key={symbol}>
      <span><i style={{ backgroundColor: color }} />{symbol}</span>
      <span className="mono">{percent(weight)}</span>
    </li>)}</ul> : <p className="section-empty">Add a position to see allocation.</p>}
  </section>;
}

export function Holdings({ metrics, filter, clear, edit, issues }: {
  metrics: Metrics; filter: string; clear: () => void; edit: (symbol: string) => void; issues: Record<string, string>;
}) {
  const query = filter.trim().toLowerCase();
  const matches = metrics.holdings.filter(({ symbol, name }) => symbol.toLowerCase().includes(query) || name?.toLowerCase().includes(query));
  return <section className="panel holdings" id="holdings" aria-labelledby="holdings-title">
    <div className="panel-heading">
      <div><h2 id="holdings-title">Holdings <span className="count">{metrics.holdings.length}</span></h2>
        <p>Positions and regular-session marks in USD</p></div>
      {query && <button className="button compact outline" onClick={clear}><ListFilter size={14} /> Clear filter</button>}
      {!query && <span className="panel-tag">USD</span>}
    </div>
    {matches.length ? <div className="table-scroll" tabIndex={0} aria-label="Scrollable holdings table">
      <table>
        <thead><tr>
          <th scope="col">Asset</th><th scope="col">Shares</th><th scope="col">Avg. cost</th>
          <th scope="col">Cost basis</th><th scope="col">Market price</th><th scope="col">Day %</th>
          <th scope="col">Market value</th><th scope="col">Day P/L</th><th scope="col">Unrealized P/L</th>
          <th scope="col" aria-label="Position actions" />
        </tr></thead>
        <tbody>
          {matches.map((holding) => <tr key={holding.symbol}>
            <th scope="row"><div className="asset">
              <span className="asset-icon">{holding.symbol.slice(0, 2)}</span>
              <div><strong>{holding.symbol}</strong><span title={holding.name ?? "Name unavailable"}>{holding.name ?? "Name unavailable"}</span></div>
            </div></th>
            <td>{shares(holding.shares)}</td>
            <td>{holding.avg ? money(holding.avg) : <span className="muted">Not set</span>}</td>
            <td>{holding.basis ? money(holding.basis) : <span className="muted">Not set</span>}</td>
            <td>{holding.quote ? quotePrice(d(holding.quote.price)) : dash}<small className={holding.freshness === "Stale quote" ? "amber" : ""}>
              {holding.freshness}</small></td>
            <td className={tone(holding.dailyPercent)}>{percent(holding.dailyPercent, true)}</td>
            <td>{money(holding.value)}</td>
            <td className={tone(holding.daily)}>{money(holding.daily, true)}</td>
            <td className={tone(holding.unrealized)}>{money(holding.unrealized, true)}<small>{percent(holding.unrealizedPercent, true)}</small></td>
            <td><button className="icon-button" aria-label={"Manage " + holding.symbol} onClick={() => edit(holding.symbol)}><PencilLine size={15} /></button></td>
          </tr>)}
        </tbody>
      </table>
    </div> : <p className="section-empty">{query ? "No holdings match your search." : "There are no open holdings. Record a buy or set a share quantity to get started."}</p>}
    <p className="table-note">Manage a position to see its prior close, quote timestamp and extended-hours availability.
      {Object.keys(issues).length > 0 && " Some requested quotes could not be refreshed."}</p>
  </section>;
}

export function Activity({ events, full = false, expand }: {
  events: LedgerEvent[]; full?: boolean; expand?: () => void;
}) {
  const reversed = [...events].reverse();
  const shown = full ? reversed : reversed.slice(0, 4);
  return <section className={full ? "" : "panel activity"} id={full ? undefined : "activity"} aria-labelledby={full ? undefined : "activity-title"}>
    {!full && <div className="panel-heading">
      <div><h2 id="activity-title">Recent transactions</h2><p>Portfolio ledger</p></div>
      <Clock3 size={19} className="heading-icon" aria-hidden />
    </div>}
    {shown.length ? <ul className="transactions">{shown.map((event) => {
      const { kind } = event.action;
      const Icon = kind === "buy" || kind === "deposit" ? ArrowDownLeft
        : kind === "sell" || kind === "withdrawal" ? ArrowUpRight : event.sample ? CircleDollarSign : PencilLine;
      return <li key={event.id}>
        <span className="transaction-icon"><Icon size={17} aria-hidden /></span>
        <div>
          <strong>{event.sample && "symbol" in event.action ? event.action.symbol + " opening position" : eventTitle(event.action)}</strong>
          <span>{event.sample ? "Example holding" : time(event.at)}</span>
        </div>
        <span className="mono">{actionDetail(event.action)}</span>
      </li>;
    })}</ul> : <p className="section-empty">Your ledger is empty.</p>}
    {!full && events.length > 0 && <button className="text-button activity-link" onClick={expand}>View transaction history <ChevronRight size={15} /></button>}
  </section>;
}
