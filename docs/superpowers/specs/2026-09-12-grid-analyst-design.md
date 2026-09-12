# Grid Analyst — Design Spec

**Date:** 2026-09-12
**Status:** Approved by user 2026-09-12. Data source finalised on Pionex perp candles after live-bot calibration (see Data facts). UI direction C (Comparison Board) chosen by user.

## Goal

Add a fifth dashboard tab, **⚡ Grid Analyst**, that turns a monthly USD profit goal into a concrete Pionex **Spot Grid** bot configuration for MON: investment amount, lower price, upper price, grid count. Parameters are chosen by brute-force backtest against real MON daily candles.

## Decisions already made

| Decision | Choice | Why |
|---|---|---|
| Grid product | Pionex Spot Grid | No leverage, no liquidation, simplest parameter set |
| Goal metric | Grid profit only (realized pair profit) | Matches Pionex "Grid Profit"; independent of where price ends |
| Algorithm | Brute-force backtest search | Deterministic, explainable, fast enough client-side |
| Budget cap | Optional "max investment" input | Tells user when a goal is unrealistic |
| Price history | **Pionex `MON_USDT_PERP` candles from the local Postgres**, finest resolution the window allows (5-min → 15-min → 30-min → 1-hour) | Calibrated against the user's live bot: 5-minute perp candles reproduce 85 of 83 real rounds. KuCoin spot is too thin (87 % of its 1-minute candles are flat) and under-counts fills 2×; it stays in the DB only as deep-history backup. Pionex caps each interval at 10,000 candles, but the local DB accumulates beyond that when the ingest runs regularly |
| Fallback | CoinGecko daily series already loaded by the dashboard | high = low = close, daily only, flagged as approximate |
| Windows | 1M (30 d, 5-min, ≈ 8,600 candles) · 3M (90 d, 15-min, ≈ 8,600) · 6M (180 d, 30-min, ≈ 8,600) · Max (from launch, 1-hour, ≈ 7,000) | 12M not possible — MON launched 2025-11-24. Resolution follows what Pionex history covers today (5-min 35 d, 15-min 104 d, 30-min 208 d, 1-hour full). Every window is ≈ 8k candles, so optimizer cost is flat |
| Fees | 0.05% per side (Pionex spot maker/taker) | Constant, `GRID_FEE_RATE` |

## Data facts (verified 2026-09-12)

**Calibration against the user's live Pionex spot grid** (0.023–0.030, 80 grids arithmetic, 23,719.89 USDT, created 2026-09-11 13:08 UTC+7; after 23.5 h Pionex reported **83 rounds, +78.44 USDT grid profit**, −171.65 trend PnL). The section-3 fill model run over the same hours:

| Source / resolution | Candles | Simulated rounds | Simulated grid profit | Rounds captured |
|---|---|---|---|---|
| Pionex perp 1-min | 1,411 | 90 | 71.69 | 108 % |
| **Pionex perp 5-min** | 283 | **85** | **67.83** | **102 %** |
| Pionex perp 15-min | 94 | 71 | 56.83 | 86 % |
| Pionex perp 30-min | 47 | 64 | 51.23 | 77 % |
| Pionex perp 1-hour | 23 | 53 | 42.46 | 64 % |
| Pionex perp 4-hour | 6 | 37 | 29.66 | 45 % |
| KuCoin spot 5-min | 283 | 44 | 34.77 | 53 % |
| KuCoin spot 1-min | 1,413 | 28 | 22.03 | 34 % |

