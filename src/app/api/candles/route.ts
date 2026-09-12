import { NextRequest } from "next/server";
import { queryCandlesFromDb } from "@/lib/server/candles-db";
import { fetchCandlesLive } from "@/lib/server/candles-pionex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL_MS = 5 * 60 * 1000;
const CACHEABLE = new Set([30, 90, 180, 400]);
const cache = new Map<number, { at: number; body: string }>();

const OK_HEADERS = { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" };

/** Mirrors resolutionForDays() in src/lib/candles.ts — keep in sync. */
function resolutionForDays(days: number): number {
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
  const raw = req.nextUrl.searchParams.get("days");
  const days = Number(raw);
  if (!raw || !Number.isInteger(days) || days < 1 || days > 400) {
    return json({ error: "days must be an integer 1..400" }, 400);
  }

  const cacheable = CACHEABLE.has(days);
  const hit = cacheable ? cache.get(days) : undefined;
  if (hit && Date.now() - hit.at < TTL_MS) {
    return new Response(hit.body, { headers: OK_HEADERS });
  }

  const resolutionSec = resolutionForDays(days);
  let candles: number[][] | null = null;
  let source: "db" | "live" = "db";
  try {
    candles = await queryCandlesFromDb(resolutionSec, days);
  } catch (err) {
    console.error("[candles] db query failed, falling back to live:", err instanceof Error ? err.message : err);
    candles = null;
  }
  if (!candles || candles.length === 0) {
    source = "live";
    try {
      candles = await fetchCandlesLive(resolutionSec, days);
    } catch (err) {
      return json({ error: `candles unavailable: ${err instanceof Error ? err.message : String(err)}` }, 502);
    }
    if (candles.length === 0) {
      return json({ error: "candles unavailable: empty" }, 502);
    }
  }

  const body = JSON.stringify({ resolutionSec, source, candles });
  if (cacheable) cache.set(days, { at: Date.now(), body });
  return new Response(body, { headers: OK_HEADERS });
}
