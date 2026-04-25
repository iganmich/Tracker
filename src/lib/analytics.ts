import type {
  BuySignalScore,
  BuyZone,
  BuyZoneOptions,
  CycleProjection,
  CycleProjectionResult,
  PricePoint,
  SRResult,
  SignalFactor,
} from "./types";
import { DEFAULT_BUY_ZONE_OPTIONS } from "./types";
import { C } from "./constants";

export function calcSR(data: PricePoint[]): SRResult {
  if (!data.length) return { supports: [], resistances: [] };
  const prices = data.map((d) => d.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min;
  const bucketSize = range / 20;
  const buckets: Record<number, number> = {};
  prices.forEach((p) => {
    const b = Math.floor((p - min) / bucketSize);
    buckets[b] = (buckets[b] || 0) + 1;
  });
  const levels = Object.entries(buckets)
    .filter(([, count]) => count >= 3)
    .map(([b, count]) => ({
      price: min + (parseInt(b, 10) + 0.5) * bucketSize,
      touches: count,
    }))
    .sort((a, b) => b.touches - a.touches)
    .slice(0, 8);
  const cur = prices[prices.length - 1];
  return {
    supports: levels
      .filter((l) => l.price < cur)
      .sort((a, b) => b.price - a.price)
      .slice(0, 4),
    resistances: levels
      .filter((l) => l.price >= cur)
      .sort((a, b) => a.price - b.price)
      .slice(0, 4),
  };
}

export function detectBuyZones(
  data: PricePoint[],
  options: BuyZoneOptions = DEFAULT_BUY_ZONE_OPTIONS,
): BuyZone[] {
  if (data.length < 14) return [];
  const { pumpMin, dropMin, dropMax, recoveryMin } = options;
  const zones: BuyZone[] = [];

  for (let i = 8; i < data.length - 5; i++) {
    const lookbackSlice = data.slice(Math.max(0, i - 20), i - 2);
    const lookback = lookbackSlice.map((d) => d.price);
    if (!lookback.length) continue;
    const prevHigh = Math.max(...lookback);
    const prevHighIdx =
      lookbackSlice.reduce(
        (best, d, j) => (d.price > best.price ? { price: d.price, j } : best),
        { price: 0, j: 0 },
      ).j + Math.max(0, i - 20);

    const beforePeak = data
      .slice(Math.max(0, prevHighIdx - 8), prevHighIdx)
      .map((d) => d.price);
    if (!beforePeak.length) continue;
    const baseBeforePeak = Math.min(...beforePeak);
    const pumpMagnitude = (prevHigh - baseBeforePeak) / baseBeforePeak;
    if (pumpMagnitude < pumpMin) continue;

    const localWindow = data.slice(i - 2, i + 3).map((d) => d.price);
    const localMin = Math.min(...localWindow);
    if (data[i].price > localMin * 1.005) continue;

    const drop = (prevHigh - data[i].price) / prevHigh;
    if (drop < dropMin || drop > dropMax) continue;

    const afterDip = data
      .slice(i + 1, Math.min(data.length, i + 11))
      .map((d) => d.price);
    if (!afterDip.length) continue;
    const peakAfterDip = Math.max(...afterDip);
    const recoveryPct = (peakAfterDip - data[i].price) / data[i].price;
    if (recoveryPct < recoveryMin) continue;

    const sellTarget = data[i].price * (1 + recoveryPct * 0.75);
    let sellIdx = i + 1;
    for (let s = i + 1; s < Math.min(data.length, i + 15); s++) {
      if (data[s].price >= sellTarget) {
        sellIdx = s;
        break;
      }
      sellIdx = s;
    }

    const sellPoint = data[sellIdx];
    const sellPrice = sellPoint?.price ?? peakAfterDip;
    const sellDate =
      sellPoint?.date ?? data[Math.min(data.length - 1, i + 10)].date;

    zones.push({
      ...data[i],
      drop: (drop * 100).toFixed(1),
      prevHigh,
      buyZone: data[i].price,
      sellPrice,
      sellDate,
      recoveryPct: (recoveryPct * 100).toFixed(1),
      actualReturn: ((sellPrice / data[i].price - 1) * 100).toFixed(1),
      label: `BUY ZONE (-${(drop * 100).toFixed(0)}% dip)`,
    });
  }

  const deduped: BuyZone[] = [];
  for (const z of zones) {
    const zDate = new Date(z.date).getTime();
    const clash = deduped.find(
      (d) => Math.abs(new Date(d.date).getTime() - zDate) / 86_400_000 < 7,
    );
    if (!clash) deduped.push(z);
    else if (parseFloat(z.drop) > parseFloat(clash.drop)) {
      deduped.splice(deduped.indexOf(clash), 1, z);
    }
  }

  return deduped;
}

export function projectFutureCycles(
  priceData: PricePoint[],
  buyZones: BuyZone[],
): CycleProjectionResult {
  if (buyZones.length < 2 || !priceData.length) {
    return { projections: [], avgGap: 0, avgDrop: "—" };
  }

  const gaps: number[] = [];
  for (let i = 1; i < buyZones.length; i++) {
    gaps.push(
      Math.round(
        (new Date(buyZones[i].date).getTime() -
          new Date(buyZones[i - 1].date).getTime()) /
          86_400_000,
      ),
    );
  }
  const avgGap = Math.max(
    7,
    Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length),
  );

  const avgDrop =
    buyZones.reduce((a, z) => a + parseFloat(z.drop), 0) / buyZones.length;

  const completedZones = buyZones.filter((z) => z.actualReturn);
  const avgActualReturn =
    completedZones.reduce((a, z) => a + parseFloat(z.actualReturn), 0) /
    Math.max(1, completedZones.length);

  const avgHoldDays = buyZones
    .filter((z) => z.sellDate && z.date)
    .map((z) =>
      Math.round(
        (new Date(z.sellDate).getTime() - new Date(z.date).getTime()) /
          86_400_000,
      ),
    )
    .filter((d) => d > 0 && d < avgGap);
  const holdDays = avgHoldDays.length
    ? Math.round(avgHoldDays.reduce((a, b) => a + b, 0) / avgHoldDays.length)
    : Math.max(4, Math.round(avgGap * 0.45));

  const currentPrice = priceData[priceData.length - 1].price;
  const estBuyPrice = parseFloat(
    (currentPrice * (1 - avgDrop / 100)).toFixed(6),
  );
  const estReturn = Math.max(5, avgActualReturn);
  const estSellPrice = parseFloat(
    (estBuyPrice * (1 + estReturn / 100)).toFixed(6),
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const windowEnd = new Date(today);
  windowEnd.setDate(today.getDate() + 30);

  const projections: CycleProjection[] = [];
  let prevBuyDate = new Date(buyZones[buyZones.length - 1].date);
  let cycleNum = 0;

  for (let iter = 0; iter < 120; iter++) {
    const buyDate = new Date(prevBuyDate);
    buyDate.setDate(prevBuyDate.getDate() + avgGap);

    const sellDate = new Date(buyDate);
    sellDate.setDate(buyDate.getDate() + holdDays);
    const nextBuy = new Date(buyDate);
    nextBuy.setDate(buyDate.getDate() + avgGap - 1);
    if (sellDate >= nextBuy) sellDate.setDate(nextBuy.getDate() - 1);

    cycleNum++;
    prevBuyDate = new Date(buyDate);

    if (sellDate < today) continue;

    const daysAway = Math.round(
      (buyDate.getTime() - today.getTime()) / 86_400_000,
    );
    const isActive = buyDate <= today && sellDate >= today;
    const isUpcoming = buyDate > today && buyDate <= windowEnd;

    if (!isActive && !isUpcoming && projections.length > 0) break;

    let confidence: CycleProjection["confidence"];
    let confidenceColor: string;
    if (isActive) {
      confidence = "Active Now";
      confidenceColor = C.red;
    } else if (daysAway <= 10) {
      confidence = "High";
      confidenceColor = C.green;
    } else if (daysAway <= 20) {
      confidence = "Medium";
      confidenceColor = C.yellow;
    } else {
      confidence = "Low";
      confidenceColor = C.muted;
    }

    const actualHold = Math.round(
      (sellDate.getTime() - buyDate.getTime()) / 86_400_000,
    );

    projections.push({
      cycle: cycleNum,
      buyDate: buyDate.toISOString().split("T")[0],
      sellDate: sellDate.toISOString().split("T")[0],
      estBuyPrice,
      estSellPrice,
      estReturn: estReturn.toFixed(1),
      confidence,
      confidenceColor,
      daysAway,
      isActive,
      holdDays: actualHold,
    });

    if (projections.length >= 6) break;
  }

  return {
    projections,
    avgGap,
    avgDrop: avgDrop.toFixed(1),
    holdDays,
  };
}

function timeFactor(daysAway: number, isActive: boolean): SignalFactor {
  if (isActive)
    return {
      score: 30,
      max: 30,
      label: "Time",
      detail: "Cycle window is active right now",
    };
  if (daysAway <= 5)
    return {
      score: 25,
      max: 30,
      label: "Time",
      detail: `Buy window in ${daysAway}d (very near)`,
    };
  if (daysAway <= 10)
    return {
      score: 20,
      max: 30,
      label: "Time",
      detail: `Buy window in ${daysAway}d`,
    };
  if (daysAway <= 20)
    return {
      score: 10,
      max: 30,
      label: "Time",
      detail: `Buy window in ${daysAway}d (still distant)`,
    };
  return {
    score: 0,
    max: 30,
    label: "Time",
    detail: `Buy window ${daysAway}d away`,
  };
}

function priceFactor(
  currentPrice: number,
  projectedBuy: number,
): { factor: SignalFactor; proximityPct: number } {
  const diff = (currentPrice - projectedBuy) / projectedBuy;
  const pct = diff * 100;
  if (diff <= 0)
    return {
      factor: {
        score: 30,
        max: 30,
        label: "Price",
        detail: `At/below projected buy ($${projectedBuy.toFixed(5)})`,
      },
      proximityPct: pct,
    };
  if (diff <= 0.05)
    return {
      factor: {
        score: 25,
        max: 30,
        label: "Price",
        detail: `Within 5% of buy target (${pct.toFixed(1)}% above)`,
      },
      proximityPct: pct,
    };
  if (diff <= 0.1)
    return {
      factor: {
        score: 18,
        max: 30,
        label: "Price",
        detail: `Within 10% of buy target (${pct.toFixed(1)}% above)`,
      },
      proximityPct: pct,
    };
  if (diff <= 0.2)
    return {
      factor: {
        score: 8,
        max: 30,
        label: "Price",
        detail: `${pct.toFixed(1)}% above buy target`,
      },
      proximityPct: pct,
    };
  return {
    factor: {
      score: 0,
      max: 30,
      label: "Price",
      detail: `${pct.toFixed(1)}% above buy target`,
    },
    proximityPct: pct,
  };
}

function pumpFactor(
  data: PricePoint[],
  options: BuyZoneOptions,
): SignalFactor {
  const window = data.slice(-20).map((d) => d.price);
  if (window.length < 4)
    return {
      score: 0,
      max: 25,
      label: "Pump",
      detail: "Not enough price history",
    };
  const min = Math.min(...window);
  const max = Math.max(...window);
  const pump = (max - min) / min;
  if (pump >= options.pumpMin)
    return {
      score: 25,
      max: 25,
      label: "Pump",
      detail: `${(pump * 100).toFixed(1)}% rise in last 20d (algorithm primed)`,
    };
  if (pump >= options.pumpMin * 0.5)
    return {
      score: 12,
      max: 25,
      label: "Pump",
      detail: `Only ${(pump * 100).toFixed(1)}% rise (need ${(options.pumpMin * 100).toFixed(0)}%)`,
    };
  return {
    score: 0,
    max: 25,
    label: "Pump",
    detail: `No pump (${(pump * 100).toFixed(1)}% range, need ${(options.pumpMin * 100).toFixed(0)}%)`,
  };
}

function momentumFactor(data: PricePoint[]): SignalFactor {
  if (data.length < 8)
    return {
      score: 0,
      max: 15,
      label: "Momentum",
      detail: "Not enough history",
    };
  const last = data[data.length - 1].price;
  const weekAgo = data[data.length - 8].price;
  const change = ((last - weekAgo) / weekAgo) * 100;
  if (change <= -3)
    return {
      score: 15,
      max: 15,
      label: "Momentum",
      detail: `Falling ${change.toFixed(1)}% / 7d (dip in progress)`,
    };
  if (change <= 0)
    return {
      score: 8,
      max: 15,
      label: "Momentum",
      detail: `Down ${change.toFixed(1)}% / 7d`,
    };
  if (change <= 3)
    return {
      score: 3,
      max: 15,
      label: "Momentum",
      detail: `Flat (${change.toFixed(1)}% / 7d)`,
    };
  return {
    score: 0,
    max: 15,
    label: "Momentum",
    detail: `Rising ${change.toFixed(1)}% / 7d (no dip yet)`,
  };
}

export function computeBuySignal(
  priceData: PricePoint[],
  projection: CycleProjection,
  options: BuyZoneOptions = DEFAULT_BUY_ZONE_OPTIONS,
): BuySignalScore | null {
  if (!priceData.length) return null;
  const currentPrice = priceData[priceData.length - 1].price;
  const recentHigh = Math.max(...priceData.slice(-20).map((d) => d.price));

  const time = timeFactor(projection.daysAway, projection.isActive);
  const { factor: price, proximityPct } = priceFactor(
    currentPrice,
    projection.estBuyPrice,
  );
  const pump = pumpFactor(priceData, options);
  const momentum = momentumFactor(priceData);

  const total = time.score + price.score + pump.score + momentum.score;

  const warnings: string[] = [];
  if (pump.score === 0)
    warnings.push(
      "No qualifying pump in recent history — buy zone unlikely to fire even on schedule.",
    );
  if (price.score <= 8)
    warnings.push(
      "Price is well above projected buy target — wait for a dip.",
    );
  if (momentum.score === 0 && pump.score > 0)
    warnings.push(
      "Price still rising — pump may not be exhausted yet.",
    );

  let rating: BuySignalScore["rating"];
  let ratingColor: string;
  if (total >= 75) {
    rating = "Strong Buy";
    ratingColor = C.green;
  } else if (total >= 50) {
    rating = "Watch";
    ratingColor = C.yellow;
  } else if (total >= 25) {
    rating = "Wait";
    ratingColor = C.muted;
  } else {
    rating = "No Signal";
    ratingColor = C.red;
  }

  return {
    total,
    rating,
    ratingColor,
    factors: { time, price, pump, momentum },
    warnings,
    currentPrice,
    projectedBuyPrice: projection.estBuyPrice,
    recentHigh,
    proximityPct,
  };
}
