import type { Candle, GridWindow } from "./candles";

export type GridMode = "arithmetic" | "geometric";

export interface GridParams {
  lower: number;
  upper: number;
  grids: number;
  investment: number;
  mode: GridMode;
}

export interface GridResult {
  gridProfit: number; // USD, realized, net of nominal fees
  monthlyYield: number; // gridProfit / investment / days * 30
  monthlyProfit: number; // monthlyYield * investment
  trades: number; // completed pairs (every sell fill)
  buys: number; // grid buy fills (seed buys at start are not counted)
  tradesPerMonth: number;
  timeInRangePct: number; // 0..100, candles whose close is inside [lower, upper]
  maxDrawdownPct: number; // 0..100, worst peak-to-trough of equity over closes
  unrealizedPnl: number; // equityEnd − investment − gridProfit
  breakouts: number; // candles whose close is outside the range
  days: number; // (last − first + candleMs) / day
  levels: number[]; // grids + 1 ascending
  cashEnd: number;
  coinsEnd: number;
  exits: StopExit[]; // stop-loss exits (empty without a stop)
  daysOut: number; // days spent halted after a stop, waiting to re-enter
  totalPnl: number; // equityEnd − investment (grid profit + unrealized − exit losses)
  sliceProfits: number[]; // net grid profit per consecutive 30-day slice (continuous bot, not re-seeded)
  worstSliceYield: number; // min over slices ≥ 20 days of sliceProfit / investment (a per-30-day yield); = monthlyYield if no full slice
  activeDays: number; // distinct calendar days with ≥ 1 completed pair
  idleDays: number; // days (rounded) − activeDays
}

/** Optional stop loss: sell everything at `price` when a candle's low touches it; re-enter when a close is back inside the range. */
export interface StopConfig {
  price: number;
  reenter: boolean;
}

export interface StopExit {
  time: number;
  price: number;
  equityBefore: number; // cash + coins × stop, before the exit fee
  equityAfter: number; // cash after selling everything
  lossFromEntry: number; // equity at the last (re)entry − equityAfter
}

export const GRID_FEE_RATE = 0.0005; // Pionex spot, per side
/** After a stop, wait until a close is this far above the stop before restarting the grid. */
export const REENTRY_MARGIN = 0.01;
export const MIN_ORDER_USDT = 5;

const DAY_MS = 86_400_000;

export function gridLevels(lower: number, upper: number, grids: number, mode: GridMode): number[] {
  const levels = new Array<number>(grids + 1);
  if (mode === "arithmetic") {
    const step = (upper - lower) / grids;
    for (let i = 0; i <= grids; i++) levels[i] = lower + step * i;
  } else {
    const ratio = Math.pow(upper / lower, 1 / grids);
    for (let i = 0; i <= grids; i++) levels[i] = lower * Math.pow(ratio, i);
  }
  levels[0] = lower;
  levels[grids] = upper;
  return levels;
}

/** Tightest interval spacing as a fraction (top interval for arithmetic, constant for geometric). */
export function minSpacingPct(lower: number, upper: number, grids: number, mode: GridMode): number {
  if (mode === "geometric") return Math.pow(upper / lower, 1 / grids) - 1;
  const L = gridLevels(lower, upper, grids, mode);
  return (L[grids] - L[grids - 1]) / L[grids - 1];
}

function emptyResult(levels: number[]): GridResult {
  return {
    gridProfit: 0, monthlyYield: 0, monthlyProfit: 0, trades: 0, buys: 0, tradesPerMonth: 0,
    timeInRangePct: 0, maxDrawdownPct: 0, unrealizedPnl: 0, breakouts: 0, days: 0,
    levels, cashEnd: 0, coinsEnd: 0, exits: [], daysOut: 0, totalPnl: 0, sliceProfits: [], worstSliceYield: 0, activeDays: 0, idleDays: 0,
  };
}

/**
 * Pionex-style spot grid backtest. One order per grid interval k = [L[k], L[k+1]]:
 * either a buy at L[k] or a sell at L[k+1]. Each interval trades q = investment / grids
 * USDT worth of coins sized at its lower bound. See spec section 3 for the exact rules.
 */
