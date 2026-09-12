/**
 * Pull MON/USDT OHLCV candles from KuCoin and store them in the local Postgres (`mon` database).
 *
 *   npm run candles:ingest              # incremental: every resolution, from last stored candle to now
 *   npm run candles:ingest -- --res 5min  # one resolution only
 *   npm run candles:ingest -- --full    # ignore what is stored, re-pull from launch (upserts)
 *
 * Target is MON_DATABASE_URL (default: this repo's own local Docker Postgres, infra/local-db, port 5460).
 * Refuses any host that is not localhost — this script never touches Neon.
 */
import pg from "pg";

const KUCOIN = "https://api.kucoin.com/api/v1/market/candles";
const EXCHANGE = "kucoin";
const SYMBOL = "MON-USDT";
const LAUNCH_S = Date.UTC(2025, 10, 24) / 1000; // 2025-11-24 00:00 UTC (first trade 15:00)
const PAGE = 1500; // KuCoin max candles per request
const PAUSE_MS = 150; // stay well under KuCoin's public rate limit

const RESOLUTIONS: Record<string, number> = {
  "1min": 60,
  "5min": 300,
  "15min": 900,
  "1hour": 3600,
  "1day": 86400,
};

const DEFAULT_URL = "postgresql://mon:localdev@localhost:5460/mon";

function parseArgs() {
  const args = process.argv.slice(2);
  const res = args.includes("--res") ? args[args.indexOf("--res") + 1] : null;
  const full = args.includes("--full");
  if (res && !(res in RESOLUTIONS)) {
    console.error(`Unknown --res ${res}. Use one of: ${Object.keys(RESOLUTIONS).join(", ")}`);
    process.exit(1);
  }
  return { res, full };
}

function assertLocal(url: string) {
  const host = new URL(url).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    console.error(`✗ ingest only targets a local database. Refusing host: ${host}`);
    process.exit(1);
  }
}

type Row = [string, string, string, string, string, string, string]; // time_s, o, c, h, l, vol, turnover

async function fetchPage(type: string, startAt: number, endAt: number): Promise<Row[]> {
  const url = `${KUCOIN}?type=${type}&symbol=${SYMBOL}&startAt=${startAt}&endAt=${endAt}`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(url);
    if (res.status === 429) {
      await sleep(2000 * attempt);
      continue;
    }
    if (!res.ok) throw new Error(`KuCoin ${res.status} for ${url}`);
    const json = (await res.json()) as { code: string; data?: Row[]; msg?: string };
    if (json.code !== "200000") throw new Error(`KuCoin code ${json.code}: ${json.msg ?? ""}`);
    return json.data ?? [];
  }
  throw new Error("KuCoin rate-limited 5 times in a row");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ingestResolution(client: pg.Client, type: string, sec: number, full: boolean) {
  const { rows } = await client.query<{ max: string | null }>(
    "SELECT extract(epoch FROM max(time))::text AS max FROM mon_candles WHERE exchange=$1 AND symbol=$2 AND resolution_sec=$3",
    [EXCHANGE, SYMBOL, sec],
  );
  const stored = rows[0]?.max ? Number(rows[0].max) : null;
  // Re-pull the last stored candle too: it may have been partial when ingested.
  let cursor = full || stored === null ? LAUNCH_S : stored;
  const now = Math.floor(Date.now() / 1000);
  let inserted = 0;
  let requests = 0;

  process.stdout.write(`${type.padEnd(6)} from ${new Date(cursor * 1000).toISOString()} `);

  while (cursor < now) {
    const endAt = Math.min(cursor + PAGE * sec, now + sec);
    const page = await fetchPage(type, cursor, endAt);
    requests++;
    if (page.length > 0) {
      // KuCoin: [time, open, close, high, low, volume, turnover], newest first
      const values: unknown[] = [];
      const tuples = page.map((r, i) => {
        const b = i * 10;
        values.push(
          EXCHANGE, SYMBOL, sec, new Date(Number(r[0]) * 1000),
          r[1], r[3], r[4], r[2], r[5], r[6],
        );
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
      inserted += result.rowCount ?? 0;
    }
    cursor = endAt;
    process.stdout.write(".");
    await sleep(PAUSE_MS);
  }

  const { rows: cnt } = await client.query<{ n: string; first: string; last: string }>(
    "SELECT count(*)::text AS n, min(time)::text AS first, max(time)::text AS last FROM mon_candles WHERE exchange=$1 AND symbol=$2 AND resolution_sec=$3",
    [EXCHANGE, SYMBOL, sec],
  );
  console.log(
    `\n  ${requests} requests, ${inserted} rows upserted → total ${cnt[0].n} (${cnt[0].first} … ${cnt[0].last})`,
  );
}

async function main() {
  const { res, full } = parseArgs();
  const url = process.env.MON_DATABASE_URL ?? DEFAULT_URL;
  assertLocal(url);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  console.log(`→ ${EXCHANGE} ${SYMBOL} → ${new URL(url).host}/${new URL(url).pathname.slice(1)} (${full ? "full" : "incremental"})`);
  try {
    const targets = res ? [res] : Object.keys(RESOLUTIONS);
    for (const type of targets) {
      await ingestResolution(client, type, RESOLUTIONS[type], full);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("\n✗", err instanceof Error ? err.message : err);
  process.exit(1);
});
