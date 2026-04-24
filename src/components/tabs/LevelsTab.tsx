"use client";

import { useMemo, useState } from "react";
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
import { C } from "@/lib/constants";
import { callClaude } from "@/lib/claude";
import { calcSR } from "@/lib/analytics";
import type { ManualLevel, PricePoint, SRLevel } from "@/lib/types";

interface LevelsTabProps {
  priceData: PricePoint[];
  loading: boolean;
  currentPrice: number | null;
}

type LevelType = "support" | "resistance";

export function LevelsTab({
  priceData,
  loading,
  currentPrice,
}: LevelsTabProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [manualLevels, setManualLevels] = useState<ManualLevel[]>([]);
  const [newLevel, setNewLevel] = useState("");
  const [newType, setNewType] = useState<LevelType>("support");

  const { supports, resistances } = useMemo(
    () => calcSR(priceData),
    [priceData],
  );

  const allSupports: SRLevel[] = [
    ...supports,
    ...manualLevels
      .filter((l) => l.type === "support")
      .map((l) => ({ price: l.price, touches: 0, manual: true as const })),
  ];
  const allResistances: SRLevel[] = [
    ...resistances,
    ...manualLevels
      .filter((l) => l.type === "resistance")
      .map((l) => ({ price: l.price, touches: 0, manual: true as const })),
  ];

  function addLevel() {
    const val = parseFloat(newLevel);
    if (!Number.isNaN(val) && val > 0) {
      setManualLevels((prev) => [
        ...prev,
        { price: val, type: newType, manual: true },
      ]);
      setNewLevel("");
    }
  }

  async function run() {
    setBusy(true);
    setText("");
    const ctx = priceData
      .slice(-60)
      .map((d) => `${d.date}:$${d.price}`)
      .join(",");
    const supStr = allSupports.map((s) => `$${s.price.toFixed(5)}`).join(", ");
    const resStr = allResistances
      .map((r) => `$${r.price.toFixed(5)}`)
      .join(", ");
    try {
      await callClaude(
        `MON (Monad) crypto. Daily prices: ${ctx}. Current: $${currentPrice?.toFixed(5)}. Auto-detected supports: ${supStr}. Resistances: ${resStr}. Analyze: 1) Strength of each level by touch count? 2) Key support if price drops further? 3) Key resistance to break for bullish move? 4) Is current price near critical level? 5 concise sentences with specific prices.`,
        setText,
      );
    } catch (e) {
      setText(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setBusy(false);
  }

  return (
    <div id="panel-levels" role="tabpanel" aria-labelledby="tab-levels">
      <ChartFrame
        caption={
          <>
            <span style={{ color: C.green }}>━ Support</span>
            &nbsp;&nbsp;
            <span style={{ color: C.red }}>━ Resistance</span>
            <br />
            <span className="text-[10px]" style={{ color: C.muted }}>
              Dashed = manual levels
            </span>
          </>
        }
        height={230}
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
            {allSupports.map((s, i) => (
              <ReferenceLine
                key={`s${i}`}
                y={s.price}
                stroke={C.green}
                strokeDasharray={s.manual ? "2 3" : "6 3"}
                strokeWidth={s.manual ? 1 : 1.5}
                label={{
                  value: `S ${s.price.toFixed(4)}`,
                  position: "insideTopRight",
                  fill: C.green,
                  fontSize: 8,
                }}
              />
            ))}
            {allResistances.map((r, i) => (
              <ReferenceLine
                key={`r${i}`}
                y={r.price}
                stroke={C.red}
                strokeDasharray={r.manual ? "2 3" : "6 3"}
                strokeWidth={r.manual ? 1 : 1.5}
                label={{
                  value: `R ${r.price.toFixed(4)}`,
                  position: "insideTopRight",
                  fill: C.red,
                  fontSize: 8,
                }}
              />
            ))}
            <Line
              type="monotone"
              dataKey="price"
              stroke={C.blue}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: C.blue }}
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
          Add Custom Level
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="new-level-input">
            Price
          </label>
          <input
            id="new-level-input"
            value={newLevel}
            onChange={(e) => setNewLevel(e.target.value)}
            placeholder="Price e.g. 0.03200"
            inputMode="decimal"
            className="min-h-[44px] w-[140px] rounded-md px-2.5 text-xs text-white outline-none tabular-nums"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: `1px solid ${C.border}`,
              fontFamily: C.font,
            }}
          />
          {(["support", "resistance"] as LevelType[]).map((t) => {
            const selected = newType === t;
            const color = t === "support" ? C.green : C.red;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setNewType(t)}
                aria-pressed={selected}
                className="min-h-[44px] rounded-md border px-3 text-[11px]"
                style={{
                  background: selected ? `${color}22` : "transparent",
                  borderColor: color,
                  color,
                  fontFamily: C.font,
                }}
              >
                {t === "support" ? "Support" : "Resistance"}
              </button>
            );
          })}
          <button
            type="button"
            onClick={addLevel}
            className="min-h-[44px] rounded-md border px-3.5 text-[11px]"
            style={{
              background: `${C.blue}22`,
              borderColor: C.blue,
              color: C.blue,
              fontFamily: C.font,
            }}
          >
            + Add
          </button>
        </div>
        {manualLevels.length > 0 && (
          <ul className="mt-2.5 list-none p-0">
            {manualLevels.map((l, i) => (
              <li
                key={`${l.type}-${l.price}-${i}`}
                className="mb-1 flex items-center justify-between rounded-md px-2 py-1.5"
                style={{ background: "rgba(255,255,255,0.02)" }}
              >
                <span
                  className="text-[11px] tabular-nums"
                  style={{ color: l.type === "support" ? C.green : C.red }}
                >
                  {l.type === "support" ? "S" : "R"} — ${l.price.toFixed(5)}{" "}
                  <span style={{ color: C.muted }}>(manual)</span>
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setManualLevels((p) => p.filter((_, idx) => idx !== i))
                  }
                  aria-label={`Remove ${l.type} at ${l.price.toFixed(5)}`}
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center text-sm"
                  style={{ color: C.muted, background: "transparent" }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mb-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {(
          [
            { title: "Support Levels", levels: allSupports, color: C.green },
            { title: "Resistance Levels", levels: allResistances, color: C.red },
          ] as const
        ).map(({ title, levels, color }) => (
          <section
            key={title}
            className="rounded-xl p-3"
            style={{
              background: C.surface,
              border: `1px solid ${color}22`,
            }}
          >
            <p
              className="m-0 mb-2 text-[10px] uppercase tracking-[1px]"
              style={{ color }}
            >
              {title}
            </p>
            {!levels.length && (
              <p className="m-0 text-[11px]" style={{ color: C.muted }}>
                None detected
              </p>
            )}
            {levels.map((l, i) => (
              <div
                key={`${title}-${i}`}
                className="flex justify-between py-1.5"
                style={{ borderBottom: `1px solid ${C.border}` }}
              >
                <span className="text-[11px] tabular-nums text-white">
                  ${l.price.toFixed(5)}
                </span>
                <span className="text-[10px]" style={{ color }}>
                  {l.manual ? "manual" : `${l.touches}x`}
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>

      <AIBox
        title="Support & Resistance Analysis"
        onRun={run}
        loading={busy}
        text={text}
        placeholder='Click "Analyse" for AI interpretation of key price levels and what to watch.'
      />
    </div>
  );
}
