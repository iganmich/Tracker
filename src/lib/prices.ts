import type { PricePoint } from "./types";
import { UNLOCK_EVENTS } from "./constants";

const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/coins/monad/market_chart?vs_currency=usd&days=90&interval=daily";

function findUnlockNear(dt: Date) {
  return (
    UNLOCK_EVENTS.find(
      (e) => Math.abs(new Date(e.date).getTime() - dt.getTime()) / 86_400_000 < 1.5,
    ) ?? null
  );
}

function toPricePoint(ts: number, price: number): PricePoint {
  const dt = new Date(ts);
  return {
    date: dt.toISOString().split("T")[0],
    displayDate: dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    price: parseFloat(price.toFixed(6)),
    unlock: findUnlockNear(dt),
  };
}

export async function fetchPriceData(): Promise<PricePoint[]> {
  const res = await fetch(COINGECKO_URL);
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const json = (await res.json()) as { prices: [number, number][] };
  return json.prices.map(([ts, price]) => toPricePoint(ts, price));
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
