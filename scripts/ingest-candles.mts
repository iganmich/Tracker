/**
 * Pull MON/USDT OHLCV candles from an exchange and store them in the local Postgres (`mon` database).
 *
 *   npm run candles:ingest                       # incremental, all sources, all resolutions
 *   npm run candles:ingest -- --source pionex    # one source (pionex | kucoin)
 *   npm run candles:ingest -- --res 5min         # one resolution (names below)
 *   npm run candles:ingest -- --full             # ignore what is stored, re-pull from launch (upserts)
 *
 * Sources
 *   pionex  MON_USDT_PERP  — liquid; reproduces the user's live Pionex spot grid bot within ±3 % rounds
 *                            on 5-minute candles. Hard cap of 10,000 candles per interval
 *                            (1min ≈ 7 d, 5min ≈ 35 d, 15min ≈ 104 d, 30min ≈ 208 d, 1hour/4hour/1day full).
 *                            Public, paginates backwards with endTime, newest first.
 *   kucoin  MON-USDT       — real spot, full history at every resolution, but very thin: most 1-minute
 *                            candles are flat, so it under-counts grid fills ~2×. Kept for deep history.
 *
 * Target is MON_DATABASE_URL (default: this repo's own local Docker Postgres, infra/local-db, port 5460).
 * Refuses any host that is not localhost — this script never touches Neon or a deployed database.
 */
import pg from "pg";

const LAUNCH_S = Date.UTC(2025, 10, 24) / 1000; // 2025-11-24 00:00 UTC (first trade 15:00)
const PAUSE_MS = 150;
const DEFAULT_URL = "postgresql://mon:localdev@localhost:5460/mon";

type Candle = { t: number; o: string; h: string; l: string; c: string; v: string; q: string | null };

interface Source {
  exchange: string;
  symbol: string;
  resolutions: Record<string, number>; // our resolution name → seconds
  /** Fetch candles covering [startS, endS]; return newest-or-oldest order, any length. Empty = nothing more. */
  fetchRange(resName: string, sec: number, startS: number, endS: number | null): Promise<Candle[]>;
  pageCandles: number;
  /** true → walk forward from start (KuCoin startAt/endAt); false → walk backwards with endTime (Pionex). */
  forward: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(url: string): Promise<T> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(url);
    if (res.status === 429) {
      await sleep(2000 * attempt);
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    return (await res.json()) as T;
  }
  throw new Error(`rate-limited 5 times: ${url}`);
}

const kucoin: Source = {
  exchange: "kucoin",
  symbol: "MON-USDT",
  resolutions: { "1min": 60, "5min": 300, "15min": 900, "1hour": 3600, "1day": 86400 },
  pageCandles: 1500,
  forward: true,
  async fetchRange(resName, _sec, startS, endS) {
    type Row = [string, string, string, string, string, string, string]; // time, open, close, high, low, vol, turnover
    const json = await getJson<{ code: string; data?: Row[]; msg?: string }>(
      `https://api.kucoin.com/api/v1/market/candles?type=${resName}&symbol=MON-USDT&startAt=${startS}&endAt=${endS}`,
    );
    if (json.code !== "200000") throw new Error(`KuCoin code ${json.code}: ${json.msg ?? ""}`);
    return (json.data ?? []).map((r) => ({ t: Number(r[0]), o: r[1], h: r[3], l: r[4], c: r[2], v: r[5], q: r[6] }));
  },
};

const pionex: Source = {
  exchange: "pionex",
  symbol: "MON_USDT_PERP",
  resolutions: { "1min": 60, "5min": 300, "15min": 900, "30min": 1800, "1hour": 3600, "4hour": 14400, "1day": 86400 },
  pageCandles: 500,
  forward: false,
  async fetchRange(resName, _sec, _startS, endS) {
    const interval = { "1min": "1M", "5min": "5M", "15min": "15M", "30min": "30M", "1hour": "60M", "4hour": "4H", "1day": "1D" }[resName];
    type K = { time: number; open: string; high: string; low: string; close: string; volume: string };
    const json = await getJson<{ result: boolean; code?: string; message?: string; data?: { klines: K[] } }>(
      // Pionex rejects an endTime at or after "now"; omit it for the newest page.
      `https://api.pionex.com/api/v1/market/klines?symbol=MON_USDT_PERP&interval=${interval}&limit=500${endS === null ? "" : `&endTime=${endS * 1000}`}`,
    );
    if (!json.result) throw new Error(`Pionex ${json.code}: ${json.message ?? ""}`);
    return (json.data?.klines ?? []).map((k) => ({ t: Math.floor(k.time / 1000), o: k.open, h: k.high, l: k.low, c: k.close, v: k.volume, q: null }));
  },
};

