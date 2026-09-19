import { NextRequest } from "next/server";
import { COINS, DEFAULT_COIN, isCoinId } from "@/lib/coins";
import { ensureCandles } from "@/lib/server/candle-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL_MS = 5 * 60 * 1000;
const CACHEABLE = new Set([1, 7, 30, 90, 180, 400]);
const cache = new Map<string, { at: number; body: string }>();

const OK_HEADERS = { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" };

/** Mirrors resolutionForDays() in src/lib/candles.ts — keep in sync. */
function resolutionForDays(days: number): number {
  if (days <= 1) return 60;
  if (days <= 30) return 300;
  if (days <= 90) return 900;
  if (days <= 180) return 1800;
  return 3600;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: status === 200 ? OK_HEADERS : { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export async function GET(req: NextRequest) {
  const rawCoin = req.nextUrl.searchParams.get("coin") ?? DEFAULT_COIN;
  if (!isCoinId(rawCoin)) {
    return json({ error: `unknown coin ${rawCoin}` }, 400);
  }
  const coin = COINS[rawCoin];

  const raw = req.nextUrl.searchParams.get("days");
  const days = Number(raw);
  if (!raw || !Number.isInteger(days) || days < 1 || days > 400) {
    return json({ error: "days must be an integer 1..400" }, 400);
  }

  const cacheKey = `${coin.id}:${days}`;
  const cacheable = CACHEABLE.has(days);
  const hit = cacheable ? cache.get(cacheKey) : undefined;
  if (hit && Date.now() - hit.at < TTL_MS) {
    return new Response(hit.body, { headers: OK_HEADERS });
  }

  const resolutionSec = resolutionForDays(days);
  let result;
  try {
    result = await ensureCandles(coin, resolutionSec, days);
  } catch (err) {
    return json({ error: `candles unavailable: ${err instanceof Error ? err.message : String(err)}` }, 502);
  }
  if (result.candles.length === 0) {
    return json({ error: "candles unavailable: empty" }, 502);
  }

  const body = JSON.stringify({
    coin: coin.id,
    symbol: coin.pionexSymbol,
    resolutionSec: result.resolutionSec,
    source: result.source,
    candles: result.candles,
  });
  if (cacheable) cache.set(cacheKey, { at: Date.now(), body });
  return new Response(body, { headers: OK_HEADERS });
}
