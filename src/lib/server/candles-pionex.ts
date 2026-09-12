const BASE = "https://api.pionex.com/api/v1/market/klines?symbol=MON_USDT_PERP&limit=500";
const INTERVAL: Record<number, string> = { 300: "5M", 900: "15M", 1800: "30M", 3600: "60M" };
const MAX_PAGES = 20; // Pionex serves at most 10,000 candles per interval
const PAUSE_MS = 120;

interface Kline { time: number; open: string; high: string; low: string; close: string }
interface KlineResponse { result: boolean; code?: string; message?: string; data?: { klines: Kline[] } }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Compact rows [timeMs, open, high, low, close], ascending, covering the last `days` days. */
export async function fetchCandlesLive(resolutionSec: number, days: number): Promise<number[][]> {
  const interval = INTERVAL[resolutionSec];
  if (!interval) throw new Error(`unsupported resolution ${resolutionSec}`);
  const floor = Date.now() - days * 86_400_000;
  const out = new Map<number, number[]>();
  let endTime: number | null = null; // null = newest page; Pionex rejects endTime ≥ now

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${BASE}&interval=${interval}${endTime === null ? "" : `&endTime=${endTime}`}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`Pionex ${res.status}`);
    const json = (await res.json()) as KlineResponse;
    if (!json.result) throw new Error(`Pionex ${json.code ?? ""}: ${json.message ?? ""}`);
    const klines = json.data?.klines ?? [];
    if (klines.length === 0) break;
    let oldest = Infinity;
    for (const k of klines) {
      const row = [k.time, Number(k.open), Number(k.high), Number(k.low), Number(k.close)];
      if (!row.every(Number.isFinite)) continue;
      if (k.time >= floor) out.set(k.time, row);
      if (k.time < oldest) oldest = k.time;
    }
    if (oldest <= floor || klines.length < 500) break;
    endTime = oldest - 1;
    await sleep(PAUSE_MS);
  }
  if (out.size === 0) throw new Error("Pionex returned no candles");
  return [...out.values()].sort((a, b) => a[0] - b[0]);
}
