"use client";

import { useMemo } from "react";
import { StatCard } from "@/components/StatCard";
import { C } from "@/lib/constants";
import { detectBuyZones } from "@/lib/analytics";
import type { BuyZone, BuyZoneOptions, PricePoint } from "@/lib/types";

interface BacktestTabProps {
  priceData: PricePoint[];
  thresholds: BuyZoneOptions;
}

interface Summary {
  zones: BuyZone[];
  trades: number;
  wins: number;
  winRate: string;
  avgReturn: string;
  cumReturn: string;
  bestTrade: string;
  worstTrade: string;
}

function holdDays(z: BuyZone) {
  return Math.round(
    (new Date(z.sellDate).getTime() - new Date(z.date).getTime()) /
      86_400_000,
  );
}

export function BacktestTab({ priceData, thresholds }: BacktestTabProps) {
  const summary = useMemo<Summary>(() => {
    const zones = detectBuyZones(priceData, thresholds);
    if (!zones.length) {
      return {
        zones: [],
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
    return {
      zones,
      trades: zones.length,
      wins,
      winRate: `${((wins / zones.length) * 100).toFixed(0)}%`,
      avgReturn: `${avg.toFixed(1)}%`,
      cumReturn: `${(cum * 100).toFixed(1)}%`,
      bestTrade: `${Math.max(...returns).toFixed(1)}%`,
      worstTrade: `${Math.min(...returns).toFixed(1)}%`,
    };
  }, [priceData, thresholds]);

  return (
    <div id="panel-backtest" role="tabpanel" aria-labelledby="tab-backtest">
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatCard
          label="Trades"
          value={summary.trades}
          sub="Detected cycles"
          subColor={C.muted}
          accent={C.blue}
        />
        <StatCard
          label="Win Rate"
          value={summary.winRate}
          sub={`${summary.wins} wins`}
          subColor={C.green}
          accent={C.green}
        />
        <StatCard
          label="Avg Return"
          value={summary.avgReturn}
          sub="Per cycle"
          subColor={C.yellow}
          accent={C.yellow}
        />
        <StatCard
          label="Cumulative"
          value={summary.cumReturn}
          sub="Compounded"
          subColor={C.purple}
          accent={C.purple}
        />
      </div>

      <section
        className="mb-3.5 overflow-hidden rounded-xl"
        style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
        }}
      >
        <header
          className="flex items-center justify-between px-3.5 py-2.5"
          style={{ borderBottom: `1px solid ${C.border}` }}
        >
          <p
            className="m-0 text-[10px] uppercase tracking-[1px]"
            style={{ color: C.muted }}
          >
            Cycle Details
          </p>
          <span className="text-[10px]" style={{ color: C.muted }}>
            best <span style={{ color: C.green }}>{summary.bestTrade}</span>
            {"  ·  "}
            worst <span style={{ color: C.red }}>{summary.worstTrade}</span>
          </span>
        </header>

        {summary.zones.length === 0 ? (
          <p
            className="m-0 px-4 py-5 text-center text-[11px]"
            style={{ color: C.muted }}
          >
            No cycles detected at current thresholds. Loosen the detection
            sliders on the Cycles tab to surface more.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px] tabular-nums">
              <thead>
                <tr style={{ color: C.muted }}>
                  <th className="px-3 py-2 font-normal">#</th>
                  <th className="px-3 py-2 font-normal">Buy Date</th>
                  <th className="px-3 py-2 font-normal">Buy $</th>
                  <th className="px-3 py-2 font-normal">Sell Date</th>
                  <th className="px-3 py-2 font-normal">Sell $</th>
                  <th className="px-3 py-2 font-normal">Hold</th>
                  <th className="px-3 py-2 font-normal">Drop</th>
                  <th className="px-3 py-2 font-normal">Recov</th>
                  <th className="px-3 py-2 text-right font-normal">Return</th>
                </tr>
              </thead>
              <tbody>
                {summary.zones
                  .slice()
                  .reverse()
                  .map((z, i) => {
                    const ret = parseFloat(z.actualReturn);
                    const win = ret > 0;
                    const cycleNum = summary.zones.length - i;
                    return (
                      <tr
                        key={`${z.date}-${i}`}
                        style={{
                          borderTop: `1px solid ${C.border}`,
                          color: C.text,
                        }}
                      >
                        <td className="px-3 py-2" style={{ color: C.muted }}>
                          {cycleNum}
                        </td>
                        <td className="px-3 py-2">{z.date}</td>
                        <td className="px-3 py-2">${z.buyZone.toFixed(5)}</td>
                        <td className="px-3 py-2">{z.sellDate}</td>
                        <td className="px-3 py-2">
                          ${z.sellPrice.toFixed(5)}
                        </td>
                        <td className="px-3 py-2" style={{ color: C.muted }}>
                          {holdDays(z)}d
                        </td>
                        <td className="px-3 py-2" style={{ color: C.red }}>
                          -{z.drop}%
                        </td>
                        <td className="px-3 py-2" style={{ color: C.yellow }}>
                          +{z.recoveryPct}%
                        </td>
                        <td
                          className="px-3 py-2 text-right font-bold"
                          style={{ color: win ? C.green : C.red }}
                        >
                          {win ? "+" : ""}
                          {z.actualReturn}%
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p
        className="m-0 text-[10px] italic"
        style={{ color: C.muted }}
      >
        ⚠ Sanity-check backtest only — uses the dip-detection thresholds from
        the Cycles tab. No fees, slippage, or position sizing modeled. Each
        row assumes a full position bought at the dip and sold at the
        algorithm&apos;s computed sell point.
      </p>
    </div>
  );
}
