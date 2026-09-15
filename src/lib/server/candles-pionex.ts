import type { Coin } from "@/lib/coins";

const BASE = "https://api.pionex.com/api/v1/market/klines";
const PAGE = 500;
const INTERVAL: Record<number, string> = {
  60: "1M",
  300: "5M",
  900: "15M",
  1800: "30M",
  3600: "60M",
  14400: "4H",
  86400: "1D",
};
/** Pionex serves at most 10,000 candles per interval → 20 pages of 500. */
const MAX_PAGES = 20;
const PAUSE_MS = 120;
const DAY_MS = 86_400_000;

interface Kline { time: number; open: string; high: string; low: string; close: string; volume: string }
interface KlineResponse { result: boolean; code?: string; message?: string; data?: { klines: Kline[] } }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Rows [timeMs, open, high, low, close, volume] for `symbol`, ascending, no candle older than `floorMs`.
 * Volume is kept because `mon_candles.volume` is NOT NULL; the API only ever serves the first five.
 * Pages backwards from the newest candle until the floor is reached, a short/empty page, or `maxPages`.
 */
export async function fetchPionexKlines(
  symbol: string,
  resolutionSec: number,
  floorMs: number,
  maxPages = MAX_PAGES,
): Promise<number[][]> {
  const interval = INTERVAL[resolutionSec];
  if (!interval) throw new Error(`unsupported resolution ${resolutionSec}`);
  const out = new Map<number, number[]>();
  let endTime: number | null = null; // null = newest page; Pionex rejects endTime ≥ now

  for (let page = 0; page < maxPages; page++) {
    const url = `${BASE}?symbol=${symbol}&interval=${interval}&limit=${PAGE}${endTime === null ? "" : `&endTime=${endTime}`}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`Pionex ${res.status} for ${symbol}`);
    const json = (await res.json()) as KlineResponse;
    if (!json.result) throw new Error(`Pionex ${json.code ?? ""}: ${json.message ?? ""}`);
    const klines = json.data?.klines ?? [];
    if (klines.length === 0) break;
    let oldest = Infinity;
    for (const k of klines) {
      const row = [k.time, Number(k.open), Number(k.high), Number(k.low), Number(k.close)];
      if (!row.every(Number.isFinite)) continue;
      const volume = Number(k.volume);
      row.push(Number.isFinite(volume) ? volume : 0);
      if (k.time >= floorMs) out.set(k.time, row);
      if (k.time < oldest) oldest = k.time;
    }
    if (oldest <= floorMs || klines.length < PAGE) break;
    endTime = oldest - 1;
    await sleep(PAUSE_MS);
  }
  return [...out.values()].sort((a, b) => a[0] - b[0]);
}

/** Live fallback: compact rows [timeMs, open, high, low, close] for the last `days` days, never before launch. */
export async function fetchCandlesLive(coin: Coin, resolutionSec: number, days: number): Promise<number[][]> {
  const floorMs = Math.max(coin.launchMs, Date.now() - days * DAY_MS);
  const rows = await fetchPionexKlines(coin.pionexSymbol, resolutionSec, floorMs);
  if (rows.length === 0) throw new Error("Pionex returned no candles");
  return rows.map((r) => r.slice(0, 5));
}
