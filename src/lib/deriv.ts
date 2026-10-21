import { isLegacyAppId, validateCredentials } from "./deriv-config";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Msg = any;

export type DerivAccount = { loginid: string; virtual: boolean; balance: number; currency: string };
type OptionsAccount = { account_id: string; account_type: string; balance: number | string; currency: string; status?: string };
type ConnectionOptions = {
  token?: string;
  allowLive?: boolean;
  onAccount?: (account: DerivAccount) => void;
  onError?: (message: string) => void;
};
const REST_URL = "https://api.derivws.com/trading/v1/options";

export function selectOptionsAccount(accounts: OptionsAccount[], allowLive = false): DerivAccount {
  const active = accounts.filter((a) => a.status === undefined || a.status === "active");
  const account = active.find((a) => a.account_type === "demo")
    ?? (allowLive ? active.find((a) => a.account_type === "real") : undefined);
  if (!account) throw new Error("No active demo account found. Create a Deriv Options demo account, or explicitly allow real-money trading.");
  return { loginid: account.account_id, virtual: account.account_type === "demo", balance: Number(account.balance), currency: account.currency };
}

export class DerivClient {
  private ws?: WebSocket;
  private reqId = 1;
  private pending = new Map<number, { res: (m: Msg) => void; rej: (e: Error) => void }>();
  private streams = new Map<number, (m: Msg) => void>();
  private closedByUser = false;
  private retry?: ReturnType<typeof setTimeout>;
  private abort?: AbortController;
  private generation = 0;
  readonly modern: boolean;
  constructor(
    private appId: string,
    private onStatus: (s: "connecting" | "open" | "closed") => void,
    private onReady: () => void,
    private options: ConnectionOptions = {},
  ) { this.modern = !isLegacyAppId(appId); }

  private async rest(path: string, method: "GET" | "POST", signal: AbortSignal): Promise<Msg> {
    const response = await fetch(`${REST_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.options.token?.trim() ?? ""}`, "Deriv-App-ID": this.appId.trim() },
      signal,
    });
    // Never surface a response body which may echo credentials.
    if (!response.ok) {
      const reason = response.status === 401 ? "Check your App ID and personal access token."
        : response.status === 403 ? "Check that your token has the trade permission."
        : "Please try again.";
      throw new Error(`Deriv connection failed (${response.status}). ${reason}`);
    }
    return response.json();
  }

  private async socketUrl(signal: AbortSignal): Promise<string> {
    const validation = validateCredentials(this.appId, this.options.token ?? "");
    if (validation) throw new Error(validation);
    if (!this.modern) return `wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(this.appId.trim())}`;
    if (!this.options.token) return `${REST_URL.replace("https:", "wss:")}/ws/public`;
    const response = await this.rest("/accounts", "GET", signal);
    if (!Array.isArray(response.data)) throw new Error("Deriv returned no account list.");
    const account = selectOptionsAccount(response.data, this.options.allowLive);
    const otp = await this.rest(`/accounts/${encodeURIComponent(account.loginid)}/otp`, "POST", signal);
    const url = new URL(otp.data?.url ?? "");
    const expectedPath = `/trading/v1/options/ws/${account.virtual ? "demo" : "real"}`;
    if (url.protocol !== "wss:" || url.hostname !== "api.derivws.com" || url.pathname !== expectedPath || !url.searchParams.get("otp")) {
      throw new Error("Deriv returned an invalid connection address.");
    }
    if (!signal.aborted) this.options.onAccount?.(account);
    return url.href;
  }

  async connect() {
    this.closedByUser = false;
    const generation = ++this.generation;
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    this.onStatus("connecting");
    let url: string;
    try { url = await this.socketUrl(abort.signal); }
    catch (error) {
      if (abort.signal.aborted || generation !== this.generation) return;
      this.onStatus("closed");
      this.options.onError?.(error instanceof TypeError ? "Deriv could not be reached. Check your connection and try again." : error instanceof Error ? error.message : "Deriv connection failed.");
      return;
    }
    if (this.closedByUser || generation !== this.generation) return;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => { this.onStatus("open"); this.onReady(); };
    ws.onmessage = (e) => {
      let m: Msg;
      try { m = JSON.parse(e.data) as Msg; } catch { return; }
      const id = m.req_id as number;
      const s = this.streams.get(id);
      if (s) { s(m); }
      const p = this.pending.get(id);
      if (p) {
        this.pending.delete(id);
        if (m.error) p.rej(new Error(m.error.message)); else p.res(m);
      }
    };
    ws.onclose = () => {
      this.onStatus("closed");
      this.pending.forEach((p) => p.rej(new Error("Connection lost")));
      this.pending.clear();
      this.streams.clear();
      if (!this.closedByUser && generation === this.generation) this.retry = setTimeout(() => { void this.connect(); }, 2500);
    };
    const ping = setInterval(() => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ ping: 1 }));
      if (ws.readyState > 1) clearInterval(ping);
    }, 30000);
  }

  send(req: Msg): Promise<Msg> {
    const id = this.reqId++;
    return new Promise((res, rej) => {
      if (!this.ws || this.ws.readyState !== 1) return rej(new Error("Not connected"));
      this.pending.set(id, { res, rej });
      const payload = this.modern && req.proposal && req.symbol
        ? Object.fromEntries(Object.entries({ ...req, underlying_symbol: req.symbol }).filter(([key]) => key !== "symbol"))
        : req;
      this.ws.send(JSON.stringify({ ...payload, req_id: id }));
    });
  }

  subscribe(req: Msg, cb: (m: Msg) => void) {
    const id = this.reqId++;
    this.streams.set(id, cb);
    this.ws?.send(JSON.stringify({ ...req, subscribe: 1, req_id: id }));
    return () => this.streams.delete(id);
  }

  close() {
    this.closedByUser = true;
    this.generation++;
    this.abort?.abort();
    if (this.retry) clearTimeout(this.retry);
    this.ws?.close();
  }
}
