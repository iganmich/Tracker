import type { Coin } from "@/lib/coins";
import { hasDb, latestStoredMs, queryCandlesFromDb, upsertCandles } from "./candles-db";
import { fetchCandlesLive, fetchPionexKlines } from "./candles-pionex";

export interface StoreResult {
  source: "db" | "live";
  resolutionSec: number;
  candles: number[][];
  /** Rows written to the store by this request (0 when the store was already current). */
  backfilled: number;
}

export type RefreshReason = "backfill" | "top-up" | "fresh";

/** Pionex hard cap: nothing older than 10,000 candles back is obtainable at a given interval. */
const PIONEX_MAX_CANDLES = 10_000;

/**
 * How far back the store needs to pull for one coin/resolution.
 *  - nothing stored → `backfill` from launch, or from the Pionex history cap if that is later
 *  - stale by more than two candles → `top-up` from the newest stored candle (it may have been partial)
 *  - otherwise → `fresh`, nothing to fetch
 */
export function refreshPlan(
  latestMs: number | null,
  nowMs: number,
  resolutionSec: number,
  launchMs: number,
): { floorMs: number; reason: RefreshReason } {
  const stepMs = resolutionSec * 1000;
  if (latestMs === null) {
    return { floorMs: Math.max(launchMs, nowMs - PIONEX_MAX_CANDLES * stepMs), reason: "backfill" };
  }
  // Re-pull the newest stored candle: it may have been written while still open.
  if (nowMs - latestMs > 2 * stepMs) return { floorMs: latestMs, reason: "top-up" };
  return { floorMs: latestMs, reason: "fresh" };
}

/** One in-flight refresh per coin/resolution, so concurrent first requests share a single backfill. */
const inFlight = new Map<string, Promise<number>>();

function refresh(coin: Coin, resolutionSec: number): Promise<number> {
  const key = `${coin.id}:${resolutionSec}`;
  const running = inFlight.get(key);
  if (running) return running;
  const task = (async () => {
    const latest = await latestStoredMs(coin.exchange, coin.pionexSymbol, resolutionSec);
    const plan = refreshPlan(latest, Date.now(), resolutionSec, coin.launchMs);
    if (plan.reason === "fresh") return 0;
    const rows = await fetchPionexKlines(coin.pionexSymbol, resolutionSec, plan.floorMs);
    const written = await upsertCandles(coin.exchange, coin.pionexSymbol, resolutionSec, rows);
    console.log(`[candles] ${coin.id} ${resolutionSec}s ${plan.reason} ${written} rows`);
    return written;
  })();
  const tracked = task.finally(() => inFlight.delete(key));
  inFlight.set(key, tracked);
  return tracked;
}

/**
 * Candles for one coin, served from the local store. Backfills the coin on first request and tops up
 * the missing tail afterwards; falls back to a direct Pionex read when there is no store or it is empty.
 */
export async function ensureCandles(coin: Coin, resolutionSec: number, days: number): Promise<StoreResult> {
  if (!hasDb()) {
    return { source: "live", resolutionSec, candles: await fetchCandlesLive(coin, resolutionSec, days), backfilled: 0 };
  }

  let backfilled = 0;
  try {
    backfilled = await refresh(coin, resolutionSec);
  } catch (err) {
    console.error(`[candles] ${coin.id} ${resolutionSec}s refresh failed:`, err instanceof Error ? err.message : err);
  }

  let candles: number[][] | null = null;
  try {
    candles = await queryCandlesFromDb(coin.exchange, coin.pionexSymbol, resolutionSec, days);
  } catch (err) {
    console.error(`[candles] ${coin.id} db read failed:`, err instanceof Error ? err.message : err);
  }
  if (candles && candles.length > 0) return { source: "db", resolutionSec, candles, backfilled };

  return { source: "live", resolutionSec, candles: await fetchCandlesLive(coin, resolutionSec, days), backfilled };
}