export function simulateGrid(
  candles: Candle[],
  p: GridParams,
  candleMs: number,
  feeRate = GRID_FEE_RATE,
  stop?: StopConfig,
): GridResult {
  const { lower, upper, grids, investment, mode } = p;
  const L = gridLevels(lower, upper, grids, mode);
  if (candles.length === 0 || grids < 1 || !(lower < upper) || investment <= 0) return emptyResult(L);

  let q = investment / grids;
  const coinsPer = new Float64Array(grids);

  // isSell[k] = 1 → interval k holds a sell at L[k+1]; 0 → a buy at L[k]
  const isSell = new Uint8Array(grids);
  let cash = investment;
  let coins = 0;
  let gridProfit = 0;
  let trades = 0;
  let buys = 0;
  let entryEquity = investment;

  // Seed (or re-seed after a stop) with `capital` at price p0: intervals whose upper bound is above p0 start as sells.
  const seed = (p0: number, capital: number) => {
    q = capital / grids;
    entryEquity = capital;
    for (let k = 0; k < grids; k++) {
      coinsPer[k] = q / L[k];
      isSell[k] = 0;
      if (L[k + 1] > p0) {
        isSell[k] = 1;
        cash -= coinsPer[k] * p0 * (1 + feeRate);
        coins += coinsPer[k];
      }
    }
  };
  seed(candles[0].open, investment);

  // Walk one price segment a → b, filling orders in the direction of travel.
  const walk = (a: number, b: number) => {
    if (b < a) {
      // downward: buys with b ≤ L[k] < a, highest first
      for (let k = grids - 1; k >= 0; k--) {
        if (isSell[k]) continue;
        const lv = L[k];
        if (lv >= a) continue;
        if (lv < b) break;
        cash -= q * (1 + feeRate);
        coins += coinsPer[k];
        buys++;
        isSell[k] = 1;
      }
    } else if (b > a) {
      // upward: sells with a < L[k+1] ≤ b, lowest first
      for (let k = 0; k < grids; k++) {
        if (!isSell[k]) continue;
        const lv = L[k + 1];
        if (lv <= a) continue;
        if (lv > b) break;
        cash += coinsPer[k] * lv * (1 - feeRate);
        coins -= coinsPer[k];
        trades++;
        gridProfit += coinsPer[k] * (lv - L[k]) - feeRate * coinsPer[k] * (L[k] + lv);
        isSell[k] = 0;
      }
    }
  };

  let peak = investment;
  let maxDD = 0;
  let breakouts = 0;
  const firstTime = candles[0].time;
  const SLICE_MS = 30 * DAY_MS;
  const sliceProfits: number[] = [];
  const activeDaySet = new Set<number>();
  let sliceStartProfit = 0;
  let sliceIdx = 0;
  const exits: StopExit[] = [];
  let halted = false;
  let daysOut = 0;
  for (const c of candles) {
    const idx = Math.floor((c.time - firstTime) / SLICE_MS);
    while (idx > sliceIdx) {
      sliceProfits.push(gridProfit - sliceStartProfit);
      sliceStartProfit = gridProfit;
      sliceIdx++;
    }
    const tradesBefore = trades;
    if (halted) {
      daysOut += candleMs / DAY_MS;
      // Re-enter only once price has recovered clearly above the stop (REENTRY_MARGIN) and closed inside the range.
      if (stop?.reenter && c.close >= stop.price * (1 + REENTRY_MARGIN) && c.close >= lower && c.close <= upper) {
        seed(c.close, cash);
        halted = false;
      }
    } else if (stop && c.low <= stop.price) {
      // Price fell to the stop inside this candle. A stop order fills at the stop, or at the open if the
      // candle already opened below it (gap). Buys between the open and the exit price fill on the way down.
      const exitPrice = Math.min(stop.price, c.open);
      if (exitPrice < c.open) walk(c.open, exitPrice);
      const equityBefore = cash + coins * exitPrice;
      cash += coins * exitPrice * (1 - feeRate);
      coins = 0;
      exits.push({ time: c.time, price: exitPrice, equityBefore, equityAfter: cash, lossFromEntry: entryEquity - cash });
      halted = true;
    } else if (c.close >= c.open) {
      walk(c.open, c.low);
      walk(c.low, c.high);
      walk(c.high, c.close);
    } else {
      walk(c.open, c.high);
      walk(c.high, c.low);
      walk(c.low, c.close);
    }
    if (trades > tradesBefore) activeDaySet.add(Math.floor(c.time / DAY_MS));
    if (c.close < lower || c.close > upper) breakouts++;
    const equity = cash + coins * c.close;
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  const first = candles[0].time;
  const last = candles[candles.length - 1].time;
  const days = (last - first + candleMs) / DAY_MS;
  const monthlyYield = days > 0 ? (gridProfit / investment / days) * 30 : 0;
  const equityEnd = cash + coins * candles[candles.length - 1].close;

  // Close the trailing slice. Only slices covering ≥ 20 days count for the worst-slice yield,
  // so a short tail (or a window under 20 days) never masquerades as a bad month.
  sliceProfits.push(gridProfit - sliceStartProfit);
  const lastSliceDays = (last - (firstTime + sliceIdx * SLICE_MS) + candleMs) / DAY_MS;
  const fullSlices = sliceProfits.filter((_, i) => i < sliceProfits.length - 1 || lastSliceDays >= 20);
  const worstSliceYield = fullSlices.length > 0 ? Math.min(...fullSlices) / investment : monthlyYield;
  const activeDays = activeDaySet.size;

  return {
    gridProfit,
    monthlyYield,
    monthlyProfit: monthlyYield * investment,
    trades,
    buys,
    tradesPerMonth: days > 0 ? (trades / days) * 30 : 0,
    timeInRangePct: (100 * (candles.length - breakouts)) / candles.length,
    maxDrawdownPct: maxDD * 100,
    unrealizedPnl: equityEnd - investment - gridProfit,
    breakouts,
    days,
    levels: L,
    cashEnd: cash,
    coinsEnd: coins,
    exits,
    daysOut,
    totalPnl: equityEnd - investment,
    sliceProfits,
    worstSliceYield,
    activeDays,
    idleDays: Math.max(0, Math.round(days) - activeDays),
  };
}

/* ---------- persisted tab settings (pure, shared by tab + tests) ---------- */

export type RankBy = "worst" | "average";

export interface GridSettings {
  goalUsd: number | null; // null = no goal: size everything to maxInvestment and report earnings
  maxInvestment: number | null;
  window: GridWindow;
  mode: GridMode;
  /** "worst": rank and size on the worst 30-day slice (steady income); "average": on the mean yield. */
  rankBy: RankBy;
  /** Candidates completing fewer rounds per day on average are dropped (0 = no filter). */
  minTradesPerDay: number;
  /** The recommended stop must keep the theoretical worst case within this fraction of the investment. */
  maxLossPct: number;
}

export const DEFAULT_GRID_SETTINGS: GridSettings = {
  goalUsd: 500,
  maxInvestment: null,
  window: "3m",
  mode: "arithmetic",
  rankBy: "worst",
  minTradesPerDay: 3,
  maxLossPct: 0.1,
};

export const isGridSettings = (v: unknown): v is GridSettings => {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    (o.goalUsd === null || typeof o.goalUsd === "number") &&
    (o.maxInvestment === null || typeof o.maxInvestment === "number") &&
    ["1m", "3m", "6m", "max"].includes(o.window as string) &&
    (o.mode === "arithmetic" || o.mode === "geometric") &&
    (o.rankBy === "worst" || o.rankBy === "average") &&
    typeof o.minTradesPerDay === "number" &&
    typeof o.maxLossPct === "number"
  );
};

