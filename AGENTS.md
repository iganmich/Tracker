<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# MON Tracker — Agent Notes

## What this is

Single-page client dashboard for tracking MON (Monad). Four tabs (Unlock, Cycles, Levels, Backtest) all driven from one shared `priceData` array fetched from CoinGecko, with a mock-data fallback. No database, no auth — read-only public dashboard.

## Architecture

- **Top-level state** lives in [src/app/dashboard/page.tsx](src/app/dashboard/page.tsx): `priceData`, `loading`, `activeTab`, `thresholds`. Persistent values use `usePersistentState` from [src/lib/storage.ts](src/lib/storage.ts).
- **Pure analytics** are in [src/lib/analytics.ts](src/lib/analytics.ts). No React imports. `detectBuyZones`, `projectFutureCycles`, `calcSR`, `computeBuySignal` are all pure functions; tabs `useMemo` them.
- **Tabs are dumb** — they receive props, render. State for the AI buttons (`busy`, `text`) is local to each tab.
- **Charts** use recharts inside `<ChartFrame>` which handles skeleton loading and responsive height (mobile vs `lg:`).
- **AI calls** go through `/api/claude` (server route in [src/app/api/claude/route.ts](src/app/api/claude/route.ts)) — never call Anthropic from the browser. The route streams SSE; the client parses `data: ` lines for `text_delta` events.

## Conventions

- **Color palette** lives as both CSS variables (in [globals.css](src/app/globals.css)) and a TS object `C` in [constants.ts](src/lib/constants.ts). Use `C.green` etc. inline for dynamic per-element coloring; use Tailwind classes for layout (flex/grid/spacing/responsive).
- **Tabular numerals everywhere** prices/dates appear — either via the global `font-variant-numeric: tabular-nums` on body, or `tabular-nums` Tailwind class for finer control inside tables.
- **Touch targets ≥44px** on all interactive elements (buttons, sliders, the ✕ remove buttons). Use `min-h-[44px]`.
- **Focus rings** are global via `*:focus-visible` in [globals.css](src/app/globals.css). Don't override per-component unless adding, never removing.
- **Mobile-first grids** — default `grid-cols-1`, then `sm:grid-cols-3`/`sm:grid-cols-4` etc. Don't use fixed `grid-cols-N` without a mobile fallback.
- **No emojis as structural icons** — emojis in TAB labels are decorative + paired with text labels, that's fine. Don't use emojis as standalone icon-only buttons.

## Data shape

- `PricePoint = { date, displayDate, price, unlock }` — one per day from CoinGecko
- `BuyZone` extends `PricePoint` with `drop`, `prevHigh`, `sellDate`, `sellPrice`, `actualReturn` etc.
- `BuyZoneOptions = { pumpMin, dropMin, dropMax, recoveryMin }` — all 0..1 fractions, defaults in `DEFAULT_BUY_ZONE_OPTIONS`
- `BuySignalScore` combines four factors → 0-100 + rating + warnings (see [analytics.ts](src/lib/analytics.ts) `computeBuySignal`)

## Don't

- Don't add a database. This dashboard is intentionally stateless — refresh-recoverable state goes in `localStorage` only.
- Don't break the API key boundary. `ANTHROPIC_API_KEY` is server-only; the browser must never see it. Always proxy through `/api/claude`.
- Don't add `output: "standalone"` or change the Dockerfile without coordinating — both are tuned for Coolify deploy at tracker.xamadu.com.
- Don't introduce client-side fetches to CoinGecko on every render. The single `useEffect` in DashboardPage runs once on mount; tabs read from the in-memory array.

## Deployment

- Production: Coolify (Hetzner) → tracker.xamadu.com, Cloudflare proxied (SSL=Full)
- GitHub: [iganmich/Tracker](https://github.com/iganmich/Tracker), Coolify webhook on `main` push
- Required env: `ANTHROPIC_API_KEY` (only one)
- Container exposes port 3000 — Coolify config must match
