"use client";

import type { ReactNode } from "react";
import { C } from "@/lib/constants";
import { GRID_WINDOW_LABEL, type GridWindow } from "@/lib/candles";
import { DEFAULT_GRID_SETTINGS, type GridMode, type GridSettings } from "@/lib/grid";

interface GridInputsProps {
  value: GridSettings;
  onChange: (next: GridSettings) => void;
}

const WINDOWS: GridWindow[] = ["1m", "3m", "6m", "max"];
const MODES: { id: GridMode; label: string }[] = [
  { id: "arithmetic", label: "ARITH" },
  { id: "geometric", label: "GEO" },
];

function Pill({ active, color, onClick, children, ariaLabel }: { active: boolean; color: string; onClick: () => void; children: ReactNode; ariaLabel?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      className="min-h-[44px] flex-1 rounded-lg border text-[10px] font-bold tracking-[1px] transition-colors"
      style={{
        background: active ? `${color}1f` : "transparent",
        borderColor: active ? `${color}80` : C.border,
        color: active ? color : C.muted,
      }}
    >
      {children}
    </button>
  );
}

export function GridInputs({ value, onChange }: GridInputsProps) {
  const inputStyle = { background: "rgba(0,0,0,0.25)", borderColor: "rgba(255,255,255,0.14)", color: "#fff", fontFamily: C.font };
  return (
    <section
      className="mb-3 grid grid-cols-1 gap-3 rounded-xl p-3.5 sm:grid-cols-2 lg:grid-cols-4"
      style={{ background: C.surface, border: `1px solid ${C.border}` }}
      aria-label="Grid analyst inputs"
    >
      <label className="flex flex-col gap-1.5 text-[9px] uppercase tracking-[1px]" style={{ color: C.muted }}>
        Monthly goal (USD)
        <input
          id="grid-goal"
          type="number"
          min={1}
          step={10}
          inputMode="decimal"
          value={value.goalUsd}
          onChange={(e) => onChange({ ...value, goalUsd: Math.max(0, Number(e.target.value) || 0) })}
          className="min-h-[44px] rounded-lg border px-3 text-[14px] font-bold tabular-nums"
          style={inputStyle}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-[9px] uppercase tracking-[1px]" style={{ color: C.muted }}>
        Max investment (USD, optional)
        <input
          id="grid-max"
          type="number"
          min={0}
          step={100}
          inputMode="decimal"
          placeholder="no limit"
          value={value.maxInvestment ?? ""}
          onChange={(e) => onChange({ ...value, maxInvestment: e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0) })}
          className="min-h-[44px] rounded-lg border px-3 text-[14px] font-bold tabular-nums"
          style={inputStyle}
        />
      </label>
      <div className="flex flex-col gap-1.5 text-[9px] uppercase tracking-[1px]" style={{ color: C.muted }} role="group" aria-label="Backtest window">
        Backtest window
        <div className="flex gap-1">
          {WINDOWS.map((w) => (
            <Pill key={w} active={value.window === w} color={C.green} onClick={() => onChange({ ...value, window: w })}>
              {GRID_WINDOW_LABEL[w]}
            </Pill>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 text-[9px] uppercase tracking-[1px]" style={{ color: C.muted }} role="group" aria-label="Grid mode">
        Grid mode
        <div className="flex gap-1">
          {MODES.map((m) => (
            <Pill key={m.id} active={value.mode === m.id} color={C.purple} onClick={() => onChange({ ...value, mode: m.id })} ariaLabel={m.id}>
              {m.label}
            </Pill>
          ))}
          <button
            type="button"
            onClick={() => onChange(DEFAULT_GRID_SETTINGS)}
            className="min-h-[44px] rounded-lg border px-3 text-[10px] font-bold tracking-[1px] transition-colors"
            style={{ borderColor: C.border, color: C.muted }}
            aria-label="Reset inputs to defaults"
          >
            RESET
          </button>
        </div>
      </div>
    </section>
  );
}
