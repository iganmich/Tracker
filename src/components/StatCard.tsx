import { C } from "@/lib/constants";

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  subColor?: string;
  accent: string;
}

export function StatCard({ label, value, sub, subColor, accent }: StatCardProps) {
  return (
    <div
      className="rounded-[10px] px-3.5 py-3"
      style={{
        background: C.surface,
        border: `1px solid ${accent}22`,
      }}
    >
      <p
        className="m-0 text-[9px] uppercase tracking-[1px]"
        style={{ color: C.muted }}
      >
        {label}
      </p>
      <p className="m-0 mt-1 mb-0.5 text-base font-bold text-white tabular-nums">
        {value}
      </p>
      <p className="m-0 text-[10px]" style={{ color: subColor ?? C.muted }}>
        {sub}
      </p>
    </div>
  );
}
