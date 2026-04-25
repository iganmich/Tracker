"use client";

import { C } from "@/lib/constants";
import {
  DEFAULT_BUY_ZONE_OPTIONS,
  type BuyZoneOptions,
} from "@/lib/types";

interface ThresholdControlsProps {
  value: BuyZoneOptions;
  onChange: (next: BuyZoneOptions) => void;
  zoneCount: number;
}

interface FieldDef {
  key: keyof BuyZoneOptions;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
}

const FIELDS: FieldDef[] = [
  {
    key: "pumpMin",
    label: "Pump min",
    hint: "Prior peak must rise this much",
    min: 0.02,
    max: 0.5,
    step: 0.01,
  },
  {
    key: "dropMin",
    label: "Drop min",
    hint: "Dip from peak ≥",
    min: 0.02,
    max: 0.5,
    step: 0.01,
  },
  {
    key: "dropMax",
    label: "Drop max",
    hint: "Dip from peak ≤",
    min: 0.1,
    max: 0.95,
    step: 0.01,
  },
  {
    key: "recoveryMin",
    label: "Recovery min",
    hint: "Bounce within 10d ≥",
    min: 0.02,
    max: 0.5,
    step: 0.01,
  },
];

function pct(v: number) {
  return `${(v * 100).toFixed(0)}%`;
}

export function ThresholdControls({
  value,
  onChange,
  zoneCount,
}: ThresholdControlsProps) {
  const isDefault =
    value.pumpMin === DEFAULT_BUY_ZONE_OPTIONS.pumpMin &&
    value.dropMin === DEFAULT_BUY_ZONE_OPTIONS.dropMin &&
    value.dropMax === DEFAULT_BUY_ZONE_OPTIONS.dropMax &&
    value.recoveryMin === DEFAULT_BUY_ZONE_OPTIONS.recoveryMin;

  function update<K extends keyof BuyZoneOptions>(
    key: K,
    raw: string,
  ) {
    const num = parseFloat(raw);
    if (Number.isNaN(num)) return;
    const next = { ...value, [key]: num };
    if (key === "dropMin" && num >= next.dropMax) next.dropMax = num + 0.01;
    if (key === "dropMax" && num <= next.dropMin) next.dropMin = num - 0.01;
    onChange(next);
  }

  return (
    <section
      className="mb-3.5 rounded-xl p-3.5"
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
      }}
      aria-label="Buy zone detection thresholds"
    >
      <div className="mb-3 flex items-center justify-between">
        <p
          className="m-0 text-[10px] uppercase tracking-[1px]"
          style={{ color: C.muted }}
        >
          Detection Thresholds · {zoneCount} zones found
        </p>
        <button
          type="button"
          onClick={() => onChange(DEFAULT_BUY_ZONE_OPTIONS)}
          disabled={isDefault}
          className="min-h-[44px] rounded-md border px-3 text-[10px] disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            background: "transparent",
            borderColor: C.border,
            color: C.muted,
            fontFamily: C.font,
          }}
        >
          Reset
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => {
          const v = value[f.key];
          return (
            <div key={f.key}>
              <div className="mb-1 flex items-baseline justify-between">
                <label
                  htmlFor={`th-${f.key}`}
                  className="text-[11px]"
                  style={{ color: C.text }}
                >
                  {f.label}
                </label>
                <span
                  className="text-[11px] tabular-nums"
                  style={{ color: C.green }}
                >
                  {pct(v)}
                </span>
              </div>
              <input
                id={`th-${f.key}`}
                type="range"
                min={f.min}
                max={f.max}
                step={f.step}
                value={v}
                onChange={(e) => update(f.key, e.target.value)}
                className="w-full accent-[var(--green)]"
                style={{ accentColor: C.green }}
                aria-describedby={`th-${f.key}-hint`}
              />
              <p
                id={`th-${f.key}-hint`}
                className="m-0 mt-0.5 text-[9px]"
                style={{ color: C.muted }}
              >
                {f.hint} {pct(f.min)}–{pct(f.max)}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
