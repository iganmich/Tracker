# Grid Analyst — Design Spec

**Date:** 2026-09-12
**Status:** Approved by user, pending spec review

## Goal

Add a fifth dashboard tab, **⚡ Grid Analyst**, that turns a monthly USD profit goal into a concrete Pionex **Spot Grid** bot configuration for MON: investment amount, lower price, upper price, grid count. Parameters are chosen by brute-force backtest against real MON daily candles.

## Decisions already made

| Decision | Choice | Why |
|---|---|---|
| Grid product | Pionex Spot Grid | No leverage, no liquidation, simplest parameter set |
| Goal metric | Grid profit only (realized pair profit) | Matches Pionex "Grid Profit"; independent of where price ends |
| Algorithm | Brute-force backtest search | Deterministic, explainable, fast enough client-side |
| Budget cap | Optional "max investment" input | Tells user when a goal is unrealistic |
| Price history | Pionex `MON_USDT_PERP` daily klines via server proxy | Only source with intraday high/low; MON spot pair is not exposed by the Pionex API as of 2026-09-12 |
| Fallback | CoinGecko daily series already loaded by the dashboard | high = low = close, flagged as approximate |
| Windows | 3M (90 candles), 6M (180), Max (all available) | 12M not possible — MON launched 2025-11-24 |
| Fees | 0.05% per side (Pionex spot maker/taker) | Constant, `GRID_FEE_RATE` |

## Data facts (verified 2026-09-12)

- Pionex `GET /api/v1/market/klines?symbol=MON_USDT_PERP&interval=1D&limit=500` → 338 daily candles from 2025-10-10, public, no auth, **no CORS header** (browser cannot call it directly).
- Pionex 4H → 500 candles ≈ 83 days; 60M → 500 candles ≈ 21 days. Not used in v1.
- CoinGecko free tier: daily back to launch (294 points), hourly for 90 days, 5-min for 1 day, hard cap 365 days. CORS allowed.
- Pionex spot symbol list (407) contains no MON pair. Perp list contains `MON_USDT_PERP`. Perp price tracks CoinGecko spot within 0.1%.

## Architecture

### 1. Server route — `src/app/api/klines/route.ts`

- `GET /api/klines?interval=1D&limit=500`
- Proxies to Pionex klines for `MON_USDT_PERP`. Symbol is a server constant, not a query param (no open proxy).
- Validates `interval` against `["1D"]` for v1 and `limit` as integer 1..500. Anything else → 400.
- Returns `{ candles: Candle[] }`, sorted ascending by time. Pionex returns newest-first; the route reverses.
- Response cached with `Cache-Control: public, max-age=300` (5 min) — daily candles change once per day; the last candle is intraday and refreshes within 5 min.
- On upstream failure → 502 with `{ error }`.

### 2. Client data — `src/lib/klines.ts`

```ts
export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }
export type GridWindow = "3m" | "6m" | "max";
export const GRID_WINDOW_DAYS: Record<GridWindow, number | null> = { "3m": 90, "6m": 180, max: null };

export async function fetchCandles(): Promise<Candle[]>;          // calls /api/klines, throws on !ok
export function sliceWindow(candles: Candle[], w: GridWindow): Candle[];
export function candlesFromPricePoints(points: PricePoint[]): Candle[]; // fallback, o=h=l=c=price
```

- Tab fetches once on mount, stores in state; window slicing is a `useMemo`. No refetch on pill change.

### 3. Simulator — `src/lib/grid.ts` (pure, no React)

```ts
export type GridMode = "arithmetic" | "geometric";
export interface GridParams { lower: number; upper: number; grids: number; investment: number; mode: GridMode }
export interface GridResult {
  gridProfit: number;        // USD, realized, net of fees
  monthlyYield: number;      // gridProfit / investment / days * 30
  monthlyProfit: number;     // monthlyYield * investment
  trades: number;            // completed buy→sell pairs
  tradesPerMonth: number;
  timeInRangePct: number;    // 0..100, share of candles whose close is within [lower, upper]
  maxDrawdownPct: number;    // worst peak-to-trough of (cash + coins*close) vs investment, 0..100
  unrealizedPnl: number;     // (cash + coins*lastClose) - investment - gridProfit
  breakouts: number;         // candles with close outside range
  days: number;
  levels: number[];          // grids + 1 price levels, ascending
}
export const GRID_FEE_RATE = 0.0005;
export function gridLevels(lower: number, upper: number, grids: number, mode: GridMode): number[];
export function simulateGrid(candles: Candle[], p: GridParams, feeRate = GRID_FEE_RATE): GridResult;
```

