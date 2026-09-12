<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# MON Tracker — Agent Notes

## What this is

Single-page client dashboard for tracking MON (Monad). Five tabs (Unlock, Cycles, Levels, Backtest, Grid Analyst) all driven from one shared `priceData` array fetched from CoinGecko, with a mock-data fallback. The Grid Analyst tab additionally fetches its own candle data. No database, no auth — read-only public dashboard.

## Architecture

- **Top-level state** lives in [src/app/dashboard/page.tsx](src/app/dashboard/page.tsx): `priceData`, `loading`, `activeTab`, `thresholds`. Persistent values use `usePersistentState` from [src/lib/storage.ts](src/lib/storage.ts).
- **Pure analytics** are in [src/lib/analytics.ts](src/lib/analytics.ts). No React imports. `detectBuyZones`, `projectFutureCycles`, `calcSR`, `computeBuySignal`, `computeBollingerBands` are all pure functions; tabs `useMemo` them.
- **Tabs are dumb** — they receive props, render. State for the AI buttons (`busy`, `text`) is local to each tab.
- **Charts** use recharts inside `<ChartFrame>` which handles skeleton loading and responsive height (mobile vs `lg:`). The Cycles tab uses `<ComposedChart>` so it can mix `<Area>` (Bollinger range) with `<Line>` (price + BB upper/lower/middle).
- **Chart timeframe data** in CyclesTab is a per-tab fetch separate from the dashboard's daily `priceData`. `fetchPriceDataForTimeframe(tf)` in [src/lib/prices.ts](src/lib/prices.ts) hits CoinGecko's `market_chart` endpoint with a per-timeframe `days` param: `5m` → days=1 (5-min), `1h` → days=7 (hourly), `4h` → days=30 hourly aggregated client-side via close-of-bucket, `1d` → days=90&interval=daily. CoinGecko free tier won't give sub-5-min data. Per-timeframe results live in a `useRef`-backed cache so re-clicking a tab doesn't refetch.
- **AI calls** go through `/api/claude` (server route in [src/app/api/claude/route.ts](src/app/api/claude/route.ts)) — never call Anthropic from the browser. The route streams SSE; the client parses `data: ` lines for `text_delta` events.
- **Grid Analyst** — `src/lib/grid.ts` is pure (simulator + optimizer), pinned to the user's live Pionex bot by calibration tests over the fixtures in `src/lib/__tests__/fixtures/` (5-minute candles: 85 simulated rounds vs 83 real, +67.83 vs +78.44 USDT). Candles come from `/api/candles?days=N` ([src/app/api/candles/route.ts](src/app/api/candles/route.ts)): Postgres when `MON_DATABASE_URL` is set, else Pionex live pagination; resolution follows the window (5-min ≤ 30 d, 15-min ≤ 90 d, 30-min ≤ 180 d, else 1-hour) and `RESOLUTION_FACTOR` in `src/lib/candles.ts` corrects coarser resolutions for sizing (they capture 86 % / 77 % / 64 % of live fills). The tab caches one `CandleSet` per window in a `useRef` map and persists its inputs under `mon.grid`. UI: `src/components/grid/` (inputs, candidate board, Pionex ticket, chart) composed by `src/components/tabs/GridAnalystTab.tsx`.

## Conventions

- **Color palette** lives as both CSS variables (in [globals.css](src/app/globals.css)) and a TS object `C` in [constants.ts](src/lib/constants.ts). Use `C.green` etc. inline for dynamic per-element coloring; use Tailwind classes for layout (flex/grid/spacing/responsive).
- **Tabular numerals everywhere** prices/dates appear — either via the global `font-variant-numeric: tabular-nums` on body, or `tabular-nums` Tailwind class for finer control inside tables.
- **Touch targets ≥44px** on all interactive elements (buttons, sliders, the ✕ remove buttons). Use `min-h-[44px]`.
- **Focus rings** are global via `*:focus-visible` in [globals.css](src/app/globals.css). Don't override per-component unless adding, never removing.
- **Mobile-first grids** — default `grid-cols-1`, then `sm:grid-cols-3`/`sm:grid-cols-4` etc. Don't use fixed `grid-cols-N` without a mobile fallback.
- **No emojis as structural icons** — emojis in TAB labels are decorative + paired with text labels, that's fine. Don't use emojis as standalone icon-only buttons.

## Data shape

