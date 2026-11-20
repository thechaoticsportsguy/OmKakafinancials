"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readDocument } from "@/lib/ledger";
import { samplePortfolio, type PortfolioDocument } from "@/lib/schema";
import type { Quotes } from "@/lib/metrics";
import { scheduleQuoteRefresh } from "@/lib/market/refresh";
import type { Quote, QuoteResponse } from "@/lib/market/types";

const key = "om-terminal.portfolio.v1";
const lock = "om-terminal-portfolio";

function load() {
  const raw = window.localStorage.getItem(key);
  return raw ? readDocument(JSON.parse(raw)) : samplePortfolio();
}

export function usePortfolio() {
  const [data, setData] = useState<PortfolioDocument>(samplePortfolio);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    function restore() {
      try {
        setData(load());
        setError("");
      } catch {
        setError("Your saved data could not be read. Import a valid backup or reset the sample portfolio in Settings.");
      }
      setReady(true);
    }
    restore();
    const listener = (event: StorageEvent) => {
      if (event.key === key || event.key === null) restore();
    };
    window.addEventListener("storage", listener);
    return () => window.removeEventListener("storage", listener);
  }, []);

  const save = useCallback(async (update: (previous: PortfolioDocument) => PortfolioDocument, replace?: PortfolioDocument) => {
    const write = () => {
      const previous = replace ?? load();
      const next = replace ?? update(previous);
      if (replace || next !== previous) window.localStorage.setItem(key, JSON.stringify(next));
      setData(next);
      setError("");
      return next;
    };
    if (navigator.locks) return navigator.locks.request(lock, write);
    return write();
  }, []);
  return { data, ready, error, save };
}

interface MarketState {
  quotes: Quotes;
  observed: Quotes;
  issues: Record<string, string>;
  configured: boolean | null;
  loading: boolean;
  message: string;
  lastSuccess: number | null;
  lastQuoteAt: number | null;
  nextRefresh: number | null;
}

export function useMarket(tickers: string, ready: boolean) {
  const [state, setState] = useState<MarketState>({
    quotes: {}, observed: {}, issues: {}, configured: null, loading: false, message: "",
    lastSuccess: null, lastQuoteAt: null, nextRefresh: null,
  });
  const symbolsRef = useRef<string[]>([]);
  const refreshRef = useRef<(() => void) | null>(null);
  const refreshNow = useCallback(() => refreshRef.current?.(), []);

  useEffect(() => {
    symbolsRef.current = tickers.split(",").filter(Boolean);
  }, [tickers]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    let active = false;
    async function poll(manual: boolean) {
      if (active || controller.signal.aborted) return;
      active = true;
      setState((current) => ({ ...current, loading: true, message: "" }));
      const symbols = symbolsRef.current;
      const checked: string[] = [];
      const received: Quote[] = [];
      const issues: Record<string, string> = {};
      let configured: boolean | null = null;
      let message = "";
      try {
        for (let index = 0; index < symbols.length; index += 24) {
          const batch = symbols.slice(index, index + 24);
          const params = new URLSearchParams({ symbols: batch.join(",") });
          if (manual) params.set("refresh", "1");
          const response = await fetch("/api/quotes?" + params, {
            signal: controller.signal,
          });
          if (!response.ok) throw new Error("Quote service is temporarily unavailable.");
          const result: QuoteResponse = await response.json();
          checked.push(...batch);
          received.push(...result.quotes);
          Object.assign(issues, result.issues);
          configured = result.configured;
          message = result.message ?? "";
          if (!configured || controller.signal.aborted) break;
        }
      } catch (error) {
        message = error instanceof Error ? error.message : "Quote refresh failed.";
      } finally {
        active = false;
      }
      if (controller.signal.aborted) return;
      setState((current) => {
        const quotes = { ...current.quotes };
        const latestIssues = { ...current.issues };
        const observed: Quotes = {};
        let lastQuoteAt = current.lastQuoteAt;
        let lastSuccess = current.lastSuccess;
        for (const symbol of checked) delete latestIssues[symbol];
        Object.assign(latestIssues, issues);
        for (const quote of received) {
          const previous = quotes[quote.symbol];
          if (previous && quote.at < previous.at) continue;
          quotes[quote.symbol] = quote;
          if (issues[quote.symbol]) continue;
          observed[quote.symbol] = quote;
          lastQuoteAt = Math.max(lastQuoteAt ?? 0, quote.at);
          lastSuccess = Math.max(lastSuccess ?? 0, quote.fetchedAt);
        }
        return {
          ...current, quotes, observed, issues: latestIssues, lastQuoteAt, lastSuccess, message,
          configured: configured ?? current.configured, loading: false,
        };
      });
    }
    const schedule = scheduleQuoteRefresh(
      (manual) => { void poll(manual); },
      (at) => setState((current) => ({ ...current, nextRefresh: at })),
    );
    function checkOnReturn() {
      if (document.visibilityState === "visible") schedule.checkDue();
    }
    refreshRef.current = schedule.refreshNow;
    document.addEventListener("visibilitychange", checkOnReturn);
    window.addEventListener("pageshow", checkOnReturn);
    return () => {
      controller.abort();
      schedule.stop();
      refreshRef.current = null;
      document.removeEventListener("visibilitychange", checkOnReturn);
      window.removeEventListener("pageshow", checkOnReturn);
    };
  }, [ready]);
  return { ...state, refreshNow };
}
