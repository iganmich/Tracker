"use client";

import { useEffect, useMemo, useState } from "react";
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
import {
  DEFAULT_BUY_ZONE_OPTIONS,
  type BuyZoneOptions,
  type PricePoint,
  type TabId,
} from "@/lib/types";

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<TabId>("unlock");
  const [priceData, setPriceData] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [thresholds, setThresholds] = useState<BuyZoneOptions>(
    DEFAULT_BUY_ZONE_OPTIONS,
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