/* ---------- optimizer ---------- */

export interface OptimizeInput {
  candles: Candle[];
  candleMs: number;
  goalUsd: number | null; // null → no sizing to a goal; requiredInvestment is 0
  maxInvestment: number | null;
  currentPrice: number;
  mode: GridMode;
  /** Resolution correction (RESOLUTION_FACTOR); multiplies yield for sizing only. */
  factor: number;
  rankBy: RankBy;
  minTradesPerDay: number;
  maxLossPct: number;
}

export interface Candidate {
  lower: number;
  upper: number;
  grids: number;
  mode: GridMode;
  result: GridResult; // simulated at NOMINAL_INVESTMENT
  spacingPct: number; // tightest interval, fraction
  profitPerGridPct: number; // spacingPct − 2 × fee
  rankYield: number; // raw yield used for ranking: worstSliceYield or monthlyYield per rankBy
  liveMonthlyYield: number; // rankYield × factor
  requiredInvestment: number; // ceil(goal / liveMonthlyYield)
  stopLoss: number; // recommended Pionex stop-loss price (best row of the sweep within the max-loss cap)
  stopLabel: string; // e.g. "cap −10%" or "5% below lower"
  stopMargin: number; // fraction below the lower bound (negative = inside the range)
  stopLossPct: number; // worst case from the current price: fraction of the investment lost if price falls straight to the stop
  stopLossFromTopPct: number; // worst case if price first rises to the top of the range, then falls to the stop
  stopExits: number; // times the recommended stop fired in the window (with re-entry)
  stopPnlDeltaPct: number; // pnl with the recommended stop − pnl without, as a fraction of investment
  stopSweep: StopSweepRow[]; // full sweep for the ticket's table
}