- Per-pair profit is exact: Pionex transaction #81 (buy 298.50 USDT at 0.02335, sell 0.02344, fees 0.1487 + 0.1492) shows 0.8482; the formula `coins × spacing − fee × coins × (L_buy + L_sell)` gives 0.8515. The remaining −14 % on the 5-min total comes from Pionex sizing orders by coin quantity rather than constant USDT; acceptable.
- **Why Pionex perp, not KuCoin spot:** KuCoin's MON book is nearly dead (≈ 142k USDT / day; 1,226 of 1,413 one-minute candles that day had high = low), so its path misses most oscillation. Pionex perp is liquid (45k trades / day) and tracks spot within 0.2 %.
- **Resolution correction factors** (from the table, rounds captured): 5-min 1.00, 15-min 1.17, 30-min 1.30, 1-hour 1.57. The tab shows the raw simulated figure as the headline and prints "× factor ≈ live estimate" beside it for windows coarser than 5-min; the optimizer ranks on raw yield (the factor is constant within a window, so ranking is unaffected) but sizes the required investment with the corrected yield so the goal is not under-funded. Single-day calibration — stated as such in the footer; re-measure when more live-bot days exist.
- **Local store contents** (`mon_candles`): Pionex 1-min (7 d), 5-min (35 d), 15-min (104 d), 30-min (208 d), 1-hour / 4-hour / 1-day (full since 2025-11-24); KuCoin 1-min / 5-min / 15-min / 1-hour / 1-day (full). ≈ 620k rows, ≈ 65 MB.
- Pionex klines: public, no auth, no CORS, paginate backwards with `endTime` (omit it for the newest page — a value at/after now is rejected), 500 per page, 10,000-candle cap per interval.
- Binance and Bybit are geo-blocked from the user's location. Gate caps at 10,000 points. CoinGecko: daily-only beyond 90 days, CORS allowed; remains the daily fallback.

## Architecture

### 1. Candle storage and server route

**Local history store (built 2026-09-12, before the tab).** MON-tracker has its own Docker Postgres stack at `infra/local-db/` (`mon-tracker-local-db`, `postgres:17-alpine`, host port 5460, user/db `mon`, password `localdev`, own volume). It follows the AIMS repos' local-db pattern but is a separate stack so no sibling repo's `db:local:reset` can touch it, and it never connects to Neon. Table `mon_candles (exchange, symbol, resolution_sec, time, open, high, low, close, volume, turnover, ingested_at)` with PK `(exchange, symbol, resolution_sec, time)`. `npm run candles:ingest` (`scripts/ingest-candles.mts`, plain `pg`) pulls KuCoin `MON-USDT` at 1min/5min/15min/1hour/1day from launch and upserts; it is incremental (resumes from the last stored candle, re-pulling that one because it may have been partial) and refuses non-localhost hosts. `npm run db:local:up|down|psql` manage the container. `MON_DATABASE_URL` in `.env.local` points the app at it.

**Route — `src/app/api/candles/route.ts`**

- `GET /api/candles?days=<1..400>`
- Resolution rule (server-side, not a query param): `days ≤ 30 → 300 s`; `≤ 90 → 900 s`; `≤ 180 → 1800 s`; else `3600 s`.
- **Source A (preferred): Postgres.** When `MON_DATABASE_URL` is set, query `mon_candles` for `exchange='pionex', symbol='MON_USDT_PERP', resolution_sec=<rule>` and `time ≥ now − days`, ordered ascending. One query, ≈ 8.6k rows, a few ms. A module-level `pg.Pool` (max 3) is created lazily on first request.
- **Source B (fallback): live Pionex proxy.** When `MON_DATABASE_URL` is unset (Coolify today) or the query throws, page Pionex `market/klines?symbol=MON_USDT_PERP&interval=<5M|15M|30M|60M>&limit=500` backwards (first page without `endTime`, then `endTime = oldest − 1` ms), sequentially with a 120 ms pause, stopping when a page is short, the oldest candle is older than `now − days`, or 20 pages (the 10k cap) are reached. ≈ 18 requests per window. Parse `klines[].{time, open, high, low, close}` strings with `Number`, drop non-finite rows, sort ascending, de-duplicate on time.
- Response `{ resolutionSec: number, source: "db" | "live", candles: number[][] }`, each candle `[timeMs, open, high, low, close]` (compact array; ≈ 8.6k candles ≈ 400 KB raw, ≈ 90 KB gzipped). `source` is shown in the tab footer.
- In-memory module cache keyed by `days` with 5-min TTL, plus `Cache-Control: public, max-age=300`.
- Validation: `days` must be an integer 1..400 → otherwise 400. Both sources failing → 502 `{ error }`.
- The dashboard's existing "don't add a database" rule in AGENTS.md is amended: the database is optional, local-first, holds only public market data, and the app must keep working without it.

