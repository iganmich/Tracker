"use client";

import { C } from "@/lib/constants";
import type { Candidate, GridResult } from "@/lib/grid";
import { fmtPct, fmtPrice, fmtUsd } from "./CandidateBoard";

interface CandidateTicketProps {
  rank: number; // 1-based
  candidate: Candidate | null;
  investment: number | null; // required investment for the chosen candidate
  sized: GridResult | null; // simulateGrid at `investment` (already resolution-corrected by the tab)
  warnings: string[];
}

function Field({ label, unit, value, sub }: { label: string; unit?: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[10px] px-3 py-2.5" style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.14)" }}>
      <p className="m-0 flex justify-between text-[9px] uppercase tracking-[1px]" style={{ color: C.muted }}>
        <span>{label}</span>
        {unit && <span style={{ color: C.muted }}>{unit}</span>}
      </p>
      <p className="m-0 mt-1 text-[22px] font-extrabold tracking-tight text-white tabular-nums">
        {value}
        {sub && <span className="ml-1 text-[11px] font-normal" style={{ color: C.muted }}>{sub}</span>}
      </p>
    </div>
  );
}

export function CandidateTicket({ rank, candidate, investment, sized, warnings }: CandidateTicketProps) {
  return (
    <section
      className="mb-3 rounded-xl p-3.5"
      style={{ border: `1px solid ${C.green}59`, background: `linear-gradient(180deg, ${C.green}12, ${C.green}05)` }}
      aria-label="What to type into Pionex"
    >
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 text-[11px] font-bold uppercase tracking-[1px]" style={{ color: C.green }}>
          {candidate ? `Candidate ${rank} · what to type into Pionex` : "What to type into Pionex"}
        </h3>
        <span className="text-[10px]" style={{ color: C.muted }}>spot grid · MON/USDT · fields in Pionex order</span>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Field label="Investment" unit="USDT" value={investment != null ? Math.round(investment).toLocaleString("en-US") : "—"} />
        <Field label="Lower price" unit="USDT" value={candidate ? fmtPrice(candidate.lower) : "—"} />
        <Field label="Upper price" unit="USDT" value={candidate ? fmtPrice(candidate.upper) : "—"} />
        <Field label="Grid count" unit={candidate?.mode} value={candidate ? String(candidate.grids) : "—"} sub={candidate ? `${fmtPct(candidate.spacingPct * 100, 2)} / grid` : undefined} />
      </div>

      {candidate && sized && (
        <p className="m-0 mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px]" style={{ color: C.muted }}>
          <span>Expected <b style={{ color: C.green }}>{fmtUsd(sized.monthlyProfit)} / month</b></span>
          <span>{fmtPct(candidate.liveMonthlyYield * 100)} monthly yield</span>
          <span>{fmtPct(candidate.profitPerGridPct * 100, 2)} profit per grid after fees</span>
          <span>{Math.round(sized.tradesPerMonth).toLocaleString()} trades / month</span>
          <span>unrealized {fmtUsd(sized.unrealizedPnl)} at window end</span>
        </p>
      )}

      {warnings.length > 0 && (
        <ul className="m-0 mt-2.5 flex list-none flex-col gap-1 p-0">
          {warnings.map((w) => (
            <li key={w} className="rounded-lg px-2.5 py-1.5 text-[11px]" style={{ color: C.yellow, border: `1px solid ${C.yellow}4d`, background: `${C.yellow}0f` }}>
              ⚠ {w}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
