import type { CSSProperties, ReactNode } from "react";
import { C } from "@/lib/constants";

interface ChartFrameProps {
  caption: ReactNode;
  height: number;
  lgHeight?: number;
  loading: boolean;
  children: ReactNode;
  className?: string;
}

export function ChartFrame({
  caption,
  height,
  lgHeight,
  loading,
  children,
  className,
}: ChartFrameProps) {
  const styleVars = {
    "--chart-h": `${height}px`,
    "--chart-lh": `${lgHeight ?? Math.round(height * 1.7)}px`,
  } as CSSProperties;

  return (
    <section
      className={`mb-3 rounded-xl px-2 pb-2 pt-4 sm:mb-3.5 ${className ?? ""}`}
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
      }}
    >
      <p className="mb-3 ml-2 text-[11px]" style={{ color: C.muted }}>
        {caption}
      </p>
      {loading ? (
        <div
          className="skeleton mx-2 mb-2 h-[var(--chart-h)] rounded-md lg:h-[var(--chart-lh)]"
          style={styleVars}
          role="status"
          aria-label="Loading chart"
        />
      ) : (
        <div
          className="h-[var(--chart-h)] lg:h-[var(--chart-lh)]"
          style={styleVars}
        >
          {children}
        </div>
      )}
    </section>
  );
}
