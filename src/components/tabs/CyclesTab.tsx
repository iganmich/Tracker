"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AIBox } from "@/components/AIBox";
import { BuySignalBadge } from "@/components/BuySignalBadge";
import { ChartFrame } from "@/components/ChartFrame";
import { ChartTooltip } from "@/components/ChartTooltip";
import { formatAxisPrice, priceDomain } from "@/components/priceAxis";
import { StatCard } from "@/components/StatCard";
import { ThresholdControls } from "@/components/ThresholdControls";
import { useCoin, usePriceFormat } from "@/lib/coin-context";
import { C } from "@/lib/constants";
import { callClaude } from "@/lib/claude";
import {
  computeBollingerBands,
  computeBuySignal,
  detectBuyZones,
  projectFutureCycles,
} from "@/lib/analytics";
import { fetchPriceDataForTimeframe, type Timeframe } from "@/lib/prices";
import type {
  BuyZoneOptions,
  EnrichedPricePoint,
  PricePoint,
} from "@/lib/types";

const TIMEFRAMES: Timeframe[] = ["5m", "1h", "4h", "1d"];

interface CyclesTabProps {
  priceData: PricePoint[];
  loading: boolean;
  thresholds: BuyZoneOptions;
  onThresholdsChange: (next: BuyZoneOptions) => void;
}

