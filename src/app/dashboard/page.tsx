"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardHeader } from "@/components/DashboardHeader";
import { TabBar } from "@/components/TabBar";
import { BacktestTab } from "@/components/tabs/BacktestTab";
import { CyclesTab } from "@/components/tabs/CyclesTab";
import { LevelsTab } from "@/components/tabs/LevelsTab";
import { UnlockTab } from "@/components/tabs/UnlockTab";
import { C } from "@/lib/constants";
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

const TAB_IDS: readonly TabId[] = ["unlock", "cycles", "levels", "backtest"];

const isTabId = (v: unknown): v is TabId =>
  typeof v === "string" && (TAB_IDS as readonly string[]).includes(v);

const isThresholds = (v: unknown): v is BuyZoneOptions =>
  typeof v === "object" &&
  v !== null &&
  ["pumpMin", "dropMin", "dropMax", "recoveryMin"].every(
    (k) => typeof (v as Record<string, unknown>)[k] === "number",
  );

export default function DashboardPage() {
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchPriceData();
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
  }, []);

  const { currentPrice, priceChange } = useMemo(
    () => computePriceMeta(priceData),
    [priceData],
  );

  return (
    <main
      className="mx-auto min-h-dvh w-full max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8"
      style={{ color: C.text, fontFamily: C.font }}
    >
      <DashboardHeader currentPrice={currentPrice} priceChange={priceChange} />
      <TabBar active={activeTab} onChange={setActiveTab} />

      {activeTab === "unlock" && (
        <UnlockTab
          priceData={priceData}
          loading={loading}
          currentPrice={currentPrice}
          priceChange={priceChange}
        />
      )}
      {activeTab === "cycles" && (
        <CyclesTab
          priceData={priceData}
          loading={loading}
          thresholds={thresholds}
          onThresholdsChange={setThresholds}
        />
      )}
      {activeTab === "levels" && (
        <LevelsTab
          priceData={priceData}
          loading={loading}
          currentPrice={currentPrice}
        />
      )}
      {activeTab === "backtest" && (
        <BacktestTab priceData={priceData} thresholds={thresholds} />
      )}

      <p
        className="mt-5 text-center text-[9px]"
        style={{ color: "#333" }}
      >
        Data: CoinGecko · Not financial advice
      </p>
    </main>
  );
}