**Fill model (mirrors Pionex spot grid seeding):**

1. Levels `L[0..grids]` ascending. Per-grid quote budget `q = investment / grids`.
2. Entry price `p0 = candles[0].open`. Levels above `p0` each hold a **sell order** for `q / L[i]` coins (bot buys those coins at market on start, paying fee). Levels at or below `p0` each hold a **buy order** of `q` USD.
   - Cash after seeding = `investment − Σ(q for levels above p0) × (1 + fee)`.
3. Each candle is walked as a price path: green candle (`close ≥ open`) → `open → low → high → close`; red → `open → high → low → close`. Between consecutive path points, orders are filled in the direction of travel in level order.
4. Filling **buy at L[i]** (price falls to ≤ L[i]): spend `q` USD (+fee), receive `q / L[i]` coins, place **sell at L[i+1]** for those coins. The buy order at L[i] is removed.
5. Filling **sell at L[i]** (price rises to ≥ L[i]): sell the coins tied to that order, credit `coins × L[i] × (1 − fee)`, book pair profit `coins × (L[i] − L[i−1]) − fees of both legs`, place **buy at L[i−1]** for `q` USD. The sell order at L[i] is removed.
6. Top level `L[grids]` has no sell-then-buy-above; bottom level `L[0]` has no buy-then-sell-below. A fill at the top places a buy at `L[grids−1]`; a fill at the bottom places a sell at `L[1]`.
7. Within one path segment an order can fill at most once; a newly placed order can fill in a later segment of the same candle (e.g. buy at low, sell at high on a green day).
8. Prices outside `[lower, upper]` fill nothing; the bot simply waits.

`maxDrawdownPct` is computed on candle closes from mark-to-market equity `cash + coins × close`.

### 4. Optimizer — `src/lib/grid.ts`

```ts
export interface OptimizeInput { candles: Candle[]; goalUsd: number; maxInvestment?: number; currentPrice: number; mode: GridMode }
export interface Candidate { params: Omit<GridParams,"investment">; result: GridResult; spacingPct: number; profitPerGridPct: number }
export interface OptimizeOutput {
  best: Candidate | null;             // null if no candidate passed filters
  requiredInvestment: number | null;  // goalUsd / best.result.monthlyYield
  overBudget: boolean;                // requiredInvestment > maxInvestment
  achievableMonthly: number | null;   // maxInvestment * monthlyYield when overBudget
  alternatives: Candidate[];          // next 5 by yield
  warnings: string[];
}
export function optimizeGrid(input: OptimizeInput): OptimizeOutput;
```

**Search space:**
- `lower` ∈ percentiles `{0, 2.5, 5, 10, 15}` of window lows.
- `upper` ∈ percentiles `{85, 90, 95, 97.5, 100}` of window highs.
- Require `lower < currentPrice < upper`; skip otherwise.
- `grids` ∈ `{10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 120, 150}`.
- Constraints (Pionex spot grid): spacing % ≥ `3 × 2 × fee` (= 0.3%) so each pair nets profit; per-grid budget at nominal investment must be ≥ `MIN_ORDER_USDT` (5). Nominal investment = 1000 for simulation; yield is linear in investment so one run per (lower, upper, grids).
- Filter: `timeInRangePct ≥ 90`.
- Rank by `monthlyYield` desc. Best = first. Alternatives = next 5.
- `requiredInvestment = goalUsd / monthlyYield`, rounded up to whole USD.
- Check `requiredInvestment / grids ≥ MIN_ORDER_USDT`; if not, add warning "Investment too small for N grids — raise goal or reduce grids".

**Warnings produced:**
- No candidate passed the 90% in-range filter (very trending window).
- Fallback data in use (candles without intraday range → fills underestimated).
- Current price within 5% of lower or upper.
- Over budget.
- Backtest window shorter than 30 days.

### 5. UI — `src/components/tabs/GridAnalystTab.tsx`

Props: `priceData: PricePoint[]` (for fallback), `currentPrice: number | null`.

Local state (persisted under `mon.grid` via `usePersistentState`, type-guarded):
```ts
interface GridSettings { goalUsd: number; maxInvestment: number | null; window: GridWindow; mode: GridMode }
DEFAULT: { goalUsd: 100, maxInvestment: null, window: "3m", mode: "arithmetic" }
```

Layout (mobile-first, one column → `lg:` two columns):

