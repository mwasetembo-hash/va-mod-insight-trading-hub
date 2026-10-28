// Deriv "Only Ups / Only Downs" (contract types RUNHIGH / RUNLOW).
// Wins only if EVERY tick in the contract is strictly higher (or lower) than the previous one.
export type RunDir = "RUNHIGH" | "RUNLOW";
export const RUN_MIN_TICKS = 2;
export const RUN_MAX_TICKS = 5;

export function clampRunTicks(n: number) {
  return Math.max(RUN_MIN_TICKS, Math.min(RUN_MAX_TICKS, Math.round(n)));
}

/** entry = spot at purchase; path = the following ticks. */
export function runWins(dir: RunDir, entry: number, path: number[]) {
  let prev = entry;
  for (const p of path) {
    if (dir === "RUNHIGH" ? p <= prev : p >= prev) return false;
    prev = p;
  }
  return path.length > 0;
}

/** Auto-detect direction from the recent tick streak + signal bias. Returns null when unclear. */
export function detectRunDir(prices: number[], bias: "CALL" | "PUT" | null): RunDir | null {
  if (prices.length < 6) return null;
  const last = prices.slice(-6);
  let ups = 0, downs = 0;
  for (let i = 1; i < last.length; i++) { if (last[i] > last[i - 1]) ups++; else if (last[i] < last[i - 1]) downs++; }
  if (ups >= 4 && bias !== "PUT") return "RUNHIGH";
  if (downs >= 4 && bias !== "CALL") return "RUNLOW";
  return null;
}

/** Validate Deriv's contracts_for response before any order: type offered, tick duration in range. */
export function runSupported(available: { contract_type: string; min_contract_duration?: string; max_contract_duration?: string }[], dir: RunDir, ticks: number): string | null {
  const spec = available.find((c) => c.contract_type === dir);
  if (!spec) return `${dir === "RUNHIGH" ? "Only Ups" : "Only Downs"} is not offered on this market.`;
  const min = parseInt(spec.min_contract_duration ?? `${RUN_MIN_TICKS}`, 10);
  const max = parseInt(spec.max_contract_duration ?? `${RUN_MAX_TICKS}`, 10);
  if (ticks < min || ticks > max) return `Duration must be ${min}-${max} ticks on this market.`;
  return null;
}
