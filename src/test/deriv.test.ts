import { afterEach, describe, expect, it, vi } from "vitest";
import { DerivClient, selectOptionsAccount } from "@/lib/deriv";
import { DEFAULT_DERIV_APP_ID } from "@/lib/deriv-config";

const demo = { account_id: "DOT12345", account_type: "demo", status: "active", balance: "10000", currency: "USD" };
const real = { account_id: "CR12345", account_type: "real", status: "active", balance: "50", currency: "USD" };

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Deriv Options account safety", () => {
  it("prefers demo accounts, even if real trading is enabled", () => {
    expect(selectOptionsAccount([real, demo], true)).toEqual({ loginid: "DOT12345", virtual: true, balance: 10000, currency: "USD" });
  });
  it("never selects a real account without explicit opt-in", () => {
    expect(() => selectOptionsAccount([real])).toThrow("No active demo account");
  });
  it("allows a real account only with explicit opt-in", () => {
    expect(selectOptionsAccount([real], true).virtual).toBe(false);
  });
  it("does not connect to a disabled demo account", () => {
    expect(() => selectOptionsAccount([{ ...demo, status: "disabled" }])).toThrow("No active demo account");
  });
});

describe("Deriv connection", () => {
  it("gets an account-specific OTP with PAT headers instead of legacy authorize", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [real, demo] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { url: "wss://api.derivws.com/trading/v1/options/ws/demo?otp=test-only" } }) });
    vi.stubGlobal("fetch", fetchMock);
    const socket = { readyState: 1, send: vi.fn(), close: vi.fn() };
    const SocketMock = vi.fn(function () { return socket; });
    vi.stubGlobal("WebSocket", SocketMock);
    const account = vi.fn();
    const testToken = `pat_${"a".repeat(64)}`;
    const client = new DerivClient(DEFAULT_DERIV_APP_ID, vi.fn(), vi.fn(), { token: testToken, onAccount: account });
    await client.connect();
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.derivws.com/trading/v1/options/accounts");
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: `Bearer ${testToken}`, "Deriv-App-ID": DEFAULT_DERIV_APP_ID });
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.derivws.com/trading/v1/options/accounts/DOT12345/otp");
    expect(fetchMock.mock.calls[1][1].method).toBe("POST");
    expect(SocketMock).toHaveBeenCalledWith("wss://api.derivws.com/trading/v1/options/ws/demo?otp=test-only");
    expect(account.mock.calls[0][0].virtual).toBe(true);
    const proposal = client.send({ proposal: 1, symbol: "R_100", amount: 0.35 });
    expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({ proposal: 1, underlying_symbol: "R_100", amount: 0.35, req_id: 1 });
    const onmessage = (socket as typeof socket & { onmessage?: (event: { data: string }) => void }).onmessage;
    onmessage?.({ data: JSON.stringify({ req_id: 1, proposal: { id: "test-proposal" } }) });
    await proposal;
    client.close();
  });
  it("connects to public market data without needing a private token", async () => {
    vi.useFakeTimers();
    const SocketMock = vi.fn(function () { return { close: vi.fn() }; });
    vi.stubGlobal("WebSocket", SocketMock);
    const client = new DerivClient(DEFAULT_DERIV_APP_ID, vi.fn(), vi.fn());
    await client.connect();
    expect(SocketMock).toHaveBeenCalledWith("wss://api.derivws.com/trading/v1/options/ws/public");
    client.close();
  });
  it("does not echo a private response body when authentication fails", async () => {
    const error = vi.fn();
    const json = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json }));
    const client = new DerivClient(DEFAULT_DERIV_APP_ID, vi.fn(), vi.fn(), { token: `pat_${"a".repeat(64)}`, onError: error });
    await client.connect();
    expect(error).toHaveBeenCalledWith("Deriv connection failed (401). Check your App ID and personal access token.");
    expect(json).not.toHaveBeenCalled();
  });
});