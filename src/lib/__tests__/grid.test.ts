import { describe, expect, it } from "vitest";
import { expandCandles, type Candle } from "@/lib/candles";
import { GRID_FEE_RATE, gridLevels, simulateGrid } from "@/lib/grid";
import live5m from "./fixtures/live-bot-5m.json";
import live1h from "./fixtures/live-bot-1h.json";

const DAY = 86_400_000;

function flat(price: number, n: number, ms = DAY): Candle[] {
  return Array.from({ length: n }, (_, i) => ({ time: i * ms, open: price, high: price, low: price, close: price }));
}

describe("gridLevels", () => {
  it("arithmetic: grids+1 levels, equal steps, exact endpoints", () => {
    const L = gridLevels(0.01, 0.02, 10, "arithmetic");
    expect(L).toHaveLength(11);
    expect(L[0]).toBe(0.01);
    expect(L[10]).toBe(0.02);
    for (let i = 1; i < 11; i++) expect(L[i] - L[i - 1]).toBeCloseTo(0.001, 12);
  });

  it("geometric: constant ratio", () => {
    const L = gridLevels(0.01, 0.02, 10, "geometric");
    const r = L[1] / L[0];
    for (let i = 1; i < 11; i++) expect(L[i] / L[i - 1]).toBeCloseTo(r, 12);
    expect(L[10]).toBe(0.02);
  });
});

describe("simulateGrid", () => {
  const params = { lower: 0.01, upper: 0.02, grids: 10, investment: 1000, mode: "arithmetic" as const };
  const L = gridLevels(0.01, 0.02, 10, "arithmetic");

  it("sawtooth between L[3] and L[4]: one pair per candle, exact accounting (spec worked check)", () => {
    const mid = (L[3] + L[4]) / 2;
    const n = 20;
    const candles: Candle[] = Array.from({ length: n }, (_, i) => ({ time: i * DAY, open: mid, high: L[4], low: L[3], close: mid }));
    const r = simulateGrid(candles, params, DAY);
    const q = params.investment / 10;
    const coins3 = q / L[3];
    const fee = GRID_FEE_RATE;
    expect(r.trades).toBe(n);
    expect(r.buys).toBe(n - 1); // day 1 sells the seed; every later pair starts with a grid buy
    expect(r.gridProfit).toBeCloseTo(n * (coins3 * (L[4] - L[3]) - fee * coins3 * (L[3] + L[4])), 9);
    // hand-derived end state (spec section 7): interval 3 ends holding a buy.
    const coinsEnd = [4, 5, 6, 7, 8, 9].reduce((s, k) => s + q / L[k], 0);
    const seedCost = (1 + fee) * mid * [3, 4, 5, 6, 7, 8, 9].reduce((s, k) => s + q / L[k], 0);
    const cashEnd = params.investment - seedCost + n * coins3 * L[4] * (1 - fee) - (n - 1) * q * (1 + fee);
    expect(r.coinsEnd).toBeCloseTo(coinsEnd, 9);
    expect(r.cashEnd).toBeCloseTo(cashEnd, 6);
    expect(r.gridProfit + r.unrealizedPnl).toBeCloseTo(r.cashEnd + r.coinsEnd * mid - params.investment, 9);
    expect(r.days).toBeCloseTo(n, 9);
    expect(r.timeInRangePct).toBe(100);
    // one pair every day → every day active; 20 days = one slice ≥ 20 days → worst slice = whole window
    expect(r.activeDays).toBe(n);
    expect(r.idleDays).toBe(0);
    expect(r.sliceProfits).toHaveLength(1);
    expect(r.worstSliceYield).toBeCloseTo(r.gridProfit / params.investment, 12);
  });

  it("splits profit into 30-day slices and reports the worst one", () => {
    const mid = (L[3] + L[4]) / 2;
    // 60 days: days 0-29 oscillate (1 pair/day), days 30-59 flat (0 pairs)
    const candles: Candle[] = Array.from({ length: 60 }, (_, i) =>
      i < 30 ? { time: i * DAY, open: mid, high: L[4], low: L[3], close: mid } : { time: i * DAY, open: mid, high: mid, low: mid, close: mid },
    );
    const r = simulateGrid(candles, params, DAY);
    expect(r.sliceProfits).toHaveLength(2);
    expect(r.sliceProfits[0]).toBeCloseTo(r.gridProfit, 9);
    expect(r.sliceProfits[1]).toBe(0);
    expect(r.worstSliceYield).toBe(0);
    expect(r.activeDays).toBe(30);
    expect(r.idleDays).toBe(30);
  });

  it("candles entirely above the range: no trades, zero time in range", () => {
    const r = simulateGrid(flat(0.05, 10), params, DAY);
    expect(r.trades).toBe(0);
    expect(r.gridProfit).toBe(0);
    expect(r.timeInRangePct).toBe(0);
    expect(r.breakouts).toBe(10);
  });

  it("flat candles inside the range with zero fee: nothing happens", () => {
    const r = simulateGrid(flat(0.015, 10), params, DAY, 0);
    expect(r.trades).toBe(0);
    expect(r.maxDrawdownPct).toBe(0);
    expect(r.unrealizedPnl).toBeCloseTo(0, 9);
  });

  it("fees reduce profit", () => {
    const mid = (L[3] + L[4]) / 2;
    const candles: Candle[] = Array.from({ length: 5 }, (_, i) => ({ time: i * DAY, open: mid, high: L[4], low: L[3], close: mid }));
    const gross = simulateGrid(candles, params, DAY, 0).gridProfit;
    const net = simulateGrid(candles, params, DAY).gridProfit;
    expect(net).toBeLessThan(gross);
    expect(gross).toBeCloseTo(5 * (params.investment / 10 / L[3]) * (L[4] - L[3]), 9);
  });

  it("seeding at a level: interval below holds a buy (unrealized 0 at zero fee)", () => {
    const k = 5;
    const candles: Candle[] = [{ time: 0, open: L[k], high: L[k], low: L[k - 1], close: L[k] }];
    const r = simulateGrid(candles, params, DAY, 0);
    expect(r.trades).toBe(1);
    expect(r.unrealizedPnl).toBeCloseTo(0, 9);
  });

  it("empty input returns zeros", () => {
    const r = simulateGrid([], params, DAY);
    expect(r.trades).toBe(0);
    expect(r.days).toBe(0);
    expect(r.monthlyYield).toBe(0);
  });

  it("reproduces the live Pionex bot on 5-minute candles (calibration, exact)", () => {
    const r = simulateGrid(expandCandles(live5m as number[][]), { lower: 0.023, upper: 0.03, grids: 80, investment: 23719.89, mode: "arithmetic" }, 300_000);
    expect(live5m).toHaveLength(283);
    expect(r.trades).toBe(85); // Pionex reported 83 rounds
    expect(r.gridProfit).toBeCloseTo(67.8263, 3); // Pionex reported +78.44
    expect(r.unrealizedPnl).toBeCloseTo(-26.9422, 3);
    expect(r.breakouts).toBe(30);
    expect(r.maxDrawdownPct).toBeCloseTo(5.552, 2);
  });

  it("reproduces the reference run on 1-hour candles", () => {
    const r = simulateGrid(expandCandles(live1h as number[][]), { lower: 0.023, upper: 0.03, grids: 80, investment: 23719.89, mode: "arithmetic" }, 3_600_000);
    expect(r.trades).toBe(53);
    expect(r.gridProfit).toBeCloseTo(42.4594, 3);
  });
});
