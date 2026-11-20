"use client";

import { Download, ExternalLink, RotateCcw, Upload, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { dash, quotePrice, quoteTime } from "@/lib/format";
import { d, readDocument } from "@/lib/ledger";
import type { Metrics } from "@/lib/metrics";
import type { PortfolioDocument } from "@/lib/schema";

export function Dialog({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className="modal" aria-labelledby="dialog-title" onCancel={(event) => { event.preventDefault(); close(); }}>
    <div className="dialog-heading"><h2 id="dialog-title">{title}</h2><button className="icon-button" onClick={close} aria-label="Close dialog"><X size={20} /></button></div>
    {children}
  </dialog>;
}

export function Settings({ configured, data, requestReplace, onError }: {
  configured: boolean | null; data: PortfolioDocument;
  requestReplace: (data?: PortfolioDocument) => void; onError: (message: string) => void;
}) {
  const upload = useRef<HTMLInputElement>(null);
  async function importFile(file: File) {
    try {
      if (file.size > 10_000_000) throw new Error("Backup exceeds the 10 MB size limit.");
      const next = readDocument(JSON.parse(await file.text()));
      requestReplace(next);
    } catch (error) {
      onError(error instanceof Error && error.message === "Backup exceeds the 10 MB size limit."
        ? error.message : "This file is not a valid OM Terminal version 1 portfolio.");
    }
  }
  function exportFile() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "om-terminal-portfolio.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="settings-content">
    <section>
      <div className="settings-label"><h3>Market data</h3><span className="panel-tag">{configured ? "Key configured" : "Finnhub"}</span></div>
      <p>Use a free personal API key. Set <code>FINNHUB_API_KEY</code> in <code>.env.local</code> and restart Next.js.</p>
      <a className="text-button" href="https://finnhub.io/register" target="_blank" rel="noreferrer">Get a Finnhub key <ExternalLink size={14} /></a>
      <p>Quotes are checked when the dashboard opens and once an hour while it remains open. Use Refresh Now for an extra check. This feed supplies regular-session marks.</p>
    </section>
    <section>
      <h3>Portfolio data</h3>
      <p>Your ledger and valuation history are stored in this browser. Export a JSON backup to move them to another device.</p>
      <input ref={upload} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} aria-label="Select portfolio backup"
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importFile(file); }} />
      <div className="button-row">
        <button className="button outline" onClick={exportFile}><Download size={15} /> Export JSON</button>
        <button className="button outline" onClick={() => upload.current?.click()}><Upload size={15} /> Import JSON</button>
        <button className="button outline danger" onClick={() => requestReplace()}><RotateCcw size={15} /> Reset sample</button>
      </div>
    </section>
  </div>;
}

export function PositionDetail({ holding, issue, draft }: {
  holding: Metrics["holdings"][number]; issue?: string; draft: (command: string) => void;
}) {
  const quote = holding.quote;
  return <div className="position-detail">
    <p>{holding.name ?? "Name unavailable"}</p>
    <dl className="detail-list">
      <div><dt>Source</dt><dd>{quote?.source ?? dash}</dd></div>
      <div><dt>Quote session</dt><dd>{quote ? "Regular session" : dash}</dd></div>
      <div><dt>Quote timestamp</dt><dd>{quote ? <time dateTime={new Date(quote.at).toISOString()}>{quoteTime(quote.at)}</time> : dash}</dd></div>
      <div><dt>Freshness</dt><dd>{holding.freshness}</dd></div>
      <div><dt>Latest regular mark</dt><dd>{quote ? quotePrice(d(quote.price)) : dash}</dd></div>
      <div><dt>Prior close for quoted session</dt><dd>{quote?.previousClose ? quotePrice(d(quote.previousClose)) : dash}</dd></div>
      {["Premarket", "After hours", "Overnight"].map((label) => <div key={label}><dt>{label}</dt><dd>Unavailable</dd></div>)}
    </dl>
    {issue && <p className="amber">{issue}</p>}
    <div className="button-row">
      <button className="button outline" onClick={() => draft("Change my " + holding.symbol + " position to ")}>Change shares</button>
      <button className="button outline" onClick={() => draft("Set my " + holding.symbol + " average cost to $")}>Set average cost</button>
      <button className="button outline danger" onClick={() => draft("Remove " + holding.symbol + " from my portfolio")}>Remove</button>
    </div>
  </div>;
}
