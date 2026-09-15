import type { PricePoint } from "./types";
import { UNLOCK_EVENTS } from "./constants";

const COINGECKO_BASE =
  "https://api.coingecko.com/api/v3/coins/monad/market_chart?vs_currency=usd";

export type Timeframe = "5m" | "1h" | "4h" | "1d";

const TIMEFRAME_CONFIG: Record<
  Timeframe,
  { days: number; aggregateHours?: number; intraday: boolean }
> = {
  "5m": { days: 1, intraday: true },
  "1h": { days: 7, intraday: true },
  "4h": { days: 30, aggregateHours: 4, intraday: true },
  "1d": { days: 90, intraday: false },
};

function findUnlockNear(dt: Date) {
  return (
    UNLOCK_EVENTS.find(
      (e) => Math.abs(new Date(e.date).getTime() - dt.getTime()) / 86_400_000 < 1.5,
    ) ?? null
  );
}

function toPricePoint(ts: number, price: number, intraday = false): PricePoint {
  const dt = new Date(ts);
  return {
    date: intraday ? dt.toISOString() : dt.toISOString().split("T")[0],
    displayDate: intraday
      ? dt.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
        })
      : dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    price: parseFloat(price.toFixed(6)),
    unlock: intraday ? null : findUnlockNear(dt),
  };
}

function aggregateToHours(
  points: [number, number][],
  hours: number,
): [number, number][] {
  if (points.length === 0) return [];
  const ms = hours * 60 * 60 * 1000;
  const buckets = new Map<number, number>();
  for (const [ts, price] of points) {
    const bucket = Math.floor(ts / ms) * ms;
    buckets.set(bucket, price);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]);
}

export async function fetchPriceDataForTimeframe(
  tf: Timeframe,
): Promise<PricePoint[]> {
  const cfg = TIMEFRAME_CONFIG[tf];
  const url =
    tf === "1d"
      ? `${COINGECKO_BASE}&days=${cfg.days}&interval=daily`
      : `${COINGECKO_BASE}&days=${cfg.days}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const json = (await res.json()) as { prices: [number, number][] };
  const raw = cfg.aggregateHours
    ? aggregateToHours(json.prices, cfg.aggregateHours)
    : json.prices;
  return raw.map(([ts, price]) => toPricePoint(ts, price, cfg.intraday));
}

export async function fetchPriceData(): Promise<PricePoint[]> {
  return fetchPriceDataForTimeframe("1d");
}

export function generateMockData(): PricePoint[] {
  const mock = [
    0.025, 0.11, 0.09, 0.08, 0.085, 0.079, 0.072, 0.068, 0.065, 0.062, 0.059,
    0.055, 0.052, 0.05, 0.048, 0.045, 0.043, 0.041, 0.039, 0.038, 0.037, 0.036,
    0.035, 0.035, 0.034, 0.033, 0.032, 0.031, 0.03, 0.031, 0.032, 0.033, 0.034,
    0.033, 0.032, 0.031, 0.03, 0.029, 0.028, 0.027, 0.028, 0.029, 0.03, 0.031,
    0.031, 0.03, 0.03, 0.029, 0.028, 0.028, 0.027, 0.026, 0.025, 0.026, 0.027,
    0.028, 0.029, 0.03, 0.031, 0.03, 0.029, 0.028, 0.027, 0.026, 0.025, 0.024,
    0.025, 0.024, 0.024, 0.025, 0.026, 0.027, 0.028, 0.029, 0.03, 0.031, 0.032,
    0.033, 0.034, 0.033, 0.032, 0.031, 0.03, 0.031, 0.031, 0.03, 0.03, 0.031,
    0.032, 0.033,
  ];
  const start = new Date("2025-11-24");
  return mock.map((price, i) => {
    const dt = new Date(start);
    dt.setDate(start.getDate() + i);
    return toPricePoint(dt.getTime(), price);
  });
}

export function computePriceMeta(data: PricePoint[]): {
  currentPrice: number | null;
  priceChange: number | null;
} {
  if (data.length < 8) {
    return {
      currentPrice: data[data.length - 1]?.price ?? null,
      priceChange: null,
    };
  }
  const last = data[data.length - 1].price;
  const weekAgo = data[data.length - 8].price;
  return {
    currentPrice: last,
    priceChange: ((last - weekAgo) / weekAgo) * 100,
  };
}
