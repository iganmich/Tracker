"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CandidateBoard } from "@/components/grid/CandidateBoard";
import { CandidateTicket } from "@/components/grid/CandidateTicket";
import { GridChart } from "@/components/grid/GridChart";
import { GridInputs } from "@/components/grid/GridInputs";
import { useCoin, usePriceFormat } from "@/lib/coin-context";
import { C } from "@/lib/constants";
import {
  GRID_WINDOW_DAYS,
  GRID_WINDOW_LABEL,
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

/** Windows too short to fit a range to: they borrow the 3M ranges and only measure performance. */
const SHORT_WINDOWS = new Set<GridWindow>(["1d", "1w"]);

const RES_LABEL: Record<number, string> = { 60: "1-minute", 300: "5-minute", 900: "15-minute", 1800: "30-minute", 3600: "1-hour", 86400: "daily" };

export function GridAnalystTab({ priceData, currentPrice }: GridAnalystTabProps) {
  const coin = useCoin();
  const fmtPrice = usePriceFormat();
  const [settings, setSettings] = usePersistentState<GridSettings>("mon.grid", DEFAULT_GRID_SETTINGS, isGridSettings);
  const [set, setSet] = useState<CandleSet | null>(null);
  const [rangeSet, setRangeSet] = useState<CandleSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(0);
  // One entry per `${coin}:${window}` so switching back and forth is instant.
  const cacheRef = useRef<Map<string, CandleSet>>(new Map());

  // Fetch per coin + window, cache per session (same pattern as CyclesTab).
  useEffect(() => {
    const w = settings.window;
    const key = `${coin.id}:${w}`;
    const cached = cacheRef.current.get(key);
    if (cached) {
      setSet(cached);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    // Short windows (1D/1W) also need the 3M series: ranges are fitted to it, only the
    // performance is measured on the short window — otherwise the "best" range is one
    // fitted to yesterday's high and low with hindsight.
    const rangeKey = `${coin.id}:3m`;
    const rangeCached = cacheRef.current.get(rangeKey);
    const needRange = SHORT_WINDOWS.has(w) && !rangeCached;
    Promise.all([
      fetchCandles(coin.id, GRID_WINDOW_DAYS[w]),
      needRange ? fetchCandles(coin.id, GRID_WINDOW_DAYS["3m"]) : Promise.resolve(rangeCached ?? null),
    ])
      .then(([cs, range]) => {
        if (cancelled) return;
        cacheRef.current.set(key, cs);
        if (range) cacheRef.current.set(rangeKey, range);
        setSet(cs);
        setRangeSet(range);
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
        setRangeSet(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [coin.id, settings.window, priceData]);

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
      rankBy: settings.rankBy,
      minTradesPerDay: settings.minTradesPerDay,
      maxLossPct: settings.maxLossPct,
      asset: coin.id,
      rangeCandles: SHORT_WINDOWS.has(settings.window) ? rangeSet?.candles : undefined,
    });
  }, [set, rangeSet, candleMs, price, settings.window, settings.goalUsd, settings.maxInvestment, settings.mode, settings.rankBy, settings.minTradesPerDay, settings.maxLossPct, factor, coin.id]);

  const candidates = useMemo(() => (out?.best ? [out.best, ...out.alternatives] : []), [out]);
  const selectedIdx = Math.min(selected, Math.max(0, candidates.length - 1));
  const chosen = candidates[selectedIdx] ?? null;
  // Over budget → size the ticket to what the user can actually invest; the warning states the shortfall.
  const investment = chosen
    ? settings.goalUsd === null
      ? settings.maxInvestment // investment mode: the ticket is sized to what the user enters
      : settings.maxInvestment != null && chosen.requiredInvestment > settings.maxInvestment
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
    if (SHORT_WINDOWS.has(settings.window) && rangeSet) {
      w.unshift(`${GRID_WINDOW_LABEL[settings.window]} window: ranges are the 3M ranges, only the yield is measured over the last ${GRID_WINDOW_DAYS[settings.window]} day(s) and scaled to a month. Use it to see how a realistic grid did recently, not to size an investment.`);
    }
    if (set?.source === "fallback") w.unshift("Approximate: using daily CoinGecko prices without intraday range — the candle service is unavailable. Fills are under-counted heavily.");
    else if (set && factor !== 1) w.unshift(`${RES_LABEL[set.resolutionSec]} candles capture about ${Math.round(100 / factor)}% of live fills — yields, profit and investment are corrected ×${factor.toFixed(2)}. Calibrated on one live-bot day (measured on MON).`);
    return w;
  }, [out, set, factor, chosen, settings.window, rangeSet]);

  const noCandidateReason = out?.warnings.find((w) => w.includes("trending")) ?? out?.warnings[0];

  const caption = (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      <span>Price · {set ? RES_LABEL[set.resolutionSec] : "…"} candles</span>
      {chosen && <span style={{ color: C.blue }}>▬ range {fmtPrice(chosen.lower)} – {fmtPrice(chosen.upper)}</span>}
      {chosen && <span style={{ color: C.dim }}>┈ {chosen.grids} grids</span>}
      {price != null && <span className="text-white">— now {fmtPrice(price)}</span>}
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
        rankBy={settings.rankBy}
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

      <p className="mt-1 text-center text-[11px]" style={{ color: C.dim }}>
        {set?.source === "fallback"
          ? "Backtest on CoinGecko daily prices (fallback — candle service unavailable)"
          : `Backtest on Pionex ${coin.pionexSymbol} ${set ? RES_LABEL[set.resolutionSec] : ""} candles · ${set?.source === "db" ? "local db" : "live"}`}
        {" · fee 0.05%/side · calibrated on one live-bot day · past range ≠ future range"}
      </p>
    </div>
  );
}