const SOURCES: Record<string, Source> = { pionex, kucoin };

function parseArgs() {
  const args = process.argv.slice(2);
  const pick = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
  const source = pick("--source");
  const res = pick("--res");
  const full = args.includes("--full");
  if (source && !(source in SOURCES)) {
    console.error(`Unknown --source ${source}. Use: ${Object.keys(SOURCES).join(", ")}`);
    process.exit(1);
  }
  return { source, res, full };
}

function assertLocal(url: string) {
  const host = new URL(url).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    console.error(`✗ ingest only targets a local database. Refusing host: ${host}`);
    process.exit(1);
  }
}

async function upsert(client: pg.Client, src: Source, sec: number, rows: Candle[]) {
  if (rows.length === 0) return 0;
  const values: unknown[] = [];
  const tuples = rows.map((r, i) => {
    const b = i * 10;
    values.push(src.exchange, src.symbol, sec, new Date(r.t * 1000), r.o, r.h, r.l, r.c, r.v, r.q);
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`;
  });
  const result = await client.query(
    `INSERT INTO mon_candles (exchange, symbol, resolution_sec, time, open, high, low, close, volume, turnover)
     VALUES ${tuples.join(",")}
     ON CONFLICT (exchange, symbol, resolution_sec, time) DO UPDATE SET
       open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low, close = EXCLUDED.close,
       volume = EXCLUDED.volume, turnover = EXCLUDED.turnover, ingested_at = now()`,
    values,
  );
  return result.rowCount ?? 0;
}

async function ingest(client: pg.Client, src: Source, resName: string, sec: number, full: boolean) {
  const { rows } = await client.query<{ max: string | null }>(
    "SELECT extract(epoch FROM max(time))::text AS max FROM mon_candles WHERE exchange=$1 AND symbol=$2 AND resolution_sec=$3",
    [src.exchange, src.symbol, sec],
  );
  const stored = rows[0]?.max ? Number(rows[0].max) : null;
  // Re-pull the last stored candle too: it may have been partial when ingested.
  const floor = full || stored === null ? LAUNCH_S : stored;
  const now = Math.floor(Date.now() / 1000);
  let inserted = 0;
  let requests = 0;
  process.stdout.write(`${src.exchange.padEnd(7)}${resName.padEnd(6)} from ${new Date(floor * 1000).toISOString()} `);

  if (src.forward) {
    let cursor = floor;
    while (cursor < now) {
      const endS = Math.min(cursor + src.pageCandles * sec, now + sec);
      const page = await src.fetchRange(resName, sec, cursor, endS);
      requests++;
      inserted += await upsert(client, src, sec, page);
      cursor = endS;
      process.stdout.write(".");
      await sleep(PAUSE_MS);
    }
  } else {
    let endS: number | null = null; // null = newest page
    while (endS === null || endS > floor) {
      const page = await src.fetchRange(resName, sec, floor, endS);
      requests++;
      const keep = page.filter((r) => r.t >= floor);
      inserted += await upsert(client, src, sec, keep);
      process.stdout.write(".");
      if (page.length < src.pageCandles || keep.length === 0) break; // history cap or reached floor
      endS = Math.min(...page.map((r) => r.t)) - 1;
      await sleep(PAUSE_MS);
    }
  }

  const { rows: cnt } = await client.query<{ n: string; first: string; last: string }>(
    "SELECT count(*)::text AS n, min(time)::text AS first, max(time)::text AS last FROM mon_candles WHERE exchange=$1 AND symbol=$2 AND resolution_sec=$3",
    [src.exchange, src.symbol, sec],
  );
  console.log(`\n  ${requests} requests, ${inserted} rows upserted → total ${cnt[0].n} (${cnt[0].first} … ${cnt[0].last})`);
}

async function main() {
  const { source, res, full } = parseArgs();
  const url = process.env.MON_DATABASE_URL ?? DEFAULT_URL;
  assertLocal(url);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  console.log(`→ ${new URL(url).host}${new URL(url).pathname} (${full ? "full" : "incremental"})`);
  try {
    for (const src of source ? [SOURCES[source]] : Object.values(SOURCES)) {
      for (const [resName, sec] of Object.entries(src.resolutions)) {
        if (res && res !== resName) continue;
        await ingest(client, src, resName, sec, full);
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("\n✗", err instanceof Error ? err.message : err);
  process.exit(1);
});
