/**
 * Coin registry. Everything coin-specific in the app (CoinGecko id, Pionex symbol, launch date,
 * price precision, whether an unlock schedule exists) comes from here.
 */
export type CoinId = "MON" | "XRP" | "SOL" | "BTC";

export interface Coin {
  id: CoinId;
  name: string;
  /** CoinGecko coin id for the daily dashboard series. */
  coingeckoId: string;
  /** Pionex klines symbol. Spot where it exists; MON has no spot pair in the public API, so its perp. */
  pionexSymbol: string;
  pionexMarket: "spot" | "perp";
  /** Exchange tag stored in mon_candles.exchange. */
  exchange: "pionex";
  /** First tradeable timestamp (ms UTC); nothing before this is stored or shown. */
  launchMs: number;
  /** Decimals for price display (Pionex tick size). */
  priceDecimals: number;
  /** MON has a monthly unlock schedule (UNLOCK_EVENTS); other coins don't. */
  hasUnlocks: boolean;
  /** Short description used in AI prompts. */
  blurb: string;
}

export const COINS: Record<CoinId, Coin> = {
  MON: {
    id: "MON",
    name: "Monad",
    coingeckoId: "monad",
    pionexSymbol: "MON_USDT_PERP",
    pionexMarket: "perp",
    exchange: "pionex",
    launchMs: Date.UTC(2025, 10, 24, 15),
    priceDecimals: 5,
    hasUnlocks: true,
    blurb: "MON (Monad, launched Nov 2025)",
  },
  XRP: {
    id: "XRP",
    name: "XRP",
    coingeckoId: "ripple",
    pionexSymbol: "XRP_USDT",
    pionexMarket: "spot",
    exchange: "pionex",
    launchMs: Date.UTC(2013, 7, 4),
    priceDecimals: 4,
    hasUnlocks: false,
    blurb: "XRP (Ripple)",
  },
  SOL: {
    id: "SOL",
    name: "Solana",
    coingeckoId: "solana",
    pionexSymbol: "SOL_USDT",
    pionexMarket: "spot",
    exchange: "pionex",
    launchMs: Date.UTC(2020, 3, 10),
    priceDecimals: 2,
    hasUnlocks: false,
    blurb: "SOL (Solana)",
  },
  BTC: {
    id: "BTC",
    name: "Bitcoin",
    coingeckoId: "bitcoin",
    pionexSymbol: "BTC_USDT",
    pionexMarket: "spot",
    exchange: "pionex",
    launchMs: Date.UTC(2010, 6, 17),
    priceDecimals: 2,
    hasUnlocks: false,
    blurb: "BTC (Bitcoin)",
  },
};

export const COIN_IDS = Object.keys(COINS) as CoinId[];
export const DEFAULT_COIN: CoinId = "MON";

export const isCoinId = (v: unknown): v is CoinId => typeof v === "string" && v in COINS;

/** Price formatted with the coin's tick precision, grouped thousands for large prices. */
export function formatPrice(n: number, coin: Coin): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: coin.priceDecimals, maximumFractionDigits: coin.priceDecimals });
}
