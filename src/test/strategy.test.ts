import { describe, it, expect } from "vitest";
import { applyResult, initialMg, stakeFor, phasesFor, type MgConfig } from "@/lib/strategy";

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
});
