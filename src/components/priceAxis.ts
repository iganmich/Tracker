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
