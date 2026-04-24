import { C } from "@/lib/constants";

interface DashboardHeaderProps {
  currentPrice: number | null;
  priceChange: number | null;
}

export function DashboardHeader({
  currentPrice,
  priceChange,
}: DashboardHeaderProps) {
  return (
    <header className="mb-4 flex items-center gap-2.5 sm:mb-5">
      <div
        className="flex h-8 w-8 items-center justify-center rounded-full text-base font-black text-white"
        style={{ background: "linear-gradient(135deg,#6c47ff,#00e5a0)" }}
        aria-hidden
      >
        M
      </div>
      <div>
        <h1
          className="m-0 text-[18px] font-black tracking-tight text-white"
        >
          MON Tracker
        </h1>
        <p className="m-0 text-[10px]" style={{ color: C.green }}>
          Monad · Multi-Pattern Analysis
        </p>
      </div>
      <div className="ml-auto text-right tabular-nums" aria-live="polite">
        {currentPrice != null && (
          <p className="m-0 text-[15px] font-bold text-white">
            ${currentPrice.toFixed(5)}
          </p>
        )}
        {priceChange != null && (
          <p
            className="m-0 text-[10px]"
            style={{ color: priceChange >= 0 ? C.green : C.red }}
          >
            {priceChange >= 0 ? "▲" : "▼"} {Math.abs(priceChange).toFixed(1)}% 7d
          </p>
        )}
      </div>
    </header>
  );
}
