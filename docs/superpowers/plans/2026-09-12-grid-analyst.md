# Grid Analyst Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fifth dashboard tab, ⚡ Grid Analyst, that turns a monthly USD profit goal into a ranked board of Pionex spot-grid configurations (range, grid count, required investment), backtested on Pionex MON_USDT_PERP candles from the local Postgres.

**Architecture:** Pure TypeScript simulator + optimizer in `src/lib/grid.ts` (no React), candle types/helpers in `src/lib/candles.ts`, a server route `/api/candles` that reads Postgres when `MON_DATABASE_URL` is set and otherwise proxies Pionex live, and a client tab composed of four small components. Spec: `docs/superpowers/specs/2026-09-12-grid-analyst-design.md` — read sections 3, 4 and 5 before the matching tasks; the spec is the authority on the fill model.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, TypeScript strict, Tailwind v4, recharts 3, `pg`, vitest.

---

## Read this first — repo facts every task depends on

- **Repo:** `/Users/Xamadu/IGANMICH/MON-tracker`. Conventions in `AGENTS.md` (read it). Path alias `@/*` → `src/*`.
- **The working tree has the user's own uncommitted changes** in `src/components/ChartTooltip.tsx`, `src/components/tabs/CyclesTab.tsx`, `src/lib/analytics.ts`, `src/lib/prices.ts`, `src/lib/types.ts`. **Never `git add -A` or `git add .`.** Stage only the files your task names. Never revert, reformat or "fix" those five files unless your task explicitly modifies one of them (Task 6 touches `types.ts` — stage that file only after confirming your one-line change is the only hunk you intend to commit; use `git add -p src/lib/types.ts` and accept only your hunk).
- **Network on this Mac:** IPv6 is broken; Node fetch and npm hang. Prefix every `npm install` and every Node script that fetches with `NODE_OPTIONS='--no-network-family-autoselection --dns-result-order=ipv4first'`. `npm run candles:ingest` already does this. `next dev` needs it too if the live Pionex fallback is exercised.
- **Local DB:** container `mon-tracker-local-db-postgres-1`, `postgresql://mon:localdev@localhost:5460/mon`, table `mon_candles(exchange, symbol, resolution_sec, time, open, high, low, close, volume, turnover, ingested_at)`. Pionex rows: `exchange='pionex', symbol='MON_USDT_PERP'`, resolutions 60/300/900/1800/3600/14400/86400. `.env.local` already contains `MON_DATABASE_URL`.
- **Dev server** may already be running on :3000 (started earlier from this repo). Check with `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/dashboard` before starting another.
- **Commit style:** conventional commits, end the message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. **Execution note (2026-09-12):** implementer subagents run in parallel on disjoint files and do not commit; the lead stages the task's listed files and commits after review, using the commands in each task's commit step.
- **Design tokens:** `C` in `src/lib/constants.ts` (`C.green`, `C.yellow`, `C.red`, `C.blue`, `C.purple`, `C.muted`, `C.surface`, `C.border`, `C.font`). Tailwind classes for layout; inline `style` with `C.*` for dynamic color. Touch targets `min-h-[44px]`. Tabular nums are global.
- **Recharts rule (AGENTS.md):** in tooltips read `payload[0].payload`, never `payload[0].value`, because the `[lower, upper]` tuple of an `<Area>` lands in `.value`.

## File map

| File | Responsibility | Task |
|---|---|---|
| `vitest.config.ts`, `package.json` (test script) | test runner | 1 |
| `src/lib/candles.ts` | `Candle`, `GridWindow`, window→days, resolution factors, `fetchCandles`, `candlesFromPricePoints`, `downsample` | 2 |
| `src/lib/__tests__/candles.test.ts` | tests for the above | 2 |
| `src/lib/grid.ts` | `gridLevels`, `simulateGrid`, `optimizeGrid`, `GridSettings` + guard, `minSpacingPct` | 3, 4 |
| `src/lib/__tests__/grid.test.ts` | simulator tests incl. live-bot calibration | 3 |
| `src/lib/__tests__/optimize.test.ts` | optimizer tests | 4 |
| `src/lib/server/candles-db.ts` | Postgres query (lazy `pg.Pool`) | 5 |
| `src/lib/server/candles-pionex.ts` | live Pionex pagination | 5 |
| `src/app/api/candles/route.ts` | GET handler, validation, cache, db→live fallback | 5 |
| `next.config.ts` | `serverExternalPackages: ["pg"]` | 5 |
| `src/lib/types.ts`, `src/lib/constants.ts`, `src/app/dashboard/page.tsx` | register the tab | 6 |
| `src/components/grid/GridInputs.tsx` | inputs card | 6 |
| `src/components/grid/CandidateBoard.tsx` | ranked, selectable rows | 7 |
| `src/components/grid/CandidateTicket.tsx` | four Pionex fields + expected + warnings | 7 |
| `src/components/grid/GridChart.tsx` | price + range band + grid lines | 8 |
| `src/components/tabs/GridAnalystTab.tsx` | state, fetch, memo, composition | 9 |
| `AGENTS.md`, `README.md` | docs | 10 |

Dependency order: 1 → {2, 3→4, 5, 6} in parallel → {7, 8} in parallel (need 2, 3, 4, 6) → 9 → 10.

---

### Task 1: Vitest setup

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (scripts)
- Create: `src/lib/__tests__/smoke.test.ts`

- [ ] **Step 1: Install vitest**

Run: `NODE_OPTIONS='--no-network-family-autoselection --dns-result-order=ipv4first' npm install -D vitest --no-audit --no-fund`
Expected: `added N packages`, and `ls node_modules/.bin/vitest` exists.

- [ ] **Step 2: Create the config**

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
```

- [ ] **Step 3: Add the script**

In `package.json` `scripts`, add `"test": "vitest run"` and `"test:watch": "vitest"`. Do not touch other scripts.

- [ ] **Step 4: Smoke test**

```ts
// src/lib/__tests__/smoke.test.ts
import { describe, expect, it } from "vitest";
import { C } from "@/lib/constants";

describe("vitest wiring", () => {
  it("resolves the @ alias", () => {
    expect(C.green).toBe("#00e5a0");
  });
});
```

- [ ] **Step 5: Run**

Run: `npm test`
Expected: `1 passed`.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts package.json package-lock.json src/lib/__tests__/smoke.test.ts
git commit -m "chore: add vitest

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `src/lib/candles.ts`

**Files:**
- Create: `src/lib/candles.ts`
- Test: `src/lib/__tests__/candles.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/__tests__/candles.test.ts
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

  it("fetchCandles rejects on a non-OK response and expands rows on success", async () => {
    const g = globalThis as { fetch?: typeof fetch };
    const original = g.fetch;
    g.fetch = (async () => ({ ok: false, status: 502 })) as unknown as typeof fetch;
    await expect(fetchCandles(30)).rejects.toThrow("candles 502");
    g.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ resolutionSec: 300, source: "db", candles: [[1, 2, 3, 0.5, 2.5]] }) })) as unknown as typeof fetch;
    await expect(fetchCandles(30)).resolves.toEqual({ resolutionSec: 300, source: "db", candles: [{ time: 1, open: 2, high: 3, low: 0.5, close: 2.5 }] });
    g.fetch = original;
  });

  it("downsamples to at most n points keeping first and last", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ time: i, open: i, high: i, low: i, close: i }));
    const out = downsample(rows, 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out[0].time).toBe(0);
    expect(out[out.length - 1].time).toBe(999);
    expect(downsample(rows.slice(0, 10), 100)).toHaveLength(10);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- candles`
Expected: FAIL, cannot resolve `@/lib/candles`.

- [ ] **Step 3: Implement**

```ts
// src/lib/candles.ts
import type { PricePoint } from "./types";