export const NOMINAL_INVESTMENT = 1000;
export const STOP_MARGINS = [0, 0.01, 0.02, 0.03, 0.05, 0.08, 0.1, 0.15];

export const LOSS_CAPS = [0.05, 0.1, 0.15];

export interface StopSweepRow {
  label: string; // "none", "5% below lower", "cap −10%"
  margin: number | null; // fraction below the lower bound (negative = inside the range); null = no stop
  stopPrice: number | null;
  worstCasePct: number; // worst case if price falls from the entry (current) price to the stop, 0..1
  worstFromTopPct: number; // worst case if price first rises to the top of the range, then falls to the stop
  exits: number;
  worstExitLossPct: number; // largest lossFromEntry / investment, 0..1
  daysOut: number;
  gridProfitPct: number; // gridProfit / investment over the window
  pnlPct: number; // totalPnl / investment over the window (what you actually keep)
}

/**
 * Worst case if price falls from the top of the range straight to the stop: every buy level above the stop
 * is held at its level and sold at the stop. Fraction of capital lost, grid profit ignored. Works for a stop
 * inside the range too (levels below it are never bought, so they cost nothing).
 */
export function worstCaseLossPct(lower: number, upper: number, grids: number, mode: GridMode, stopPrice: number, entryPrice?: number): number {
  const L = gridLevels(lower, upper, grids, mode);
  let loss = 0;
  for (let k = 0; k < grids; k++) {
    if (entryPrice !== undefined && L[k + 1] > entryPrice) {
      // seeded sell: q/L[k] coins bought at the entry price, sold at the stop
      if (entryPrice > stopPrice) loss += (entryPrice - stopPrice) / L[k];
    } else if (L[k] > stopPrice) {
      // grid buy at L[k] on the way down, sold at the stop
      loss += 1 - stopPrice / L[k];
    }
  }
  return Math.max(0, loss / grids);
}

/**
 * The stop price at which the worst case equals `targetLoss` (fraction). With `entryPrice` the worst case is
 * a fall from there (so the result is always below the entry); without it, a fall from the top of the range.
 */
