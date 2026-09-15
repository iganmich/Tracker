"use client";

import { COIN_IDS, formatPrice, type Coin, type CoinId } from "@/lib/coins";
import { C } from "@/lib/constants";

interface DashboardHeaderProps {
  coin: Coin;
  onCoinChange: (id: CoinId) => void;
  currentPrice: number | null;
  priceChange: number | null;
}

export function DashboardHeader({
  coin,
  onCoinChange,
  currentPrice,
  priceChange,
}: DashboardHeaderProps) {
  return (
    <header className="mb-4 flex flex-wrap items-center gap-x-2.5 gap-y-2 sm:mb-5 sm:flex-nowrap">
      <div
        className="flex h-8 w-8 items-center justify-center rounded-full text-base font-black text-white"
        style={{ background: "linear-gradient(135deg,#6c47ff,#00e5a0)" }}
        aria-hidden
      >
        {coin.id[0]}
      </div>
      <div>
        <h1 className="m-0 text-[18px] font-black tracking-tight text-white">
          {coin.id} Tracker
        </h1>
        <p className="m-0 text-[10px]" style={{ color: C.green }}>
          {coin.name} · Multi-Pattern Analysis
        </p>
      </div>

      <div
        role="group"
        aria-label="Coin"
        className="order-last flex w-full flex-wrap gap-1.5 sm:order-none sm:ml-3 sm:w-auto sm:flex-nowrap"
      >
        {COIN_IDS.map((id) => {
          const active = id === coin.id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onCoinChange(id)}
              aria-pressed={active}
              className="min-h-[44px] flex-1 rounded-lg border px-3 text-[10px] font-bold tracking-[1px] transition-colors sm:flex-none"
              style={{
                background: active ? `${C.green}1f` : "transparent",
                borderColor: active ? `${C.green}80` : C.border,
                color: active ? C.green : C.dim,
              }}
            >
              {id}
            </button>
          );
        })}
      </div>

      <div className="ml-auto text-right tabular-nums" aria-live="polite">
        {currentPrice != null && (
          <p className="m-0 text-[15px] font-bold text-white">
            ${formatPrice(currentPrice, coin)}
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
