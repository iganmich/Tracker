import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/candles";
import { GRID_COUNTS, MIN_ORDER_USDT, optimizeGrid } from "@/lib/grid";

const H = 3_600_000;

/** Ranging market: sine wave around 0.025 with ±8 % amplitude plus small noise, hourly, 60 days. */
function ranging(days = 60): Candle[] {
  const out: Candle[] = [];
  let seed = 3;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280), seed / 233280);
  for (let i = 0; i < days * 24; i++) {
    const base = 0.025 * (1 + 0.08 * Math.sin(i / 30));
    const o = base * (1 + (rnd() - 0.5) * 0.004);
    const c = base * (1 + (rnd() - 0.5) * 0.004);
    const h = Math.max(o, c) * (1 + rnd() * 0.003);
    const l = Math.min(o, c) * (1 - rnd() * 0.003);
    out.push({ time: i * H, open: o, high: h, low: l, close: c });
  }
  return out;
}

/** Strong uptrend: +150 % over the window. */
function trending(days = 60): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < days * 24; i++) {
    const p = 0.02 * (1 + (1.5 * i) / (days * 24));
    out.push({ time: i * H, open: p, high: p * 1.002, low: p * 0.998, close: p * 1.001 });
  }
  return out;
}

describe("optimizeGrid", () => {
  it("finds a candidate in a ranging market and sizes the investment to the goal", () => {
    const candles = ranging();
    const currentPrice = candles[candles.length - 1].close;
    const out = optimizeGrid({ candles, candleMs: H, goalUsd: 300, maxInvestment: null, currentPrice, mode: "arithmetic", factor: 1, rankBy: "average", minTradesPerDay: 0 });
    expect(out.best).not.toBeNull();
    const b = out.best!;
    expect(b.lower).toBeLessThan(currentPrice);
    expect(b.upper).toBeGreaterThan(currentPrice);
    expect(b.result.timeInRangePct).toBeGreaterThanOrEqual(90);
    expect(b.result.monthlyYield).toBeGreaterThan(0);
    expect(out.requiredInvestment).not.toBeNull();
    expect(out.requiredInvestment! * b.result.monthlyYield).toBeGreaterThanOrEqual(300);
    expect(out.requiredInvestment! * b.result.monthlyYield).toBeLessThan(300 * 1.01 + 1);
    expect(out.overBudget).toBe(false);
    expect(out.alternatives.length).toBeGreaterThan(0);
    expect(out.alternatives.length).toBeLessThanOrEqual(GRID_COUNTS.length - 1);
    // ranked by raw yield, best first; one row per grid count so the board compares spacing choices
    for (const a of out.alternatives) expect(a.rankYield).toBeLessThanOrEqual(b.rankYield);
    const gridCounts = [b, ...out.alternatives].map((c) => c.grids);
    expect(new Set(gridCounts).size).toBe(gridCounts.length);
    expect(out.tested).toBeGreaterThan(out.kept);
    expect(out.kept).toBeGreaterThanOrEqual(1 + out.alternatives.length);
  });

  it("applies the resolution factor to sizing but not to ranking", () => {
    const candles = ranging();
    const currentPrice = candles[candles.length - 1].close;
    const raw = optimizeGrid({ candles, candleMs: H, goalUsd: 300, maxInvestment: null, currentPrice, mode: "arithmetic", factor: 1, rankBy: "average", minTradesPerDay: 0 });
    const corrected = optimizeGrid({ candles, candleMs: H, goalUsd: 300, maxInvestment: null, currentPrice, mode: "arithmetic", factor: 1.57, rankBy: "average", minTradesPerDay: 0 });
    expect(corrected.best!.lower).toBe(raw.best!.lower);
    expect(corrected.best!.grids).toBe(raw.best!.grids);
    expect(corrected.requiredInvestment!).toBeLessThan(raw.requiredInvestment!);
    expect(corrected.best!.liveMonthlyYield).toBeCloseTo(raw.best!.result.monthlyYield * 1.57, 12);
  });

  it("flags over-budget and reports the achievable profit", () => {
    const candles = ranging();
    const currentPrice = candles[candles.length - 1].close;
    const out = optimizeGrid({ candles, candleMs: H, goalUsd: 300, maxInvestment: 100, currentPrice, mode: "arithmetic", factor: 1, rankBy: "average", minTradesPerDay: 0 });
    expect(out.overBudget).toBe(true);
    expect(out.achievableMonthly).toBeCloseTo(100 * out.best!.liveMonthlyYield, 9);
    expect(out.warnings.some((w) => w.toLowerCase().includes("budget"))).toBe(true);
  });

  it("returns no candidate in a strongly trending market, with a warning", () => {
    const candles = trending();
    const currentPrice = candles[candles.length - 1].close;
    const out = optimizeGrid({ candles, candleMs: H, goalUsd: 300, maxInvestment: null, currentPrice, mode: "arithmetic", factor: 1, rankBy: "average", minTradesPerDay: 0 });
    expect(out.best).toBeNull();
    expect(out.requiredInvestment).toBeNull();
    expect(out.warnings.some((w) => w.includes("trending"))).toBe(true);
  });

  it("warns when the investment is too small for the grid count", () => {
    const candles = ranging();
    const currentPrice = candles[candles.length - 1].close;
    const out = optimizeGrid({ candles, candleMs: H, goalUsd: 1, maxInvestment: null, currentPrice, mode: "arithmetic", factor: 1, rankBy: "average", minTradesPerDay: 0 });
    expect(out.best).not.toBeNull();
    expect(out.requiredInvestment! / out.best!.grids).toBeLessThan(MIN_ORDER_USDT);
    expect(out.warnings.some((w) => w.includes("too small"))).toBe(true);
  });

  it("ranks on the worst 30-day slice and drops low-activity grids when asked", () => {
    const candles = ranging();
    const currentPrice = candles[candles.length - 1].close;
    const worst = optimizeGrid({ candles, candleMs: H, goalUsd: 300, maxInvestment: null, currentPrice, mode: "arithmetic", factor: 1, rankBy: "worst", minTradesPerDay: 0 });
    expect(worst.best).not.toBeNull();
    expect(worst.best!.rankYield).toBe(worst.best!.result.worstSliceYield);
    expect(worst.best!.rankYield).toBeLessThanOrEqual(worst.best!.result.monthlyYield + 1e-12);
    for (const a of worst.alternatives) expect(a.result.worstSliceYield).toBeLessThanOrEqual(worst.best!.result.worstSliceYield);
    const busy = optimizeGrid({ candles, candleMs: H, goalUsd: 300, maxInvestment: null, currentPrice, mode: "arithmetic", factor: 1, rankBy: "worst", minTradesPerDay: 3 });
    for (const c of [busy.best!, ...busy.alternatives]) expect(c.result.tradesPerMonth / 30).toBeGreaterThanOrEqual(3);
    expect(busy.kept).toBeLessThanOrEqual(worst.kept);
  });

  it("handles empty candles", () => {
    const out = optimizeGrid({ candles: [], candleMs: H, goalUsd: 300, maxInvestment: null, currentPrice: 0.025, mode: "arithmetic", factor: 1, rankBy: "average", minTradesPerDay: 0 });
    expect(out.best).toBeNull();
    expect(out.tested).toBe(0);
  });
});