export function stopPriceForLoss(lower: number, upper: number, grids: number, mode: GridMode, targetLoss: number, entryPrice?: number): number {
  let lo = lower * 0.3;
  let hi = entryPrice ?? upper;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (worstCaseLossPct(lower, upper, grids, mode, mid, entryPrice) > targetLoss) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** A stop must sit clearly below the current price or it fires on the first candle. */
export const STOP_BELOW_ENTRY = 0.01;

/**
 * Backtest the same grid with a stop at each margin below the lower bound (re-entering when price closes back
 * inside the range) and without a stop. Rows are per-window figures as fractions of the investment.
 */
export function stopSweep(candles: Candle[], p: Omit<GridParams, "investment">, candleMs: number, entryPrice: number, margins = STOP_MARGINS, lossCaps = LOSS_CAPS): StopSweepRow[] {
  const params = { ...p, investment: NOMINAL_INVESTMENT };
  const rows: StopSweepRow[] = [];
  const none = simulateGrid(candles, params, candleMs);
  rows.push({ label: "none", margin: null, stopPrice: null, worstCasePct: 1, worstFromTopPct: 1, exits: 0, worstExitLossPct: 0, daysOut: 0, gridProfitPct: none.gridProfit / NOMINAL_INVESTMENT, pnlPct: none.totalPnl / NOMINAL_INVESTMENT });
  const maxStop = entryPrice * (1 - STOP_BELOW_ENTRY);
  const run = (label: string, stopPrice: number) => {
    if (stopPrice >= maxStop) return; // would fire immediately
    const r = simulateGrid(candles, params, candleMs, GRID_FEE_RATE, { price: stopPrice, reenter: true });
    rows.push({
      label,
      margin: 1 - stopPrice / p.lower,
      stopPrice,
      worstCasePct: worstCaseLossPct(p.lower, p.upper, p.grids, p.mode, stopPrice, entryPrice),
      worstFromTopPct: worstCaseLossPct(p.lower, p.upper, p.grids, p.mode, stopPrice),
      exits: r.exits.length,
      worstExitLossPct: r.exits.reduce((m, e) => Math.max(m, e.lossFromEntry), 0) / NOMINAL_INVESTMENT,
      daysOut: r.daysOut,
      gridProfitPct: r.gridProfit / NOMINAL_INVESTMENT,
      pnlPct: r.totalPnl / NOMINAL_INVESTMENT,
    });
  };
  // Loss caps: a stop inside (or below) the range so the worst case never exceeds the cap.
  for (const cap of lossCaps) {
    const price = stopPriceForLoss(p.lower, p.upper, p.grids, p.mode, cap, entryPrice);
    if (price > p.lower * (1 - Math.max(...margins))) run(`cap −${Math.round(cap * 100)}%`, price);
  }
  for (const margin of margins) run(margin === 0 ? "at lower bound" : `${Math.round(margin * 100)}% below lower`, p.lower * (1 - margin));
  return rows.sort((a, b) => (b.stopPrice ?? Infinity) - (a.stopPrice ?? Infinity));
}

/**
 * The stop that kept the most P&L in the window among those whose worst case stays within `maxLossPct`
 * (ties → fewer exits → higher stop price = earlier exit). Falls back to the lowest-worst-case stop if none fits.
 */
export function pickStop(rows: StopSweepRow[], maxLossPct = 1): StopSweepRow {
  const withStop = rows.filter((r) => r.stopPrice !== null);
  const fitting = withStop.filter((r) => r.worstCasePct <= maxLossPct + 1e-9);
  const pool = fitting.length > 0 ? fitting : [withStop.reduce((m, r) => (r.worstCasePct < m.worstCasePct ? r : m), withStop[0])];
  return pool.reduce((best, r) => {
    if (r.pnlPct > best.pnlPct + 1e-9) return r;
    if (Math.abs(r.pnlPct - best.pnlPct) <= 1e-9 && (r.exits < best.exits || (r.exits === best.exits && (r.stopPrice ?? 0) > (best.stopPrice ?? 0)))) return r;
    return best;
  }, pool[0]);
}

export interface OptimizeOutput {
  best: Candidate | null;
  requiredInvestment: number | null;
  overBudget: boolean;
  achievableMonthly: number | null;
  alternatives: Candidate[];
  warnings: string[];
  tested: number;
  kept: number;
}

const LOWER_PCTS = [0, 2.5, 5, 10, 15];
const UPPER_PCTS = [85, 90, 95, 97.5, 100];
export const GRID_COUNTS = [10, 15, 20, 25, 30, 40, 50, 60, 80, 100];
const MIN_IN_RANGE_PCT = 90;
/** Pairs must be earned by grid buys, not just by unwinding the seed on a rise (that is trend profit). */
const MIN_BUY_SHARE = 0.5;
const MIN_SPACING = 6 * GRID_FEE_RATE; // 0.3 %: three round-trip fees of headroom
const EDGE_WARN = 0.05;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function unique(xs: number[]): number[] {
  return [...new Set(xs)];
}

export function optimizeGrid(input: OptimizeInput): OptimizeOutput {
  const { candles, candleMs, goalUsd, maxInvestment, currentPrice, mode, rankBy } = input;
  const minTradesPerDay = input.minTradesPerDay > 0 ? input.minTradesPerDay : 0;
  const factor = input.factor > 0 ? input.factor : 1;
  const warnings: string[] = [];
  const none: OptimizeOutput = {
    best: null, requiredInvestment: null, overBudget: false, achievableMonthly: null,
    alternatives: [], warnings, tested: 0, kept: 0,
  };
  if (candles.length === 0) {
    warnings.push("No candle data for this window.");
    return none;
  }
  if (!(currentPrice > 0)) {
    warnings.push("No current price.");
    return none;
  }
  if (goalUsd !== null && !(goalUsd > 0)) {
    warnings.push("Enter a monthly goal above zero, or leave it empty and enter an investment.");
    return none;
  }

  const lows = candles.map((c) => c.low).sort((a, b) => a - b);
  const highs = candles.map((c) => c.high).sort((a, b) => a - b);
  const lowers = unique(LOWER_PCTS.map((p) => percentile(lows, p)));
  const uppers = unique(UPPER_PCTS.map((p) => percentile(highs, p)));

  const days = (candles[candles.length - 1].time - candles[0].time + candleMs) / DAY_MS;
  if (days < 28) warnings.push("Backtest window is shorter than 28 days — monthly figures are extrapolated.");

  let tested = 0;
  const candidates: Candidate[] = [];
  for (const lower of lowers) {
    for (const upper of uppers) {
      if (!(lower < currentPrice && currentPrice < upper)) continue;
      for (const grids of GRID_COUNTS) {
        const spacingPct = minSpacingPct(lower, upper, grids, mode);
        if (spacingPct < MIN_SPACING) continue;
        if (NOMINAL_INVESTMENT / grids < MIN_ORDER_USDT) continue; // guards hypothetical grid counts > 200
        tested++;
        const result = simulateGrid(candles, { lower, upper, grids, investment: NOMINAL_INVESTMENT, mode }, candleMs);
        if (result.timeInRangePct < MIN_IN_RANGE_PCT || result.monthlyYield <= 0) continue;
        if (result.buys < MIN_BUY_SHARE * result.trades) continue; // trending: seed sells only
        if (result.tradesPerMonth / 30 < minTradesPerDay) continue; // too few rounds to be steady income
        const rankYield = rankBy === "worst" ? result.worstSliceYield : result.monthlyYield;
        if (rankYield <= 0) continue;
        const liveMonthlyYield = rankYield * factor;
        candidates.push({
          lower, upper, grids, mode, result, spacingPct,
          profitPerGridPct: spacingPct - 2 * GRID_FEE_RATE,
          rankYield,
          liveMonthlyYield,
          requiredInvestment: goalUsd !== null ? Math.ceil(goalUsd / liveMonthlyYield) : 0,
          stopLoss: 0, stopLabel: "", stopMargin: 0, stopLossPct: 0, stopLossFromTopPct: 0, stopExits: 0, stopPnlDeltaPct: 0, stopSweep: [],
        });
      }
    }
  }
  candidates.sort((a, b) => b.rankYield - a.rankYield);

  // Ranking on raw yield favours wide spacing, so the top of the list would be six near-identical
  // 10-grid ranges. The board is a comparison, so keep only the best range per grid count.
  const bestPerGrids: Candidate[] = [];
  const seenGrids = new Set<number>();
  for (const c of candidates) {
    if (seenGrids.has(c.grids)) continue;
    seenGrids.add(c.grids);
    bestPerGrids.push(c);
  }
  // Stop-loss sweep only for the rows the board shows (≤ GRID_COUNTS.length), 8 sims each.
  for (const c of bestPerGrids) {
    const sweep = stopSweep(candles, { lower: c.lower, upper: c.upper, grids: c.grids, mode: c.mode }, candleMs, currentPrice);
    const pick = pickStop(sweep, input.maxLossPct > 0 ? input.maxLossPct : 1);
    c.stopSweep = sweep;
    c.stopLoss = pick.stopPrice ?? c.lower * (1 - 0.05);
    c.stopLabel = pick.label;
    c.stopMargin = pick.margin ?? 0.05;
    c.stopLossPct = pick.worstCasePct;
    c.stopLossFromTopPct = pick.worstFromTopPct;
    c.stopExits = pick.exits;
    c.stopPnlDeltaPct = pick.pnlPct - sweep[0].pnlPct;
  }

  if (candidates.length === 0) {
    warnings.push(
      minTradesPerDay > 0
        ? `No grid configuration passed the filters on this window: price left every range for > ${100 - MIN_IN_RANGE_PCT}% of the time, profit came only from a trending rise, or nothing completed ${minTradesPerDay} rounds a day. Lower the minimum rounds per day or try another window.`
        : `No grid configuration worked on this window: either price left every range for > ${100 - MIN_IN_RANGE_PCT}% of the time, or profit came only from selling the starting position on a rise — the market is trending, not ranging. Try another window or wait for a range.`,
    );
    return { ...none, tested };
  }

  const best = bestPerGrids[0];
  if (goalUsd === null) {
    // Investment mode: nothing to size; the tab reports earnings at maxInvestment.
    if (maxInvestment !== null && maxInvestment / best.grids < MIN_ORDER_USDT) {
      warnings.push(`Investment too small for ${best.grids} grids — Pionex needs at least ${MIN_ORDER_USDT} USDT per grid.`);
    }
    if ((currentPrice - best.lower) / currentPrice < EDGE_WARN) warnings.push("Current price is within 5% of the lower bound — the bot would start almost fully in MON.");
    if ((best.upper - currentPrice) / currentPrice < EDGE_WARN) warnings.push("Current price is within 5% of the upper bound — little room to sell before a breakout.");
    return { best, requiredInvestment: null, overBudget: false, achievableMonthly: null, alternatives: bestPerGrids.slice(1), warnings, tested, kept: candidates.length };
  }
  const requiredInvestment = best.requiredInvestment;
  if (requiredInvestment / best.grids < MIN_ORDER_USDT) {
    warnings.push(
      `Investment too small for ${best.grids} grids — Pionex needs at least ${MIN_ORDER_USDT} USDT per grid. Raise the goal or pick an alternative with fewer grids.`,
    );
  }
  const overBudget = maxInvestment !== null && requiredInvestment > maxInvestment;
  const achievableMonthly = overBudget && maxInvestment !== null ? maxInvestment * best.liveMonthlyYield : null;
  if (overBudget && maxInvestment !== null) {
    warnings.push(
      `Over budget: $${goalUsd.toLocaleString()} / month needs $${requiredInvestment.toLocaleString()}, above your $${maxInvestment.toLocaleString()} max. At your max this grid earns about $${Math.round(achievableMonthly ?? 0).toLocaleString()} / month.`,
    );
  }
  if ((currentPrice - best.lower) / currentPrice < EDGE_WARN) warnings.push("Current price is within 5% of the lower bound — the bot would start almost fully in MON.");
  if ((best.upper - currentPrice) / currentPrice < EDGE_WARN) warnings.push("Current price is within 5% of the upper bound — little room to sell before a breakout.");

  return {
    best,
    requiredInvestment,
    overBudget,
    achievableMonthly,
    alternatives: bestPerGrids.slice(1), // one row per grid count, so at most GRID_COUNTS.length − 1
    warnings,
    tested,
    kept: candidates.length,
  };
}
