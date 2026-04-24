"use client";

import { useState } from "react";
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
import { C, UNLOCK_EVENTS } from "@/lib/constants";
import { callClaude } from "@/lib/claude";
import type { PricePoint } from "@/lib/types";

interface UnlockTabProps {
  priceData: PricePoint[];
  loading: boolean;
  currentPrice: number | null;
  priceChange: number | null;
}

export function UnlockTab({
  priceData,
  loading,
  currentPrice,
  priceChange,
}: UnlockTabProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const now = new Date();
  const nextUnlock = UNLOCK_EVENTS.map((e) => ({ ...e, dt: new Date(e.date) }))
    .filter((e) => e.dt >= now)
    .sort((a, b) => a.dt.getTime() - b.dt.getTime())[0];
  const daysToUnlock = nextUnlock
    ? Math.ceil((nextUnlock.dt.getTime() - now.getTime()) / 86_400_000)
    : null;

  async function run() {
    setBusy(true);
    setText("");
    const ctx = priceData
      .slice(-60)
      .map((d) => `${d.date}:$${d.price}`)
      .join(",");
    try {
      await callClaude(
        `Crypto analyst for MON (Monad). Daily prices: ${ctx}. Unlock dates: ${UNLOCK_EVENTS.map((e) => e.date).join(",")}. Monthly validator unlocks ~170M MON on 24th each month. Is there a price drop pattern 3-5 days before/after the 24th? Quantify average drop % and recovery time. 4-5 sentences, data-driven.`,
        setText,
      );
    } catch (e) {
      setText(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setBusy(false);
  }

  return (
    <div id="panel-unlock" role="tabpanel" aria-labelledby="tab-unlock">
      <div className="mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <StatCard
          label="Current Price"
          value={currentPrice != null ? `$${currentPrice.toFixed(5)}` : "—"}
          sub={
            priceChange != null
              ? `${priceChange >= 0 ? "▲" : "▼"} ${Math.abs(priceChange).toFixed(1)}% 7d`
              : ""
          }
          subColor={priceChange != null && priceChange >= 0 ? C.green : C.red}
          accent={C.green}
        />
        <StatCard
          label="Next Unlock"
          value={nextUnlock?.date ?? "—"}
          sub={daysToUnlock != null ? `In ${daysToUnlock}d` : ""}
          subColor={C.yellow}
          accent={C.yellow}
        />
        <StatCard
          label="Monthly Emission"
          value="~170M MON"
          sub="≈ 1.4% circ."
          subColor={C.muted}
          accent={C.blue}
        />
      </div>

      <ChartFrame
        caption="Daily Price · 🟡 Unlock Events (24th each month)"
        height={200}
        loading={loading}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={priceData}
            margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis
              dataKey="displayDate"
              tick={{ fill: C.muted, fontSize: 9 }}
              interval={Math.max(0, Math.floor(priceData.length / 7))}
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
            {UNLOCK_EVENTS.map((e, i) => (
              <ReferenceLine
                key={i}
                x={new Date(e.date).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
                stroke={`${C.yellow}66`}
                strokeDasharray="4 3"
                strokeWidth={1.5}
              />
            ))}
            <Line
              type="monotone"
              dataKey="price"
              stroke={C.green}
              strokeWidth={2}
              dot={(props) => {
                const { cx, cy, payload } = props as {
                  cx: number;
                  cy: number;
                  payload: PricePoint;
                };
                return payload.unlock ? (
                  <circle
                    key={`u${cx}-${cy}`}
                    cx={cx}
                    cy={cy}
                    r={5}
                    fill={C.yellow}
                    stroke="#000"
                    strokeWidth={1.5}
                  />
                ) : (
                  <circle key={`n${cx}-${cy}`} cx={cx} cy={cy} r={0} />
                );
              }}
              activeDot={{ r: 4, fill: C.green }}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartFrame>

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
          Unlock Schedule
        </p>
        <ol className="m-0 list-none p-0">
          {UNLOCK_EVENTS.map((e) => {
            const isPast = new Date(e.date) < now;
            const isNext = nextUnlock?.date === e.date;
            return (
              <li
                key={e.date}
                className="mb-1 flex items-center justify-between rounded-md px-2.5 py-2"
                style={{
                  background: isNext
                    ? `${C.yellow}10`
                    : "rgba(255,255,255,0.015)",
                  border: `1px solid ${isNext ? `${C.yellow}33` : "transparent"}`,
                  opacity: isPast ? 0.4 : 1,
                }}
              >
                <div className="flex items-center gap-2">
                  <span aria-hidden className="text-xs">
                    {isPast ? "✓" : isNext ? "⏳" : "🔒"}
                  </span>
                  <div>
                    <p
                      className="m-0 text-[11px]"
                      style={{ color: isNext ? C.yellow : C.text }}
                    >
                      {e.date}
                    </p>
                    <p className="m-0 text-[10px]" style={{ color: C.muted }}>
                      {e.label}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p
                    className="m-0 text-[11px] font-bold tabular-nums"
                    style={{ color: C.yellow }}
                  >
                    {e.amount}
                  </p>
                  <p className="m-0 text-[9px]" style={{ color: C.muted }}>
                    {e.category}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <AIBox
        title="Unlock Pattern Analysis"
        onRun={run}
        loading={busy}
        text={text}
        placeholder='Click "Analyse" to detect price patterns around monthly unlock dates.'
      />
    </div>
  );
}
