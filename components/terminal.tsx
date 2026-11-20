"use client";

import {
  Activity as ActivityIcon, CandlestickChart, CircleDollarSign, Database, LayoutDashboard, LineChart,
  RefreshCw, Search, Settings2, Table2, Terminal as TerminalIcon, TrendingUp, Wallet, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { answerQuestion, eventTitle, parseCommand, previewAction } from "@/lib/commands";
import { clock, dash, money, percent, quoteTime, tone } from "@/lib/format";
import { appendEvent, replay } from "@/lib/ledger";
import { captureSnapshot, investmentReturn, portfolioMetrics, quoteSymbols } from "@/lib/metrics";
import { marketClock, sessionNames } from "@/lib/market/calendar";
import { quoteFreshness } from "@/lib/market/quote";
import { actionSchema, samplePortfolio, type Action, type PortfolioDocument } from "@/lib/schema";
import { Assistant } from "./assistant";
import { Dialog, PositionDetail, Settings } from "./dialogs";
import { Performance } from "./performance";
import { Activity, Allocation, Holdings } from "./portfolio-panels";
import { useMarket, usePortfolio } from "./use-terminal";

type Modal = { kind: "settings" } | { kind: "history" } | { kind: "position"; symbol: string } | { kind: "replace"; data?: PortfolioDocument };
type Pending = { action: Action; ledger: string; id: string };

function MetricCard({ label, icon, value, hint, color }: {
  label: string; icon: ReactNode; value: string; hint: ReactNode; color?: string;
}) {
  return <div className="metric">
    <div className="metric-top"><span>{label}</span>{icon}</div>
    <strong className={"mono metric-value " + (color ?? "")}>{value}</strong>
    <span className="metric-hint">{hint}</span>
  </div>;
}

const links = [
  { label: "Overview", href: "#overview", icon: LayoutDashboard },
  { label: "Holdings", href: "#holdings", icon: Table2 },
  { label: "Assistant", href: "#assistant", icon: TerminalIcon },
  { label: "Transactions", href: "#activity", icon: ActivityIcon },
];

export function Terminal() {
  const { data, ready, error: storageError, save } = usePortfolio();
  const [now, setNow] = useState(0);
  const [section, setSection] = useState("#overview");
  const [filter, setFilter] = useState("");
  const [input, setInput] = useState("");
  const [modal, setModal] = useState<Modal | null>(null);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [commandMessage, setCommandMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const transactionRunning = useRef(false);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 1000);
    function shortcut(event: KeyboardEvent) {
      const target = event.target;
      if (event.key === "/" && target instanceof HTMLElement && !target.closest("input, textarea, dialog, [contenteditable]")) {
        if (document.querySelector("dialog[open]")) return;
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener("keydown", shortcut);
    function syncSection() {
      const hash = window.location.hash;
      setSection(links.some(({ href }) => href === hash) ? hash : "#overview");
    }
    syncSection();
    window.addEventListener("hashchange", syncSection);
    return () => {
      clearInterval(id);
      document.removeEventListener("keydown", shortcut);
      window.removeEventListener("hashchange", syncSection);
    };
  }, []);

  const state = useMemo(() => replay(data.events), [data.events]);
  const clockInfo = now ? marketClock(now) : null;
  const date = clockInfo?.date ?? "";
  const symbols = useMemo(() => quoteSymbols(state, data.events, date).join(","), [state, data.events, date]);
  const market = useMarket(symbols, ready && !!now);
  const metrics = useMemo(() => portfolioMetrics(state, data.events, market.quotes, now), [state, data.events, market.quotes, now]);
  const lifetimeReturn = useMemo(() => investmentReturn(data.snapshots, data.events), [data.snapshots, data.events]);
  const quoted = metrics.holdings.filter(({ quote }) => quote).length;
  const stale = metrics.holdings.some(({ freshness }) => freshness === "Stale quote");
  const issuesCount = symbols.split(",").filter((symbol) => market.issues[symbol]).length;

  useEffect(() => {
    if (!ready || storageError) return;
    const at = Date.now();
    const valuation = portfolioMetrics(state, data.events, market.observed, at);
    if (captureSnapshot(data, valuation, at) === data) return;
    void save((latest) => {
      const current = portfolioMetrics(replay(latest.events), latest.events, market.observed, at);
      return captureSnapshot(latest, current, at);
    }).catch(() => setNotice("A valuation could not be saved. Existing history is still available. Check browser storage in Settings."));
  }, [data, market.observed, state, ready, save, storageError]);

  function open(next: Modal) {
    setNotice("");
    setModal(next);
  }
  function goToAssistant(command: string) {
    setModal(null);
    setCommandMessage(null);
    setPending(null);
    setInput(command);
    window.location.hash = "assistant";
    requestAnimationFrame(() => inputRef.current?.focus());
  }
  function run(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    setPending(null);
    const result = parseCommand(input);
    if ("error" in result) setCommandMessage({ text: result.error, error: true });
    else if ("question" in result) setCommandMessage({ text: answerQuestion(result.question, metrics) });
    else {
      try {
        previewAction(result.action, data.events);
        setPending({ action: result.action, ledger: JSON.stringify(data.events), id: crypto.randomUUID() });
        setCommandMessage(null);
      } catch (error) {
        setCommandMessage({ text: error instanceof Error ? error.message : "The transaction is invalid.", error: true });
      }
    }
  }

  async function confirmEntry() {
    if (!pending || transactionRunning.current) return;
    transactionRunning.current = true;
    setBusy(true);
    const { action, id, ledger } = pending;
    try {
      await save((latest) => {
        if (JSON.stringify(latest.events) !== ledger) throw new Error("The portfolio changed. Run the command again to review its effects.");
        const quote = "symbol" in action ? market.quotes[action.symbol] : undefined;
        const proposedMark = quote && quoteFreshness(quote, now) !== "Stale quote" ? quote.price : undefined;
        let mark: string | undefined;
        if ((action.kind === "quantity" || action.kind === "remove") && proposedMark
          && actionSchema.safeParse({ kind: "basis", symbol: action.symbol, price: proposedMark }).success) mark = proposedMark;
        return appendEvent(latest, { action, at: Date.now(), id, mark });
      });
      setPending(null);
      setInput("");
      setCommandMessage({ text: eventTitle(action) + " recorded in your portfolio." });
    } catch (error) {
      setPending(null);
      setCommandMessage({ text: error instanceof Error ? error.message : "The entry could not be saved.", error: true });
    } finally {
      setBusy(false);
      transactionRunning.current = false;
    }
  }

  async function replacePortfolio(next?: PortfolioDocument) {
    if (transactionRunning.current) return;
    transactionRunning.current = true;
    setBusy(true);
    try {
      await save(() => next ?? samplePortfolio(), next ?? samplePortfolio());
      setPending(null);
      setCommandMessage(null);
      setFilter("");
      setNotice(next ? "Portfolio backup restored." : "Sample portfolio restored.");
      setModal({ kind: "settings" });
    } catch {
      setNotice("The portfolio could not be saved. Check that this browser allows local storage.");
    } finally {
      setBusy(false);
      transactionRunning.current = false;
    }
  }

  const current = modal?.kind === "position" ? metrics.holdings.find(({ symbol }) => symbol === modal.symbol) : undefined;
  const freshness = !metrics.holdings.length ? "No open holdings" : !quoted ? "Quotes unavailable" : stale ? "Stale marks in use"
    : quoted < metrics.holdings.length ? "Some quotes missing" : clockInfo?.session === "regular" ? "Recent regular quotes" : "Last regular quotes";
  const headingState = !ready ? "Restoring your portfolio" : market.configured === false ? "Market data disconnected"
    : market.configured === null ? market.message || "Connecting to market data" : freshness;

  return <div className="terminal-shell" id="overview">
    <a className="skip-link" href="#main">Skip to portfolio</a>
    <aside className="sidebar" aria-label="Terminal navigation">
      <a className="brand" href="#overview">
        <span className="brand-icon"><CandlestickChart size={22} strokeWidth={2.35} /></span>
        <span>OM<span> Terminal</span><small>PORTFOLIO TRACKER</small></span>
      </a>
      <nav>{links.map(({ label, href, icon: Icon }) => <a key={href} href={href} aria-label={label} aria-current={section === href ? "location" : undefined}>
        <Icon size={17} strokeWidth={1.8} /> <span>{label}</span>
      </a>)}</nav>
      <div className="side-bottom">
        <button onClick={() => open({ kind: "settings" })}><Settings2 size={17} strokeWidth={1.8} /> Settings</button>
        <div className="private"><Database size={15} /> Browser storage</div>
      </div>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <a className="mobile-brand" href="#overview"><CandlestickChart size={20} /> OM Terminal</a>
        <div className="market-bar">
          <span className={"session-pill " + (clockInfo?.session === "regular" ? "session-open" : "")}
            title={clockInfo?.session === "overnight" ? "Overnight window. Finnhub overnight prices unavailable." : undefined}>
            <i aria-hidden />{clockInfo ? sessionNames[clockInfo.session] : "Market status"}
          </span>
          <span className="clock mono" title={clockInfo?.close === 780 ? "Early close at 1:00 PM Eastern" : "Eastern time"}>
            {now ? clock(now) : dash}
          </span>
        </div>
        <div className="header-controls">
          <form className="search" role="search" onSubmit={(event) => {
            event.preventDefault();
            window.location.hash = "holdings";
          }}>
            <Search size={16} aria-hidden />
            <label className="sr-only" htmlFor="holding-search">Search holdings</label>
            <input id="holding-search" ref={searchRef} type="search" value={filter} placeholder="Search holdings" onChange={(e) => setFilter(e.target.value)} />
            {filter ? <button className="icon-button clear-search" type="button" onClick={() => setFilter("")} aria-label="Clear search"><X size={14} /></button> : <kbd>/</kbd>}
          </form>
          <button className="icon-button settings-button" title="Settings" aria-label="Settings" onClick={() => open({ kind: "settings" })}><Settings2 size={18} /></button>
        </div>
      </header>
      <main id="main">
        <div className="page-heading">
          <div><h1>Portfolio overview</h1><p>Track positions, performance, and cash.</p></div>
          <button type="button" className="button outline refresh" disabled={!ready || market.loading} onClick={market.refreshNow}>
            <RefreshCw size={15} /> {market.loading ? "Refreshing…" : "Refresh Now"}
          </button>
        </div>
        <div className="feed-status">
          <span><i className={quoted && !stale ? "ready-dot" : ""} />{headingState}</span>
          <span>Latest quote <strong>{market.lastQuoteAt
            ? <time dateTime={new Date(market.lastQuoteAt).toISOString()}>{quoteTime(market.lastQuoteAt)}</time> : dash}</strong></span>
          <span>Last successful check <strong>{market.lastSuccess
            ? <time dateTime={new Date(market.lastSuccess).toISOString()}>{quoteTime(market.lastSuccess)}</time> : dash}</strong></span>
          <span>Next refresh <strong>{market.nextRefresh
            ? <time dateTime={new Date(market.nextRefresh).toISOString()}>{quoteTime(market.nextRefresh)}</time> : dash}</strong></span>
          {clockInfo?.session === "overnight" && <span>Overnight quotes unavailable</span>}
          {issuesCount > 0 && <span className="amber">{issuesCount} {issuesCount === 1 ? "symbol" : "symbols"} need attention</span>}
          {market.configured === false && <button className="text-button" onClick={() => open({ kind: "settings" })}>Set up quotes</button>}
        </div>
        {(storageError || notice || (market.configured !== false && market.message)) &&
          <p className="notice" role="status">{storageError || notice || market.message}</p>}
        <section className="metrics" aria-label="Portfolio metrics" aria-busy={!ready}>
          <MetricCard label="Account value" icon={<Wallet size={17} />} value={ready ? money(metrics.value) : dash}
            hint={metrics.value === null ? "Waiting for all position prices" : "Holdings and available cash"} />
          <MetricCard label="Today's P/L" icon={<ActivityIcon size={17} />} value={money(metrics.daily, true)}
            color={tone(metrics.daily)} hint="Regular session" />
          <MetricCard label="Total gain/loss" icon={<TrendingUp size={17} />} value={ready ? money(metrics.totalGain, true) : dash}
            color={tone(metrics.totalGain)} hint={<>Investment return <strong className={tone(lifetimeReturn)}>{percent(lifetimeReturn, true)}</strong></>} />
          <MetricCard label="Available cash" icon={<CircleDollarSign size={17} />} value={ready ? money(metrics.cash) : dash}
            color={metrics.cash.lt(0) ? "loss" : ""} hint={metrics.cash.lt(0) ? "Recorded cash deficit" : <>Net deposits <strong>{money(metrics.netContributions)}</strong></>} />
        </section>
        <dl className="secondary-metrics">
          <div><dt>Holdings market value</dt><dd>{money(metrics.equities)}</dd></div>
          <div><dt>Invested capital</dt><dd>{metrics.invested === null ? "Not set" : money(metrics.invested)}</dd></div>
          <div><dt>Unrealized P/L</dt><dd className={tone(metrics.unrealized)}>{money(metrics.unrealized, true)}</dd></div>
          <div><dt>Realized P/L</dt><dd className={tone(metrics.realized)}>{ready ? money(metrics.realized, true) : dash}</dd></div>
        </dl>
        <div className="analytics-grid">
          <Performance data={data} now={now} configured={market.configured} openSettings={() => open({ kind: "settings" })} />
          <Allocation metrics={metrics} />
        </div>
        <Holdings metrics={metrics} filter={filter} clear={() => setFilter("")} issues={market.issues} edit={(symbol) => open({ kind: "position", symbol })} />
        <div className="lower-grid">
          <Assistant input={input} setInput={(value) => { setInput(value); setPending(null); setCommandMessage(null); }}
            submit={run} message={commandMessage} pending={pending?.action ?? null} events={data.events}
            clearPending={() => setPending(null)} confirm={() => void confirmEntry()} busy={busy || !ready} inputRef={inputRef} />
          <Activity events={data.events} expand={() => open({ kind: "history" })} />
        </div>
        <footer><span><LineChart size={15} /> OM Terminal</span><span>Quotes by <a href="https://finnhub.io/" target="_blank" rel="noreferrer">Finnhub</a> · Charts by <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView</a></span></footer>
      </main>
    </div>
    {modal && <Dialog close={() => { if (!busy) setModal(null); }} title={modal.kind === "settings" ? "Settings" :
      modal.kind === "history" ? "Transaction history" : modal.kind === "position" ? modal.symbol :
        modal.data ? "Restore portfolio backup?" : "Reset sample portfolio?"}>
      {modal.kind === "settings" && <>
        <Settings configured={market.configured} data={data} requestReplace={(backup) => open({ kind: "replace", data: backup })} onError={setNotice} />
        {notice && <p className="notice" role="status">{notice}</p>}
      </>}
      {modal.kind === "history" && <Activity events={data.events} full />}
      {modal.kind === "position" && (current ? <PositionDetail holding={current} issue={market.issues[current.symbol]} draft={goToAssistant} />
        : <p className="section-empty">This position is no longer open.</p>)}
      {modal.kind === "replace" && <div className="replace-dialog">
        <p>{modal.data ? "The backup will replace your local ledger and valuation history. It contains " + modal.data.events.length
          + " ledger entries and " + modal.data.snapshots.length + " valuations." : "This replaces your local ledger and valuation history with the six original example holdings."}</p>
        <div className="button-row">
          <button className="button outline" disabled={busy} onClick={() => open({ kind: "settings" })}>Cancel</button>
          <button className="button primary" disabled={busy} onClick={() => void replacePortfolio(modal.data)}>{modal.data ? "Restore backup" : "Reset portfolio"}</button>
        </div>
        {notice && <p className="notice" role="status">{notice}</p>}
      </div>}
    </Dialog>}
  </div>;
}
