import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/candles";
import { GRID_COUNTS, LOSS_CAPS, MIN_ORDER_USDT, STOP_MARGINS, optimizeGrid, pickStop, stopPriceForLoss, stopSweep, worstCaseLossPct } from "@/lib/grid";

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
    const out = optimizeGrid({ candles, candleMs: H, goalUsd: 300, maxInvestment: null, currentPrice, mode: "arithmetic", factor: 1, rankBy: "average", minTradesPerDay: 0, maxLossPct: 1 });
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
    const raw = optimizeGrid({ candles, candleMs: H, goalUsd: 300, maxInvestment: null, currentPrice, mode: "arithmetic", factor: 1, rankBy: "average", minTradesPerDay: 0, maxLossPct: 1 });
    const corrected = optimizeGrid({ candles, candleMs: H, goalUsd: 300, maxInvestment: null, currentPrice, mode: "arithmetic", factor: 1.57, rankBy: "average", minTradesPerDay: 0, maxLossPct: 1 });
    expect(corrected.best!.lower).toBe(raw.best!.lower);
    expect(corrected.best!.grids).toBe(raw.best!.grids);
    expect(corrected.requiredInvestment!).toBeLessThan(raw.requiredInvestment!);
    expect(corrected.best!.liveMonthlyYield).toBeCloseTo(raw.best!.result.monthlyYield * 1.57, 12);
  });

  it("flags over-budget and reports the achievable profit", () => {
    const candles = ranging();
    const currentPrice = candles[candles.length - 1].close;
    const out = optimizeGrid({ candles, candleMs: H, goalUsd: 300, maxInvestment: 100, currentPrice, mode: "arithmetic", factor: 1, rankBy: "average", minTradesPerDay: 0, maxLossPct: 1 });
    expect(out.overBudget).toBe(true);
    expect(out.achievableMonthly).toBeCloseTo(100 * out.best!.liveMonthlyYield, 9);
    expect(out.warnings.some((w) => w.toLowerCase().includes("budget"))).toBe(true);
  });

  it("returns no candidate in a strongly trending market, with a warning", () => {
    const candles = trending();
    const currentPrice = candles[candles.length - 1].close;
    const out = optimizeGrid({ candles, candleMs: H, goalUsd: 300, maxInvestment: null, currentPrice, mode: "arithmetic", factor: 1, rankBy: "average", minTradesPerDay: 0, maxLossPct: 1 });
    expect(out.best).toBeNull();
    expect(out.requiredInvestment).toBeNull();
    expect(out.warnings.some((w) => w.includes("trending"))).toBe(true);
  });

  it("warns when the investment is too small for the grid count", () => {
    const candles = ranging();
    const currentPrice = candles[candles.length - 1].close;
    const out = optimizeGrid({ candles, candleMs: H, goalUsd: 1, maxInvestment: null, currentPrice, mode: "arithmetic", factor: 1, rankBy: "average", minTradesPerDay: 0, maxLossPct: 1 });
    expect(out.best).not.toBeNull();
    expect(out.requiredInvestment! / out.best!.grids).toBeLessThan(MIN_ORDER_USDT);
    expect(out.warnings.some((w) => w.includes("too small"))).toBe(true);
  });

  it("ranks on the worst 30-day slice and drops low-activity grids when asked", () => {
    const candles = ranging();
    const currentPrice = candles[candles.length - 1].close;
    const worst = optimizeGrid({ candles, candleMs: H, goalUsd: 300, maxInvestment: null, currentPrice, mode: "arithmetic", factor: 1, rankBy: "worst", minTradesPerDay: 0, maxLossPct: 1 });
    expect(worst.best).not.toBeNull();
    expect(worst.best!.rankYield).toBe(worst.best!.result.worstSliceYield);
    expect(worst.best!.rankYield).toBeLessThanOrEqual(worst.best!.result.monthlyYield + 1e-12);
    for (const a of worst.alternatives) expect(a.result.worstSliceYield).toBeLessThanOrEqual(worst.best!.result.worstSliceYield);
    const busy = optimizeGrid({ candles, candleMs: H, goalUsd: 300, maxInvestment: null, currentPrice, mode: "arithmetic", factor: 1, rankBy: "worst", minTradesPerDay: 3, maxLossPct: 1 });
    for (const c of [busy.best!, ...busy.alternatives]) expect(c.result.tradesPerMonth / 30).toBeGreaterThanOrEqual(3);
    expect(busy.kept).toBeLessThanOrEqual(worst.kept);
  });

  it("sweeps stop-loss margins and recommends the one that kept the most P&L", () => {
    const candles = ranging();
    const currentPrice = candles[candles.length - 1].close;
    const out = optimizeGrid({ candles, candleMs: H, goalUsd: 300, maxInvestment: null, currentPrice, mode: "arithmetic", factor: 1, rankBy: "average", minTradesPerDay: 0, maxLossPct: 1 });
    const b = out.best!;
    expect(b.stopSweep.length).toBeGreaterThanOrEqual(STOP_MARGINS.length + 1);
    expect(b.stopSweep.length).toBeLessThanOrEqual(STOP_MARGINS.length + LOSS_CAPS.length + 1);
    expect(b.stopSweep.some((r) => r.margin === null)).toBe(true);
    expect(b.stopLoss).toBeCloseTo(b.lower * (1 - b.stopMargin), 9);
    expect(b.stopLossPct).toBeCloseTo(worstCaseLossPct(b.lower, b.upper, b.grids, b.mode, b.stopLoss, currentPrice), 12);
    expect(b.stopLossFromTopPct).toBeGreaterThanOrEqual(b.stopLossPct - 1e-12);
    for (const r of b.stopSweep) if (r.stopPrice !== null) expect(r.stopPrice).toBeLessThan(currentPrice);
    expect(b.stopLossPct).toBeGreaterThan(0);
    expect(b.stopLossPct).toBeLessThan(0.5);
    const pick = pickStop(b.stopSweep, 1);
    expect(b.stopExits).toBe(pick.exits);
    expect(b.stopPnlDeltaPct).toBeCloseTo(pick.pnlPct - b.stopSweep[0].pnlPct, 12);
    for (const a of out.alternatives) expect(a.stopSweep.length).toBeGreaterThan(0);
    // a stop the price never reaches changes nothing
    const far = stopSweep(candles, { lower: b.lower, upper: b.upper, grids: b.grids, mode: b.mode }, H, currentPrice, [0.9], []);
    const none = far.find((r) => r.margin === null)!;
    const farStop = far.find((r) => r.margin !== null)!;
    expect(farStop.exits).toBe(0);
    expect(farStop.pnlPct).toBeCloseTo(none.pnlPct, 12);
  });

  it("max-loss cap picks a stop inside the range whose worst case respects the cap", () => {
    const candles = ranging();
    const currentPrice = candles[candles.length - 1].close;
    const out = optimizeGrid({ candles, candleMs: H, goalUsd: 300, maxInvestment: null, currentPrice, mode: "arithmetic", factor: 1, rankBy: "average", minTradesPerDay: 0, maxLossPct: 0.05 });
    const b = out.best!;
    expect(b.stopLossPct).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(b.stopLoss).toBeLessThan(currentPrice); // never at or above the current price
    // stopPriceForLoss inverts worstCaseLossPct, from the entry price
    const p10 = stopPriceForLoss(b.lower, b.upper, b.grids, b.mode, 0.1, currentPrice);
    expect(p10).toBeLessThan(currentPrice);
    expect(worstCaseLossPct(b.lower, b.upper, b.grids, b.mode, p10, currentPrice)).toBeCloseTo(0.1, 6);
    // worst case is monotone: lower stop → bigger loss; and a fall from the top is never smaller than from the entry
    expect(worstCaseLossPct(b.lower, b.upper, b.grids, b.mode, p10 * 0.9, currentPrice)).toBeGreaterThan(0.1);
    expect(worstCaseLossPct(b.lower, b.upper, b.grids, b.mode, p10)).toBeGreaterThanOrEqual(0.1 - 1e-9);
    // at the entry price itself nothing is lost
    expect(worstCaseLossPct(b.lower, b.upper, b.grids, b.mode, currentPrice, currentPrice)).toBe(0);
  });

  it("investment mode: no goal → no sizing, candidates still ranked", () => {
    const candles = ranging();
    const currentPrice = candles[candles.length - 1].close;
    const out = optimizeGrid({ candles, candleMs: H, goalUsd: null, maxInvestment: 2000, currentPrice, mode: "arithmetic", factor: 1, rankBy: "worst", minTradesPerDay: 0, maxLossPct: 1 });
    expect(out.best).not.toBeNull();
    expect(out.requiredInvestment).toBeNull();
    expect(out.overBudget).toBe(false);
    expect(out.best!.requiredInvestment).toBe(0);
    expect(out.warnings.some((w) => w.includes("goal"))).toBe(false);
  });

  it("rangeCandles: ranges come from the long series, performance from the short one", () => {
    const long = ranging();
    const short = long.slice(-48); // last two days
    const currentPrice = short[short.length - 1].close;
    const out = optimizeGrid({ candles: short, rangeCandles: long, candleMs: H, goalUsd: 300, maxInvestment: null, currentPrice, mode: "arithmetic", factor: 1, rankBy: "average", minTradesPerDay: 0, maxLossPct: 1 });
    expect(out.best).not.toBeNull();
    const shortLow = Math.min(...short.map((c) => c.low));
    const shortHigh = Math.max(...short.map((c) => c.high));
    // a range fitted to the short window could not be wider than it; one from the long window is
    expect(out.best!.upper - out.best!.lower).toBeGreaterThan(shortHigh - shortLow);
    expect(out.best!.result.days).toBeCloseTo(2, 6);
  });

  it("handles empty candles", () => {
    const out = optimizeGrid({ candles: [], candleMs: H, goalUsd: 300, maxInvestment: null, currentPrice: 0.025, mode: "arithmetic", factor: 1, rankBy: "average", minTradesPerDay: 0, maxLossPct: 1 });
    expect(out.best).toBeNull();
    expect(out.tested).toBe(0);
  });
});