export interface Candle {
  time: number; // ms, candle open time (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
}

export type GridWindow = "1m" | "3m" | "6m" | "max";

export const GRID_WINDOW_DAYS: Record<GridWindow, number> = {
  "1m": 30,
  "3m": 90,
  "6m": 180,
  max: 400,
};

export const GRID_WINDOW_LABEL: Record<GridWindow, string> = {
  "1m": "1M",
  "3m": "3M",
  "6m": "6M",
  max: "MAX",
};

/** MON launch: 2025-11-24 15:00 UTC (first Pionex/KuCoin trade). */
export const MON_LAUNCH_MS = Date.UTC(2025, 10, 24, 15);

/**
 * Finest Pionex resolution whose 10,000-candle history covers the window
 * (5-min ≈ 35 d, 15-min ≈ 104 d, 30-min ≈ 208 d, 1-hour = full). Mirrored in
 * src/app/api/candles/route.ts — keep both in sync.
 */
export function resolutionForDays(days: number): number {
  if (days <= 30) return 300;
  if (days <= 90) return 900;
  if (days <= 180) return 1800;
  return 3600;
}

/**
 * Share of live grid rounds the fill model captures at each resolution,
 * measured against the user's live Pionex bot on 2026-09-11/12
 * (5-min 85/83, 15-min 71/83, 30-min 64/83, 1-hour 53/83). Used to correct
 * yields for sizing; see spec "Data facts".
 */
export const RESOLUTION_FACTOR: Record<number, number> = {
  300: 1.0,
  900: 1.17,
  1800: 1.3,
  3600: 1.57,
  86400: 3.3, // CoinGecko daily fallback — rough, flagged in the UI
};

export type CandleSource = "db" | "live" | "fallback";

export interface CandleSet {
  resolutionSec: number;
  source: CandleSource;
  candles: Candle[];
}

interface CandleResponse {
  resolutionSec: number;
  source: "db" | "live";
  candles: number[][];
}

export function expandCandles(rows: number[][]): Candle[] {
  return rows.map(([time, open, high, low, close]) => ({ time, open, high, low, close }));
}

export async function fetchCandles(days: number): Promise<CandleSet> {
  const res = await fetch(`/api/candles?days=${days}`);
  if (!res.ok) throw new Error(`candles ${res.status}`);
  const json = (await res.json()) as CandleResponse;
  return {
    resolutionSec: json.resolutionSec,
    source: json.source,
    candles: expandCandles(json.candles),
  };
}

/** Daily CoinGecko points → flat candles (o = h = l = c). Fallback only. */
export function candlesFromPricePoints(points: PricePoint[]): Candle[] {
  return points.map((p) => {
    const t = new Date(p.date).getTime();
    return { time: t, open: p.price, high: p.price, low: p.price, close: p.price };
  });
}

/** Keep at most `n` candles for drawing (every k-th, always first and last). */
export function downsample(candles: Candle[], n: number): Candle[] {
  if (candles.length <= n) return candles;
  const step = Math.ceil(candles.length / n);
  const out: Candle[] = [];
  for (let i = 0; i < candles.length; i += step) out.push(candles[i]);
  const last = candles[candles.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- candles`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/candles.ts src/lib/__tests__/candles.test.ts
git commit -m "feat(grid): candle types, window/resolution mapping, helpers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Grid simulator (`src/lib/grid.ts` part 1)

Read spec section 3 first. The fill model is **one order per grid interval**; the worked check and the live-bot fixture pin it exactly.

**Files:**
- Create: `src/lib/grid.ts`
- Test: `src/lib/__tests__/grid.test.ts`
- Fixtures (already committed): `src/lib/__tests__/fixtures/live-bot-5m.json` (283 rows), `live-bot-1h.json` (23 rows). Format: `[timeMs, open, high, low, close][]`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/__tests__/grid.test.ts
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
```

`resolveJsonModule` is already on in tsconfig, so the JSON imports type-check.

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- grid`
Expected: FAIL, cannot resolve `@/lib/grid`.

- [ ] **Step 3: Implement the simulator**

```ts
// src/lib/grid.ts
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
}

export const GRID_FEE_RATE = 0.0005; // Pionex spot, per side
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
    levels, cashEnd: 0, coinsEnd: 0,
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
): GridResult {
  const { lower, upper, grids, investment, mode } = p;
  const L = gridLevels(lower, upper, grids, mode);
  if (candles.length === 0 || grids < 1 || !(lower < upper) || investment <= 0) return emptyResult(L);

  const q = investment / grids;
  const coinsPer = new Float64Array(grids);
  for (let k = 0; k < grids; k++) coinsPer[k] = q / L[k];

  // isSell[k] = 1 → interval k holds a sell at L[k+1]; 0 → a buy at L[k]
  const isSell = new Uint8Array(grids);
  let cash = investment;
  let coins = 0;
  let gridProfit = 0;
  let trades = 0;
  let buys = 0;

  // Seed at the first open: intervals whose upper bound is above p0 start as sells.
  const p0 = candles[0].open;
  for (let k = 0; k < grids; k++) {
    if (L[k + 1] > p0) {
      isSell[k] = 1;
      cash -= coinsPer[k] * p0 * (1 + feeRate);
      coins += coinsPer[k];
    }
  }

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
  for (const c of candles) {
    if (c.close >= c.open) {
      walk(c.open, c.low);
      walk(c.low, c.high);
      walk(c.high, c.close);
    } else {
      walk(c.open, c.high);
      walk(c.high, c.low);
      walk(c.low, c.close);
    }
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
  };
}

/* ---------- persisted tab settings (pure, shared by tab + tests) ---------- */

export interface GridSettings {
  goalUsd: number;
  maxInvestment: number | null;
  window: GridWindow;
  mode: GridMode;
}

export const DEFAULT_GRID_SETTINGS: GridSettings = {
  goalUsd: 500,
  maxInvestment: null,
  window: "3m",
  mode: "arithmetic",
};

