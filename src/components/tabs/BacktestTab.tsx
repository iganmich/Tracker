"use client";

import { useMemo } from "react";
import { StatCard } from "@/components/StatCard";
import { C } from "@/lib/constants";
import { detectBuyZones } from "@/lib/analytics";
import type { PricePoint } from "@/lib/types";

interface BacktestTabProps {
  priceData: PricePoint[];
}

export function BacktestTab({ priceData }: BacktestTabProps) {
  const result = useMemo(() => {
    const zones = detectBuyZones(priceData);
    if (!zones.length) {
      return {
        trades: 0,
        wins: 0,
        winRate: "—",
        avgReturn: "—",
        cumReturn: "—",
        bestTrade: "—",
        worstTrade: "—",
      };
    }
    const returns = zones
      .map((z) => parseFloat(z.actualReturn))
      .filter((n) => !Number.isNaN(n));
    const wins = returns.filter((r) => r > 0).length;
    const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
    const cum = returns.reduce((a, b) => a * (1 + b / 100), 1) - 1;
    const best = Math.max(...returns);
    const worst = Math.min(...returns);
    return {
      trades: zones.length,
      wins,
      winRate: `${((wins / zones.length) * 100).toFixed(0)}%`,
      avgReturn: `${avg.toFixed(1)}%`,
      cumReturn: `${(cum * 100).toFixed(1)}%`,
      bestTrade: `${best.toFixed(1)}%`,
      worstTrade: `${worst.toFixed(1)}%`,
    };
  }, [priceData]);

  return (
    <div id="panel-backtest" role="tabpanel" aria-labelledby="tab-backtest">
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatCard
          label="Trades"
          value={result.trades}
          sub="Detected cycles"
          subColor={C.muted}
          accent={C.blue}
        />
        <StatCard
          label="Win Rate"
          value={result.winRate}
          sub={`${result.wins} wins`}
          subColor={C.green}
          accent={C.green}
        />
        <StatCard
          label="Avg Return"
          value={result.avgReturn}
          sub="Per cycle"
          subColor={C.yellow}
          accent={C.yellow}
        />
        <StatCard
          label="Cumulative"
          value={result.cumReturn}
          sub="Compounded"
          subColor={C.purple}
          accent={C.purple}
        />
      </div>

      <section
        className="rounded-xl p-4"
        style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
        }}
      >
        <p
          className="m-0 mb-2 text-[10px] uppercase tracking-[1px]"
          style={{ color: C.muted }}
        >
          Coming Soon
        </p>
        <p className="m-0 text-[12px] leading-[1.7]" style={{ color: C.text }}>
          A full strategy backtester (entry rules, position sizing, fees,
          slippage) is in progress. The numbers above are computed from the
          current dip-detection algorithm against the loaded daily prices —
          treat them as a sanity check, not a production backtest.
        </p>
        <ul
          className="mt-2.5 mb-0 list-disc pl-5 text-[11px]"
          style={{ color: C.muted }}
        >
          <li>Best trade: <span style={{ color: C.green }}>{result.bestTrade}</span></li>
          <li>Worst trade: <span style={{ color: C.red }}>{result.worstTrade}</span></li>
        </ul>
      </section>
    </div>
  );
}
