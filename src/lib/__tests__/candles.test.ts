import { describe, expect, it } from "vitest";
import {
  GRID_WINDOW_DAYS,
  RESOLUTION_FACTOR,
  candlesFromPricePoints,
  downsample,
  expandCandles,
  fetchCandles,
  resolutionForDays,
} from "@/lib/candles";

describe("candles helpers", () => {
  it("maps windows to days", () => {
    expect(GRID_WINDOW_DAYS).toEqual({ "1m": 30, "3m": 90, "6m": 180, max: 400 });
  });

  it("picks the finest resolution Pionex history covers", () => {
    expect(resolutionForDays(30)).toBe(300);
    expect(resolutionForDays(90)).toBe(900);
    expect(resolutionForDays(180)).toBe(1800);
    expect(resolutionForDays(400)).toBe(3600);
  });

  it("has a factor for every resolution the route can return", () => {
    for (const days of [30, 90, 180, 400]) {
      expect(RESOLUTION_FACTOR[resolutionForDays(days)]).toBeGreaterThanOrEqual(1);
    }
  });

  it("expands compact rows", () => {
    expect(expandCandles([[1, 2, 3, 0.5, 2.5]])).toEqual([
      { time: 1, open: 2, high: 3, low: 0.5, close: 2.5 },
    ]);
  });

  it("builds flat candles from daily price points", () => {
    const c = candlesFromPricePoints([
      { date: "2026-01-01", displayDate: "Jan 1", price: 0.02, unlock: null },
    ]);
    expect(c).toEqual([
      { time: Date.UTC(2026, 0, 1), open: 0.02, high: 0.02, low: 0.02, close: 0.02 },
    ]);
  });

  it("downsamples to at most n points keeping first and last", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ time: i, open: i, high: i, low: i, close: i }));
    const out = downsample(rows, 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out[0].time).toBe(0);
    expect(out[out.length - 1].time).toBe(999);
    expect(downsample(rows.slice(0, 10), 100)).toHaveLength(10);
    expect(downsample(rows, 0)).toEqual([]);
    expect(downsample(rows, 1)).toEqual([rows[999]]);
  });

  it("fetchCandles hits /api/candles?days=N, rejects on a non-OK response and expands rows on success", async () => {
    const g = globalThis as { fetch?: typeof fetch };
    const original = g.fetch;
    const calls: string[] = [];
    try {
      g.fetch = (async (url: string) => {
        calls.push(url);
        return { ok: false, status: 502 };
      }) as unknown as typeof fetch;
      await expect(fetchCandles(30)).rejects.toThrow("candles 502");
      expect(calls[0]).toBe("/api/candles?days=30");
      g.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ resolutionSec: 300, source: "db", candles: [[1, 2, 3, 0.5, 2.5]] }) })) as unknown as typeof fetch;
      await expect(fetchCandles(30)).resolves.toEqual({ resolutionSec: 300, source: "db", candles: [{ time: 1, open: 2, high: 3, low: 0.5, close: 2.5 }] });
    } finally {
      g.fetch = original;
    }
  });

  it("downsamples to at most n points keeping first and last", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ time: i, open: i, high: i, low: i, close: i }));
    const out = downsample(rows, 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out[0].time).toBe(0);
    expect(out[out.length - 1].time).toBe(999);
    expect(downsample(rows.slice(0, 10), 100)).toHaveLength(10);
    expect(downsample(rows, 0)).toEqual([]);
    expect(downsample(rows, 1)).toEqual([rows[999]]);
  });

  it("fetchCandles rejects on a non-OK response and expands rows on success", async () => {
    const g = globalThis as { fetch?: typeof fetch };
    const original = g.fetch;
    g.fetch = (async () => ({ ok: false, status: 502 })) as unknown as typeof fetch;
    await expect(fetchCandles(30)).rejects.toThrow("candles 502");
    g.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ resolutionSec: 300, source: "db", candles: [[1, 2, 3, 0.5, 2.5]] }) })) as unknown as typeof fetch;
    await expect(fetchCandles(30)).resolves.toEqual({ resolutionSec: 300, source: "db", candles: [{ time: 1, open: 2, high: 3, low: 0.5, close: 2.5 }] });
    g.fetch = original;
  });
});
