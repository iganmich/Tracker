/**
 * Chart axis ticks, short at every price scale the coin registry covers
 * (BTC ≈ 78,000 down to MON ≈ 0.031). Tooltips and tables use the coin's
 * full precision via `usePriceFormat`; axes trade precision for width.
 */
export function formatAxisPrice(v: number): string {
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (v >= 100) return v.toFixed(0);
  if (v >= 1) return v.toFixed(2);
  return v.toFixed(4);
}

/**
 * Y-axis domain hugging the data: [min − pad, max + pad] with 5 % padding, so a coin that trades
 * between 0.019 and 0.032 fills the chart instead of sitting in the top third above a zero baseline.
 * Extra values (support/resistance levels, band edges) are included so reference lines stay visible.
 */
export function priceDomain(values: Array<number | null | undefined>, padFraction = 0.05): [number, number] {
  const vals = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (vals.length === 0) return [0, 1];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo) * padFraction || lo * padFraction || 1;
  return [Math.max(0, lo - pad), hi + pad];
}
