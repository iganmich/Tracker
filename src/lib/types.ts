export type UnlockCategory = "Multiple" | "Validator" | "Treasury";

export interface UnlockEvent {
  date: string;
  label: string;
  amount: string;
  category: UnlockCategory;
}

export interface PricePoint {
  date: string;
  displayDate: string;
  price: number;
  unlock: UnlockEvent | null;
}

export interface BuyZone {
  date: string;
  displayDate: string;
  price: number;
  unlock: UnlockEvent | null;
  drop: string;
  prevHigh: number;
  buyZone: number;
  sellPrice: number;
  sellDate: string;
  recoveryPct: string;
  actualReturn: string;
  label: string;
}

export interface EnrichedPricePoint extends PricePoint {
  drop?: string;
  prevHigh?: number;
  buyZone?: number;
  sellPrice?: number;
  sellDate?: string;
  recoveryPct?: string;
  actualReturn?: string;
  label?: string;
  isBuyZone: boolean;
}

export interface SRLevel {
  price: number;
  touches: number;
  manual?: boolean;
}

export interface ManualLevel {
  price: number;
  type: "support" | "resistance";
  manual: true;
  touches?: number;
}

export interface SRResult {
  supports: SRLevel[];
  resistances: SRLevel[];
}

export interface CycleProjection {
  cycle: number;
  buyDate: string;
  sellDate: string;
  estBuyPrice: number;
  estSellPrice: number;
  estReturn: string;
  confidence: "Active Now" | "High" | "Medium" | "Low";
  confidenceColor: string;
  daysAway: number;
  isActive: boolean;
  holdDays: number;
}

export interface CycleProjectionResult {
  projections: CycleProjection[];
  avgGap: number;
  avgDrop: string;
  holdDays?: number;
}

export interface BuyZoneOptions {
  pumpMin: number;
  dropMin: number;
  dropMax: number;
  recoveryMin: number;
}

export const DEFAULT_BUY_ZONE_OPTIONS: BuyZoneOptions = {
  pumpMin: 0.1,
  dropMin: 0.1,
  dropMax: 0.7,
  recoveryMin: 0.08,
};

export interface SignalFactor {
  score: number;
  max: number;
  label: string;
  detail: string;
}

export interface BuySignalScore {
  total: number;
  rating: "Strong Buy" | "Watch" | "Wait" | "No Signal";
  ratingColor: string;
  factors: {
    time: SignalFactor;
    price: SignalFactor;
    pump: SignalFactor;
    momentum: SignalFactor;
  };
  warnings: string[];
  currentPrice: number;
  projectedBuyPrice: number;
  recentHigh: number;
  proximityPct: number;
}

export type TabId = "unlock" | "cycles" | "levels" | "backtest";

export interface TabDef {
  id: TabId;
  label: string;
}
