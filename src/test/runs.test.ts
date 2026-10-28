import { describe, expect, it } from "vitest";
import { clampRunTicks, detectRunDir, runSupported, runWins } from "@/lib/runs";

describe("Only Ups / Only Downs", () => {
  it("Only Ups wins only when every tick rises", () => {
    expect(runWins("RUNHIGH", 1, [2, 3, 4])).toBe(true);
    expect(runWins("RUNHIGH", 1, [2, 2, 4])).toBe(false);
  });
  it("Only Downs wins only when every tick falls", () => {
    expect(runWins("RUNLOW", 5, [4, 3])).toBe(true);
    expect(runWins("RUNLOW", 5, [4, 6])).toBe(false);
  });
  it("duration is limited to 2-5 ticks", () => {
    expect(clampRunTicks(1)).toBe(2);
    expect(clampRunTicks(9)).toBe(5);
  });
  it("auto-detects direction from a tick streak", () => {
    expect(detectRunDir([1, 2, 3, 4, 5, 6], null)).toBe("RUNHIGH");
    expect(detectRunDir([6, 5, 4, 3, 2, 1], null)).toBe("RUNLOW");
    expect(detectRunDir([1, 2, 1, 2, 1, 2], null)).toBeNull();
  });
  it("blocks orders when the market does not offer the contract", () => {
    expect(runSupported([{ contract_type: "CALL" }], "RUNHIGH", 3)).not.toBeNull();
    expect(runSupported([{ contract_type: "RUNHIGH", min_contract_duration: "2t", max_contract_duration: "5t" }], "RUNHIGH", 3)).toBeNull();
    expect(runSupported([{ contract_type: "RUNLOW", min_contract_duration: "2t", max_contract_duration: "5t" }], "RUNLOW", 6)).not.toBeNull();
  });
});
