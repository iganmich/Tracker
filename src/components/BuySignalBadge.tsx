"use client";

import { C } from "@/lib/constants";
import type { BuySignalScore } from "@/lib/types";

interface BuySignalBadgeProps {
  signal: BuySignalScore;
}

function FactorBar({
  label,
  score,
  max,
  detail,
  color,
}: {
  label: string;
  score: number;
  max: number;
  detail: string;
  color: string;
}) {
  const pct = (score / max) * 100;
  return (
    <div className="mb-2">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-[1px]" style={{ color: C.muted }}>
          {label}
        </span>
        <span
          className="text-[11px] tabular-nums"
          style={{ color }}
        >
          {score}/{max}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full"
        style={{ background: "rgba(255,255,255,0.05)" }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{
            width: `${pct}%`,
            background: color,
          }}
        />
      </div>
      <p className="m-0 mt-1 text-[10px]" style={{ color: C.muted }}>
        {detail}
      </p>
    </div>
  );
}

function ProximityMeter({ signal }: { signal: BuySignalScore }) {
  const { currentPrice, projectedBuyPrice, recentHigh } = signal;
  const lo = Math.min(projectedBuyPrice, currentPrice) * 0.97;
  const hi = Math.max(recentHigh, currentPrice) * 1.02;
  const range = hi - lo;
  const pos = (v: number) => Math.max(0, Math.min(100, ((v - lo) / range) * 100));

  const buyPos = pos(projectedBuyPrice);
  const curPos = pos(currentPrice);
  const highPos = pos(recentHigh);

  return (
    <div className="mb-3 mt-1">
      <div className="mb-1 flex items-baseline justify-between">
        <span
          className="text-[10px] uppercase tracking-[1px]"
          style={{ color: C.muted }}
        >
          Price Proximity
        </span>
        <span className="text-[10px] tabular-nums" style={{ color: C.muted }}>
          {signal.proximityPct >= 0 ? "+" : ""}
          {signal.proximityPct.toFixed(1)}% from buy
        </span>
      </div>
      <div
        className="relative h-8 rounded-md"
        style={{
          background:
            "linear-gradient(90deg, rgba(0,229,160,0.18) 0%, rgba(255,193,48,0.10) 50%, rgba(255,77,109,0.18) 100%)",
          border: `1px solid ${C.border}`,
        }}
      >
        <div
          className="absolute top-1 bottom-1 w-px"
          style={{ left: `${buyPos}%`, background: C.green }}
          aria-hidden
        />
        <div
          className="absolute -top-1 -translate-x-1/2 text-[9px] tabular-nums"
          style={{ left: `${buyPos}%`, color: C.green }}
        >
          ▼
        </div>

        <div
          className="absolute top-1 bottom-1 w-px"
          style={{ left: `${highPos}%`, background: C.red }}
          aria-hidden
        />

        <div
          className="absolute top-1 bottom-1 -translate-x-1/2 rounded-sm"
          style={{
            left: `${curPos}%`,
            width: 3,
            background: "#fff",
            boxShadow: "0 0 6px rgba(255,255,255,0.7)",
          }}
          aria-label="Current price"
        />
      </div>
      <div className="mt-1 flex justify-between text-[9px] tabular-nums" style={{ color: C.muted }}>
        <span style={{ color: C.green }}>buy ${projectedBuyPrice.toFixed(5)}</span>
        <span className="text-white">now ${currentPrice.toFixed(5)}</span>
        <span style={{ color: C.red }}>20d high ${recentHigh.toFixed(5)}</span>
      </div>
    </div>
  );
}

export function BuySignalBadge({ signal }: BuySignalBadgeProps) {
  const { total, rating, ratingColor, factors, warnings } = signal;

  return (
    <section
      className="mb-3.5 rounded-xl p-4"
      style={{
        background: C.surface,
        border: `1px solid ${ratingColor}44`,
      }}
      aria-label="Buy signal score"
    >
      <header className="mb-3 flex items-end justify-between">
        <div>
          <p
            className="m-0 text-[10px] uppercase tracking-[1px]"
            style={{ color: C.muted }}
          >
            Buy Signal
          </p>
          <p
            className="m-0 mt-1 text-[24px] font-bold leading-none tabular-nums"
            style={{ color: ratingColor }}
          >
            {total}
            <span className="text-sm" style={{ color: C.muted }}>
              {" "}
              / 100
            </span>
          </p>
        </div>
        <div className="text-right">
          <p
            className="m-0 text-[14px] font-bold uppercase tracking-[2px]"
            style={{ color: ratingColor }}
          >
            {rating}
          </p>
        </div>
      </header>

      <ProximityMeter signal={signal} />

      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 sm:gap-x-4">
        <FactorBar
          label={factors.time.label}
          score={factors.time.score}
          max={factors.time.max}
          detail={factors.time.detail}
          color={C.blue}
        />
        <FactorBar
          label={factors.price.label}
          score={factors.price.score}
          max={factors.price.max}
          detail={factors.price.detail}
          color={C.green}
        />
        <FactorBar
          label={factors.pump.label}
          score={factors.pump.score}
          max={factors.pump.max}
          detail={factors.pump.detail}
          color={C.yellow}
        />
        <FactorBar
          label={factors.momentum.label}
          score={factors.momentum.score}
          max={factors.momentum.max}
          detail={factors.momentum.detail}
          color={C.purple}
        />
      </div>

      {warnings.length > 0 && (
        <ul
          className="m-0 mt-2 list-none space-y-1 p-0 text-[10px]"
          style={{ color: C.red }}
        >
          {warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
