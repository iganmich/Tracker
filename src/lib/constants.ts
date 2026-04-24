import type { TabDef, UnlockEvent } from "./types";

export const UNLOCK_EVENTS: UnlockEvent[] = [
  { date: "2025-11-24", label: "Launch + Airdrop", amount: "10.8B", category: "Multiple" },
  { date: "2025-12-24", label: "Validator Rewards", amount: "~170M", category: "Validator" },
  { date: "2026-01-24", label: "Validator Rewards", amount: "~170M", category: "Validator" },
  { date: "2026-02-24", label: "Category Labs Treasury", amount: "~83M", category: "Treasury" },
  { date: "2026-03-24", label: "Validator Rewards", amount: "~170M", category: "Validator" },
  { date: "2026-04-24", label: "Validator Rewards + Treasury", amount: "~253M", category: "Multiple" },
  { date: "2026-05-24", label: "Validator Rewards", amount: "~170M", category: "Validator" },
  { date: "2026-06-24", label: "Validator Rewards + Treasury", amount: "~253M", category: "Multiple" },
];

export const TABS: TabDef[] = [
  { id: "unlock", label: "🔓 Unlock Tracker" },
  { id: "cycles", label: "📈 Investment Cycles" },
  { id: "levels", label: "🎯 Support & Resistance" },
  { id: "backtest", label: "🔬 Backtest" },
];

export const C = {
  bg: "#070a14",
  surface: "rgba(255,255,255,0.03)",
  border: "rgba(255,255,255,0.07)",
  green: "#00e5a0",
  yellow: "#ffc130",
  red: "#ff4d6d",
  blue: "#4d9fff",
  purple: "#a78bfa",
  text: "#c8d0e0",
  muted: "#566070",
  font: "'JetBrains Mono', 'Courier New', monospace",
} as const;
