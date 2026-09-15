"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardHeader } from "@/components/DashboardHeader";
import { TabBar } from "@/components/TabBar";
import { BacktestTab } from "@/components/tabs/BacktestTab";
import { CyclesTab } from "@/components/tabs/CyclesTab";
import { GridAnalystTab } from "@/components/tabs/GridAnalystTab";
import { LevelsTab } from "@/components/tabs/LevelsTab";
import { UnlockTab } from "@/components/tabs/UnlockTab";
import { CoinProvider } from "@/lib/coin-context";
import { COINS, DEFAULT_COIN, isCoinId, type CoinId } from "@/lib/coins";
import { C, TABS } from "@/lib/constants";
import {
  computePriceMeta,
  fetchPriceData,
  generateMockData,
} from "@/lib/prices";
import { usePersistentState } from "@/lib/storage";
import {
  DEFAULT_BUY_ZONE_OPTIONS,
  type BuyZoneOptions,
  type PricePoint,
  type TabId,
} from "@/lib/types";

const TAB_IDS: readonly TabId[] = ["unlock", "cycles", "levels", "backtest", "grid"];

const isTabId = (v: unknown): v is TabId =>
  typeof v === "string" && (TAB_IDS as readonly string[]).includes(v);

const isThresholds = (v: unknown): v is BuyZoneOptions =>
  typeof v === "object" &&
  v !== null &&
  ["pumpMin", "dropMin", "dropMax", "recoveryMin"].every(
    (k) => typeof (v as Record<string, unknown>)[k] === "number",
  );

export default function DashboardPage() {
  const [coinId, setCoinId] = usePersistentState<CoinId>(
    "mon.coin",
    DEFAULT_COIN,
    isCoinId,
  );
  const coin = COINS[coinId];
  const [activeTab, setActiveTab] = usePersistentState<TabId>(
    "mon.activeTab",
    "unlock",
    isTabId,
  );
  const [priceData, setPriceData] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [thresholds, setThresholdsRaw] = usePersistentState<BuyZoneOptions>(
    "mon.thresholds",
    DEFAULT_BUY_ZONE_OPTIONS,
    isThresholds,
  );
  const setThresholds = useCallback(
    (next: BuyZoneOptions) => setThresholdsRaw(next),
    [setThresholdsRaw],
  );

  // Switching coin clears the previous coin's series so the tabs show skeletons rather
  // than stale data. Done as a render-time adjustment, not an effect
  // (react-hooks/set-state-in-effect); the fetch below then refills it.
  const [fetchedCoin, setFetchedCoin] = useState(coinId);
  if (fetchedCoin !== coinId) {
    setFetchedCoin(coinId);
    setPriceData([]);
    setLoading(true);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchPriceData(coin);
        if (!cancelled) setPriceData(data);
      } catch {
        if (!cancelled) setPriceData(generateMockData());
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [coin]);

  const { currentPrice, priceChange } = useMemo(
    () => computePriceMeta(priceData),
    [priceData],
  );

  // Coins without an unlock schedule don't get the Unlock tab; a persisted "unlock"
  // selection falls back to Cycles for as long as such a coin is selected.
  const tabs = useMemo(
    () => (coin.hasUnlocks ? TABS : TABS.filter((t) => t.id !== "unlock")),
    [coin.hasUnlocks],
  );
  const shownTab =
    activeTab === "unlock" && !coin.hasUnlocks ? "cycles" : activeTab;

  return (
    <CoinProvider coin={coin}>
      <main
        className="mx-auto min-h-dvh w-full max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8"
        style={{ color: C.text, fontFamily: C.font }}
      >
        <DashboardHeader
          coin={coin}
          onCoinChange={setCoinId}
          currentPrice={currentPrice}
          priceChange={priceChange}
        />
        <TabBar active={shownTab} onChange={setActiveTab} tabs={tabs} />

        {shownTab === "unlock" && (
          <UnlockTab
            priceData={priceData}
            loading={loading}
            currentPrice={currentPrice}
            priceChange={priceChange}
          />
        )}
        {shownTab === "cycles" && (
          <CyclesTab
            priceData={priceData}
            loading={loading}
            thresholds={thresholds}
            onThresholdsChange={setThresholds}
          />
        )}
        {shownTab === "levels" && (
          <LevelsTab
            priceData={priceData}
            loading={loading}
            currentPrice={currentPrice}
          />
        )}
        {shownTab === "backtest" && (
          <BacktestTab priceData={priceData} thresholds={thresholds} />
        )}
        {shownTab === "grid" && (
          <GridAnalystTab priceData={priceData} currentPrice={currentPrice} />
        )}

        <p className="mt-5 text-center text-[9px]" style={{ color: "#333" }}>
          Data: CoinGecko · Pionex {coin.pionexSymbol} · Not financial advice
        </p>
      </main>
    </CoinProvider>
  );
}
