"use client";

import { useCoin, usePriceFormat } from "@/lib/coin-context";
import { C } from "@/lib/constants";
import type { Candidate, RankBy } from "@/lib/grid";

export const fmtUsd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
export const fmtPct = (n: number, d = 1) => `${n.toFixed(d)}%`;

interface CandidateBoardProps {
  candidates: Candidate[]; // best first
  selected: number;
  onSelect: (i: number) => void;
  goalUsd: number | null;
  maxInvestment: number | null;
  rankBy: RankBy;
  currentPrice: number | null;
  tested: number;
  kept: number;
  loading: boolean;
  emptyMessage?: string;
}

function Bar({ fraction, color, marker }: { fraction: number; color: string; marker?: number }) {
  return (
    <div className="relative mt-1.5 h-1.5 overflow-visible rounded-full" style={{ background: "rgba(255,255,255,0.06)" }} aria-hidden>
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(0, Math.min(100, fraction * 100))}%`, background: color }} />
      {marker !== undefined && (
        <div className="absolute -top-[3px] h-3 w-0.5 bg-white" style={{ left: `${Math.max(0, Math.min(100, marker * 100))}%` }} />
      )}
    </div>
  );
}

export function CandidateBoard({ candidates, selected, onSelect, goalUsd, maxInvestment, rankBy, currentPrice, tested, kept, loading, emptyMessage }: CandidateBoardProps) {
  const coin = useCoin();
  const fmtPrice = usePriceFormat();
  const topYield = candidates[0]?.rankYield ?? 1;
  const best = candidates[0];
  const investMode = goalUsd === null;
  const budgetLine =
    best && goalUsd !== null && maxInvestment != null && best.requiredInvestment > maxInvestment
      ? `Your ${fmtUsd(maxInvestment)} max reaches about ${fmtUsd(maxInvestment * best.liveMonthlyYield)} / month with candidate 1 — ${fmtUsd(goalUsd)} needs ${fmtUsd(best.requiredInvestment)}.`
      : null;
  const factorOf = (c: Candidate) => (c.rankYield > 0 ? c.liveMonthlyYield / c.rankYield : 1);
  return (
    <section className="mb-3" aria-label="Grid candidates">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="m-0 text-[12px] font-bold text-white">
            {investMode
              ? maxInvestment != null
                ? `What ${fmtUsd(maxInvestment)} earns per month`
                : "Enter a monthly goal or an investment"
              : `Candidates that reach ${fmtUsd(goalUsd)} / month`}
          </h2>
          <p className="m-0 text-[11px]" style={{ color: C.dim }}>
            {loading
              ? "Backtesting…"
              : `${tested.toLocaleString()} configurations tested, ${kept.toLocaleString()} passed the filters · ranked by ${rankBy === "worst" ? "worst 30-day slice" : "average month"}.`}
          </p>
          {!loading && budgetLine && (
            <p className="m-0 mt-1 text-[11px]" style={{ color: C.yellow }}>
              ⚠ {budgetLine}
            </p>
          )}
        </div>
      </div>

      {loading &&
        [0, 1, 2].map((i) => <div key={i} className="skeleton mb-1.5 h-[64px] rounded-[10px]" role="status" aria-label="Loading candidates" />)}

      {!loading && candidates.length === 0 && (
        <p className="rounded-[10px] px-3.5 py-3 text-[11px]" style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.dim }}>
          {emptyMessage ?? "No candidate passed the filters."}
        </p>
      )}

      {!loading &&
        candidates.map((c, i) => {
          const active = i === selected;
          const pos = currentPrice != null && c.upper > c.lower ? Math.max(0, Math.min(1, (currentPrice - c.lower) / (c.upper - c.lower))) : undefined;
          return (
            <div
              key={`${c.lower}-${c.upper}-${c.grids}`}
              role="button"
              tabIndex={0}
              aria-pressed={active}
              onClick={() => onSelect(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(i);
                }
              }}
              className="mb-1.5 grid min-h-[44px] cursor-pointer grid-cols-[24px_1fr_1fr] items-center gap-x-2.5 gap-y-1 rounded-[10px] px-3 py-2.5 transition-colors md:grid-cols-[28px_1.3fr_1fr_56px_1fr_0.9fr_110px]"
              style={{
                background: active ? `${C.green}0f` : C.surface,
                border: `1px solid ${active ? `${C.green}80` : C.border}`,
              }}
            >
              <span className="text-[13px] font-extrabold" style={{ color: active ? C.green : C.dim }}>{i + 1}</span>
              <span className="col-span-2 text-[11px] text-white md:col-span-1">
                {fmtPrice(c.lower)} – {fmtPrice(c.upper)}
                <span className="block text-[11px]" style={{ color: C.dim }}>
                  {pos !== undefined
                    ? `now ${Math.round(pos * 100)}% up the range · starts ≈${Math.round((1 - pos) * 100)}% ${coin.id} / ${Math.round(pos * 100)}% USDT`
                    : "range"}
                </span>
                <Bar fraction={1} color={`${C.blue}59`} marker={pos} />
              </span>
              <span className="whitespace-nowrap text-[11px]" style={{ color: C.dim }}>
                {rankBy === "worst" ? "Worst month" : "Avg / mo"}
                <b className="block text-[13px] text-white">
                  {fmtPct(c.liveMonthlyYield * 100)}
                  <span className="ml-1.5 text-[11px] font-normal" style={{ color: C.dim }}>
                    {rankBy === "worst" ? `avg ${fmtPct(c.result.monthlyYield * 100)}` : `worst ${fmtPct(c.result.worstSliceYield * 100)}`}
                  </span>
                </b>
                <Bar fraction={c.rankYield / topYield} color={C.green} />
              </span>
              <span className="text-center text-[11px]" style={{ color: C.dim }}>
                Grids<b className="block text-[13px] text-white">{c.grids}</b>
              </span>
              <span className="text-[11px]" style={{ color: C.dim }}>
                In range · DD · idle
                <b className="block text-[13px] text-white">
                  {fmtPct(c.result.timeInRangePct, 0)} · −{fmtPct(c.result.maxDrawdownPct)} ·{" "}
                  <span style={{ color: c.result.idleDays > Math.round(c.result.days) / 4 ? C.yellow : "#fff" }}>{c.result.idleDays}d</span>
                </b>
                <span className="block text-[11px]" style={{ color: C.dim }}>{Math.round(c.result.tradesPerMonth / 30)} rounds / day</span>
              </span>
              <span className="text-[11px]" style={{ color: C.dim }}>
                Stop loss ({c.stopLabel})
                <b className="block text-[13px] text-white">
                  {fmtPrice(c.stopLoss)} · <span style={{ color: C.red }}>−{fmtPct(c.stopLossPct * 100, 0)}</span>
                  <span className="ml-1 text-[10px] font-normal" style={{ color: C.dim }}>from here · −{fmtPct(c.stopLossFromTopPct * 100, 0)} from top</span>
                </b>
                <span className="block text-[11px]" style={{ color: c.stopExits > 0 ? C.yellow : C.dim }}>
                  {c.stopExits > 0 ? `fired ${c.stopExits}× in window · ` : "never fired in window · "}
                  <span style={{ color: c.stopPnlDeltaPct >= 0 ? C.green : C.red }}>
                    {c.stopPnlDeltaPct >= 0 ? "+" : ""}{fmtPct(c.stopPnlDeltaPct * 100)} vs no stop
                  </span>
                </span>
              </span>
              <span className="col-span-3 text-left md:col-span-1 md:text-right">
                {investMode ? (
                  maxInvestment != null ? (
                    <>
                      <b className="block text-[13px]" style={{ color: C.green }}>
                        {fmtUsd(maxInvestment * (rankBy === "worst" ? c.result.worstSliceYield : c.result.monthlyYield) * factorOf(c))} / mo
                      </b>
                      <span className="block text-[11px]" style={{ color: C.dim }}>{rankBy === "worst" ? "worst month" : "average month"}</span>
                      <span className="block text-[11px]" style={{ color: C.dim }}>
                        {rankBy === "worst" ? "avg" : "worst"} ≈ {fmtUsd(maxInvestment * (rankBy === "worst" ? c.result.monthlyYield : c.result.worstSliceYield) * factorOf(c))}
                      </span>
                    </>
                  ) : (
                    <span className="text-[11px]" style={{ color: C.dim }}>enter an investment</span>
                  )
                ) : maxInvestment != null && c.requiredInvestment > maxInvestment ? (
                  <>
                    <b className="block text-[13px]" style={{ color: C.yellow }}>{fmtUsd(maxInvestment * c.liveMonthlyYield)} / mo</b>
                    <span className="text-[11px]" style={{ color: C.dim }}>at your {fmtUsd(maxInvestment)} · goal needs {fmtUsd(c.requiredInvestment)}</span>
                  </>
                ) : (
                  <>
                    <b className="block text-[13px]" style={{ color: C.green }}>{fmtUsd(c.requiredInvestment)}</b>
                    <span className="block text-[11px]" style={{ color: C.dim }}>
                      for {fmtUsd(goalUsd ?? 0)} in {rankBy === "worst" ? "the worst month" : "an average month"}
                    </span>
                    <span className="block text-[11px]" style={{ color: C.dim }}>
                      {rankBy === "worst"
                        ? `avg month ≈ ${fmtUsd(c.requiredInvestment * c.result.monthlyYield * factorOf(c))}`
                        : `worst month ≈ ${fmtUsd(c.requiredInvestment * c.result.worstSliceYield * factorOf(c))}`}
                    </span>
                  </>
                )}
              </span>
            </div>
          );
        })}
    </section>
  );
}
