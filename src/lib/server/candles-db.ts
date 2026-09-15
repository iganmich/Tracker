let pool: import("pg").Pool | null = null;

/** Rows per INSERT statement; 500 × 9 bound parameters stays well under Postgres' 65,535 limit. */
const CHUNK = 500;

async function getPool(): Promise<import("pg").Pool | null> {
  const url = process.env.MON_DATABASE_URL;
  if (!url) return null;
  if (!pool) {
    const { Pool } = await import("pg");
    pool = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 3_000 });
    pool.on("error", (err) => console.error("[candles] pg pool error", err.message));
  }
  return pool;
}

/** True when a candle database is configured. */
export function hasDb(): boolean {
  return Boolean(process.env.MON_DATABASE_URL);
}

/** Compact rows [timeMs, open, high, low, close], ascending. `null` when no DB is configured. */
export async function queryCandlesFromDb(
  exchange: string,
  symbol: string,
  resolutionSec: number,
  days: number,
): Promise<number[][] | null> {
  const p = await getPool();
  if (!p) return null;
  type Row = { t: number; o: number; h: number; l: number; c: number };
  const queryConfig: import("pg").QueryConfig<unknown[]> & { query_timeout: number } = {
    text: `SELECT (extract(epoch FROM time) * 1000)::float8 AS t,
            open::float8 AS o, high::float8 AS h, low::float8 AS l, close::float8 AS c
       FROM mon_candles
      WHERE exchange = $1 AND symbol = $2 AND resolution_sec = $3
        AND time >= now() - ($4::int * interval '1 day')
      ORDER BY time ASC`,
    values: [exchange, symbol, resolutionSec, days],
    query_timeout: 5_000,
  };
  const { rows } = await p.query<Row>(queryConfig);
  return rows.map((r) => [r.t, r.o, r.h, r.l, r.c]);
}

/** Newest stored candle time in ms. `null` when no DB is configured or nothing is stored yet. */
export async function latestStoredMs(exchange: string, symbol: string, resolutionSec: number): Promise<number | null> {
  const p = await getPool();
  if (!p) return null;
  const queryConfig: import("pg").QueryConfig<unknown[]> & { query_timeout: number } = {
    text: `SELECT (extract(epoch FROM max(time)) * 1000)::float8 AS t
             FROM mon_candles
            WHERE exchange = $1 AND symbol = $2 AND resolution_sec = $3`,
    values: [exchange, symbol, resolutionSec],
    query_timeout: 5_000,
  };
  const { rows } = await p.query<{ t: number | null }>(queryConfig);
  const t = rows[0]?.t;
  return typeof t === "number" && Number.isFinite(t) ? t : null;
}

/**
 * Upsert rows [timeMs, open, high, low, close, volume?]. `mon_candles.volume` is NOT NULL, so a row
 * without one stores 0. Turnover is never known here and is left NULL, which the conflict clause
 * keeps from overwriting a turnover the ingest script already stored. Returns the rows written.
 */
export async function upsertCandles(
  exchange: string,
  symbol: string,
  resolutionSec: number,
  rows: number[][],
): Promise<number> {
  if (rows.length === 0) return 0;
  const p = await getPool();
  if (!p) return 0;
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const tuples = chunk.map((r, j) => {
      const b = j * 9;
      const volume = Number.isFinite(r[5]) ? r[5] : 0;
      values.push(exchange, symbol, resolutionSec, new Date(r[0]), r[1], r[2], r[3], r[4], volume);
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},NULL)`;
    });
    const result = await p.query({
      text: `INSERT INTO mon_candles (exchange, symbol, resolution_sec, time, open, high, low, close, volume, turnover)
             VALUES ${tuples.join(",")}
             ON CONFLICT (exchange, symbol, resolution_sec, time) DO UPDATE SET
               open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low, close = EXCLUDED.close,
               volume = EXCLUDED.volume,
               turnover = COALESCE(EXCLUDED.turnover, mon_candles.turnover),
               ingested_at = now()`,
      values,
    });
    written += result.rowCount ?? 0;
  }
  return written;
}