1. **Inputs card** — goal (number input, USD), max investment (number input, blank = none), window pills (3M / 6M / Max), mode toggle (Arithmetic / Geometric). All controls `min-h-[44px]`.
2. **Recommended bot card** — the four Pionex fields first, large, tabular-nums, in Pionex's form order: Investment (USDT), Lower price, Upper price, Grid count. Prices formatted to 5 decimals (MON ≈ 0.02). Then a stats row via `StatCard`: spacing %, profit/grid %, expected monthly grid profit, trades/month, time in range, max drawdown, unrealized P&L at window end. Warnings rendered as amber lines above the stats.
3. **Chart** — `ChartFrame` + recharts `ComposedChart`: close price `Line`, shaded `Area` between lower and upper (tuple `rangeBand: [lower, upper]` on every row, read from `payload[0].payload` per AGENTS.md rule), grid levels as `ReferenceLine`s — if `grids > 30`, draw every `ceil(grids/30)`-th level. Current price `ReferenceLine` dashed.
4. **Alternatives table** — top 5: lower, upper, grids, spacing, monthly yield, required investment, time in range. Row click applies that candidate to the result card (local state `selectedIdx`).
5. Footer note: "Backtest on Pionex MON_USDT_PERP daily candles · fees 0.05%/side · past range ≠ future range".

Loading: skeleton via `ChartFrame loading`; result card shows "—" placeholders. Error: fallback to CoinGecko candles and a warning line, never a blank tab.

Computation: `useMemo(() => optimizeGrid(...), [windowCandles, goalUsd, maxInvestment, mode, currentPrice])`. Selected alternative re-simulated at its required investment for display only.

### 6. Wiring

- `types.ts`: `TabId` adds `"grid"`; add `Candle`-independent types stay in `grid.ts`/`klines.ts`.
- `constants.ts`: `TABS` adds `{ id: "grid", label: "⚡ Grid Analyst" }` after backtest.
- `dashboard/page.tsx`: `TAB_IDS` adds `"grid"`; renders `<GridAnalystTab priceData={priceData} currentPrice={currentPrice} />`.
- AGENTS.md / README: add tab description, `/api/klines` route, `mon.grid` storage key, data-source note about MON spot vs perp.

### 7. Testing

Add **vitest** (devDependency, `npm test` script, `vitest.config.ts` with `@` alias). Tests in `src/lib/__tests__/`:

**grid.test.ts**
- `gridLevels` arithmetic: equal differences, `levels.length === grids + 1`, endpoints exact.
- `gridLevels` geometric: equal ratios.
- Sawtooth candles oscillating exactly between `L[3]` and `L[4]` every day with `open = close = midpoint`: yields exactly one completed pair per day after the first, profit = `days−1` × `q/L[3] × (L[4]−L[3])` minus fees (within 1e-9).
- Candles entirely above `upper`: zero trades, `timeInRangePct = 0`, `breakouts = candles.length`.
- Flat candles (o=h=l=c inside range): zero trades, zero drawdown.
- Fees: with `feeRate = 0`, profit equals gross; with default fee, profit strictly lower.

**klines.test.ts**
- `sliceWindow("3m")` returns last 90; `"max"` returns all; shorter input returns all.
- `candlesFromPricePoints` sets o=h=l=c.

**optimize.test.ts**
- Synthetic ranging market: `best` is non-null, `lower < currentPrice < upper`, `requiredInvestment × monthlyYield ≈ goalUsd`.
- With `maxInvestment` below required: `overBudget === true`, `achievableMonthly === maxInvestment × monthlyYield`.
- Strongly trending synthetic data: `best === null` and a warning is present.

**Route** — no unit test; verified manually with curl (`/api/klines` returns ascending candles, bad `limit` → 400).

## Out of scope (v1)

- Futures grid, leverage, long/short modes.
- Hourly/4H backtests (Pionex 500-candle cap makes windows too short; CoinGecko hourly lacks high/low).
- Auto-creating the bot via API (Pionex has no public grid-bot endpoint).
- AI commentary button.
- Trailing / infinity grid variants.

## Risks

- **MON spot not on Pionex API.** If the user cannot actually open a MON spot grid on Pionex, the numbers are still valid for any exchange's spot grid on MON, but the "Pionex order" framing should be softened. Flag in UI footer.
- **Daily candle path approximation** over-counts fills when price whipsaws several times inside a day and under-counts when a day spans many levels but the path order differs. Acceptable for sizing; stated in footer.
- **Range percentiles** from a trending window may produce a range that the price will leave soon; the 90% in-range filter and the "near edge" warning mitigate but do not eliminate this.
