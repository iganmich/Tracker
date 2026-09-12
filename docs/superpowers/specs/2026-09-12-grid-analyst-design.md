# Grid Analyst — Design Spec

**Date:** 2026-09-12
**Status:** Spec review passed (2 rounds); data source revised to KuCoin 5-minute candles after live-bot calibration; awaiting user review

## Goal

Add a fifth dashboard tab, **⚡ Grid Analyst**, that turns a monthly USD profit goal into a concrete Pionex **Spot Grid** bot configuration for MON: investment amount, lower price, upper price, grid count. Parameters are chosen by brute-force backtest against real MON daily candles.

## Decisions already made

| Decision | Choice | Why |
|---|---|---|
| Grid product | Pionex Spot Grid | No leverage, no liquidation, simplest parameter set |
| Goal metric | Grid profit only (realized pair profit) | Matches Pionex "Grid Profit"; independent of where price ends |
| Algorithm | Brute-force backtest search | Deterministic, explainable, fast enough client-side |
| Budget cap | Optional "max investment" input | Tells user when a goal is unrealistic |
| Price history | **KuCoin spot `MON-USDT` 5-minute candles** via paginating server proxy (15-minute for the Max window) | Only source found with real spot OHLC at minute resolution back to launch day. KuCoin last price matches Pionex within 0.2%. MON/USDT spot grid exists in the Pionex app (user has one running) but Pionex's public API exposes only the perp, capped at 10,000 candles per interval |
| Fallback | CoinGecko daily series already loaded by the dashboard | high = low = close, daily only, flagged as approximate |
| Windows | 3M (90 days ≈ 25,900 five-minute candles), 6M (180 days ≈ 51,800), Max (all from launch 2025-11-24, ≈ 28,000 fifteen-minute candles) | 12M not possible — MON launched 2025-11-24 15:00 UTC. Resolution is chosen by window: 5m for 3M/6M, 15m for Max (keeps the largest payload ≈ 52k candles) |
| Fees | 0.05% per side (Pionex spot maker/taker) | Constant, `GRID_FEE_RATE` |

## Data facts (verified 2026-09-12)