- `PricePoint = { date, displayDate, price, unlock }` — one per day from CoinGecko (or hour-stamped for intraday timeframes)
- `BuyZone` extends `PricePoint` with `drop`, `prevHigh`, `sellDate`, `sellPrice`, `actualReturn` etc.
- `BuyZoneOptions = { pumpMin, dropMin, dropMax, recoveryMin }` — all 0..1 fractions, defaults in `DEFAULT_BUY_ZONE_OPTIONS`
- `BuySignalScore` combines four factors → 0-100 + rating + warnings (see [analytics.ts](src/lib/analytics.ts) `computeBuySignal`)
- `Timeframe = "5m" | "1h" | "4h" | "1d"` from [src/lib/prices.ts](src/lib/prices.ts) — used by CyclesTab's chart pills
- `EnrichedPricePoint` extends `PricePoint` with optional `bbMiddle`, `bbUpper`, `bbLower`, `bbRange: [lower, upper] | null` (the tuple is consumed by recharts `<Area dataKey="bbRange">` for the shaded band)
- **Cycle prediction stop-limits** are computed inline in CyclesTab — `estBuyPrice * 1.02` and `estSellPrice * 0.98` (2% buffer to ensure fill). Not persisted.
- `Candle = { time, open, high, low, close }` (ms, numbers) — from [src/lib/candles.ts](src/lib/candles.ts)
- `GridWindow = "1m" | "3m" | "6m" | "max"` — Grid Analyst backtest window
- `GridSettings = { goalUsd, maxInvestment, window, mode }` — persisted Grid Analyst inputs (see [src/lib/grid.ts](src/lib/grid.ts))
- `Candidate` (from `optimizeGrid` in [src/lib/grid.ts](src/lib/grid.ts)) — a grid range/count with its `result: GridResult`, `liveMonthlyYield`, `requiredInvestment`

## Don't

- Don't add a database *for app state*. Refresh-recoverable UI state goes in `localStorage` only. The one database that exists (`infra/local-db/`, see below) holds only public market-data history, is optional, and the app must keep working without it.
- Don't break the API key boundary. `ANTHROPIC_API_KEY` is server-only; the browser must never see it. Always proxy through `/api/claude`.
- Don't add `output: "standalone"` or change the Dockerfile without coordinating — both are tuned for Coolify deploy at tracker.xamadu.com.
- Don't introduce client-side fetches to CoinGecko on every render. DashboardPage fetches the daily price series once on mount; CyclesTab does its own per-timeframe fetch but caches each timeframe in a `useRef` map — refetch only when the user picks a timeframe that hasn't been seen this session.
- Don't read `payload[0].value` in `<ChartTooltip>` — read from `payload[0].payload` (the row) and pull `price` / `bbUpper` / `bbLower` directly. When a `<Area dataKey="bbRange">` is rendered, recharts puts the `[lower, upper]` tuple at `payload[0].value` and `.toFixed()` will throw. The tuple-from-row pattern is order-independent.
- Don't change the fill model in `simulateGrid` without updating the calibration fixtures' expected values *and* explaining why in the commit — the two calibration tests pin the model to the live bot.

## Local candle database (optional)

MON-tracker has its own Docker Postgres for MON/USDT candle history, used by backtests (Grid Analyst). Same pattern as the AIMS repos' `infra/local-db`, but a **separate stack** (`mon-tracker-local-db`, `postgres:17-alpine`, host port **5460**, user/db `mon`, password `localdev`) so nothing mixes with opsaims/cioaim/cp/execaims and their `db:local:reset` can't delete it. It never connects to Neon or any deployed environment.

- `npm run db:local:up` / `db:local:down` / `db:local:psql` — manage the container. The table is created on first boot from [infra/local-db/init.sql](infra/local-db/init.sql).
- `npm run candles:ingest` — pulls **Pionex `MON_USDT_PERP`** (1min/5min/15min/30min/1hour/4hour/1day) and **KuCoin `MON-USDT`** (1min/5min/15min/1hour/1day) candles and upserts into `mon_candles`. Incremental: resumes from the last stored candle, so **run it regularly** — Pionex only serves the last 10,000 candles per interval (5-min ≈ 35 days) and the local DB is what keeps older fine-grained history. `-- --source pionex`, `-- --res 5min`, `-- --full`. Refuses non-localhost hosts.
- `MON_DATABASE_URL=postgresql://mon:localdev@localhost:5460/mon` in `.env.local` points the app at it. Unset (as on Coolify today) → server routes fall back to live Pionex fetches (`MON_USDT_PERP`, paginated).
- Table `mon_candles (exchange, symbol, resolution_sec, time, open, high, low, close, volume, turnover, ingested_at)`, PK `(exchange, symbol, resolution_sec, time)`. KuCoin omits minutes with zero trades, so 1min has gaps; consumers must not assume a fixed stride.
- **Use Pionex perp candles for backtests, not KuCoin.** Calibrated against the user's live Pionex grid bot: 5-min perp candles reproduce 85 of 83 real rounds; KuCoin spot is so thin (most 1-min candles flat) it captures only ~50 %. KuCoin is kept for deep history only. Pionex's public API has no MON spot pair; Binance/Bybit are geo-blocked from the dev machine; Gate caps at 10,000 points; CoinGecko is daily-only beyond 90 days.
- On this dev machine IPv6 is broken and Node `fetch` hangs unless family auto-selection is off; the `candles:ingest` script sets `NODE_OPTIONS='--no-network-family-autoselection --dns-result-order=ipv4first'` for that reason. `next dev` routes that call KuCoin live need the same prefix here.

## Testing

Tests live in `src/lib/__tests__` (vitest), run with `npm test`. Includes the Grid Analyst calibration tests (see "Don't" above). The `NODE_OPTIONS` network flag prefix is not needed for tests.

## Deployment

- Production: Coolify (Hetzner) → tracker.xamadu.com, Cloudflare proxied (SSL=Full)
- GitHub: [iganmich/Tracker](https://github.com/iganmich/Tracker), Coolify webhook on `main` push
- Required env: `ANTHROPIC_API_KEY` (only one)
- Container exposes port 3000 — Coolify config must match
