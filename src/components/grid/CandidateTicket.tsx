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
      <p className="m-0 flex justify-between text-[11px] uppercase tracking-[1px]" style={{ color: C.dim }}>
        <span>{label}</span>
        {unit && <span style={{ color: C.dim }}>{unit}</span>}
      </p>
      <p className="m-0 mt-1 text-[22px] font-extrabold tracking-tight text-white tabular-nums">
        {value}
        {sub && <span className="ml-1 text-[11px] font-normal" style={{ color: C.dim }}>{sub}</span>}
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
        <span className="text-[11px]" style={{ color: C.dim }}>spot grid · MON/USDT · fields in Pionex order</span>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Field label="Investment" unit="USDT" value={investment != null ? Math.round(investment).toLocaleString("en-US") : "—"} />
        <Field label="Lower price" unit="USDT" value={candidate ? fmtPrice(candidate.lower) : "—"} />
        <Field label="Upper price" unit="USDT" value={candidate ? fmtPrice(candidate.upper) : "—"} />
        <Field label="Grid count" unit={candidate?.mode} value={candidate ? String(candidate.grids) : "—"} sub={candidate ? `${fmtPct(candidate.spacingPct * 100, 2)} / grid` : undefined} />
        <Field
          label="Stop loss"
          unit={candidate ? candidate.stopLabel : "USDT"}
          value={candidate ? fmtPrice(candidate.stopLoss) : "—"}
          sub={candidate && investment != null ? `worst from here −${fmtPct(candidate.stopLossPct * 100, 0)} ≈ ${fmtUsd(investment * candidate.stopLossPct)}` : undefined}
        />
      </div>

      {candidate && investment != null && candidate.stopSweep.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <p className="m-0 mb-1 text-[11px] uppercase tracking-[1px]" style={{ color: C.dim }}>
            Stop-loss backtest for this grid · exits when a candle low touches the stop, re-enters when price closes back inside the range · figures over the whole window at {fmtUsd(investment)}
          </p>
          <table className="w-full border-collapse text-[11px] tabular-nums">
            <thead>
              <tr>
                {["Stop", "Price", "Worst from here", "From top", "Exits", "Worst exit", "Days out", "Grid profit", "Net P&L", ""].map((h, i) => (
                  <th key={h || i} className={`py-1 pr-3 text-[11px] font-normal uppercase tracking-[1px] ${i >= 2 ? "text-right" : "text-left"}`} style={{ color: C.dim, borderBottom: "1px solid rgba(255,255,255,0.12)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {candidate.stopSweep.map((r) => {
                const chosen = r.stopPrice !== null && Math.abs(r.stopPrice - candidate.stopLoss) < 1e-12;
                return (
                  <tr key={r.label} style={{ background: chosen ? `${C.green}12` : undefined, color: chosen ? "#fff" : C.text }}>
                    <td className="py-1 pr-3" style={{ borderBottom: `1px solid ${C.border}` }}>{r.label}</td>
                    <td className="py-1 pr-3" style={{ borderBottom: `1px solid ${C.border}` }}>{r.stopPrice === null ? "—" : fmtPrice(r.stopPrice)}</td>
                    <td className="py-1 pr-3 text-right" style={{ borderBottom: `1px solid ${C.border}`, color: C.red }}>{r.stopPrice === null ? "unbounded" : `−${fmtPct(r.worstCasePct * 100, 0)}`}</td>
                    <td className="py-1 pr-3 text-right" style={{ borderBottom: `1px solid ${C.border}`, color: C.dim }}>{r.stopPrice === null ? "unbounded" : `−${fmtPct(r.worstFromTopPct * 100, 0)}`}</td>
                    <td className="py-1 pr-3 text-right" style={{ borderBottom: `1px solid ${C.border}` }}>{r.exits}</td>
                    <td className="py-1 pr-3 text-right" style={{ borderBottom: `1px solid ${C.border}`, color: r.worstExitLossPct > 0 ? C.red : undefined }}>{r.worstExitLossPct > 0 ? `−${fmtPct(r.worstExitLossPct * 100)} · ${fmtUsd(investment * r.worstExitLossPct)}` : "—"}</td>
                    <td className="py-1 pr-3 text-right" style={{ borderBottom: `1px solid ${C.border}` }}>{r.daysOut > 0 ? r.daysOut.toFixed(1) : "—"}</td>
                    <td className="py-1 pr-3 text-right" style={{ borderBottom: `1px solid ${C.border}` }}>{fmtUsd(investment * r.gridProfitPct)}</td>
                    <td className="py-1 pr-3 text-right font-bold" style={{ borderBottom: `1px solid ${C.border}`, color: r.pnlPct >= 0 ? C.green : C.red }}>{r.pnlPct >= 0 ? "+" : "−"}{fmtUsd(Math.abs(investment * r.pnlPct))}</td>
                    <td className="py-1 text-right text-[11px]" style={{ borderBottom: `1px solid ${C.border}`, color: C.green }}>{chosen ? "recommended" : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {candidate && sized && investment != null && (
        <p className="m-0 mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px]" style={{ color: C.dim }}>
          {/* the tab pre-multiplies monthlyProfit by the resolution factor; recover it so the worst month gets the same correction */}
          <span>Worst month <b style={{ color: C.green }}>{fmtUsd(investment * sized.worstSliceYield * (sized.monthlyYield > 0 ? sized.monthlyProfit / (sized.monthlyYield * investment) : 1))} / month</b></span>
          <span>average <b className="text-white">{fmtUsd(sized.monthlyProfit)} / month</b></span>
          <span>{fmtPct(candidate.result.worstSliceYield * 100)} worst · {fmtPct(candidate.result.monthlyYield * 100)} avg raw yield</span>
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
