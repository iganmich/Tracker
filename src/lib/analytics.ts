import type {
  BuyZone,
  CycleProjection,
  CycleProjectionResult,
  PricePoint,
  SRResult,
} from "./types";
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

export function detectBuyZones(data: PricePoint[]): BuyZone[] {
  if (data.length < 14) return [];
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
    if (pumpMagnitude < 0.1) continue;

    const localWindow = data.slice(i - 2, i + 3).map((d) => d.price);
    const localMin = Math.min(...localWindow);
    if (data[i].price > localMin * 1.005) continue;

    const drop = (prevHigh - data[i].price) / prevHigh;
    if (drop < 0.1 || drop > 0.7) continue;

    const afterDip = data
      .slice(i + 1, Math.min(data.length, i + 11))
      .map((d) => d.price);
    if (!afterDip.length) continue;
    const peakAfterDip = Math.max(...afterDip);
    const recoveryPct = (peakAfterDip - data[i].price) / data[i].price;
    if (recoveryPct < 0.08) continue;

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
