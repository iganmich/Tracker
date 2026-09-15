"use client";

import { C } from "@/lib/constants";
import type { EnrichedPricePoint } from "@/lib/types";

interface ChartTooltipPayloadEntry {
  value?: number;
  payload?: EnrichedPricePoint;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: ChartTooltipPayloadEntry[];
  label?: string | number;
}

export function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  const price = d?.price;
  return (
    <div
      role="tooltip"
      className="rounded-lg px-3.5 py-2.5 text-[11px]"
      style={{
        background: "rgba(7,10,20,0.97)",
        border: `1px solid ${C.green}33`,
        color: C.text,
      }}
    >
      <p className="mb-1 font-bold" style={{ color: C.green }}>
        {label}
      </p>
      {typeof price === "number" && (
        <p className="m-0">
          Price: <b className="text-white">${price.toFixed(5)}</b>
        </p>
      )}
      {typeof d?.bbUpper === "number" && typeof d?.bbLower === "number" && (
        <p className="m-0 mt-0.5" style={{ color: C.purple }}>
          BB: ${d.bbLower.toFixed(5)} – ${d.bbUpper.toFixed(5)}
        </p>
      )}
      {d?.unlock && (
        <p className="mt-1 m-0" style={{ color: C.yellow }}>
          🔓 {d.unlock.label} · {d.unlock.amount}
        </p>
      )}
      {d?.isBuyZone && (
        <p className="mt-1 m-0" style={{ color: C.green }}>
          ✅ {d.label}
        </p>
      )}
    </div>
  );
}
