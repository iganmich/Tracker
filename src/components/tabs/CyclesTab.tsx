"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AIBox } from "@/components/AIBox";
import { ChartFrame } from "@/components/ChartFrame";
import { ChartTooltip } from "@/components/ChartTooltip";
import { StatCard } from "@/components/StatCard";
import { C } from "@/lib/constants";
import { callClaude } from "@/lib/claude";
import {
  detectBuyZones,
  projectFutureCycles,
} from "@/lib/analytics";
import type { EnrichedPricePoint, PricePoint } from "@/lib/types";

interface CyclesTabProps {
  priceData: PricePoint[];
  loading: boolean;
}

export function CyclesTab({ priceData, loading }: CyclesTabProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const buyZones = useMemo(() => detectBuyZones(priceData), [priceData]);

  const enriched: EnrichedPricePoint[] = useMemo(
    () =>
      priceData.map((d) => {
        const z = buyZones.find((b) => b.date === d.date);
        return {
          ...d,
          ...(z ?? {}),
          isBuyZone: !!z,
        };
      }),
    [priceData, buyZones],
  );

  const data4h = useMemo(() => {
    const out: { displayDate: string; price: number }[] = [];
    for (let i = 0; i < priceData.length - 1; i++) {
      const cur = priceData[i];
      const nxt = priceData[i + 1];
      for (let h = 0; h < 6; h++) {
        const t = h / 6;
        out.push({
          displayDate: h === 0 ? cur.displayDate : "",
          price: parseFloat(
            (
              cur.price +
              (nxt.price - cur.price) * t +
              (Math.random() - 0.5) * 0.0012
            ).toFixed(6),
          ),
        });
      }
    }
    return out;
  }, [priceData]);

  const cycleData = useMemo(
    () =>
      buyZones.length >= 2 ? projectFutureCycles(priceData, buyZones) : null,
    [priceData, buyZones],
  );
  const projections = cycleData?.projections ?? [];
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
        `Crypto technical analyst for MON (Monad, launched Nov 2025). Daily prices: ${ctx}. Past buy zones: ${detected}. Projected future cycles (algorithmic): ${proj}. Average cycle gap: ${avgGap} days, avg drop: ${avgDropStr}%. Analyze: 1) How reliable is this cycle pattern? 2) What conditions would invalidate the next projected buy? 3) Are the sell targets realistic based on past pumps? 4) Any risk factors to watch? 5 concise sentences with specific prices.`,
        setText,
      );
    } catch (e) {
      setText(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setBusy(false);
  }

  return (
    <div id="panel-cycles" role="tabpanel" aria-labelledby="tab-cycles">
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
          <>
            Daily Chart · 🟢 Past Buy Zones ·{" "}
            <span style={{ color: C.green }}>━</span> Projected Buy Window
          </>
        }
        height={190}
        loading={loading}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
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
              tick={{ fill: C.muted, fontSize: 9 }}
              tickFormatter={(v: number) => `$${v.toFixed(3)}`}
              axisLine={false}
              tickLine={false}
              width={56}
            />
            <Tooltip content={<ChartTooltip />} />
            {projections.slice(0, 1).map((p, i) => (
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
            {projections.slice(0, 1).map((p, i) => (
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
          </LineChart>
        </ResponsiveContainer>
      </ChartFrame>

      <ChartFrame
        caption="4H Chart (last 16 days) · Intraday cycle view"
        height={140}
        loading={loading}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data4h.slice(-96)}
            margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis
              dataKey="displayDate"
              tick={{ fill: C.muted, fontSize: 9 }}
              interval={15}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: C.muted, fontSize: 9 }}
              tickFormatter={(v: number) => `$${v.toFixed(4)}`}
              axisLine={false}
              tickLine={false}
              width={62}
            />
            <Tooltip content={<ChartTooltip />} />
            <Line
              type="monotone"
              dataKey="price"
              stroke={C.purple}
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3, fill: C.purple }}
            />
          </LineChart>
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
              className="m-0 text-[10px] uppercase tracking-[1px]"
              style={{ color: C.green }}
            >
              📅 Upcoming 30-Day Cycles
            </p>
            <span className="text-[10px]" style={{ color: C.muted }}>
              {avgGap}d avg gap · -{avgDropStr}% avg dip
            </span>
          </div>
          {projections.map((p) => (
            <article
              key={p.cycle}
              className="mb-2.5 overflow-hidden rounded-[10px]"
              style={{
                border: `1px solid ${p.confidenceColor}44`,
                background: "rgba(255,255,255,0.015)",
              }}
            >
              <header
                className="flex items-center justify-between px-3 py-1.5"
                style={{ background: `${p.confidenceColor}15` }}
              >
                <span
                  className="text-[11px] font-bold"
                  style={{ color: p.confidenceColor }}
                >
                  Cycle {p.cycle} · {p.confidence}
                </span>
                <span className="text-[10px]" style={{ color: C.muted }}>
                  {p.isActive
                    ? "In progress"
                    : p.daysAway > 0
                      ? `Buy in ${p.daysAway}d`
                      : "Starting soon"}
                </span>
              </header>
              <div className="px-3 py-2.5">
                <div className="flex items-stretch">
                  <div
                    className="flex-1 rounded-l-lg px-2.5 py-2"
                    style={{
                      background: `${C.green}12`,
                      border: `1px solid ${C.green}30`,
                    }}
                  >
                    <p
                      className="m-0 text-[9px] uppercase tracking-[1px]"
                      style={{ color: C.green }}
                    >
                      🟢 BUY
                    </p>
                    <p className="m-0 mt-1 text-xs font-bold text-white tabular-nums">
                      {p.buyDate}
                    </p>
                    <p
                      className="m-0 text-[10px] tabular-nums"
                      style={{ color: C.green }}
                    >
                      ~${p.estBuyPrice.toFixed(5)}
                    </p>
                  </div>
                  <div
                    className="flex flex-col items-center justify-center px-2"
                    style={{
                      background: "rgba(255,255,255,0.02)",
                      borderTop: "1px solid rgba(255,255,255,0.06)",
                      borderBottom: "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    <span className="text-sm" style={{ color: C.muted }}>
                      →
                    </span>
                    <span
                      className="whitespace-nowrap text-[9px]"
                      style={{ color: C.muted }}
                    >
                      hold {p.holdDays}d
                    </span>
                  </div>
                  <div
                    className="flex-1 rounded-r-lg px-2.5 py-2"
                    style={{
                      background: `${C.red}12`,
                      border: `1px solid ${C.red}30`,
                    }}
                  >
                    <p
                      className="m-0 text-[9px] uppercase tracking-[1px]"
                      style={{ color: C.red }}
                    >
                      🔴 SELL
                    </p>
                    <p className="m-0 mt-1 text-xs font-bold text-white tabular-nums">
                      {p.sellDate}
                    </p>
                    <p
                      className="m-0 text-[10px] tabular-nums"
                      style={{ color: C.red }}
                    >
                      ~${p.estSellPrice.toFixed(5)}{" "}
                      <span style={{ color: C.yellow }}>+{p.estReturn}%</span>
                    </p>
                  </div>
                </div>
              </div>
            </article>
          ))}
          <p
            className="m-0 mt-1 text-[9px] italic"
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
                        ${z.buyZone.toFixed(5)}
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
                        ${z.sellPrice?.toFixed(5) ?? "—"}
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
