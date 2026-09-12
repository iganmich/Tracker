"use client";

import { useMemo, type ReactNode } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame } from "@/components/ChartFrame";
import { C } from "@/lib/constants";
import { downsample, type Candle } from "@/lib/candles";

interface GridChartProps {
  candles: Candle[];
  lower: number | null;
  upper: number | null;
  levels: number[]; // grids + 1, ascending (empty when no candidate)
  currentPrice: number | null;
  loading: boolean;
  caption: ReactNode;
}

interface Row {
  t: number;
  label: string;
  close: number;
  band: [number, number] | null;
}

const MAX_POINTS = 600;
const MAX_LINES = 30;

function GridTooltip({ active, payload }: { active?: boolean; payload?: { payload?: Row }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload; // never payload[0].value — the band tuple lives there
  if (!d) return null;
  return (
    <div role="tooltip" className="rounded-lg px-3.5 py-2.5 text-[11px]" style={{ background: "rgba(7,10,20,0.97)", border: `1px solid ${C.green}33`, color: C.text }}>
      <p className="m-0 mb-1 font-bold" style={{ color: C.green }}>{d.label}</p>
      <p className="m-0">Close: <b className="text-white">${d.close.toFixed(5)}</b></p>
      {d.band && (
        <p className="m-0 mt-0.5" style={{ color: C.blue }}>Range: ${d.band[0].toFixed(5)} – ${d.band[1].toFixed(5)}</p>
      )}
    </div>
  );
}

export function GridChart({ candles, lower, upper, levels, currentPrice, loading, caption }: GridChartProps) {
  const rows = useMemo<Row[]>(() => {
    const band: [number, number] | null = lower != null && upper != null ? [lower, upper] : null;
    return downsample(candles, MAX_POINTS).map((c) => ({
      t: c.time,
      label: new Date(c.time).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric" }),
      close: c.close,
      band,
    }));
  }, [candles, lower, upper]);

  const lines = useMemo(() => {
    if (levels.length === 0) return [];
    const every = Math.ceil(levels.length / MAX_LINES);
    return levels.filter((_, i) => i % every === 0);
  }, [levels]);

  const domain = useMemo<[number, number]>(() => {
    const vals = rows.map((r) => r.close);
    if (lower != null) vals.push(lower);
    if (upper != null) vals.push(upper);
    if (vals.length === 0) return [0, 1];
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = (hi - lo) * 0.05 || lo * 0.05;
    return [lo - pad, hi + pad];
  }, [rows, lower, upper]);

  return (
    <ChartFrame caption={caption} height={200} lgHeight={320} loading={loading}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: C.muted }} tickLine={false} axisLine={false} minTickGap={40} />
          <YAxis domain={domain} tick={{ fontSize: 9, fill: C.muted }} tickLine={false} axisLine={false} width={58} tickFormatter={(v: number) => v.toFixed(4)} />
          <Tooltip content={<GridTooltip />} />
          <Area type="monotone" dataKey="band" stroke={`${C.blue}88`} fill={`${C.blue}14`} strokeWidth={1} dot={false} activeDot={false} isAnimationActive={false} />
          {lines.map((lv) => (
            <ReferenceLine key={lv} y={lv} stroke="rgba(255,255,255,0.08)" strokeDasharray="2 4" />
          ))}
          {currentPrice != null && (
            <ReferenceLine y={currentPrice} stroke="rgba(255,255,255,0.7)" strokeDasharray="4 3" label={{ value: currentPrice.toFixed(5), position: "right", fill: "#fff", fontSize: 9 }} />
          )}
          <Line type="monotone" dataKey="close" stroke={C.green} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
