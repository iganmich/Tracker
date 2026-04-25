# MON Tracker

Price intelligence dashboard for **MON (Monad)** — unlock tracker, investment cycle detection, support & resistance levels, and a sanity-check backtest. Live at [tracker.xamadu.com](https://tracker.xamadu.com).

## Features

- **Unlock Tracker** — daily price chart with monthly validator-unlock markers (24th of each month), full unlock schedule, and AI-driven pattern analysis
- **Investment Cycles** — algorithmic detection of past pump → dip → recovery cycles, projection of upcoming buy/sell windows, and a **Buy Signal Score (0-100)** combining time/price/pump/momentum factors with a price-proximity meter
- **Support & Resistance** — auto-detected levels by touch count + manual level overlay
- **Backtest** — per-cycle table (buy/sell dates, prices, hold days, drop %, recovery %, return) with win/loss color coding
- **Configurable thresholds** — sliders on the Cycles tab let you loosen or tighten dip detection live; settings persist across refreshes via `localStorage`
- **Dark terminal aesthetic** — JetBrains Mono, electric green/amber/red palette, tabular numerals, focus rings, mobile-first responsive grids, `prefers-reduced-motion` respected

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript |
| Styling | Tailwind v4 + CSS variables |
| Charts | recharts |
| Font | JetBrains Mono via `next/font/google` |
| Data | CoinGecko `coins/monad` daily prices (mock-data fallback) |
| AI | Server-side proxy to Anthropic at `/api/claude` |
| Deploy | Coolify (Hetzner), Dockerfile-based, Next.js standalone output |

## Project Layout

```
src/
├── app/
│   ├── api/claude/route.ts    # Anthropic streaming proxy (server-only key)
│   ├── dashboard/page.tsx     # Top-level client page (state + tab routing)
│   ├── layout.tsx             # JetBrains Mono, design tokens
│   ├── globals.css            # CSS variables (--bg, --green, --muted, …)
│   └── page.tsx               # Redirects → /dashboard
├── components/
│   ├── tabs/
│   │   ├── UnlockTab.tsx
│   │   ├── CyclesTab.tsx
│   │   ├── LevelsTab.tsx
│   │   └── BacktestTab.tsx
│   ├── BuySignalBadge.tsx     # 0-100 score + factor bars + proximity meter
│   ├── ChartFrame.tsx         # Skeleton-loading chart wrapper, responsive height
│   ├── ChartTooltip.tsx
│   ├── DashboardHeader.tsx
│   ├── StatCard.tsx
│   ├── TabBar.tsx
│   └── ThresholdControls.tsx  # 4 sliders + reset
└── lib/
    ├── analytics.ts           # calcSR, detectBuyZones, projectFutureCycles, computeBuySignal
    ├── claude.ts              # streaming client → /api/claude
    ├── constants.ts           # UNLOCK_EVENTS, TABS, color palette `C`
    ├── prices.ts              # CoinGecko fetch + mock fallback
    ├── storage.ts             # usePersistentState (localStorage hook)
    └── types.ts               # all domain types + DEFAULT_BUY_ZONE_OPTIONS
```

## Running Locally

```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — redirects to `/dashboard`.

If CoinGecko is unreachable the dashboard transparently falls back to embedded mock data so the UI is always testable offline.

## Deployment (Coolify)

Repo is Coolify-ready out of the box.

1. **New Resource → Public Repository**
   - URL: `https://github.com/iganmich/Tracker`
   - Branch: `main`
   - Build Pack: **Dockerfile**
2. **Configuration → General** — set **Ports Exposes** to `3000`
3. **Environment Variables** — `ANTHROPIC_API_KEY=sk-ant-...`
4. **Domains** — `https://tracker.xamadu.com` (Cloudflare proxied, SSL = **Full**)
5. **Webhooks** (auto-deploy) — paste the Manual Git Webhook URL into GitHub → repo Settings → Webhooks, with a generated secret. Push to `main` then triggers a build.

## Persistence

The dashboard saves two values to `localStorage`:

- `mon.thresholds` — buy-zone detection sliders
- `mon.activeTab` — which tab was last open

Both are type-guarded on read; corrupt or missing values fall back to defaults.

## Buy Signal Scoring

`computeBuySignal(priceData, projection, options)` combines four weighted factors:

| Factor | Max | Source |
|---|---|---|
| Time | 30 | Days until projected cycle window opens |
| Price | 30 | Current price proximity to projected buy target |
| Pump | 25 | Whether a `pumpMin`%+ rise occurred in last 20 days |
| Momentum | 15 | 7-day price change direction |

**Rating:** Strong Buy ≥75 · Watch ≥50 · Wait ≥25 · No Signal <25

Warnings surface when key conditions are missing — e.g. *"No qualifying pump in recent history — buy zone unlikely to fire even on schedule."*

## Not Financial Advice

This tool detects historical patterns and projects them forward; it does not predict the future. Backtest numbers ignore fees, slippage, and position sizing. Use as a research aid, not a trading bot.
