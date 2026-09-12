"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CandidateBoard } from "@/components/grid/CandidateBoard";
import { CandidateTicket } from "@/components/grid/CandidateTicket";
import { GridChart } from "@/components/grid/GridChart";
import { GridInputs } from "@/components/grid/GridInputs";
import { C } from "@/lib/constants";
import {
  GRID_WINDOW_DAYS,
  RESOLUTION_FACTOR,
  candlesFromPricePoints,
  fetchCandles,
  type CandleSet,
  type GridWindow,
} from "@/lib/candles";
import { DEFAULT_GRID_SETTINGS, isGridSettings, optimizeGrid, simulateGrid, type GridSettings } from "@/lib/grid";
import { usePersistentState } from "@/lib/storage";
import type { PricePoint } from "@/lib/types";

interface GridAnalystTabProps {
  priceData: PricePoint[];
  currentPrice: number | null;
}

const RES_LABEL: Record<number, string> = { 300: "5-minute", 900: "15-minute", 1800: "30-minute", 3600: "1-hour", 86400: "daily" };

export function GridAnalystTab({ priceData, currentPrice }: GridAnalystTabProps) {
  const [settings, setSettings] = usePersistentState<GridSettings>("mon.grid", DEFAULT_GRID_SETTINGS, isGridSettings);
  const [set, setSet] = useState<CandleSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(0);
  const cacheRef = useRef<Partial<Record<GridWindow, CandleSet>>>({});

  // Fetch per window, cache per session (same pattern as CyclesTab).
  useEffect(() => {
    const w = settings.window;
    const cached = cacheRef.current[w];
    if (cached) {
      setSet(cached);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchCandles(GRID_WINDOW_DAYS[w])
      .then((cs) => {
        if (cancelled) return;
        cacheRef.current[w] = cs;
        setSet(cs);
      })
      .catch(() => {
        if (cancelled) return;
        const days = GRID_WINDOW_DAYS[w];
        const cutoff = Date.now() - days * 86_400_000;
        const fb: CandleSet = {
          resolutionSec: 86400,
          source: "fallback",
          candles: candlesFromPricePoints(priceData).filter((c) => c.time >= cutoff),
        };
        setSet(fb);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [settings.window, priceData]);

  // Reset the selection whenever the inputs or the candle set change. Done as a render-time
  // adjustment rather than an effect (react-hooks/set-state-in-effect).
  const [prev, setPrev] = useState<{ settings: GridSettings; set: CandleSet | null }>({ settings, set });
  if (prev.settings !== settings || prev.set !== set) {
    setPrev({ settings, set });
    setSelected(0);
  }

  const price = set?.candles.length ? set.candles[set.candles.length - 1].close : currentPrice;
  const factor = set ? (RESOLUTION_FACTOR[set.resolutionSec] ?? 1) : 1;
  const candleMs = set ? set.resolutionSec * 1000 : 0;

  const out = useMemo(() => {
    if (!set || set.candles.length === 0 || price == null) return null;
    return optimizeGrid({
      candles: set.candles,
      candleMs,
      goalUsd: settings.goalUsd,
      maxInvestment: settings.maxInvestment,
      currentPrice: price,
      mode: settings.mode,
      factor,
    });
  }, [set, candleMs, price, settings.goalUsd, settings.maxInvestment, settings.mode, factor]);

  const candidates = useMemo(() => (out?.best ? [out.best, ...out.alternatives] : []), [out]);
  const selectedIdx = Math.min(selected, Math.max(0, candidates.length - 1));
  const chosen = candidates[selectedIdx] ?? null;
  // Over budget → size the ticket to what the user can actually invest; the warning states the shortfall.
  const investment = chosen
    ? settings.maxInvestment != null && chosen.requiredInvestment > settings.maxInvestment
      ? settings.maxInvestment
      : chosen.requiredInvestment
    : null;

  // Re-simulate the chosen candidate at its real investment for the ticket, then apply the factor to
  // the live-facing numbers (profit and trades) — the optimizer ranked on raw yield on purpose.
  const sized = useMemo(() => {
    if (!set || !chosen || investment == null) return null;
    const r = simulateGrid(set.candles, { lower: chosen.lower, upper: chosen.upper, grids: chosen.grids, investment, mode: chosen.mode }, candleMs);
    return { ...r, monthlyProfit: r.monthlyProfit * factor, tradesPerMonth: r.tradesPerMonth * factor };
  }, [set, chosen, investment, candleMs, factor]);

  const warnings = useMemo(() => {
    // With no candidate the board already shows the optimizer's explanation; don't repeat it here.
    const w = chosen ? [...(out?.warnings ?? [])] : [];
    if (set?.source === "fallback") w.unshift("Approximate: using daily CoinGecko prices without intraday range — the candle service is unavailable. Fills are under-counted heavily.");
    else if (set && factor !== 1) w.unshift(`${RES_LABEL[set.resolutionSec]} candles capture about ${Math.round(100 / factor)}% of live fills — yields, profit and investment are corrected ×${factor.toFixed(2)}. Calibrated on one live-bot day.`);
    return w;
  }, [out, set, factor, chosen]);

  const noCandidateReason = out?.warnings.find((w) => w.includes("trending")) ?? out?.warnings[0];

  const caption = (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      <span>Price · {set ? RES_LABEL[set.resolutionSec] : "…"} candles</span>
      {chosen && <span style={{ color: C.blue }}>▬ range {chosen.lower.toFixed(5)} – {chosen.upper.toFixed(5)}</span>}
      {chosen && <span style={{ color: C.muted }}>┈ {chosen.grids} grids</span>}
      {price != null && <span className="text-white">— now {price.toFixed(5)}</span>}
    </span>
  );

  return (
    <div role="tabpanel" id="panel-grid" aria-labelledby="tab-grid">
      <GridInputs value={settings} onChange={setSettings} />

      <CandidateBoard
        candidates={candidates}
        selected={selectedIdx}
        onSelect={setSelected}
        goalUsd={settings.goalUsd}
        maxInvestment={settings.maxInvestment}
        currentPrice={price}
        tested={out?.tested ?? 0}
        kept={out?.kept ?? 0}
        loading={loading}
        emptyMessage={price == null ? "Waiting for price data." : noCandidateReason}
      />

      <CandidateTicket rank={selectedIdx + 1} candidate={chosen} investment={investment} sized={sized} warnings={warnings} />

      <GridChart
        candles={set?.candles ?? []}
        lower={chosen?.lower ?? null}
        upper={chosen?.upper ?? null}
        levels={chosen?.result.levels ?? []}
        currentPrice={price}
        loading={loading}
        caption={caption}
      />

      <p className="mt-1 text-center text-[9px]" style={{ color: "#444" }}>
        {set?.source === "fallback"
          ? "Backtest on CoinGecko daily prices (fallback — candle service unavailable)"
          : `Backtest on Pionex MON_USDT_PERP ${set ? RES_LABEL[set.resolutionSec] : ""} candles · ${set?.source === "db" ? "local db" : "live"}`}
        {" · fee 0.05%/side · calibrated on one live-bot day · past range ≠ future range"}
      </p>
    </div>
  );
}