export const isGridSettings = (v: unknown): v is GridSettings => {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.goalUsd === "number" &&
    (o.maxInvestment === null || typeof o.maxInvestment === "number") &&
    ["1m", "3m", "6m", "max"].includes(o.window as string) &&
    (o.mode === "arithmetic" || o.mode === "geometric")
  );
};
```

- [ ] **Step 4: Run tests**

Run: `npm test -- grid`
Expected: all pass, including the two calibration tests. **If a calibration test fails, do not adjust the expected numbers** — the reference implementation produced exactly those values on these fixtures; find the divergence in the fill rules (compare against spec section 3 step by step) and report it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/grid.ts src/lib/__tests__/grid.test.ts
git commit -m "feat(grid): Pionex-style spot grid simulator with live-bot calibration tests

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Optimizer (`src/lib/grid.ts` part 2)

Read spec section 4. Depends on Task 3.

**Files:**
- Modify: `src/lib/grid.ts` (append)
- Test: `src/lib/__tests__/optimize.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/__tests__/optimize.test.ts
import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/candles";
import { MIN_ORDER_USDT, optimizeGrid } from "@/lib/grid";

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
    const out = optimizeGrid({ candles, candleMs: H, goalUsd: 300, maxInvestment: null, currentPrice, mode: "arithmetic", factor: 1 });
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
    expect(out.alternatives.length).toBeLessThanOrEqual(5);
    // ranked by raw yield, best first
    for (const a of out.alternatives) expect(a.result.monthlyYield).toBeLessThanOrEqual(b.result.monthlyYield);
    expect(out.tested).toBeGreaterThan(out.kept);
    expect(out.kept).toBeGreaterThanOrEqual(1 + out.alternatives.length);
  });

  it("applies the resolution factor to sizing but not to ranking", () => {
    const candles = ranging();
    const currentPrice = candles[candles.length - 1].close;
    const raw = optimizeGrid({ candles, candleMs: H, goalUsd: 300, maxInvestment: null, currentPrice, mode: "arithmetic", factor: 1 });
    const corrected = optimizeGrid({ candles, candleMs: H, goalUsd: 300, maxInvestment: null, currentPrice, mode: "arithmetic", factor: 1.57 });
    expect(corrected.best!.lower).toBe(raw.best!.lower);
    expect(corrected.best!.grids).toBe(raw.best!.grids);
    expect(corrected.requiredInvestment!).toBeLessThan(raw.requiredInvestment!);
    expect(corrected.best!.liveMonthlyYield).toBeCloseTo(raw.best!.result.monthlyYield * 1.57, 12);
  });

  it("flags over-budget and reports the achievable profit", () => {
    const candles = ranging();
    const currentPrice = candles[candles.length - 1].close;
    const out = optimizeGrid({ candles, candleMs: H, goalUsd: 300, maxInvestment: 100, currentPrice, mode: "arithmetic", factor: 1 });
    expect(out.overBudget).toBe(true);
    expect(out.achievableMonthly).toBeCloseTo(100 * out.best!.liveMonthlyYield, 9);
    expect(out.warnings.some((w) => w.toLowerCase().includes("budget"))).toBe(true);
  });

  it("returns no candidate in a strongly trending market, with a warning", () => {
    const candles = trending();
    const currentPrice = candles[candles.length - 1].close;
    const out = optimizeGrid({ candles, candleMs: H, goalUsd: 300, maxInvestment: null, currentPrice, mode: "arithmetic", factor: 1 });
    expect(out.best).toBeNull();
    expect(out.requiredInvestment).toBeNull();
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it("warns when the investment is too small for the grid count", () => {
    const candles = ranging();
    const currentPrice = candles[candles.length - 1].close;
    const out = optimizeGrid({ candles, candleMs: H, goalUsd: 1, maxInvestment: null, currentPrice, mode: "arithmetic", factor: 1 });
    if (out.best && out.requiredInvestment! / out.best.grids < MIN_ORDER_USDT) {
      expect(out.warnings.some((w) => w.includes("too small"))).toBe(true);
    }
  });

  it("handles empty candles", () => {
    const out = optimizeGrid({ candles: [], candleMs: H, goalUsd: 300, maxInvestment: null, currentPrice: 0.025, mode: "arithmetic", factor: 1 });
    expect(out.best).toBeNull();
    expect(out.tested).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- optimize`
Expected: FAIL, `optimizeGrid` is not exported.

- [ ] **Step 3: Append the optimizer to `src/lib/grid.ts`**

```ts
/* ---------- optimizer ---------- */

export interface OptimizeInput {
  candles: Candle[];
  candleMs: number;
  goalUsd: number;
  maxInvestment: number | null;
  currentPrice: number;
  mode: GridMode;
  /** Resolution correction (RESOLUTION_FACTOR); multiplies yield for sizing only. */
  factor: number;
}

export interface Candidate {
  lower: number;
  upper: number;
  grids: number;
  mode: GridMode;
  result: GridResult; // simulated at NOMINAL_INVESTMENT
  spacingPct: number; // tightest interval, fraction
  profitPerGridPct: number; // spacingPct − 2 × fee
  liveMonthlyYield: number; // result.monthlyYield × factor
  requiredInvestment: number; // ceil(goal / liveMonthlyYield)
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

export const NOMINAL_INVESTMENT = 1000;
const LOWER_PCTS = [0, 2.5, 5, 10, 15];
const UPPER_PCTS = [85, 90, 95, 97.5, 100];
const GRID_COUNTS = [10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 120, 150];
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
  const { candles, candleMs, goalUsd, maxInvestment, currentPrice, mode } = input;
  const factor = input.factor > 0 ? input.factor : 1;
  const warnings: string[] = [];
  const none: OptimizeOutput = {
    best: null, requiredInvestment: null, overBudget: false, achievableMonthly: null,
    alternatives: [], warnings, tested: 0, kept: 0,
  };
  if (candles.length === 0 || !(goalUsd > 0) || !(currentPrice > 0)) {
    warnings.push("No candle data for this window.");
    return none;
  }

  const lows = candles.map((c) => c.low).sort((a, b) => a - b);
  const highs = candles.map((c) => c.high).sort((a, b) => a - b);
  const lowers = unique(LOWER_PCTS.map((p) => percentile(lows, p)));
  const uppers = unique(UPPER_PCTS.map((p) => percentile(highs, p)));

  const days = (candles[candles.length - 1].time - candles[0].time + candleMs) / DAY_MS;
  if (days < 30) warnings.push("Backtest window is shorter than 30 days — monthly figures are extrapolated.");

  let tested = 0;
  const candidates: Candidate[] = [];
  for (const lower of lowers) {
    for (const upper of uppers) {
      if (!(lower < currentPrice && currentPrice < upper)) continue;
      for (const grids of GRID_COUNTS) {
        const spacingPct = minSpacingPct(lower, upper, grids, mode);
        if (spacingPct < MIN_SPACING) continue;
        if (NOMINAL_INVESTMENT / grids < MIN_ORDER_USDT) continue;
        tested++;
        const result = simulateGrid(candles, { lower, upper, grids, investment: NOMINAL_INVESTMENT, mode }, candleMs);
        if (result.timeInRangePct < MIN_IN_RANGE_PCT || result.monthlyYield <= 0) continue;
        if (result.buys < MIN_BUY_SHARE * result.trades) continue; // trending: seed sells only
        const liveMonthlyYield = result.monthlyYield * factor;
        candidates.push({
          lower, upper, grids, mode, result, spacingPct,
          profitPerGridPct: spacingPct - 2 * GRID_FEE_RATE,
          liveMonthlyYield,
          requiredInvestment: Math.ceil(goalUsd / liveMonthlyYield),
        });
      }
    }
  }
  candidates.sort((a, b) => b.result.monthlyYield - a.result.monthlyYield);

  if (candidates.length === 0) {
    warnings.push(
      `No grid configuration worked on this window: either price left every range for > ${100 - MIN_IN_RANGE_PCT}% of the time, or profit came only from selling the starting position on a rise — the market is trending, not ranging. Try another window or wait for a range.`,
    );
    return { ...none, tested };
  }

  const best = candidates[0];
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
    alternatives: candidates.slice(1, 6),
    warnings,
    tested,
    kept: candidates.length,
  };
}
```

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: all pass. The ranging-market test must find a candidate and the trending test must return `best === null` (the plan reviewer executed this exact code against these exact tests on 2026-09-12: ranging passes; trending passes only because of the `MIN_BUY_SHARE` filter — a monotone rise fills the seeded sells and books a positive yield with zero grid buys). If either fails, print `out.warnings`, `out.tested`, `out.kept` and report; do not loosen the tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/grid.ts src/lib/__tests__/optimize.test.ts
git commit -m "feat(grid): brute-force optimizer with resolution-corrected sizing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `/api/candles` route (Postgres first, Pionex live fallback)

Read spec section 1. Independent of Tasks 2–4 (uses no client code).

**Files:**
- Create: `src/lib/server/candles-db.ts`
- Create: `src/lib/server/candles-pionex.ts`
- Create: `src/app/api/candles/route.ts`
- Modify: `next.config.ts`

- [ ] **Step 1: Postgres reader**

```ts
// src/lib/server/candles-db.ts
import { Pool } from "pg";

let pool: Pool | null = null;

function getPool(): Pool | null {
  const url = process.env.MON_DATABASE_URL;
  if (!url) return null;
  pool ??= new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 30_000 });
  return pool;
}

export const DB_EXCHANGE = "pionex";
export const DB_SYMBOL = "MON_USDT_PERP";

/** Compact rows [timeMs, open, high, low, close], ascending. `null` when no DB is configured. */
export async function queryCandlesFromDb(resolutionSec: number, days: number): Promise<number[][] | null> {
  const p = getPool();
  if (!p) return null;
  const { rows } = await p.query<{ t: number; o: number; h: number; l: number; c: number }>(
    `SELECT (extract(epoch FROM time) * 1000)::float8 AS t,
            open::float8 AS o, high::float8 AS h, low::float8 AS l, close::float8 AS c
       FROM mon_candles
      WHERE exchange = $1 AND symbol = $2 AND resolution_sec = $3
        AND time >= now() - ($4::int * interval '1 day')
      ORDER BY time ASC`,
    [DB_EXCHANGE, DB_SYMBOL, resolutionSec, days],
  );
  return rows.map((r) => [r.t, r.o, r.h, r.l, r.c]);
}
```

- [ ] **Step 2: Pionex live pager**

```ts
// src/lib/server/candles-pionex.ts
const BASE = "https://api.pionex.com/api/v1/market/klines?symbol=MON_USDT_PERP&limit=500";
const INTERVAL: Record<number, string> = { 300: "5M", 900: "15M", 1800: "30M", 3600: "60M" };
const MAX_PAGES = 20; // Pionex serves at most 10,000 candles per interval
const PAUSE_MS = 120;

interface Kline { time: number; open: string; high: string; low: string; close: string }
interface KlineResponse { result: boolean; code?: string; message?: string; data?: { klines: Kline[] } }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Compact rows [timeMs, open, high, low, close], ascending, covering the last `days` days. */
export async function fetchCandlesLive(resolutionSec: number, days: number): Promise<number[][]> {
  const interval = INTERVAL[resolutionSec];
  if (!interval) throw new Error(`unsupported resolution ${resolutionSec}`);
  const floor = Date.now() - days * 86_400_000;
  const out = new Map<number, number[]>();
  let endTime: number | null = null; // null = newest page; Pionex rejects endTime ≥ now

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${BASE}&interval=${interval}${endTime === null ? "" : `&endTime=${endTime}`}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Pionex ${res.status}`);
    const json = (await res.json()) as KlineResponse;
    if (!json.result) throw new Error(`Pionex ${json.code ?? ""}: ${json.message ?? ""}`);
    const klines = json.data?.klines ?? [];
    if (klines.length === 0) break;
    let oldest = Infinity;
    for (const k of klines) {
      const row = [k.time, Number(k.open), Number(k.high), Number(k.low), Number(k.close)];
      if (!row.every(Number.isFinite)) continue;
      if (k.time >= floor) out.set(k.time, row);
      if (k.time < oldest) oldest = k.time;
    }
    if (oldest <= floor || klines.length < 500) break;
    endTime = oldest - 1;
    await sleep(PAUSE_MS);
  }
  return [...out.values()].sort((a, b) => a[0] - b[0]);
}
```

- [ ] **Step 3: Route**

```ts
// src/app/api/candles/route.ts
import { NextRequest } from "next/server";
import { queryCandlesFromDb } from "@/lib/server/candles-db";
import { fetchCandlesLive } from "@/lib/server/candles-pionex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<number, { at: number; body: string }>();

/** Mirrors resolutionForDays() in src/lib/candles.ts — keep in sync. */
function resolutionForDays(days: number): number {
  if (days <= 30) return 300;
  if (days <= 90) return 900;
  if (days <= 180) return 1800;
  return 3600;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": status === 200 ? "public, max-age=300" : "no-store" },
  });

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("days");
  const days = Number(raw);
  if (!raw || !Number.isInteger(days) || days < 1 || days > 400) {
    return json({ error: "days must be an integer 1..400" }, 400);
  }

  const hit = cache.get(days);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return new Response(hit.body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" } });
  }

  const resolutionSec = resolutionForDays(days);
  let candles: number[][] | null = null;
  let source: "db" | "live" = "db";
  try {
    candles = await queryCandlesFromDb(resolutionSec, days);
  } catch (err) {
    console.error("[candles] db query failed, falling back to live:", err instanceof Error ? err.message : err);
    candles = null;
  }
  if (!candles || candles.length === 0) {
    source = "live";
    try {
      candles = await fetchCandlesLive(resolutionSec, days);
    } catch (err) {
      return json({ error: `candles unavailable: ${err instanceof Error ? err.message : String(err)}` }, 502);
    }
  }

  const body = JSON.stringify({ resolutionSec, source, candles });
  cache.set(days, { at: Date.now(), body });
  return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" } });
}
```

- [ ] **Step 4: Externalize `pg` for the server bundle**

`next.config.ts`:
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pg"],
};

export default nextConfig;
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in the new files (pre-existing errors elsewhere, if any, are not yours — report them, don't fix them).

- [ ] **Step 6: Verify with curl against the dev server**

If `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/dashboard` is not 200, start the server: `NODE_OPTIONS='--no-network-family-autoselection --dns-result-order=ipv4first' npm run dev > /tmp/mon-dev.log 2>&1 &` and wait for "Ready". Then:

```bash
curl -s "http://localhost:3000/api/candles?days=30"  | python3 -c "import sys,json; d=json.load(sys.stdin); c=d['candles']; print(d['resolutionSec'], d['source'], len(c), c[0], c[-1], 'ascending', all(c[i][0]<c[i+1][0] for i in range(len(c)-1)))"
curl -s "http://localhost:3000/api/candles?days=90"  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['resolutionSec'], d['source'], len(d['candles']))"
curl -s "http://localhost:3000/api/candles?days=400" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['resolutionSec'], d['source'], len(d['candles']))"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/candles?days=0"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/candles"
```
Expected: `300 db ≈8600 … ascending True`, `900 db ≈8600`, `3600 db ≈7000`, `400`, `400`.

Then the live path: `MON_DATABASE_URL= NODE_OPTIONS='--no-network-family-autoselection --dns-result-order=ipv4first' npx next dev -p 3100 > /tmp/mon-dev-live.log 2>&1 &`, wait for Ready, `curl -s "http://localhost:3100/api/candles?days=30" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['source'], len(d['candles']))"` → `live ≈8600`. Kill that server afterwards (`kill %1` or by PID).

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/candles-db.ts src/lib/server/candles-pionex.ts src/app/api/candles/route.ts next.config.ts
git commit -m "feat(api): /api/candles — local Postgres first, Pionex live fallback

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Register the tab + inputs card

Independent of Tasks 2–5 except it imports types from `src/lib/candles.ts` and `src/lib/grid.ts` (Tasks 2 and 3). If those are not merged yet when you start, do Steps 1–2 first and wait for them before Step 3.

**Files:**
- Modify: `src/lib/types.ts` (one line), `src/lib/constants.ts` (one entry), `src/app/dashboard/page.tsx`
- Create: `src/components/grid/GridInputs.tsx`
- Create: `src/components/tabs/GridAnalystTab.tsx` (placeholder; Task 9 replaces it)

- [ ] **Step 1: Types and tab list**

`src/lib/types.ts`: change `export type TabId = "unlock" | "cycles" | "levels" | "backtest";` to `export type TabId = "unlock" | "cycles" | "levels" | "backtest" | "grid";`. **This file has the user's uncommitted edits — change only this line.**

`src/lib/constants.ts`: append `{ id: "grid", label: "⚡ Grid Analyst" },` to `TABS`.

`src/app/dashboard/page.tsx`: `TAB_IDS` gets `"grid"`; import `GridAnalystTab`; render
```tsx
{activeTab === "grid" && (
  <GridAnalystTab priceData={priceData} currentPrice={currentPrice} />
)}
```
after the backtest block.

- [ ] **Step 2: Placeholder tab so the page compiles**

```tsx
// src/components/tabs/GridAnalystTab.tsx
"use client";

import type { PricePoint } from "@/lib/types";

interface GridAnalystTabProps {
  priceData: PricePoint[];
  currentPrice: number | null;
}

export function GridAnalystTab(_props: GridAnalystTabProps) {
  return <p className="text-[11px]">Grid Analyst — coming in Task 9.</p>;
}
```

Run: `npx tsc --noEmit` → clean. Open http://localhost:3000/dashboard, click ⚡ Grid Analyst, see the placeholder.

- [ ] **Step 3: Inputs card**

```tsx
// src/components/grid/GridInputs.tsx
"use client";

import { C } from "@/lib/constants";
import { GRID_WINDOW_LABEL, type GridWindow } from "@/lib/candles";
import type { GridMode, GridSettings } from "@/lib/grid";

interface GridInputsProps {
  value: GridSettings;
  onChange: (next: GridSettings) => void;
}

const WINDOWS: GridWindow[] = ["1m", "3m", "6m", "max"];
const MODES: { id: GridMode; label: string }[] = [
  { id: "arithmetic", label: "ARITH" },
  { id: "geometric", label: "GEO" },
];

function Pill({ active, color, onClick, children, ariaLabel }: { active: boolean; color: string; onClick: () => void; children: React.ReactNode; ariaLabel?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      className="min-h-[44px] flex-1 rounded-lg border text-[10px] font-bold tracking-[1px] transition-colors"
      style={{
        background: active ? `${color}1f` : "transparent",
        borderColor: active ? `${color}80` : C.border,
        color: active ? color : C.muted,
      }}
    >
      {children}
    </button>
  );
}

export function GridInputs({ value, onChange }: GridInputsProps) {
  const inputStyle = { background: "rgba(0,0,0,0.25)", borderColor: "rgba(255,255,255,0.14)", color: "#fff", fontFamily: C.font };
  return (
    <section
      className="mb-3 grid grid-cols-1 gap-3 rounded-xl p-3.5 sm:grid-cols-2 lg:grid-cols-4"
      style={{ background: C.surface, border: `1px solid ${C.border}` }}
      aria-label="Grid analyst inputs"
    >
      <label className="flex flex-col gap-1.5 text-[9px] uppercase tracking-[1px]" style={{ color: C.muted }}>
        Monthly goal (USD)
        <input
          id="grid-goal"
          type="number"
          min={1}
          step={10}
          inputMode="decimal"
          value={value.goalUsd}
          onChange={(e) => onChange({ ...value, goalUsd: Math.max(0, Number(e.target.value) || 0) })}
          className="min-h-[44px] rounded-lg border px-3 text-[14px] font-bold tabular-nums"
          style={inputStyle}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-[9px] uppercase tracking-[1px]" style={{ color: C.muted }}>
        Max investment (USD, optional)
        <input
          id="grid-max"
          type="number"
          min={0}
          step={100}
          inputMode="decimal"
          placeholder="no limit"
          value={value.maxInvestment ?? ""}
          onChange={(e) => onChange({ ...value, maxInvestment: e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0) })}
          className="min-h-[44px] rounded-lg border px-3 text-[14px] font-bold tabular-nums"
          style={inputStyle}
        />
      </label>
      <div className="flex flex-col gap-1.5 text-[9px] uppercase tracking-[1px]" style={{ color: C.muted }} role="group" aria-label="Backtest window">
        Backtest window
        <div className="flex gap-1">
          {WINDOWS.map((w) => (
            <Pill key={w} active={value.window === w} color={C.green} onClick={() => onChange({ ...value, window: w })}>
              {GRID_WINDOW_LABEL[w]}
            </Pill>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 text-[9px] uppercase tracking-[1px]" style={{ color: C.muted }} role="group" aria-label="Grid mode">
        Grid mode
        <div className="flex gap-1">
          {MODES.map((m) => (
            <Pill key={m.id} active={value.mode === m.id} color={C.purple} onClick={() => onChange({ ...value, mode: m.id })} ariaLabel={m.id}>
              {m.label}
            </Pill>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean for your files.

- [ ] **Step 5: Commit (stage exactly these files; `types.ts` is staged at blob level so the user's other hunk stays out)**

`git add -p` is interactive and unavailable here. Stage only the TabId change by building the committed content from HEAD:

```bash
git add src/lib/constants.ts src/app/dashboard/page.tsx src/components/grid/GridInputs.tsx src/components/tabs/GridAnalystTab.tsx
git show HEAD:src/lib/types.ts | sed 's/export type TabId = "unlock" | "cycles" | "levels" | "backtest";/export type TabId = "unlock" | "cycles" | "levels" | "backtest" | "grid";/' > /tmp/types-staged.ts
git update-index --cacheinfo 100644,$(git hash-object -w /tmp/types-staged.ts),src/lib/types.ts
git diff --cached src/lib/types.ts   # must show exactly one changed line (TabId)
git commit -m "feat(ui): register Grid Analyst tab and inputs card

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git diff src/lib/types.ts            # the user's bb* hunk must still be in the working tree
```

---

### Task 7: Candidate board + ticket

Depends on Tasks 3, 4, 6.

**Files:**
- Create: `src/components/grid/CandidateBoard.tsx`
- Create: `src/components/grid/CandidateTicket.tsx`

- [ ] **Step 1: Shared formatters (top of `CandidateBoard.tsx`, exported)**

```tsx
export const fmtPrice = (n: number) => n.toFixed(5);
export const fmtUsd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
export const fmtPct = (n: number, d = 1) => `${n.toFixed(d)}%`;
```

- [ ] **Step 2: Board**

```tsx
// src/components/grid/CandidateBoard.tsx
"use client";

import { C } from "@/lib/constants";
import type { Candidate } from "@/lib/grid";

export const fmtPrice = (n: number) => n.toFixed(5);
export const fmtUsd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
export const fmtPct = (n: number, d = 1) => `${n.toFixed(d)}%`;

interface CandidateBoardProps {
  candidates: Candidate[]; // best first
  selected: number;
  onSelect: (i: number) => void;
  goalUsd: number;
  currentPrice: number | null;
  tested: number;
  kept: number;
  loading: boolean;
  emptyMessage?: string;
}

function Bar({ fraction, color, marker }: { fraction: number; color: string; marker?: number }) {
  return (
    <div className="relative mt-1.5 h-1.5 overflow-visible rounded-full" style={{ background: "rgba(255,255,255,0.06)" }} aria-hidden>
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(0, Math.min(100, fraction * 100))}%`, background: color }} />
      {marker !== undefined && (
        <div className="absolute -top-[3px] h-3 w-0.5 bg-white" style={{ left: `${Math.max(0, Math.min(100, marker * 100))}%` }} />
      )}
    </div>
  );
}

export function CandidateBoard({ candidates, selected, onSelect, goalUsd, currentPrice, tested, kept, loading, emptyMessage }: CandidateBoardProps) {
  const topYield = candidates[0]?.result.monthlyYield ?? 1;
  return (
    <section className="mb-3" aria-label="Grid candidates">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="m-0 text-[12px] font-bold text-white">Candidates that reach {fmtUsd(goalUsd)} / month</h2>
          <p className="m-0 text-[10px]" style={{ color: C.muted }}>
            {loading ? "Backtesting…" : `${tested.toLocaleString()} configurations tested, ${kept.toLocaleString()} kept price in range ≥ 90% of the window.`}
          </p>
        </div>
      </div>

      {loading &&
        [0, 1, 2].map((i) => <div key={i} className="skeleton mb-1.5 h-[64px] rounded-[10px]" role="status" aria-label="Loading candidates" />)}

      {!loading && candidates.length === 0 && (
        <p className="rounded-[10px] px-3.5 py-3 text-[11px]" style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.muted }}>
          {emptyMessage ?? "No candidate passed the filters."}
        </p>
      )}

      {!loading &&
        candidates.map((c, i) => {
          const active = i === selected;
          const pos = currentPrice != null ? (currentPrice - c.lower) / (c.upper - c.lower) : undefined;
          return (
            <div
              key={`${c.lower}-${c.upper}-${c.grids}`}
              role="button"
              tabIndex={0}
              aria-pressed={active}
              onClick={() => onSelect(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(i);
                }
              }}
              className="mb-1.5 grid min-h-[44px] cursor-pointer grid-cols-[24px_1fr_1fr] items-center gap-x-2.5 gap-y-1 rounded-[10px] px-3 py-2.5 transition-colors md:grid-cols-[28px_1.4fr_1fr_64px_1fr_110px]"
              style={{
                background: active ? `${C.green}0f` : C.surface,
                border: `1px solid ${active ? `${C.green}80` : C.border}`,
              }}
            >
              <span className="text-[13px] font-extrabold" style={{ color: active ? C.green : C.muted }}>{i + 1}</span>
              <span className="col-span-2 text-[11px] text-white md:col-span-1">
                {fmtPrice(c.lower)} – {fmtPrice(c.upper)}
                <span className="block text-[10px]" style={{ color: C.muted }}>
                  {pos !== undefined ? `now sits ${Math.round(pos * 100)}% up the range` : "range"}
                </span>
                <Bar fraction={1} color={`${C.blue}59`} marker={pos} />
              </span>
              <span className="text-[10px]" style={{ color: C.muted }}>
                Yield / mo
                <b className="block text-[13px] text-white">{fmtPct(c.liveMonthlyYield * 100)}</b>
                <Bar fraction={c.result.monthlyYield / topYield} color={C.green} />
              </span>
              <span className="text-center text-[10px]" style={{ color: C.muted }}>
                Grids<b className="block text-[13px] text-white">{c.grids}</b>
              </span>
              <span className="text-[10px]" style={{ color: C.muted }}>
                In range · DD
                <b className="block text-[13px] text-white">{fmtPct(c.result.timeInRangePct, 0)} · −{fmtPct(c.result.maxDrawdownPct)}</b>
              </span>
              <span className="col-span-3 text-left md:col-span-1 md:text-right">
                <b className="block text-[13px]" style={{ color: C.green }}>{fmtUsd(c.requiredInvestment)}</b>
                <span className="text-[10px]" style={{ color: C.muted }}>to earn {fmtUsd(goalUsd)}</span>
              </span>
            </div>
          );
        })}
    </section>
  );
}
```

- [ ] **Step 3: Ticket**

```tsx
// src/components/grid/CandidateTicket.tsx
"use client";

import { C } from "@/lib/constants";
import type { Candidate, GridResult } from "@/lib/grid";
import { fmtPct, fmtPrice, fmtUsd } from "./CandidateBoard";

interface CandidateTicketProps {
  rank: number; // 1-based
  candidate: Candidate | null;
  investment: number | null; // required investment (or maxInvestment when over budget and the user wants that view)
  sized: GridResult | null; // simulateGrid at `investment`, for trades/month + expected profit
  warnings: string[];
}

function Field({ label, unit, value, sub }: { label: string; unit?: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[10px] px-3 py-2.5" style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.14)" }}>
      <p className="m-0 flex justify-between text-[9px] uppercase tracking-[1px]" style={{ color: C.muted }}>
        <span>{label}</span>
        {unit && <span style={{ color: C.muted }}>{unit}</span>}
      </p>
      <p className="m-0 mt-1 text-[22px] font-extrabold tracking-tight text-white tabular-nums">
        {value}
        {sub && <span className="ml-1 text-[11px] font-normal" style={{ color: C.muted }}>{sub}</span>}
      </p>
    </div>
  );
}

export function CandidateTicket({ rank, candidate, investment, sized, warnings }: CandidateTicketProps) {
  return (
    <section
      className="mb-3 rounded-xl p-3.5"
      style={{ border: `1px solid ${C.green}59`, background: `linear-gradient(180deg, ${C.green}12, ${C.green}05)` }}
      aria-label="What to type into Pionex"
    >
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 text-[11px] font-bold uppercase tracking-[1px]" style={{ color: C.green }}>
          {candidate ? `Candidate ${rank} · what to type into Pionex` : "What to type into Pionex"}
        </h3>
        <span className="text-[10px]" style={{ color: C.muted }}>spot grid · MON/USDT · fields in Pionex order</span>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Field label="Investment" unit="USDT" value={investment != null ? Math.round(investment).toLocaleString("en-US") : "—"} />
        <Field label="Lower price" unit="USDT" value={candidate ? fmtPrice(candidate.lower) : "—"} />
        <Field label="Upper price" unit="USDT" value={candidate ? fmtPrice(candidate.upper) : "—"} />
        <Field label="Grid count" unit={candidate?.mode} value={candidate ? String(candidate.grids) : "—"} sub={candidate ? `${fmtPct(candidate.spacingPct * 100, 2)} / grid` : undefined} />
      </div>

      {candidate && sized && (
        <p className="m-0 mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px]" style={{ color: C.muted }}>
          <span>Expected <b style={{ color: C.green }}>{fmtUsd(sized.monthlyProfit)} / month</b></span>
          <span>{fmtPct(candidate.liveMonthlyYield * 100)} monthly yield</span>
          <span>{fmtPct(candidate.profitPerGridPct * 100, 2)} profit per grid after fees</span>
          <span>{Math.round(sized.tradesPerMonth).toLocaleString()} trades / month</span>
          <span>unrealized {fmtUsd(sized.unrealizedPnl)} at window end</span>
        </p>
      )}

      {warnings.length > 0 && (
        <ul className="m-0 mt-2.5 flex list-none flex-col gap-1 p-0">
          {warnings.map((w) => (
            <li key={w} className="rounded-lg px-2.5 py-1.5 text-[11px]" style={{ color: C.yellow, border: `1px solid ${C.yellow}4d`, background: `${C.yellow}0f` }}>
              ⚠ {w}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

Note: `sized.monthlyProfit` is the raw simulated figure at the sized investment; the tab multiplies by the factor before passing when the resolution is coarser than 5-min (Task 9 handles that by passing a `sized` whose `monthlyProfit` and `tradesPerMonth` are already corrected — see Task 9 Step 2).

- [ ] **Step 4: Typecheck + lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add src/components/grid/CandidateBoard.tsx src/components/grid/CandidateTicket.tsx
git commit -m "feat(ui): candidate board and Pionex ticket for Grid Analyst

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Chart

Depends on Tasks 2, 3. Look at `src/components/tabs/CyclesTab.tsx` lines 200–400 for how this repo composes `ChartFrame` + `ComposedChart` + `Area` with a tuple dataKey.

**Files:**
- Create: `src/components/grid/GridChart.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/components/grid/GridChart.tsx
"use client";

import { useMemo } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame } from "@/components/ChartFrame";
import { C } from "@/lib/constants";
import { downsample, type Candle } from "@/lib/candles";

interface GridChartProps {
  candles: Candle[];
  lower: number | null;
  upper: number | null;
  levels: number[]; // grids + 1, ascending (empty when no candidate)
  currentPrice: number | null;
  loading: boolean;
  caption: React.ReactNode;
}

interface Row {
  t: number;
  label: string;
  close: number;
  band: [number, number] | null;
}

const MAX_POINTS = 600;
const MAX_LINES = 30;

function GridTooltip({ active, payload }: { active?: boolean; payload?: { payload?: Row }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload; // never payload[0].value — the band tuple lives there
  if (!d) return null;
  return (
    <div role="tooltip" className="rounded-lg px-3.5 py-2.5 text-[11px]" style={{ background: "rgba(7,10,20,0.97)", border: `1px solid ${C.green}33`, color: C.text }}>
      <p className="m-0 mb-1 font-bold" style={{ color: C.green }}>{d.label}</p>
      <p className="m-0">Close: <b className="text-white">${d.close.toFixed(5)}</b></p>
      {d.band && (
        <p className="m-0 mt-0.5" style={{ color: C.blue }}>Range: ${d.band[0].toFixed(5)} – ${d.band[1].toFixed(5)}</p>
      )}
    </div>
  );
}

export function GridChart({ candles, lower, upper, levels, currentPrice, loading, caption }: GridChartProps) {
  const rows = useMemo<Row[]>(() => {
    const band: [number, number] | null = lower != null && upper != null ? [lower, upper] : null;
    return downsample(candles, MAX_POINTS).map((c) => ({
      t: c.time,
      label: new Date(c.time).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric" }),
      close: c.close,
      band,
    }));
  }, [candles, lower, upper]);

  const lines = useMemo(() => {
    if (levels.length === 0) return [];
    const every = Math.ceil(levels.length / MAX_LINES);
    return levels.filter((_, i) => i % every === 0);
  }, [levels]);

  const domain = useMemo<[number, number]>(() => {
    const vals = rows.map((r) => r.close);
    if (lower != null) vals.push(lower);
    if (upper != null) vals.push(upper);
    if (vals.length === 0) return [0, 1];
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = (hi - lo) * 0.05 || lo * 0.05;
    return [lo - pad, hi + pad];
  }, [rows, lower, upper]);

  return (
    <ChartFrame caption={caption} height={200} lgHeight={320} loading={loading}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: C.muted }} tickLine={false} axisLine={false} minTickGap={40} />
          <YAxis domain={domain} tick={{ fontSize: 9, fill: C.muted }} tickLine={false} axisLine={false} width={58} tickFormatter={(v: number) => v.toFixed(4)} />
          <Tooltip content={<GridTooltip />} />
          <Area type="monotone" dataKey="band" stroke={`${C.blue}88`} fill={`${C.blue}14`} strokeWidth={1} dot={false} activeDot={false} isAnimationActive={false} />
          {lines.map((lv) => (
            <ReferenceLine key={lv} y={lv} stroke="rgba(255,255,255,0.08)" strokeDasharray="2 4" />
          ))}
          {currentPrice != null && (
            <ReferenceLine y={currentPrice} stroke="rgba(255,255,255,0.7)" strokeDasharray="4 3" label={{ value: currentPrice.toFixed(5), position: "right", fill: "#fff", fontSize: 9 }} />
          )}
          <Line type="monotone" dataKey="close" stroke={C.green} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
```

- [ ] **Step 2: Typecheck + lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add src/components/grid/GridChart.tsx
git commit -m "feat(ui): grid chart with range band and grid lines

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Assemble `GridAnalystTab`

Depends on Tasks 2–8. Replaces the Task 6 placeholder.

**Files:**
- Modify: `src/components/tabs/GridAnalystTab.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/components/tabs/GridAnalystTab.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CandidateBoard } from "@/components/grid/CandidateBoard";
import { CandidateTicket } from "@/components/grid/CandidateTicket";
import { GridChart } from "@/components/grid/GridChart";
import { GridInputs } from "@/components/grid/GridInputs";
import { C } from "@/lib/constants";
import {
  GRID_WINDOW_DAYS,
  RESOLUTION_FACTOR,
  candlesFromPricePoints,
  fetchCandles,
  type CandleSet,
  type GridWindow,
} from "@/lib/candles";
import { DEFAULT_GRID_SETTINGS, isGridSettings, optimizeGrid, simulateGrid, type GridSettings } from "@/lib/grid";
import { usePersistentState } from "@/lib/storage";
import type { PricePoint } from "@/lib/types";

interface GridAnalystTabProps {
  priceData: PricePoint[];
  currentPrice: number | null;
}

const RES_LABEL: Record<number, string> = { 300: "5-minute", 900: "15-minute", 1800: "30-minute", 3600: "1-hour", 86400: "daily" };

export function GridAnalystTab({ priceData, currentPrice }: GridAnalystTabProps) {
  const [settings, setSettings] = usePersistentState<GridSettings>("mon.grid", DEFAULT_GRID_SETTINGS, isGridSettings);
  const [set, setSet] = useState<CandleSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(0);
  const cacheRef = useRef<Partial<Record<GridWindow, CandleSet>>>({});

  // Fetch per window, cache per session (same pattern as CyclesTab).
  useEffect(() => {
    const w = settings.window;
    const cached = cacheRef.current[w];
    if (cached) {
      setSet(cached);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchCandles(GRID_WINDOW_DAYS[w])
      .then((cs) => {
        if (cancelled) return;
        cacheRef.current[w] = cs;
        setSet(cs);
      })
      .catch(() => {
        if (cancelled) return;
        const days = GRID_WINDOW_DAYS[w];
        const cutoff = Date.now() - days * 86_400_000;
        const fb: CandleSet = {
          resolutionSec: 86400,
          source: "fallback",
          candles: candlesFromPricePoints(priceData).filter((c) => c.time >= cutoff),
        };
        setSet(fb);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [settings.window, priceData]);

  useEffect(() => setSelected(0), [settings.goalUsd, settings.maxInvestment, settings.window, settings.mode, set]);

  const price = set?.candles.length ? set.candles[set.candles.length - 1].close : currentPrice;
  const factor = set ? (RESOLUTION_FACTOR[set.resolutionSec] ?? 1) : 1;
  const candleMs = set ? set.resolutionSec * 1000 : 0;

  const out = useMemo(() => {
    if (!set || set.candles.length === 0 || price == null) return null;
    return optimizeGrid({
      candles: set.candles,
      candleMs,
      goalUsd: settings.goalUsd,
      maxInvestment: settings.maxInvestment,
      currentPrice: price,
      mode: settings.mode,
      factor,
    });
  }, [set, candleMs, price, settings.goalUsd, settings.maxInvestment, settings.mode, factor]);

  const candidates = useMemo(() => (out?.best ? [out.best, ...out.alternatives] : []), [out]);
  const chosen = candidates[selected] ?? candidates[0] ?? null;
  const investment = chosen ? chosen.requiredInvestment : null;

  // Re-simulate the chosen candidate at its real investment for the ticket, then apply the factor to
  // the live-facing numbers (profit and trades) — the optimizer ranked on raw yield on purpose.
  const sized = useMemo(() => {
    if (!set || !chosen || investment == null) return null;
    const r = simulateGrid(set.candles, { lower: chosen.lower, upper: chosen.upper, grids: chosen.grids, investment, mode: chosen.mode }, candleMs);
    return { ...r, monthlyProfit: r.monthlyProfit * factor, tradesPerMonth: r.tradesPerMonth * factor };
  }, [set, chosen, investment, candleMs, factor]);

  const warnings = useMemo(() => {
    const w = [...(out?.warnings ?? [])];
    if (set?.source === "fallback") w.unshift("Approximate: using daily CoinGecko prices without intraday range — the candle service is unavailable. Fills are under-counted heavily.");
    else if (set && factor !== 1) w.unshift(`${RES_LABEL[set.resolutionSec]} candles capture about ${Math.round(100 / factor)}% of live fills — yields, profit and investment are corrected ×${factor.toFixed(2)}. Calibrated on one live-bot day.`);
    return w;
  }, [out, set, factor]);

  const caption = (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      <span>Price · {set ? RES_LABEL[set.resolutionSec] : "…"} candles</span>
      {chosen && <span style={{ color: C.blue }}>▬ range {chosen.lower.toFixed(5)} – {chosen.upper.toFixed(5)}</span>}
      {chosen && <span style={{ color: C.muted }}>┈ {chosen.grids} grids</span>}
      {price != null && <span className="text-white">— now {price.toFixed(5)}</span>}
    </span>
  );

  return (
    <div role="tabpanel" id="panel-grid" aria-labelledby="tab-grid">
      <GridInputs value={settings} onChange={setSettings} />

      <CandidateBoard
        candidates={candidates}
        selected={Math.min(selected, Math.max(0, candidates.length - 1))}
        onSelect={setSelected}
        goalUsd={settings.goalUsd}
        currentPrice={price}
        tested={out?.tested ?? 0}
        kept={out?.kept ?? 0}
        loading={loading}
        emptyMessage={price == null ? "Waiting for price data." : out?.warnings[0]}
      />

      <CandidateTicket rank={selected + 1} candidate={chosen} investment={investment} sized={sized} warnings={warnings} />

      <GridChart
        candles={set?.candles ?? []}
        lower={chosen?.lower ?? null}
        upper={chosen?.upper ?? null}
        levels={chosen?.result.levels ?? []}
        currentPrice={price}
        loading={loading}
        caption={caption}
      />

      <p className="mt-1 text-center text-[9px]" style={{ color: "#444" }}>
        Backtest on Pionex MON_USDT_PERP {set ? RES_LABEL[set.resolutionSec] : ""} candles · {set?.source === "db" ? "local db" : set?.source === "live" ? "live" : "fallback"} · fee 0.05%/side · calibrated on one live-bot day · past range ≠ future range
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck, lint, tests**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: clean.

- [ ] **Step 3: Verify in the browser**

Open http://localhost:3000/dashboard → ⚡ Grid Analyst. Check, and note the actual numbers in your report:
- Board shows up to 6 rows within ~2 s; row 1 selected; ticket shows four fields; chart shows band + lines + "now" line.
- Change goal to 1000 → investments double. Set max investment 1000 → amber over-budget warning. Switch window 1M / 6M / MAX → footer resolution label changes (5-minute / 30-minute / 1-hour) and the correction warning appears for non-5-minute windows. Switch GEO → grid count/spacing change.
- Click row 3 → ticket says "Candidate 3", chart band moves.
- Reload → settings persist (`mon.grid` in localStorage).
- Phone width (DevTools 400 px) → single column, no horizontal scroll.
- Sanity: for window 1M, a candidate near 0.023–0.030 with 80 grids should show a monthly yield in the neighbourhood of 8–10 % (the live bot did 0.33 %/day). If yields are wildly off (e.g. > 50 %/month or < 1 %), stop and report.

- [ ] **Step 4: Commit**

```bash
git add src/components/tabs/GridAnalystTab.tsx
git commit -m "feat(ui): Grid Analyst tab — goal → ranked grid candidates → Pionex ticket

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Docs + final verification

**Files:**
- Modify: `AGENTS.md`, `README.md`

- [ ] **Step 1: AGENTS.md**

In "What this is": four tabs → five tabs, add "Grid Analyst". In Architecture add:

```
- **Grid Analyst** — `src/lib/grid.ts` is pure (simulator + optimizer, tested against the user's live Pionex bot: `src/lib/__tests__/fixtures/`). Candles come from `/api/candles?days=N` ([src/app/api/candles/route.ts](src/app/api/candles/route.ts)): Postgres when `MON_DATABASE_URL` is set, else Pionex live pagination; resolution is chosen by window (5-min ≤ 30 d, 15-min ≤ 90 d, 30-min ≤ 180 d, else 1-hour) and `RESOLUTION_FACTOR` in `src/lib/candles.ts` corrects coarser resolutions for sizing. The tab caches one `CandleSet` per window in a `useRef` map. Settings persist under `mon.grid`.
```

In "Data shape" add `Candle`, `GridWindow`, `GridSettings`, `Candidate`. In "Don't" add: "Don't change the fill model in `simulateGrid` without updating the calibration fixtures' expected values *and* explaining why in the commit — the two calibration tests pin the model to the live bot." Under Persistence in README add `mon.grid`. Add `npm test` to the README Running Locally block. Also fix the existing AGENTS.md line "server routes fall back to live KuCoin fetches" → "live Pionex fetches" (the route pages Pionex, not KuCoin).

- [ ] **Step 2: Final gate**

Run: `npm test && npx tsc --noEmit && npm run lint && NODE_OPTIONS='--no-network-family-autoselection --dns-result-order=ipv4first' npm run build`
Expected: all green. `next build` must succeed with `serverExternalPackages: ["pg"]` (standalone output is what Coolify deploys).

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md README.md
git commit -m "docs: Grid Analyst tab, candles API, calibration notes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
