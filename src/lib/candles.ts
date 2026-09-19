import type { CoinId } from "./coins";
import type { PricePoint } from "./types";

export interface Candle {
  time: number; // ms, candle open time (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
}

export type GridWindow = "1d" | "1w" | "1m" | "3m" | "6m" | "max";

export const GRID_WINDOW_DAYS: Record<GridWindow, number> = {
  "1d": 1,
  "1w": 7,
  "1m": 30,
  "3m": 90,
  "6m": 180,
  max: 400,
};

export const GRID_WINDOW_LABEL: Record<GridWindow, string> = {
  "1d": "1D",
  "1w": "1W",
  "1m": "1M",
  "3m": "3M",
  "6m": "6M",
  max: "MAX",
};

/**
 * Finest Pionex resolution whose 10,000-candle history covers the window
 * (5-min ≈ 35 d, 15-min ≈ 104 d, 30-min ≈ 208 d, 1-hour = full). Mirrored in
 * src/app/api/candles/route.ts — keep both in sync.
 */
export function resolutionForDays(days: number): number {
  if (days <= 1) return 60; // one day: 1-minute candles (1,440), Pionex keeps ≈ 7 days of them
  if (days <= 30) return 300;
  if (days <= 90) return 900;
  if (days <= 180) return 1800;
  return 3600;
}

/**
 * Share of live grid rounds the fill model captures at each resolution,
 * measured against the user's live Pionex bot on 2026-09-11/12
 * (5-min 85/83, 15-min 71/83, 30-min 64/83, 1-hour 53/83). Used to correct
 * yields for sizing; see spec "Data facts".
 */
export const RESOLUTION_FACTOR: Record<number, number> = {
  60: 1.0, // 1-min simulated 90 of 83 live rounds; not corrected downwards
  300: 1.0,
  900: 1.17,
  1800: 1.3,
  3600: 1.57,
  86400: 3.3, // CoinGecko daily fallback — rough, flagged in the UI
};

export type CandleSource = "db" | "live" | "fallback";

export interface CandleSet {
  resolutionSec: number;
  source: CandleSource;
  candles: Candle[];
}

interface CandleResponse {
  /** Echoed back by the route; the client already knows which coin it asked for. */
  coin?: CoinId;
  symbol?: string;
  resolutionSec: number;
  source: "db" | "live";
  candles: number[][];
}

export function expandCandles(rows: number[][]): Candle[] {
  return rows.map(([time, open, high, low, close]) => ({ time, open, high, low, close }));
}

export async function fetchCandles(coinId: CoinId, days: number): Promise<CandleSet> {
  const res = await fetch(`/api/candles?coin=${coinId}&days=${days}`);
  if (!res.ok) throw new Error(`candles ${res.status}`);
  const json = (await res.json()) as CandleResponse;
  return {
    resolutionSec: json.resolutionSec,
    source: json.source,
    candles: expandCandles(json.candles),
  };
}

/** Daily CoinGecko points → flat candles (o = h = l = c). Fallback only. */
export function candlesFromPricePoints(points: PricePoint[]): Candle[] {
  return points.map((p) => {
    const t = new Date(p.date).getTime();
    return { time: t, open: p.price, high: p.price, low: p.price, close: p.price };
  });
}

/** Keep at most `n` candles for drawing (evenly spaced, always first and last). */
export function downsample(candles: Candle[], n: number): Candle[] {
  if (candles.length <= n) return candles;
  if (n <= 0) return [];
  if (n === 1) return [candles[candles.length - 1]];
  const step = (candles.length - 1) / (n - 1);
  const out: Candle[] = [];
  for (let i = 0; i < n - 1; i++) out.push(candles[Math.round(i * step)]);
  out.push(candles[candles.length - 1]);
  return out;
}
