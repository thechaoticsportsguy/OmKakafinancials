"use client";

import { ColorType, CrosshairMode, LineSeries, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { ChartNoAxesCombined, CircleHelp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { abbreviated, money, percent, quoteTime, time, tone } from "@/lib/format";
import { d } from "@/lib/ledger";
import { investmentReturn, periods, periodStart, type Period } from "@/lib/metrics";
import type { PortfolioDocument, Snapshot } from "@/lib/schema";

function ValueChart({ points }: { points: Snapshot[] }) {
  const element = useRef<HTMLDivElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const graph = useRef<{ chart: IChartApi; series: ISeriesApi<"Line"> } | null>(null);
  const observations = useRef(new Map<number, Snapshot>());
  useEffect(() => {
    const container = element.current!;
    const label = tooltip.current!;
    const chart = createChart(container, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#0d1625" }, textColor: "#9baec6", attributionLogo: true },
      grid: { vertLines: { color: "#1b283a" }, horzLines: { color: "#1b283a" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#26354c" },
      timeScale: {
        borderColor: "#26354c", timeVisible: true, secondsVisible: false,
        tickMarkFormatter: (stamp: UTCTimestamp, type: number) => new Intl.DateTimeFormat("en-US", {
          timeZone: "America/New_York",
          ...(type > 2 ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" }),
        }).format(stamp * 1000),
      },
      localization: { timeFormatter: (stamp: UTCTimestamp) => time(stamp * 1000), priceFormatter: abbreviated },
    });
    const series = chart.addSeries(LineSeries, {
      color: "#52e5bb",
      lineWidth: 2, priceLineVisible: false, lastValueVisible: false,
    });
    graph.current = { chart, series };
    chart.subscribeCrosshairMove(({ time: stamp, point }) => {
      const snapshot = typeof stamp === "number" ? observations.current.get(stamp) : undefined;
      label.hidden = !snapshot || !point;
      if (!snapshot || !point) return;
      label.textContent = quoteTime(snapshot.at) + "  ·  " + money(d(snapshot.value));
      label.style.left = Math.max(8, Math.min(point.x + 12, container.clientWidth - label.offsetWidth - 8)) + "px";
    });
    return () => {
      chart.remove();
      graph.current = null;
      observations.current.clear();
    };
  }, []);
  useEffect(() => {
    if (!graph.current) return;
    const firstDraw = !observations.current.size;
    const byTime = new Map(points.map((point) => [point.at / 1000, point]));
    const data = [...byTime].map(([stamp, point]) => ({ time: stamp as UTCTimestamp, value: d(point.value).toNumber() }));
    observations.current = byTime;
    graph.current.series.setData(data);
    if (firstDraw) graph.current.chart.timeScale().fitContent();
  }, [points]);
  return <div className="chart-canvas" role="img" aria-label="Saved account values over time. Move the crosshair to inspect a value.">
    <div ref={element} className="chart-host" />
    <div ref={tooltip} className="chart-tooltip mono" hidden />
  </div>;
}

export function Performance({ data, now, configured, openSettings }: {
  data: PortfolioDocument; now: number; configured: boolean | null; openSettings: () => void;
}) {
  const [period, setPeriod] = useState<Period>("1D");
  const start = periodStart(period, now);
  const end = data.snapshots.findLastIndex((point) => point.at <= now);
  const points = useMemo(() => data.snapshots.filter(({ at }, index) => index <= end && at >= start), [data.snapshots, end, start]);
  const last = points.at(-1);
  const first = points[0];
  const multiple = points.length >= 2;
  const result = useMemo(() => investmentReturn(points, data.events), [points, data.events]);
  return <section className="panel performance" aria-labelledby="performance-title">
    <div className="panel-heading">
      <div>
        <h2 id="performance-title">Portfolio performance</h2>
        <p>Account value over time</p>
      </div>
      <ChartNoAxesCombined size={19} className="heading-icon" aria-hidden />
    </div>
    <div className="periods" aria-label="Chart range">
      {periods.map((option) => <button type="button" className={option === period ? "period selected" : "period"} key={option}
        aria-pressed={option === period} onClick={() => setPeriod(option)}>{option}</button>)}
    </div>
    {multiple ? <ValueChart key={period} points={points} /> : <div className="chart-empty">
      <div className="empty-icon"><ChartNoAxesCombined size={22} aria-hidden /></div>
      <strong>{last ? "One valuation recorded" : "No history for this range"}</strong>
      <span>{last ? money(d(last.value)) + " · " + time(last.at) : "Saved valuations will appear here as quotes come in."}</span>
      {configured === false && <button type="button" className="button compact outline" onClick={openSettings}>Connect market data</button>}
    </div>}
    <div className="chart-footer">
      <span><span className="legend-dot" /> Account value{multiple && first && last && " · " + time(first.at) + " to " + time(last.at)}</span>
      <span title="Modified Dietz return over the recorded window, adjusted for external cash flows.">
        <CircleHelp size={13} aria-hidden /> Investment return <strong className={tone(result)}>{percent(result, true)}</strong>
      </span>
    </div>
  </section>;
}
