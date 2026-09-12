"use client";

import type { PricePoint } from "@/lib/types";

interface GridAnalystTabProps {
  priceData: PricePoint[];
  currentPrice: number | null;
}

export function GridAnalystTab({}: GridAnalystTabProps) {
  return <p className="text-[11px]">Grid Analyst — coming in Task 9.</p>;
}
