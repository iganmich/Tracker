-- Runs once, on first boot of an empty volume (docker-entrypoint-initdb.d).
-- Re-runnable by hand: npm run db:local:psql < infra/local-db/init.sql

CREATE TABLE IF NOT EXISTS mon_candles (
  exchange        text           NOT NULL,   -- 'kucoin'
  symbol          text           NOT NULL,   -- 'MON-USDT'
  resolution_sec  integer        NOT NULL,   -- 60, 300, 900, 3600, 86400
  time            timestamptz    NOT NULL,   -- candle open time (UTC)
  open            numeric(20,10) NOT NULL,
  high            numeric(20,10) NOT NULL,
  low             numeric(20,10) NOT NULL,
  close           numeric(20,10) NOT NULL,
  volume          numeric(24,8)  NOT NULL,   -- base asset (MON)
  turnover        numeric(24,8),             -- quote asset (USDT)
  ingested_at     timestamptz    NOT NULL DEFAULT now(),
  PRIMARY KEY (exchange, symbol, resolution_sec, time)
);

CREATE INDEX IF NOT EXISTS mon_candles_res_time_idx
  ON mon_candles (resolution_sec, time DESC);

COMMENT ON TABLE mon_candles IS
  'MON/USDT OHLCV history from KuCoin. Source of truth for MON-tracker backtests. Filled by `npm run candles:ingest`.';