- **KuCoin** `GET https://api.kucoin.com/api/v1/market/candles?type=5min&symbol=MON-USDT&startAt=<s>&endAt=<s>` → up to 1,500 candles per request, newest first, rows `[time_s, open, high, low, close, volume, turnover]` as strings. Types `1min`, `5min`, `15min`, `1hour` all reach back to **2025-11-24 15:00 UTC** (launch day) with no depth cap. Public, no auth, **no CORS header** (server proxy required). Minutes with zero trades are omitted (gaps), which the simulator tolerates. Last price 0.02329 vs Pionex 0.02333.
- **Pionex** klines: only `MON_USDT_PERP`, hard cap of 10,000 candles per interval (5M → 35 days, 15M → 104 days, 60M → full history). Paginates backwards with `endTime`. No CORS. Kept only as documentation; not used by the tab.
- **Binance** and **Bybit** are geo-blocked from the user's location (and possibly from the Hetzner server); not used. **Gate** caps at 10,000 points. **OKX** lists MON-USDT but its candle history was not verified.
- **CoinGecko** free tier: daily back to launch, hourly 90 days, 5-min 1 day, hard cap 365 days. CORS allowed. Used only as the daily fallback.
- **Why minute candles:** the user's live Pionex bot (0.023–0.030, 80 grids, 23,720 USDT) completed 83 rounds in its first 24 h, with round trips as short as 2 minutes (buy 08:58, sell 09:00). A daily candle walked open→low→high→close simulates ≈ 25 of those rounds, hourly ≈ 56. Five-minute candles capture most of them.
- **Per-pair calibration (Pionex transaction #81):** buy 298.50 USDT at 0.02335, sell at 0.02344, fees 0.1487 + 0.1492, Pionex profit **0.8482**. Spec formula: `coins = 298.50 / 0.02335 = 12,784`; `12,784 × 0.00009 − 0.0005 × 12,784 × (0.02335 + 0.02344) = 1.1506 − 0.2991 = 0.8515`. Within 0.4 % — the profit model in section 3 is correct; remaining error comes only from fill counting.
- **Bot-level calibration (first 23.5 h):** grid profit +78.44 USDT = +0.33 %/day (123 % annualized), 83 rounds. The section 7 optimizer test uses this as a sanity bound: a simulation of the same parameters over the same day on 5-minute candles should land within ±35 % of 83 rounds.

## Architecture

### 1. Candle storage and server route

**Local history store (built 2026-09-12, before the tab).** MON-tracker has its own Docker Postgres stack at `infra/local-db/` (`mon-tracker-local-db`, `postgres:17-alpine`, host port 5460, user/db `mon`, password `localdev`, own volume). It follows the AIMS repos' local-db pattern but is a separate stack so no sibling repo's `db:local:reset` can touch it, and it never connects to Neon. Table `mon_candles (exchange, symbol, resolution_sec, time, open, high, low, close, volume, turnover, ingested_at)` with PK `(exchange, symbol, resolution_sec, time)`. `npm run candles:ingest` (`scripts/ingest-candles.mts`, plain `pg`) pulls KuCoin `MON-USDT` at 1min/5min/15min/1hour/1day from launch and upserts; it is incremental (resumes from the last stored candle, re-pulling that one because it may have been partial) and refuses non-localhost hosts. `npm run db:local:up|down|psql` manage the container. `MON_DATABASE_URL` in `.env.local` points the app at it.

**Route — `src/app/api/candles/route.ts`**

- `GET /api/candles?days=<1..400>`
- Resolution rule (server-side, not a query param): `days ≤ 180 → 300 s`, else `900 s`.
- **Source A (preferred): Postgres.** When `MON_DATABASE_URL` is set, query `mon_candles` for `exchange='kucoin', symbol='MON-USDT', resolution_sec=<rule>` and `time ≥ now − days`, ordered ascending. One query, ~50k rows worst case, ≈ 50 ms locally. A module-level `pg.Pool` (max 3) is created lazily on first request.
- **Source B (fallback): live KuCoin proxy.** When `MON_DATABASE_URL` is unset (Coolify today) or the query throws, page KuCoin `market/candles` backwards from `now` in `1500 × candleSeconds` windows via `startAt`/`endAt`, sequentially, stopping at `MON_LAUNCH_S = 1763967600` (2025-11-24 15:00 UTC) or an empty page. 3M ≈ 18 requests, 6M ≈ 35, Max (15min) ≈ 19. Parse rows `[time_s, open, close, high, low, volume, turnover]` (note KuCoin's o-c-h-l order) with `Number`, drop non-finite rows, sort ascending, de-duplicate on time.
- Response `{ resolutionSec: number, source: "db" | "live", candles: number[][] }`, each candle `[timeMs, open, high, low, close]` (compact array; 52k candles ≈ 2.5 MB raw, ≈ 500 KB gzipped). `source` is shown in the tab footer.
- In-memory module cache keyed by `days` with 5-min TTL, plus `Cache-Control: public, max-age=300`.
- Validation: `days` must be an integer 1..400 → otherwise 400. Both sources failing → 502 `{ error }`.
- The dashboard's existing "don't add a database" rule in AGENTS.md is amended: the database is optional, local-first, holds only public market data, and the app must keep working without it.

### 2. Client data — `src/lib/candles.ts`

```ts
export interface Candle { time: number; open: number; high: number; low: number; close: number }
export type GridWindow = "3m" | "6m" | "max";
export const GRID_WINDOW_DAYS: Record<GridWindow, number> = { "3m": 90, "6m": 180, max: 400 };
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

8. **Out of range.** Prices outside `[lower, upper]` fill nothing; the bot waits. `breakouts` counts candles whose close is outside; `timeInRangePct = 100 × (days − breakouts) / days`.

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
- `grids` ∈ `{10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 120, 150}`.
- `spacingPct` for a candidate is the **minimum** interval spacing, `(L[grids] − L[grids−1]) / L[grids−1]` for arithmetic (top interval is the tightest), constant for geometric. `profitPerGridPct = spacingPct − 2 × fee`.
- Constraints (Pionex spot grid): `spacingPct ≥ 3 × 2 × fee` (= 0.3%) so each pair nets profit; per-grid budget at nominal investment must be ≥ `MIN_ORDER_USDT` (5). Nominal investment = 1000 for simulation; yield is linear in investment so one run per (lower, upper, grids).
- Filter: `timeInRangePct ≥ 90` **and** `monthlyYield > 0` (a flat or bleeding window can produce zero pairs; never divide by a non-positive yield).
- Rank by `monthlyYield` desc. Best = first. Alternatives = next 5.
- Cost: ≈ 25 ranges × 12 grid counts = 300 simulations × up to 52k candles × 3 segments ≈ 50 M segment steps worst case (6M window). Each step is a couple of comparisons unless a level is crossed, so this stays around 1 s in JS. Run it inside `useMemo`; if it measurably janks, move to a Web Worker (noted, not planned).
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
5. Footer note: "Backtest on KuCoin MON/USDT {5|15}-minute candles · Pionex fee 0.05%/side · profit-per-grid model matches Pionex to <1% · past range ≠ future range".

Loading: skeleton via `ChartFrame loading`; result card shows "—" placeholders. Error: fallback to CoinGecko candles and a warning line, never a blank tab.

Computation: `useMemo(() => optimizeGrid(...), [windowCandles, goalUsd, maxInvestment, mode, currentPrice])`. When `currentPrice` is `null` or `windowCandles` is empty the memo returns `null` and the result card shows "—" placeholders with no warnings. When `overBudget` is true the large Investment field still shows `requiredInvestment` (what the goal actually needs), the over-budget warning names `maxInvestment`, and the expected-monthly-profit stat shows `achievableMonthly` labelled "at your max investment". Selected alternative re-simulated at its required investment for display only.

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
- **Live-bot sanity bound** (fixture: KuCoin 5-minute candles for 2026-09-11 06:08 → 09-12 05:40 UTC, checked into `src/lib/__tests__/fixtures/`): `simulateGrid` with `lower 0.023, upper 0.030, grids 80, investment 23719.89, arithmetic` must report `trades` within ±35 % of 83 and `gridProfit` within ±35 % of 78.44. This pins the fill-counting accuracy that the whole tool depends on.
- With `maxInvestment` below required: `overBudget === true`, `achievableMonthly === maxInvestment × monthlyYield`.
- Strongly trending synthetic data: `best === null` and a warning is present.

**Route** — no unit test; verified manually with curl: with `MON_DATABASE_URL` set, `/api/candles?days=90` returns `source: "db"`, ascending, `resolutionSec: 300`; `days=400` returns `resolutionSec: 900`; with the variable unset, `source: "live"`; bad `days` → 400.

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