### 2. Client data — `src/lib/candles.ts`

```ts
export interface Candle { time: number; open: number; high: number; low: number; close: number }
export type GridWindow = "1m" | "3m" | "6m" | "max";
export const GRID_WINDOW_DAYS: Record<GridWindow, number> = { "1m": 30, "3m": 90, "6m": 180, max: 400 };
export const RESOLUTION_FACTOR: Record<number, number> = { 300: 1.0, 900: 1.17, 1800: 1.30, 3600: 1.57 }; // rounds captured vs live, see Data facts
export const MON_LAUNCH_MS = Date.UTC(2025, 10, 24, 15); // 2025-11-24 15:00 UTC

export async function fetchCandles(days: number): Promise<{ resolutionSec: number; candles: Candle[] }>; // calls /api/candles?days=, expands compact rows, throws on !ok
export function candlesFromPricePoints(points: PricePoint[]): Candle[]; // fallback, o=h=l=c=price, daily spacing
```

- The tab fetches **per window** on demand (`GRID_WINDOW_DAYS[window]`) because 5m-vs-15m resolution differs by window, and caches each result in a `useRef` map for the session (same pattern as CyclesTab's timeframe cache). Switching back to a seen window does not refetch.
- `resolutionSec` and `source` are displayed in the footer ("5-minute candles · local db") and `resolutionSec` is passed to `simulateGrid` so `days` is computed correctly.

### 3. Simulator — `src/lib/grid.ts` (pure, no React)

```ts
export type GridMode = "arithmetic" | "geometric";
export interface GridParams { lower: number; upper: number; grids: number; investment: number; mode: GridMode }
export interface GridResult {
  gridProfit: number;        // USD, realized, net of nominal fees (see step 6)
  monthlyYield: number;      // gridProfit / investment / days * 30
  monthlyProfit: number;     // monthlyYield * investment
  trades: number;            // completed pairs (every sell fill = one pair)
  buys: number;              // grid buy fills (seed buys are not counted)
  tradesPerMonth: number;
  timeInRangePct: number;    // 0..100, share of candles whose close is within [lower, upper] (candle-count based, resolution-agnostic)
  maxDrawdownPct: number;    // worst peak-to-trough of equity (cash + coins*close) over candle closes, as % of peak, 0..100
  unrealizedPnl: number;     // equity_end - investment - gridProfit  (so gridProfit + unrealizedPnl = total P&L exactly)
  breakouts: number;         // candles with close outside range
  days: number;              // (lastTime − firstTime + candleMs) / 86_400_000; candleMs passed in (resolutionSec × 1000)
  levels: number[];          // grids + 1 price levels, ascending
  cashEnd: number;           // USD cash at window end
  coinsEnd: number;          // MON held at window end
}
export const GRID_FEE_RATE = 0.0005;
export function gridLevels(lower: number, upper: number, grids: number, mode: GridMode): number[];
export function simulateGrid(candles: Candle[], p: GridParams, candleMs: number, feeRate = GRID_FEE_RATE): GridResult;
```

**Fill model — one order per grid interval (mirrors Pionex spot grid):**

1. **Levels and intervals.** `L[0..grids]` ascending (`L[0] = lower`, `L[grids] = upper`). There are exactly `grids` intervals `I[k] = [L[k], L[k+1]]`, `k = 0..grids−1`. Each interval holds **exactly one** order at all times: either a **buy at `L[k]`** or a **sell at `L[k+1]`**. Per-interval quote budget `q = investment / grids`. Order quantity for interval `k` is always `coins[k] = q / L[k]` (as if bought at the interval's lower bound), so every completed pair in interval `k` earns `q × (L[k+1] − L[k]) / L[k]` gross = `q × spacing%`.

2. **Seeding.** `p0 = candles[0].open`. For each interval: if `L[k+1] > p0` the interval starts with a **sell at `L[k+1]`** (this includes the interval containing `p0`); otherwise (`L[k+1] ≤ p0`) it starts with a **buy at `L[k]`**. The coins backing the seeded sells are bought at market `p0`: `cash = investment − Σ_seeded_sells coins[k] × p0 × (1 + fee)`, `coins = Σ_seeded_sells coins[k]`. Buy orders reserve nothing; cash is only debited at fill. Cash is not floored: the seed can overspend by at most `q × spacing% + fees` (the interval containing `p0` has `p0 > L[k]`), which is the same slight overspend Pionex shows. `gridProfit = 0` at seed time.

3. **Path.** Each candle, **including `candles[0]`**, is walked as segments: green (`close ≥ open`) → `open→low`, `low→high`, `high→close`; red → `open→high`, `high→low`, `low→close`. A downward segment `a→b` (`a > b`) fills every **buy** whose level `L[k]` satisfies `b ≤ L[k] < a`, processed from highest to lowest level. An upward segment `a→b` (`a < b`) fills every **sell** whose level `L[k+1]` satisfies `a < L[k+1] ≤ b`, processed from lowest to highest. Touching a level fills it; a segment never fills an order sitting exactly at its start price (that price was already the end of the previous segment). Orders placed during a segment sit on the far side of travel and so cannot fill in the same segment; they can fill in a later segment of the same candle (buy at low, sell at high on a green day).

4. **Buy fill in interval `k`** (at `L[k]`): `cash −= q × (1 + fee)`; `coins += coins[k]`; the interval's order becomes a **sell at `L[k+1]`**.

5. **Sell fill in interval `k`** (at `L[k+1]`): `cash += coins[k] × L[k+1] × (1 − fee)`; `coins −= coins[k]`; `trades += 1`; the interval's order becomes a **buy at `L[k]`**.

6. **Pair profit** booked on every sell fill, using nominal legs regardless of whether the coins came from a seed buy at `p0` or a grid buy at `L[k]`:
   `gridProfit += coins[k] × (L[k+1] − L[k]) − fee × coins[k] × (L[k] + L[k+1])`.
   The difference between the seed's actual cost (`p0`) and the nominal `L[k]` flows into `unrealizedPnl`, never into `gridProfit`. This is why `unrealizedPnl` is defined as a residual: `equity_end − investment − gridProfit`.

7. **Boundaries.** Because orders live in intervals, the top interval's sell at `L[grids]` flips to a buy at `L[grids−1]` and the bottom interval's buy at `L[0]` flips to a sell at `L[1]` automatically. No special cases.

8. **Out of range.** Prices outside `[lower, upper]` fill nothing; the bot waits. `breakouts` counts candles whose close is outside; `timeInRangePct = 100 × (candles − breakouts) / candles` (candle-count based, resolution-agnostic).

9. **Drawdown.** After each candle, `equity = cash + coins × close`. `maxDrawdownPct = 100 × max over t of (peak_t − equity_t) / peak_t`, where `peak_t` is the running max of equity (seeded with `investment`).

**Worked check (used by the sawtooth test):** arithmetic, `lower = 0.010`, `upper = 0.020`, `grids = 10` → `L = 0.010, 0.011, …, 0.020`, `q = investment / 10`. Every candle `open = close = 0.0135`, `low = 0.013`, `high = 0.014`. Seed at `0.0135`: intervals 0..2 (`L[k+1] ≤ 0.0135`) hold buys at `0.010, 0.011, 0.012`; intervals 3..9 hold sells at `0.014 … 0.020`. Day 1: `0.0135→0.013` fills no buy (lowest sell-side interval is 3; its order is a sell); `0.013→0.014` fills the sell at `0.014` → 1 pair, interval 3 now buys at `0.013`; `0.014→0.0135` nothing. Day 2+: `0.0135→0.013` fills the buy at `0.013` → sell at `0.014`; `0.013→0.014` fills it → 1 pair. **Total pairs = number of candles**, each worth `coins[3] × 0.001 − fee × coins[3] × 0.027` with `coins[3] = q / 0.013`.

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
- `grids` ∈ `{10, 15, 20, 25, 30, 40, 50, 60, 80, 100}` (user asked to see every grid count up to 100 on the board).
- `spacingPct` for a candidate is the **minimum** interval spacing, `(L[grids] − L[grids−1]) / L[grids−1]` for arithmetic (top interval is the tightest), constant for geometric. `profitPerGridPct = spacingPct − 2 × fee`.
- Constraints (Pionex spot grid): `spacingPct ≥ 3 × 2 × fee` (= 0.3%) so each pair nets profit; per-grid budget at nominal investment must be ≥ `MIN_ORDER_USDT` (5). Nominal investment = 1000 for simulation; yield is linear in investment so one run per (lower, upper, grids).
- Filter: `timeInRangePct ≥ 90` **and** `monthlyYield > 0` (a flat or bleeding window can produce zero pairs; never divide by a non-positive yield) **and** `buys ≥ 0.5 × trades` — in a monotone rise the seeded sells fill one after another and book a positive yield with no grid buy at all; that is trend profit, not grid profit, and such windows must yield no candidate.
- Rank by `monthlyYield` desc (raw). Raw yield favours wide spacing, so the top of the raw list is six near-identical 10-grid ranges; the board is a comparison, so keep only the best range **per grid count**. Best = highest-yield entry of that list. Alternatives = all remaining entries (one row per grid count, up to 9).
- `requiredInvestment = ceil(goalUsd / (monthlyYield × factor))` where `factor = RESOLUTION_FACTOR[resolutionSec]` is passed in `OptimizeInput.factor` (default 1). `Candidate` also carries `liveMonthlyYield = monthlyYield × factor` for display.
- Cost: ≈ 25 ranges × 12 grid counts = 300 simulations × up to 52k candles × 3 segments ≈ 50 M segment steps worst case (6M window). Each step is a couple of comparisons unless a level is crossed, so this stays around 1 s in JS. Run it inside `useMemo`; if it measurably janks, move to a Web Worker (noted, not planned).
- `requiredInvestment = goalUsd / monthlyYield`, rounded up to whole USD.
- Check `requiredInvestment / grids ≥ MIN_ORDER_USDT`; if not, add warning "Investment too small for N grids — raise goal or reduce grids".

**Warnings produced:**
- No candidate passed the 90% in-range filter (very trending window).
- Fallback data in use (candles without intraday range → fills underestimated).
- Current price within 5% of lower or upper.
- Over budget.
- Backtest window shorter than 30 days.

### 5. UI — direction C "Comparison Board" (user's pick from three mockups, 2026-09-12)

Files: `src/components/tabs/GridAnalystTab.tsx` (state, fetch, memo, layout) composed from `src/components/grid/GridInputs.tsx`, `CandidateBoard.tsx`, `CandidateTicket.tsx`, `GridChart.tsx`.

Props into the tab: `priceData: PricePoint[]` (fallback source), `currentPrice: number | null` (header price; the tab prefers the last candle close when candles are loaded).

Settings (persisted under `mon.grid`, type-guarded):
```ts
interface GridSettings { goalUsd: number; maxInvestment: number | null; window: GridWindow; mode: GridMode }
DEFAULT_GRID_SETTINGS = { goalUsd: 500, maxInvestment: null, window: "3m", mode: "arithmetic" }
```

Layout, top to bottom (mobile-first single column; the board rows collapse to a 3-column grid under 820 px):

1. **Inputs card** (`GridInputs`) — goal (number input, USD), max investment (number input, blank = none), window pills 1M / 3M / 6M / MAX, mode pills ARITH / GEO. All controls `min-h-[44px]`, labelled, ids stable.
2. **Board** (`CandidateBoard`) — header "Candidates that reach $<goal> / month" + one line "<tested> configurations tested, <kept> kept price in range ≥ 90 %". Then up to 6 rows (best + 5 alternatives), rank 1 first. Each row: rank · range `lower – upper` with a thin bar showing where the current price sits inside it · yield / month with a bar relative to rank 1 · grid count · in-range % and max drawdown · required investment in green ("to earn $goal"). Rows are `role="button"`, keyboard-selectable, `aria-pressed` marks the selected one; rank 1 selected by default. Selecting a row re-runs `simulateGrid` at that row's required investment for the ticket.
3. **Ticket** (`CandidateTicket`) — "Candidate N · what to type into Pionex": the four fields large (Investment USDT, Lower, Upper, Grids) in Pionex's order, then "Expected $X / month · Y % yield · Z trades / month", then the warning lines (amber) from the optimizer plus "approximate: daily fallback data" when `source` is the CoinGecko fallback, and "hourly candles capture ~64 % of live fills — shown figures are corrected × 1.57" when a factor ≠ 1 applies.
4. **Chart** (`GridChart`) — `ChartFrame` + recharts `ComposedChart`: close price `Line`, shaded `Area` from a `[lower, upper]` tuple (read from `payload[0].payload`, per AGENTS.md), grid `ReferenceLine`s thinned to ≤ 30, dashed current-price line. Candles are down-sampled to ≤ 600 points for drawing (every n-th close); the simulation always uses the full set.
5. Footer: "Backtest on Pionex MON_USDT_PERP <5|15|30|60>-minute candles · <local db | live> · fee 0.05 %/side · calibrated on one live-bot day · past range ≠ future range".

States: loading → inputs enabled, board shows 3 skeleton rows, chart skeleton. Fetch error → fallback candles from `priceData` with the daily-fallback warning; never a blank tab. `currentPrice` null and no candles → board says "Waiting for price data".

### 6. Wiring

- `types.ts`: `TabId` adds `"grid"`; `Candle`/`GridWindow` live in `candles.ts`, grid types in `grid.ts`.
- `constants.ts`: `TABS` adds `{ id: "grid", label: "⚡ Grid Analyst" }` after backtest.
- `dashboard/page.tsx`: `TAB_IDS` adds `"grid"`; renders `<GridAnalystTab priceData={priceData} currentPrice={currentPrice} />`.
- AGENTS.md / README: add tab description, `/api/candles` route, `mon.grid` storage key, the local-db stack and ingest commands, `MON_DATABASE_URL`, and the data-source note (KuCoin spot candles; Pionex API has no MON spot pair). Amend the "Don't add a database" rule as described in section 1.

### 7. Testing

Add **vitest** (devDependency, `npm test` script, `vitest.config.ts` with `@` alias). Tests in `src/lib/__tests__/`:

**grid.test.ts**
- `gridLevels` arithmetic: equal differences, `levels.length === grids + 1`, endpoints exact.
- `gridLevels` geometric: equal ratios.
- Sawtooth from the worked check in section 3 (`lower 0.010`, `upper 0.020`, `grids 10`, every candle `o = c = 0.0135`, `l = 0.013`, `h = 0.014`): `trades === candles.length`, `gridProfit === candles.length × (coins3 × 0.001 − fee × coins3 × 0.027)` with `coins3 = (investment/10) / 0.013` (within 1e-9), and `cashEnd`, `coinsEnd` match hand-derived values: `coinsEnd = Σ_{k=4..9} q/L[k]`, `cashEnd = investment − (1+fee) × 0.0135 × Σ_{k=3..9} q/L[k] + N × coins3 × 0.014 × (1−fee) − (N−1) × q × (1+fee)` (within 1e-9), and `gridProfit + unrealizedPnl === (cashEnd + coinsEnd × 0.0135) − investment`.
- Seeding at a level: `feeRate = 0`, `p0 = L[k]`, single candle `o = L[k], l = L[k−1], h = L[k], c = L[k]`. Correct seeding (interval `k−1` holds a buy because `L[k] ≤ p0`) fills that buy at `L[k−1]` and the resulting sell at `L[k]` → `trades === 1` and `unrealizedPnl === 0` (all coins were bought at nominal cost). A wrong seeding (sell at `L[k]` in interval `k−1`) would give the same `trades` but `unrealizedPnl === −(L[k] − L[k−1]) × coins[k−1]`.
- Candles entirely above `upper`: zero trades, `timeInRangePct = 0`, `breakouts = candles.length`.
- Flat candles (o=h=l=c inside range) with `feeRate = 0`: zero trades, `maxDrawdownPct === 0`, `unrealizedPnl === 0`. (At the default fee the seed buys cost fees, so drawdown is small but positive; that is expected, not a bug.)
- Fees: with `feeRate = 0`, profit equals gross; with default fee, profit strictly lower.

**candles.test.ts**
- `fetchCandles` expands compact `[t,o,h,l,c]` rows into `Candle` objects and rejects on non-OK.
- `candlesFromPricePoints` sets o=h=l=c.

**optimize.test.ts**
- Synthetic ranging market: `best` is non-null, `lower < currentPrice < upper`, `requiredInvestment × monthlyYield ≈ goalUsd`.
- **Live-bot calibration test** (fixture: Pionex perp 5-minute candles for 2026-09-11 06:10 → 09-12 05:40 UTC, 283 rows, checked into `src/lib/__tests__/fixtures/live-bot-5m.json`): `simulateGrid` with `lower 0.023, upper 0.030, grids 80, investment 23719.89, arithmetic, candleMs 300000` must report `trades === 85` and `gridProfit` within 0.01 of 67.83 (values measured 2026-09-12 with the reference implementation; real bot: 83 rounds, 78.44). A second fixture at 1-hour (23 rows) must give `trades === 53`. These pin the fill model exactly; a change in either number means the model changed.
- With `maxInvestment` below required: `overBudget === true`, `achievableMonthly === maxInvestment × monthlyYield`.
- Strongly trending synthetic data: `best === null` and a warning is present.

**Route** — no unit test; verified manually with curl: with `MON_DATABASE_URL` set, `/api/candles?days=30` returns `source: "db"`, ascending, `resolutionSec: 300`; `days=90` → 900; `days=180` → 1800; `days=400` → 3600; with the variable unset, `source: "live"`; bad `days` → 400.

**Ingest** — `scripts/ingest-candles.mts` is verified by running it and checking row counts and first/last timestamps per resolution against KuCoin (done 2026-09-12); a second run must upsert only the tail.

## Out of scope (v1)

- Futures grid, leverage, long/short modes.
- 1-minute backtests (KuCoin has them; 5× the data for marginal gain).
- Resolution as a user control (fixed by window in v1).
- Auto-creating the bot via API (Pionex has no public grid-bot endpoint).
- AI commentary button.
- Trailing / infinity grid variants.

## Risks

- **MON spot not on Pionex API.** If the user cannot actually open a MON spot grid on Pionex, the numbers are still valid for any exchange's spot grid on MON, but the "Pionex order" framing should be softened. Flag in UI footer.
- **Candle path approximation.** Five-minute candles still miss sub-5-minute whipsaws; the live-bot test bounds the error at ±35 %. The CoinGecko daily fallback is far worse and is labelled as such.
- **KuCoin vs Pionex liquidity.** KuCoin's MON book may be thinner or thicker than Pionex's; highs and lows can differ by a tick. Immaterial at 0.3 % grid spacing.
- **Payload and compute.** 6M at 5-minute is ≈ 52k candles (≈ 500 KB gzipped) and ≈ 1 s of optimizer time. Max window is served at 15-minute to stay in that envelope.
- **Range percentiles** from a trending window may produce a range that the price will leave soon; the 90% in-range filter and the "near edge" warning mitigate but do not eliminate this.
