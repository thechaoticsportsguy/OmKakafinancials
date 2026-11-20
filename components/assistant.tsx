"use client";

import { CircleHelp, CornerDownLeft, Terminal } from "lucide-react";
import type { FormEvent, RefObject } from "react";
import { actionDetail, eventTitle, type PreparedCommand } from "@/lib/commands";
import { money, quotePrice, shares } from "@/lib/format";
import { d, TRADE_SHARE_DECIMALS } from "@/lib/ledger";
import type { TradeClarification } from "@/lib/transaction-parser";

const examples = ["Add 20 shares of SPMO at 60 cents", "Remove $10 worth of SPMO", "Deposit 500 dollars cash"];

function PreviewRow({ label, value }: { label: string; value: string }) {
  return <div className="preview-row"><dt>{label}</dt><dd>{value}</dd></div>;
}

function PreviewDetails({ pending }: { pending: PreparedCommand }) {
  const { action, preview } = pending;
  const positionShares = shares(preview.after?.shares ?? d(), TRADE_SHARE_DECIMALS);
  const cash = money(preview.beforeCash) + " → " + money(preview.afterCash);
  const isTrade = action.kind === "buy" || action.kind === "sell";
  return <>
    {!isTrade && <p>{actionDetail(action)}</p>}
    <dl className="preview-details">
      {isTrade && <>
        <PreviewRow label={action.kind === "buy" ? "Shares bought" : "Shares sold"} value={shares(d(action.shares), TRADE_SHARE_DECIMALS)} />
        <PreviewRow label={action.kind === "buy" ? "Purchase price per share" : "Sale price per share"} value={quotePrice(d(action.price))} />
        <PreviewRow label={action.kind === "buy" ? "Total purchase cost" : "Sale proceeds"}
          value={preview.transactionValue ? quotePrice(preview.transactionValue) : "Unavailable"} />
      </>}
      {isTrade ? <PreviewRow label={action.kind === "buy" ? "New total shares" : "Remaining shares"} value={positionShares} />
        : "symbol" in action && <PreviewRow label="Position shares"
          value={shares(preview.before?.shares ?? d(), TRADE_SHARE_DECIMALS) + " → " + positionShares} />}
      {(action.kind === "buy" || action.kind === "basis") && <>
        <PreviewRow label="New position cost basis" value={preview.after?.basis ? money(preview.after.basis) : "Not set"} />
        <PreviewRow label="New average cost per share"
          value={preview.averageCost ? quotePrice(preview.averageCost.toDecimalPlaces(8)) : "Not set"} />
      </>}
      {action.kind === "sell" && <PreviewRow label="Realized P/L"
        value={preview.realized === null ? "Unavailable (cost basis missing)" : money(preview.realized, true)} />}
      <PreviewRow label="Cash balance" value={cash} />
    </dl>
    {action.kind === "remove" && <p>Removal records a position adjustment and adds no sale proceeds.</p>}
    {action.kind === "buy" && preview.afterCash.lt(0) && <p>This entry leaves a recorded cash deficit.</p>}
  </>;
}

export function Assistant({ input, setInput, submit, message, pending, ledgerChanged, clarification, cancel, confirm, busy, inputRef }: {
  input: string;
  setInput: (input: string) => void;
  submit: (event: FormEvent) => void;
  message: { text: string; error?: boolean } | null;
  pending: PreparedCommand | null;
  ledgerChanged: boolean;
  clarification: TradeClarification | null;
  cancel: () => void;
  confirm: () => void;
  busy: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  return <section className="panel assistant" id="assistant" aria-labelledby="assistant-title">
    <div className="panel-heading">
      <div><h2 id="assistant-title">Portfolio assistant</h2><p>Record transactions and ask about your holdings</p></div>
      <Terminal size={19} className="heading-icon" aria-hidden />
    </div>
    <form className="command" onSubmit={submit}>
      <span aria-hidden>&gt;_</span>
      <label className="sr-only" htmlFor="command">Portfolio command</label>
      <input id="command" ref={inputRef} value={input} maxLength={200} onChange={(e) => setInput(e.target.value)}
        placeholder={clarification ? "Enter the price per share" : "Enter a portfolio command"} autoComplete="off"
        aria-describedby={clarification ? "trade-clarification" : undefined} disabled={busy} />
      <button className="button primary compact" type="submit" disabled={!input.trim() || busy}>Run <CornerDownLeft size={15} /></button>
    </form>
    <div className="examples" aria-label="Example commands">
      {examples.map((example) => <button key={example} type="button" disabled={busy} onClick={() => {
        setInput(example);
        inputRef.current?.focus();
      }}>{example}</button>)}
    </div>
    <div aria-live="polite">
      {message && <p className={message.error ? "command-message loss" : "command-message"}>{message.text}</p>}
      {clarification && <div className="command-preview">
        <p id="trade-clarification">{clarification.question}</p>
        <button type="button" className="button outline compact" onClick={cancel}>Cancel</button>
      </div>}
      {pending && <div className="command-preview">
        <div className="preview-title"><strong>Confirm ledger entry</strong><span>{eventTitle(pending.action)}</span></div>
        {ledgerChanged ? <p>Portfolio changed. Run this command again to review it.</p> : <PreviewDetails pending={pending} />}
        <div className="button-row">
          <button type="button" className="button outline compact" disabled={busy} onClick={cancel}>Cancel</button>
          <button type="button" className="button primary compact" disabled={busy || ledgerChanged} onClick={confirm}>Confirm entry</button>
        </div>
      </div>}
    </div>
    <details className="command-help">
      <summary><CircleHelp size={15} /> Supported commands</summary>
      <ul>
        <li>Bought 5 SPY at 735</li><li>Sold 3 SCHD for 29 each</li>
        <li>Invested $100 in VHT at 170</li><li>Sell $10 worth of SPMO at $125 each</li>
        <li>Change my SCHD position to 30 shares</li><li>Set my VHT average cost to $165</li>
        <li>Remove JIVE from my portfolio</li><li>Withdraw $50 cash</li>
        <li>Show how much I made today</li><li>How much of my portfolio is invested in QQQM?</li>
      </ul>
    </details>
  </section>;
}
