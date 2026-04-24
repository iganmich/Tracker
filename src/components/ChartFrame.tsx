import type { ReactNode } from "react";
import { C } from "@/lib/constants";

interface ChartFrameProps {
  caption: ReactNode;
  height: number;
  loading: boolean;
  children: ReactNode;
  className?: string;
}

export function ChartFrame({
  caption,
  height,
  loading,
  children,
  className,
}: ChartFrameProps) {
  return (
    <section
      className={`mb-3 rounded-xl px-2 pb-2 pt-4 sm:mb-3.5 ${className ?? ""}`}
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
      }}
    >
      <p
        className="mb-3 ml-2 text-[11px]"
        style={{ color: C.muted }}
      >
        {caption}
      </p>
      {loading ? (
        <div
          className="skeleton mx-2 mb-2 rounded-md"
          style={{ height }}
          role="status"
          aria-label="Loading chart"
        />
      ) : (
        <div style={{ height }}>{children}</div>
      )}
    </section>
  );
}
