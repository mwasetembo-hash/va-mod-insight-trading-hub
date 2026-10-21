import { describe, expect, it } from "vitest";
import { DEFAULT_DERIV_APP_ID, isValidAppId, isValidToken, validateCredentials } from "@/lib/deriv-config";

const testPat = `pat_${"a".repeat(64)}`;

describe("Deriv credentials", () => {
  it("uses the supplied public App ID", () => {
    expect(DEFAULT_DERIV_APP_ID).toBe("34ARk0NOmxpaMAqV6Bwgg");
    expect(isValidAppId(DEFAULT_DERIV_APP_ID)).toBe(true);
  });
  it("accepts the new PAT format without storing an actual credential in tests", () => {
    expect(isValidToken(testPat)).toBe(true);
    expect(validateCredentials(DEFAULT_DERIV_APP_ID, testPat)).toBeNull();
    expect(isValidToken("pat_short")).toBe(false);
  });
  it("keeps legacy credentials compatible", () => {
    expect(validateCredentials("1089", "legacytoken123456")).toBeNull();
  });
  it("rejects mixing legacy and new credentials", () => {
    expect(validateCredentials("1089", testPat)).not.toBeNull();
    expect(validateCredentials(DEFAULT_DERIV_APP_ID, "legacytoken123456")).not.toBeNull();
  });
});