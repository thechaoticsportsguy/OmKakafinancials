"use client";

import { CircleHelp, CornerDownLeft, Terminal } from "lucide-react";
import type { FormEvent, RefObject } from "react";
import { actionDetail, eventTitle, previewAction } from "@/lib/commands";
import { money, shares } from "@/lib/format";
import type { Action, LedgerEvent } from "@/lib/schema";

export const examples = ["Add $1,000 cash", "Buy $500 worth of SPY at $735", "What's my biggest holding?"];

export function Assistant({ input, setInput, submit, message, pending, events, clearPending, confirm, busy, inputRef }: {
  input: string;
  setInput: (input: string) => void;
  submit: (event: FormEvent) => void;
  message: { text: string; error?: boolean } | null;
  pending: Action | null;
  events: LedgerEvent[];
  clearPending: () => void;
  confirm: () => void;
  busy: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  let preview: ReturnType<typeof previewAction> | null = null;
  if (pending) {
    try { preview = previewAction(pending, events); } catch { /* The saved ledger may have changed in another tab. */ }
  }
  return <section className="panel assistant" id="assistant" aria-labelledby="assistant-title">
    <div className="panel-heading">
      <div><h2 id="assistant-title">Portfolio assistant</h2><p>Record transactions and ask about your holdings</p></div>
      <Terminal size={19} className="heading-icon" aria-hidden />
    </div>
    <form className="command" onSubmit={submit}>
      <span aria-hidden>&gt;_</span>
      <label className="sr-only" htmlFor="command">Portfolio command</label>
      <input id="command" ref={inputRef} value={input} maxLength={200} onChange={(e) => setInput(e.target.value)}
        placeholder="Enter a portfolio command" autoComplete="off" />
      <button className="button primary compact" type="submit" disabled={!input.trim() || busy}>Run <CornerDownLeft size={15} /></button>
    </form>
    <div className="examples" aria-label="Example commands">
      {examples.map((example) => <button key={example} type="button" onClick={() => {
        setInput(example);
        inputRef.current?.focus();
      }}>{example}</button>)}
    </div>
    <div aria-live="polite">
      {message && <p className={message.error ? "command-message loss" : "command-message"}>{message.text}</p>}
      {pending && <div className="command-preview">
        <div className="preview-title"><strong>Confirm ledger entry</strong><span>{eventTitle(pending)}</span></div>
        <p>{actionDetail(pending)}</p>
        {preview ? <>
          {"symbol" in pending && <div className="preview-row"><span>Position shares</span>
            <span>{preview.before ? shares(preview.before.shares) : "0"} → {preview.after ? shares(preview.after.shares) : "0"}</span></div>}
          <div className="preview-row"><span>Cash balance</span><span>{money(preview.beforeCash)} → {money(preview.afterCash)}</span></div>
          {pending.kind === "remove" && <p>Removal records a position adjustment and adds no sale proceeds.</p>}
          {pending.kind === "buy" && preview.afterCash.lt(0) && <p>This entry leaves a recorded cash deficit.</p>}
        </> : <p>Portfolio changed. Run this command again to review it.</p>}
        <div className="button-row">
          <button type="button" className="button outline compact" disabled={busy} onClick={clearPending}>Cancel</button>
          <button type="button" className="button primary compact" disabled={busy || !preview} onClick={confirm}>Confirm entry</button>
        </div>
      </div>}
    </div>
    <details className="command-help">
      <summary><CircleHelp size={15} /> Supported commands</summary>
      <ul>
        <li>Add 2 shares of NVDA at $185</li><li>Sell 1 share of SPY at $740</li>
        <li>Change my SCHD position to 30 shares</li><li>Set my VHT average cost to $165</li>
        <li>Remove JIVE from my portfolio</li><li>Withdraw $50 cash</li>
        <li>Show how much I made today</li><li>How much of my portfolio is invested in QQQM?</li>
      </ul>
    </details>
  </section>;
}
