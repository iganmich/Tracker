"use client";

import { createContext, useContext, type ReactNode } from "react";
import { COINS, DEFAULT_COIN, formatPrice, type Coin } from "./coins";

const CoinContext = createContext<Coin>(COINS[DEFAULT_COIN]);

export function CoinProvider({ coin, children }: { coin: Coin; children: ReactNode }) {
  return <CoinContext.Provider value={coin}>{children}</CoinContext.Provider>;
}

/** The currently selected coin. Components use this instead of hard-coding MON. */
export function useCoin(): Coin {
  return useContext(CoinContext);
}

/** `fmt(price)` with the selected coin's decimals. */
export function usePriceFormat(): (n: number) => string {
  const coin = useCoin();
  return (n: number) => formatPrice(n, coin);
}
