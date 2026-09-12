let pool: import("pg").Pool | null = null;

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

export const DB_EXCHANGE = "pionex";
export const DB_SYMBOL = "MON_USDT_PERP";

/** Compact rows [timeMs, open, high, low, close], ascending. `null` when no DB is configured. */
export async function queryCandlesFromDb(resolutionSec: number, days: number): Promise<number[][] | null> {
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
    values: [DB_EXCHANGE, DB_SYMBOL, resolutionSec, days],
    query_timeout: 5_000,
  };
  const { rows } = await p.query<Row>(queryConfig);
  return rows.map((r) => [r.t, r.o, r.h, r.l, r.c]);
}
