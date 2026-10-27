import { describe, it, expect } from "vitest";
import { applyResult, initialMg, stakeFor, phasesFor, applyRecovery, initialRecovery, recoveryStake, digitWins, type MgConfig, type RecoveryConfig } from "@/lib/strategy";

const cfg: MgConfig = { base: 0.35, multiplier: 3.75, maxLevels: 3, startAfterLoss: 1, stopAfterMax: true };

describe("martingale", () => {
  it("base stake is 0.35", () => expect(stakeFor(cfg, initialMg)).toBe(0.35));
  it("first loss moves to level 1 at x3.75", () => {
    const s = applyResult(cfg, initialMg, false);
    expect(s.level).toBe(1);
    expect(stakeFor(cfg, s)).toBe(1.31);
  });
  it("win resets to base", () => {
    const s = applyResult(cfg, applyResult(cfg, initialMg, false), true);
    expect(s.level).toBe(0);
  });
  it("stops after losing at max level 3", () => {
    let s = initialMg;
    for (let i = 0; i < 3; i++) s = applyResult(cfg, s, false);
    expect(s.level).toBe(3);
    expect(s.stopped).toBe(false);
    s = applyResult(cfg, s, false);
    expect(s.stopped).toBe(true);
  });
  it("classic cycle is Differs, Over, Under", () =>
    expect(phasesFor("classic")).toEqual(["DIGITDIFF", "DIGITOVER", "DIGITUNDER"]));
  it("matches wins only on the exact barrier digit", () => {
    expect(digitWins("DIGITMATCH", 5, 5)).toBe(true);
    expect(digitWins("DIGITMATCH", 5, 4)).toBe(false);
  });
});

const recCfg: RecoveryConfig = { enabled: true, perTrade: 0.5, maxStake: 10 };

describe("system recovery", () => {
  it("a loss grows the drawdown and activates recovery", () => {
    const r = applyRecovery(recCfg, initialRecovery, -1);
    expect(r.drawdown).toBe(1);
    expect(r.active).toBe(true);
  });
  it("recovery stake adds half the drawdown to the base stake", () => {
    const r = applyRecovery(recCfg, initialRecovery, -2);
    expect(recoveryStake(recCfg, 0.35, r)).toBe(1.35);
  });
  it("recovery stake is capped at maxStake", () => {
    const r = applyRecovery(recCfg, initialRecovery, -100);
    expect(recoveryStake(recCfg, 0.35, r)).toBe(10);
  });
  it("a win shrinks the drawdown and full recovery deactivates", () => {
    let r = applyRecovery(recCfg, initialRecovery, -2);
    r = applyRecovery(recCfg, r, 1.5);
    expect(r.drawdown).toBe(0.5);
    expect(r.active).toBe(true);
    r = applyRecovery(recCfg, r, 0.5);
    expect(r).toEqual({ drawdown: 0, active: false });
  });
  it("disabled recovery keeps the base stake and no drawdown", () => {
    const off: RecoveryConfig = { ...recCfg, enabled: false };
    const r = applyRecovery(off, initialRecovery, -5);
    expect(r).toEqual(initialRecovery);
    expect(recoveryStake(off, 0.35, r)).toBe(0.35);
  });
});
