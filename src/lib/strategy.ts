// Indexed numeric arrays below are always in-bounds.
export type ContractKind = "DIGITDIFF" | "DIGITMATCH" | "DIGITOVER" | "DIGITUNDER" | "DIGITEVEN" | "DIGITODD";
export type StrategyMode = "classic" | "overunder" | "differs" | "evenodd";

export interface MgConfig {
  base: number;
  multiplier: number;
  maxLevels: number;
  startAfterLoss: number;
  stopAfterMax: boolean;
}
export interface MgState {
  level: number;
  losses: number;
  stopped: boolean;
}

export const initialMg: MgState = { level: 0, losses: 0, stopped: false };
const r2 = (n: number) => Math.round(n * 100) / 100;

export function stakeFor(cfg: MgConfig, s: MgState) {
  return r2(cfg.base * Math.pow(cfg.multiplier, s.level));
}

/** Win resets. Loss #startAfterLoss begins level 1. A loss at max level stops (or resets). */
export function applyResult(cfg: MgConfig, s: MgState, won: boolean): MgState {
  if (won) return { ...initialMg };
  if (s.level >= cfg.maxLevels) {
    return cfg.stopAfterMax ? { ...s, losses: s.losses + 1, stopped: true } : { ...initialMg };
  }
  const losses = s.losses + 1;
  const level = Math.min(cfg.maxLevels, Math.max(0, losses - cfg.startAfterLoss + 1));
  return { level, losses, stopped: false };
}

export function phasesFor(mode: StrategyMode): ContractKind[] {
  switch (mode) {
    case "classic": return ["DIGITDIFF", "DIGITOVER", "DIGITUNDER"];
    case "overunder": return ["DIGITOVER", "DIGITUNDER"];
    case "differs": return ["DIGITDIFF"];
    case "evenodd": return ["DIGITEVEN"];
  }
}

export function digitFrequency(digits: number[]) {
  const f: number[] = Array(10).fill(0);
  digits.forEach((d) => f[d]++);
  return f;
}

/** Resolve phase into a concrete contract with barrier based on real digit stats. */
export function resolveContract(kind: ContractKind, freq: number[], over: number, under: number) {
  if (kind === "DIGITDIFF") {
    let min = 0;
    freq.forEach((v, i) => { if (v < freq[min]) min = i; });
    return { type: "DIGITDIFF" as ContractKind, barrier: min };
  }
  if (kind === "DIGITOVER") return { type: kind, barrier: over };
  if (kind === "DIGITUNDER") return { type: kind, barrier: under };
  const even = freq.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0);
  const odd = freq.reduce((a, b) => a + b, 0) - even;
  return { type: (even >= odd ? "DIGITEVEN" : "DIGITODD") as ContractKind, barrier: undefined };
}

export function marketProfile(prices: number[], bins = 30) {
  if (prices.length < 5) return null;
  const lo = Math.min(...prices), hi = Math.max(...prices);
  if (hi === lo) return { poc: lo, vah: hi, val: lo };
  const w = (hi - lo) / bins;
  const h = Array(bins).fill(0) as number[];
  prices.forEach((p) => h[Math.min(bins - 1, Math.floor((p - lo) / w))]++);
  let poc = 0;
  h.forEach((v, i) => { if (v > h[poc]) poc = i; });
  let a = poc, b = poc, sum = h[poc];
  const target = prices.length * 0.7;
  while (sum < target && (a > 0 || b < bins - 1)) {
    const up = b < bins - 1 ? h[b + 1] : -1, dn = a > 0 ? h[a - 1] : -1;
    if (up >= dn) sum += h[++b]; else sum += h[--a];
  }
  const mid = (i: number) => lo + (i + 0.5) * w;
  return { poc: mid(poc), vah: lo + (b + 1) * w, val: lo + a * w };
}

export function lastDigit(price: number, pip: number) {
  const s = price.toFixed(pip);
  return Number(s[s.length - 1]);
}

export function digitWins(type: ContractKind, barrier: number | undefined, d: number) {
  switch (type) {
    case "DIGITDIFF": return d !== barrier;
    case "DIGITMATCH": return d === barrier;
    case "DIGITOVER": return d > (barrier ?? 0);
    case "DIGITUNDER": return d < (barrier ?? 9);
    case "DIGITEVEN": return d % 2 === 0;
    case "DIGITODD": return d % 2 === 1;
  }
}

export { isValidToken, isValidAppId } from "./deriv-config";

// ---- System Recovery: win back drawdown with sized recovery stakes ----
export interface RecoveryConfig {
  enabled: boolean;
  /** Fraction of the outstanding drawdown added to the base stake each trade (0-1). */
  perTrade: number;
  /** Hard cap on any single recovery stake. */
  maxStake: number;
}
export interface RecoveryState {
  /** Outstanding losses still to be recovered. */
  drawdown: number;
  active: boolean;
}
export const initialRecovery: RecoveryState = { drawdown: 0, active: false };

/** Stake while recovering: base plus a fraction of the outstanding drawdown, capped. */
export function recoveryStake(cfg: RecoveryConfig, base: number, r: RecoveryState) {
  if (!cfg.enabled || !r.active || r.drawdown <= 0) return r2(base);
  return r2(Math.min(cfg.maxStake, base + r.drawdown * cfg.perTrade));
}

/** Feed a settled trade's net profit into the recovery pool. Losses grow it, wins shrink it. */
export function applyRecovery(cfg: RecoveryConfig, r: RecoveryState, net: number): RecoveryState {
  if (!cfg.enabled) return { ...initialRecovery };
  const drawdown = r2(Math.max(0, r.drawdown - net));
  return { drawdown, active: drawdown > 0 };
}
