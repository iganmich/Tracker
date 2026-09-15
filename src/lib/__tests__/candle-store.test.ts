import { describe, expect, it } from "vitest";
import { refreshPlan } from "@/lib/server/candle-store";

const NOW = Date.UTC(2026, 8, 15, 12, 0, 0);
const MIN = 60_000;
const DAY = 86_400_000;

describe("refreshPlan", () => {
  it("backfills from launch when nothing is stored and the coin is young", () => {
    const launch = NOW - 10 * DAY;
    const plan = refreshPlan(null, NOW, 300, launch);
    expect(plan.reason).toBe("backfill");
    expect(plan.floorMs).toBe(launch);
  });

  it("backfills only to the Pionex 10k-candle cap for an old coin", () => {
    const launch = Date.UTC(2013, 7, 4); // XRP
    const plan = refreshPlan(null, NOW, 300, launch);
    expect(plan.reason).toBe("backfill");
    expect(plan.floorMs).toBe(NOW - 10_000 * 300 * 1000);
    expect(plan.floorMs).toBeGreaterThan(launch);
  });

  it("caps per resolution, so a daily backfill still reaches an old launch", () => {
    const launch = Date.UTC(2020, 3, 10); // SOL
    const plan = refreshPlan(null, NOW, 86_400, launch);
    expect(plan.floorMs).toBe(launch); // 10,000 days back predates the launch
  });

  it("tops up from the newest stored candle when stale by more than two candles", () => {
    const latest = NOW - 30 * MIN;
    const plan = refreshPlan(latest, NOW, 300, 0);
    expect(plan.reason).toBe("top-up");
    expect(plan.floorMs).toBe(latest); // re-pulls the last stored candle, which may have been partial
  });

  it("is fresh when the newest stored candle is within two candles of now", () => {
    const latest = NOW - 2 * 300 * 1000;
    const plan = refreshPlan(latest, NOW, 300, 0);
    expect(plan.reason).toBe("fresh");
    expect(plan.floorMs).toBe(latest);
  });

  it("flips to top-up one millisecond past the two-candle window", () => {
    const stepMs = 900 * 1000;
    expect(refreshPlan(NOW - 2 * stepMs, NOW, 900, 0).reason).toBe("fresh");
    expect(refreshPlan(NOW - 2 * stepMs - 1, NOW, 900, 0).reason).toBe("top-up");
  });

  it("treats a stored candle newer than now as fresh", () => {
    const plan = refreshPlan(NOW + MIN, NOW, 3600, 0);
    expect(plan.reason).toBe("fresh");
  });
});
