type Msg = Record<string, any>;

export class DerivClient {
  private ws?: WebSocket;
  private reqId = 1;
  private pending = new Map<number, { res: (m: Msg) => void; rej: (e: Error) => void }>();
  private streams = new Map<number, (m: Msg) => void>();
  private closedByUser = false;
  constructor(
    private appId: string,
    private onStatus: (s: "connecting" | "open" | "closed") => void,
    private onReady: () => void,
  ) {}

  connect() {
    this.closedByUser = false;
    this.onStatus("connecting");
    const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${this.appId}`);
    this.ws = ws;
    ws.onopen = () => { this.onStatus("open"); this.onReady(); };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data) as Msg;
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
      if (!this.closedByUser) setTimeout(() => this.connect(), 2500);
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
      this.ws.send(JSON.stringify({ ...req, req_id: id }));
    });
  }

  subscribe(req: Msg, cb: (m: Msg) => void) {
    const id = this.reqId++;
    this.streams.set(id, cb);
    this.ws?.send(JSON.stringify({ ...req, subscribe: 1, req_id: id }));
    return () => this.streams.delete(id);
  }

  close() { this.closedByUser = true; this.ws?.close(); }
}