export function CyclesTab({
  priceData,
  loading,
  thresholds,
  onThresholdsChange,
}: CyclesTabProps) {
  const coin = useCoin();
  const fmtPrice = usePriceFormat();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [showBollinger, setShowBollinger] = useState(true);
  const [timeframe, setTimeframe] = useState<Timeframe>("1d");
  const [chartData, setChartData] = useState<PricePoint[]>(priceData);
  const [chartLoading, setChartLoading] = useState(false);
  const cacheRef = useRef<Partial<Record<Timeframe, PricePoint[]>>>({});
  const coinRef = useRef(coin.id);

  useEffect(() => {
    cacheRef.current["1d"] = priceData;
    if (timeframe === "1d") setChartData(priceData);
  }, [priceData, timeframe]);

  useEffect(() => {
    // Cached series belong to the coin they were fetched for.
    if (coinRef.current !== coin.id) {
      coinRef.current = coin.id;
      cacheRef.current = {};
    }
    if (timeframe === "1d") return;
    const cached = cacheRef.current[timeframe];
    if (cached) {
      setChartData(cached);
      return;
    }
    let cancelled = false;
    setChartLoading(true);
    fetchPriceDataForTimeframe(timeframe, coin)
      .then((data) => {
        if (cancelled) return;
        cacheRef.current[timeframe] = data;
        setChartData(data);
      })
      .catch(() => {
        if (!cancelled) setChartData([]);
      })
      .finally(() => {
        if (!cancelled) setChartLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [timeframe, coin]);

  const buyZones = useMemo(
    () => detectBuyZones(priceData, thresholds),
    [priceData, thresholds],
  );

  const enriched: EnrichedPricePoint[] = useMemo(() => {
    const bands = computeBollingerBands(chartData, 20, 2);
    const isDaily = timeframe === "1d";
    return chartData.map((d, i) => {
      const z = isDaily ? buyZones.find((b) => b.date === d.date) : undefined;
      const b = bands[i];
      const range: [number, number] | null =
        b.lower != null && b.upper != null ? [b.lower, b.upper] : null;
      return {
        ...d,
        ...(z ?? {}),
        isBuyZone: !!z,
        bbMiddle: b.middle,
        bbUpper: b.upper,
        bbLower: b.lower,
        bbRange: range,
      };
    });
  }, [chartData, buyZones, timeframe]);
  const yDomain = useMemo(
    () => priceDomain(enriched.flatMap((d) => [d.price, d.bbUpper ?? null, d.bbLower ?? null])),
    [enriched],
  );

  const cycleData = useMemo(
    () =>
      buyZones.length >= 2 ? projectFutureCycles(priceData, buyZones) : null,
    [priceData, buyZones],
  );
  const projections = cycleData?.projections ?? [];
  const buySignal = useMemo(
    () =>
      projections[0] && priceData.length
        ? computeBuySignal(priceData, projections[0], thresholds)
        : null,
    [projections, priceData, thresholds],
  );
  const avgGap = cycleData?.avgGap ?? 0;
  const avgDropStr = cycleData?.avgDrop ?? "—";

  const avgDrop = buyZones.length
    ? (
        buyZones.reduce((a, z) => a + parseFloat(z.drop), 0) / buyZones.length
      ).toFixed(1)
    : null;

  async function run() {
    setBusy(true);
    setText("");
    const ctx = priceData
      .slice(-60)
      .map((d) => `${d.date}:$${d.price}`)
      .join(",");
    const detected =
      buyZones
        .map(
          (z) =>
            `${z.date}:drop${z.drop}%:buyAt$${z.buyZone.toFixed(5)}:prevHigh$${z.prevHigh.toFixed(5)}`,
        )
        .join(" | ") || "none";
    const proj = projections
      .map(
        (p) =>
          `Cycle${p.cycle}: buy ~${p.buyDate} at ~$${p.estBuyPrice.toFixed(5)}, sell ~${p.sellDate} target $${p.estSellPrice.toFixed(5)}`,
      )
      .join("; ");
    try {
      await callClaude(
        `Crypto technical analyst for ${coin.blurb}. Daily prices: ${ctx}. Past buy zones: ${detected}. Projected future cycles (algorithmic): ${proj}. Average cycle gap: ${avgGap} days, avg drop: ${avgDropStr}%. Analyze: 1) How reliable is this cycle pattern? 2) What conditions would invalidate the next projected buy? 3) Are the sell targets realistic based on past pumps? 4) Any risk factors to watch? 5 concise sentences with specific prices.`,
        setText,
      );
    } catch (e) {
      setText(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setBusy(false);
  }

  return (
    <div id="panel-cycles" role="tabpanel" aria-labelledby="tab-cycles">
      <ThresholdControls
        value={thresholds}
        onChange={onThresholdsChange}
        zoneCount={buyZones.length}
      />

      {buySignal && <BuySignalBadge signal={buySignal} />}

      <div className="mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <StatCard
          label="Buy Zones Found"
          value={buyZones.length}
          sub="Post-pump dips"
          subColor={C.green}
          accent={C.green}
        />
        <StatCard
          label="Avg Cycle Gap"
          value={avgGap ? `${avgGap}d` : "—"}
          sub="Between buy zones"
          subColor={C.yellow}
          accent={C.yellow}
        />
        <StatCard
          label="Avg Drop to Zone"
          value={avgDrop ? `${avgDrop}%` : "—"}
          sub="From prev high"
          subColor={C.red}
          accent={C.red}
        />
      </div>

      <ChartFrame
        caption={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="flex items-center gap-1">
              {TIMEFRAMES.map((tf) => {
                const active = tf === timeframe;
                return (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => setTimeframe(tf)}
                    className="rounded-sm px-2 py-0.5 text-[10px] font-bold uppercase tracking-[1px] transition-colors"
                    style={{
                      background: active ? `${C.green}22` : "transparent",
                      color: active ? C.green : C.muted,
                      border: `1px solid ${active ? `${C.green}55` : C.border}`,
                    }}
                    aria-pressed={active}
                  >
                    {tf}
                  </button>
                );
              })}
            </span>
            <span>
              {timeframe === "1d"
                ? "· 🟢 Past Buy Zones"
                : timeframe === "4h"
                  ? "· 30d window"
                  : timeframe === "1h"
                    ? "· 7d window"
                    : "· 24h window"}
            </span>
            <button
              type="button"
              onClick={() => setShowBollinger((v) => !v)}
              className="ml-auto rounded-sm px-2 py-0.5 text-[10px] font-bold uppercase tracking-[1px] transition-colors"
              style={{
                background: showBollinger ? `${C.purple}22` : "transparent",
                color: showBollinger ? C.purple : C.muted,
                border: `1px solid ${showBollinger ? `${C.purple}55` : C.border}`,
              }}
              aria-pressed={showBollinger}
            >
              BB(20,2)
            </button>
          </span>
        }
        height={190}
        loading={loading || chartLoading}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={enriched}
            margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis
              dataKey="displayDate"
              tick={{ fill: C.muted, fontSize: 9 }}
              interval={Math.max(0, Math.floor(enriched.length / 7))}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={yDomain}
              tick={{ fill: C.muted, fontSize: 9 }}
              tickFormatter={(v: number) => `$${formatAxisPrice(v)}`}
              axisLine={false}
              tickLine={false}
              width={56}
            />
            <Tooltip content={<ChartTooltip />} />
            {showBollinger && (
              <Area
                type="monotone"
                dataKey="bbRange"
                stroke="none"
                fill={C.purple}
                fillOpacity={0.08}
                isAnimationActive={false}
                connectNulls={false}
                activeDot={false}
              />
            )}
            {showBollinger && (
              <Line
                type="monotone"
                dataKey="bbUpper"
                stroke={`${C.purple}77`}
                strokeWidth={1}
                strokeDasharray="3 3"
                dot={false}
                activeDot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
            {showBollinger && (
              <Line
                type="monotone"
                dataKey="bbLower"
                stroke={`${C.purple}77`}
                strokeWidth={1}
                strokeDasharray="3 3"
                dot={false}
                activeDot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
            {showBollinger && (
              <Line
                type="monotone"
                dataKey="bbMiddle"
                stroke={`${C.purple}99`}
                strokeWidth={1}
                dot={false}
                activeDot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
            {timeframe === "1d" &&
              projections.slice(0, 1).map((p, i) => (
                <ReferenceLine
                  key={`pb${i}`}
                  x={new Date(p.buyDate).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                  stroke={`${C.green}88`}
                  strokeDasharray="3 3"
                  strokeWidth={2}
                  label={{
                    value: "BUY?",
                    position: "top",
                    fill: C.green,
                    fontSize: 8,
                  }}
                />
              ))}
            {timeframe === "1d" &&
              projections.slice(0, 1).map((p, i) => (
                <ReferenceLine
                  key={`ps${i}`}
                  x={new Date(p.sellDate).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                  stroke={`${C.red}88`}
                  strokeDasharray="3 3"
                  strokeWidth={2}
                  label={{
                    value: "SELL?",
                    position: "top",
                    fill: C.red,
                    fontSize: 8,
                  }}
                />
              ))}
            <Line
              type="monotone"
              dataKey="price"
              stroke={C.blue}
              strokeWidth={2}
              dot={(props) => {
                const { cx, cy, payload } = props as {
                  cx: number;
                  cy: number;
                  payload: EnrichedPricePoint;
                };
                return payload.isBuyZone ? (
                  <circle
                    key={`bz${cx}-${cy}`}
                    cx={cx}
                    cy={cy}
                    r={6}
                    fill={C.green}
                    stroke="#000"
                    strokeWidth={2}
                  />
                ) : (
                  <circle key={`nb${cx}-${cy}`} cx={cx} cy={cy} r={0} />
                );
              }}
              activeDot={{ r: 4, fill: C.blue }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartFrame>

      {projections.length > 0 && (
        <section
          className="mb-3.5 rounded-xl p-3.5"
          style={{
            background: C.surface,
            border: `1px solid ${C.green}33`,
          }}
        >
          <div className="mb-3 flex items-center justify-between">
            <p
              className="m-0 text-[11px] uppercase tracking-[1px]"
              style={{ color: C.green }}
            >
              📅 Upcoming 30-Day Cycles
            </p>
            <span className="text-[11px]" style={{ color: C.muted }}>
              {avgGap}d avg gap · -{avgDropStr}% avg dip
            </span>
          </div>
          {projections.map((p) => {
            const buyStop = p.estBuyPrice * 1.02;
            const sellStop = p.estSellPrice * 0.98;
            const denom = avgGap > 0 ? avgGap : 30;
            const progress = p.isActive
              ? 100
              : Math.min(
                  100,
                  Math.max(0, ((denom - p.daysAway) / denom) * 100),
                );
            return (
              <article
                key={p.cycle}
                className="mb-3 overflow-hidden rounded-[10px]"
                style={{
                  border: `1px solid ${p.confidenceColor}55`,
                  background: "rgba(255,255,255,0.015)",
                }}
              >
                <header
                  className="flex items-center justify-between px-4 py-2"
                  style={{ background: `${p.confidenceColor}15` }}
                >
                  <span
                    className="text-xs font-bold tracking-[1px]"
                    style={{ color: p.confidenceColor }}
                  >
                    ▶ Cycle {String(p.cycle).padStart(2, "0")} · {p.confidence}
                  </span>
                  <span className="text-[11px]" style={{ color: C.muted }}>
                    {p.isActive
                      ? "In progress"
                      : p.daysAway > 0
                        ? `buy in ${p.daysAway}d`
                        : "starting soon"}
                  </span>
                </header>
                <div className="h-[3px] w-full" style={{ background: C.border }}>
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${progress}%`,
                      background: p.confidenceColor,
                    }}
                  />
                </div>

                {/* BUY TICKET */}
                <div
                  className="px-5 py-4"
                  style={{
                    background: `linear-gradient(180deg, ${C.green}14, ${C.green}04)`,
                  }}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <span
                      className="rounded-sm px-2 py-1 text-[11px] font-bold uppercase tracking-[1.5px]"
                      style={{ background: `${C.green}22`, color: C.green }}
                    >
                      ▶ BUY · LIMIT
                    </span>
                    <span className="text-sm font-bold text-white tabular-nums">
                      {p.buyDate}
                    </span>
                  </div>
                  <p
                    className="m-0 mb-1 text-[10px] uppercase tracking-[1.5px]"
                    style={{ color: C.muted }}
                  >
                    Entry
                  </p>
                  <p
                    className="m-0 text-[24px] font-extrabold leading-none tabular-nums"
                    style={{ color: C.green }}
                  >
                    ${fmtPrice(p.estBuyPrice)}
                  </p>
                  <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span
                      className="text-[11px] uppercase tracking-[1px]"
                      style={{ color: C.muted }}
                    >
                      ▸ Stop-limit
                    </span>
                    <span
                      className="text-base font-semibold tabular-nums"
                      style={{ color: C.green }}
                    >
                      ${fmtPrice(buyStop)}
                    </span>
                    <span
                      className="ml-auto text-[10px] tracking-[0.5px]"
                      style={{ color: C.muted }}
                    >
                      +2% buffer ensures fill
                    </span>
                  </div>
                </div>

                {/* perforation */}
                <div className="relative">
                  <div
                    className="border-t border-dashed"
                    style={{ borderColor: C.border }}
                  />
                  <span
                    className="absolute -left-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full"
                    style={{ background: C.bg }}
                  />
                  <span
                    className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full"
                    style={{ background: C.bg }}
                  />
                </div>

                {/* SELL TICKET */}
                <div
                  className="px-5 py-4"
                  style={{
                    background: `linear-gradient(180deg, ${C.red}14, ${C.red}04)`,
                  }}
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="rounded-sm px-2 py-1 text-[11px] font-bold uppercase tracking-[1.5px]"
                        style={{ background: `${C.red}22`, color: C.red }}
                      >
                        ◀ SELL · LIMIT
                      </span>
                      <span
                        className="rounded-sm px-1.5 py-0.5 text-[11px] font-bold tabular-nums"
                        style={{
                          background: `${C.yellow}22`,
                          color: C.yellow,
                        }}
                      >
                        +{p.estReturn}%
                      </span>
                    </div>
                    <span className="text-sm font-bold text-white tabular-nums">
                      {p.sellDate}
                    </span>
                  </div>
                  <p
                    className="m-0 mb-1 text-[10px] uppercase tracking-[1.5px]"
                    style={{ color: C.muted }}
                  >
                    Exit
                  </p>
                  <p
                    className="m-0 text-[24px] font-extrabold leading-none tabular-nums"
                    style={{ color: C.red }}
                  >
                    ${fmtPrice(p.estSellPrice)}
                  </p>
                  <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span
                      className="text-[11px] uppercase tracking-[1px]"
                      style={{ color: C.muted }}
                    >
                      ▸ Stop-limit
                    </span>
                    <span
                      className="text-base font-semibold tabular-nums"
                      style={{ color: C.red }}
                    >
                      ${fmtPrice(sellStop)}
                    </span>
                    <span
                      className="ml-auto text-[10px] tracking-[0.5px]"
                      style={{ color: C.muted }}
                    >
                      -2% buffer ensures fill
                    </span>
                  </div>
                  <p
                    className="m-0 mt-2 text-right text-[11px]"
                    style={{ color: C.muted }}
                  >
                    hold {p.holdDays}d
                  </p>
                </div>
              </article>
            );
          })}
          <p
            className="m-0 mt-1 text-[11px]"
            style={{ color: C.muted }}
          >
            ⚠ Each cycle = one complete arc: buy the dip → hold → sell the
            recovery. Sell always occurs before the next cycle&apos;s buy. Not
            financial advice.
          </p>
        </section>
      )}

      {buyZones.length > 0 && (
        <section
          className="mb-3.5 rounded-xl p-3.5"
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
          }}
        >
          <p
            className="m-0 mb-2.5 text-[10px] uppercase tracking-[1px]"
            style={{ color: C.muted }}
          >
            Historical Confirmed Cycles (Pump → Dip → Recovery)
          </p>
          {buyZones
            .slice(-5)
            .reverse()
            .map((z, i) => {
              const ret = parseFloat(z.actualReturn);
              return (
                <article
                  key={`${z.date}-${i}`}
                  className="mb-2 overflow-hidden rounded-lg"
                  style={{ border: `1px solid ${C.green}25` }}
                >
                  <header
                    className="flex justify-between px-2.5 py-1.5"
                    style={{ background: `${C.green}10` }}
                  >
                    <span
                      className="text-[10px] font-bold"
                      style={{ color: C.green }}
                    >
                      Cycle · dip -{z.drop}% from prev high
                    </span>
                    <span
                      className="text-[10px] font-bold tabular-nums"
                      style={{
                        color: ret > 0 ? C.green : C.red,
                      }}
                    >
                      {z.actualReturn ? `+${z.actualReturn}% return` : ""}
                    </span>
                  </header>
                  <div className="flex">
                    <div
                      className="flex-1 px-2.5 py-1.5"
                      style={{ borderRight: "1px solid rgba(255,255,255,0.05)" }}
                    >
                      <p className="m-0 text-[9px]" style={{ color: C.green }}>
                        BUY
                      </p>
                      <p className="m-0 mt-0.5 text-[11px] font-bold text-white tabular-nums">
                        {z.date}
                      </p>
                      <p
                        className="m-0 text-[10px] tabular-nums"
                        style={{ color: C.green }}
                      >
                        ${fmtPrice(z.buyZone)}
                      </p>
                    </div>
                    <div className="flex items-center px-1.5">
                      <span className="text-xs" style={{ color: C.muted }}>
                        →
                      </span>
                    </div>
                    <div className="flex-1 px-2.5 py-1.5">
                      <p className="m-0 text-[9px]" style={{ color: C.red }}>
                        SELL
                      </p>
                      <p className="m-0 mt-0.5 text-[11px] font-bold text-white tabular-nums">
                        {z.sellDate || "—"}
                      </p>
                      <p
                        className="m-0 text-[10px] tabular-nums"
                        style={{ color: C.red }}
                      >
                        {z.sellPrice != null ? `$${fmtPrice(z.sellPrice)}` : "—"}
                      </p>
                    </div>
                  </div>
                </article>
              );
            })}
        </section>
      )}

      <AIBox
        title="Investment Cycle Analysis"
        onRun={run}
        loading={busy}
        text={text}
        placeholder='Click "Analyse" for AI validation of the projected buy/sell dates and cycle reliability.'
      />
    </div>
  );
}
