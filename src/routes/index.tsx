import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PriceChart, type Candle } from "@/components/PriceChart";
import { DerivClient } from "@/lib/deriv";
import {
  applyResult, digitFrequency, digitWins, initialMg, isValidAppId, isValidToken, lastDigit,
  marketProfile, phasesFor, resolveContract, stakeFor, type ContractKind, type MgState, type StrategyMode,
} from "@/lib/strategy";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Va-Mod Trading Hub | Va-Mod Insight Engine" },
      { name: "description", content: "Digit strategy hub for Deriv with live ticks, market profile (POC/VAH/VAL), digit frequency and a martingale engine. Demo account first." },
      { property: "og:title", content: "Va-Mod Trading Hub" },
      { property: "og:description", content: "Va-Mod Insight Engine: real Deriv ticks, market profile and digit strategy automation." },
    ],
  }),
  component: Hub,
});

type Tick = { epoch: number; quote: number; digit: number };
type Ledger = { time: string; symbol: string; type: string; stake: number; result: "WIN" | "LOSS"; profit: number; sim: boolean };
type Cfg = { appId: string; token: string; fcs: string; odds: string; allowLive: boolean };
const CFG_KEY = "vamod-config";
const TF: Record<string, number> = { "60": 3600, "15": 900, "5": 300, tick: 10 };
const LABEL: Record<string, string> = { DIGITDIFF: "Differs", DIGITOVER: "Over", DIGITUNDER: "Under", DIGITEVEN: "Even", DIGITODD: "Odd" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Hub() {
  // settings
  const [stake, setStake] = useState(0.35);
  const [target, setTarget] = useState(1);
  const [tf, setTf] = useState("tick");
  const [mode, setMode] = useState<StrategyMode>("classic");
  const [over, setOver] = useState(2);
  const [under, setUnder] = useState(7);
  const [mult, setMult] = useState(3.75);
  const [maxLv, setMaxLv] = useState(3);
  const [startAfter, setStartAfter] = useState(1);
  const [stopMax, setStopMax] = useState(true);
  const [stopLoss, setStopLoss] = useState(0);
  // indicator
  const [indName, setIndName] = useState("Va-Mod Insight Engine");
  const [colors, setColors] = useState({ bull: "#FFD700", bear: "#9B30FF", poc: "#FFF4B0" });
  const [draft, setDraft] = useState({ name: indName, ...colors });
  // data & connection
  const [cfg, setCfg] = useState<Cfg>({ appId: "1089", token: "", fcs: "", odds: "", allowLive: false });
  const [showCfg, setShowCfg] = useState(false);
  const [demoMode, setDemoMode] = useState(true);
  const [status, setStatus] = useState<"idle" | "connecting" | "open" | "closed">("idle");
  const [account, setAccount] = useState<{ loginid: string; virtual: boolean; balance: number; currency: string } | null>(null);
  const [symbols, setSymbols] = useState<{ symbol: string; name: string }[]>([]);
  const [symbol, setSymbol] = useState("R_100");
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [msg, setMsg] = useState("");
  // engine
  const [active, setActive] = useState(false);
  const [mg, setMg] = useState<MgState>(initialMg);
  const [phase, setPhase] = useState(0);
  const [ledger, setLedger] = useState<Ledger[]>([]);
  const [profit, setProfit] = useState(0);

  const client = useRef<DerivClient | null>(null);
  const unsubTicks = useRef<(() => void) | null>(null);
  const tickWaiters = useRef<((t: Tick) => void)[]>([]);
  const st = useRef({ active, mg, phase, profit, ticks, symbol, demoMode, account });
  st.current = { active, mg, phase, profit, ticks, symbol, demoMode, account };

  useEffect(() => {
    try { const s = localStorage.getItem(CFG_KEY); if (s) setCfg((c) => ({ ...c, ...JSON.parse(s) })); } catch {}
  }, []);

  const pushTick = useCallback((t: Tick) => {
    setTicks((p) => [...p.slice(-1999), t]);
    tickWaiters.current.splice(0).forEach((w) => w(t));
  }, []);

  // simulation feed
  useEffect(() => {
    if (!demoMode) return;
    setTicks([]);
    let price = 1000, ep = Math.floor(Date.now() / 1000) - 300;
    const seed: Tick[] = [];
    for (let i = 0; i < 300; i++) { price += (Math.random() - 0.5) * 2; seed.push({ epoch: ep++, quote: price, digit: lastDigit(price, 2) }); }
    setTicks(seed);
    const id = setInterval(() => { price += (Math.random() - 0.5) * 2; pushTick({ epoch: Math.floor(Date.now() / 1000), quote: price, digit: lastDigit(price, 2) }); }, 1000);
    return () => clearInterval(id);
  }, [demoMode, pushTick]);

  const subscribeTicks = useCallback(async (sym: string) => {
    const c = client.current; if (!c) return;
    unsubTicks.current?.();
    setTicks([]);
    try {
      const h = await c.send({ ticks_history: sym, count: 1000, end: "latest", style: "ticks" });
      const pip = h.pip_size ?? 2;
      setTicks(h.history.times.map((t: number, i: number) => ({ epoch: t, quote: h.history.prices[i], digit: lastDigit(h.history.prices[i], pip) })));
      unsubTicks.current = c.subscribe({ ticks: sym }, (m) => {
        if (m.tick) pushTick({ epoch: m.tick.epoch, quote: m.tick.quote, digit: lastDigit(m.tick.quote, m.tick.pip_size ?? pip) });
      });
    } catch (e: any) { setMsg(e.message); }
  }, [pushTick]);

  const connect = useCallback(() => {
    client.current?.close();
    const c = new DerivClient(cfg.appId || "1089", (s) => setStatus(s), async () => {
      try {
        const syms = await c.send({ active_symbols: "brief" });
        setSymbols(syms.active_symbols.filter((s: any) => s.market === "synthetic_index" || s.symbol === "frxXAUUSD")
          .map((s: any) => ({ symbol: s.symbol, name: s.display_name })));
        if (cfg.token) {
          const a = await c.send({ authorize: cfg.token });
          setAccount({ loginid: a.authorize.loginid, virtual: !!a.authorize.is_virtual, balance: a.authorize.balance, currency: a.authorize.currency });
          c.subscribe({ balance: 1 }, (m) => m.balance && setAccount((p) => p && { ...p, balance: m.balance.balance }));
        }
        subscribeTicks(st.current.symbol);
      } catch (e: any) { setMsg(e.message); }
    });
    client.current = c;
    c.connect();
  }, [cfg.appId, cfg.token, subscribeTicks]);

  useEffect(() => {
    if (demoMode) { client.current?.close(); client.current = null; setStatus("idle"); setAccount(null); return; }
    connect();
    return () => { client.current?.close(); };
  }, [demoMode, connect]);

  useEffect(() => { if (!demoMode && status === "open") subscribeTicks(symbol); }, [symbol]); // eslint-disable-line

  const nextTick = () => new Promise<Tick>((r) => tickWaiters.current.push(r));

  const freq = useMemo(() => digitFrequency(ticks.slice(-100).map((t) => t.digit)), [ticks]);
  const profile = useMemo(() => marketProfile(ticks.slice(-500).map((t) => t.quote)), [ticks]);
  const candles = useMemo<Candle[]>(() => {
    const g = TF[tf], out: Candle[] = [];
    for (const t of ticks) {
      const time = Math.floor(t.epoch / g) * g, l = out[out.length - 1];
      if (l && l.time === time) { l.high = Math.max(l.high, t.quote); l.low = Math.min(l.low, t.quote); l.close = t.quote; l.volume++; }
      else out.push({ time, open: t.quote, high: t.quote, low: t.quote, close: t.quote, volume: 1 });
    }
    return out;
  }, [ticks, tf]);

  const liveBlocked = !demoMode && account && !account.virtual && !cfg.allowLive;
  const mgCfg = { base: stake, multiplier: mult, maxLevels: maxLv, startAfterLoss: startAfter, stopAfterMax: stopMax };
  const phases = phasesFor(mode);
  const nextKind: ContractKind = phases[phase % phases.length];
  const nextC = resolveContract(nextKind, freq, over, under);

  async function runOne(): Promise<boolean> {
    const s = st.current;
    const f = digitFrequency(s.ticks.slice(-100).map((t) => t.digit));
    const kind = phasesFor(mode)[s.phase % phasesFor(mode).length];
    const c = resolveContract(kind, f, over, under);
    const amt = stakeFor(mgCfg, s.mg);
    let won: boolean, net: number;
    if (s.demoMode) {
      const t = await nextTick();
      won = Math.random() < 0.55 && digitWins(c.type, c.barrier, t.digit) !== undefined;
      net = won ? Math.round(amt * 0.25 * 100) / 100 : -amt;
    } else {
      const cl = client.current!;
      const prop = await cl.send({ proposal: 1, amount: amt, basis: "stake", contract_type: c.type, currency: s.account?.currency ?? "USD",
        duration: 1, duration_unit: "t", symbol: s.symbol, ...(c.barrier !== undefined ? { barrier: String(c.barrier) } : {}) });
      const buy = await cl.send({ buy: prop.proposal.id, price: amt });
      net = await new Promise<number>((res, rej) => {
        const to = setTimeout(() => rej(new Error("Contract timeout")), 30000);
        const un = cl.subscribe({ proposal_open_contract: 1, contract_id: buy.buy.contract_id }, (m) => {
          const p = m.proposal_open_contract;
          if (p?.is_sold) { clearTimeout(to); un(); res(Number(p.profit)); }
        });
      });
      won = net > 0;
    }
    const nm = applyResult(mgCfg, s.mg, won);
    const np = Math.round((s.profit + net) * 100) / 100;
    setLedger((l) => [{ time: new Date().toLocaleTimeString(), symbol: s.demoMode ? "SIM" : s.symbol,
      type: `${LABEL[c.type]}${c.barrier !== undefined ? " " + c.barrier : ""}`, stake: amt, result: (won ? "WIN" : "LOSS") as Ledger["result"], profit: net, sim: s.demoMode }, ...l].slice(0, 200));
    setMg(nm); setProfit(np); setPhase((p) => p + 1);
    st.current = { ...st.current, mg: nm, profit: np, phase: s.phase + 1 };
    if (nm.stopped) { setMsg("Stopped: max martingale levels reached."); return false; }
    if (np >= target) { setMsg(`Profit target $${target.toFixed(2)} reached.`); return false; }
    if (stopLoss > 0 && np <= -stopLoss) { setMsg("Stop loss hit."); return false; }
    return true;
  }

  async function toggle() {
    if (active) { setActive(false); return; }
    if (!demoMode && (!account || status !== "open")) { setMsg("Connect a Deriv token first (API & App Config)."); return; }
    if (liveBlocked) { setMsg("This token is a REAL account. Enable live trading in config to proceed."); return; }
    setMg(initialMg); setMsg(""); setActive(true);
    st.current = { ...st.current, active: true, mg: initialMg };
    while (st.current.active) {
      try { if (!(await runOne())) break; } catch (e: any) { setMsg(e.message); break; }
      await sleep(400);
    }
    setActive(false);
  }

  const hot = Math.max(...freq), cold = Math.min(...freq);
  const conn = demoMode ? "SIMULATION" : status === "open" ? (account ? (account.virtual ? "DEMO ACCOUNT" : "REAL ACCOUNT") : "CONNECTED (no token)") : status.toUpperCase();
  const fmt = (n?: number) => (n === undefined ? "—" : n.toFixed(2));

  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div>
          <h1 className="font-display text-xl font-extrabold tracking-widest text-primary">VA-MOD TRADING HUB</h1>
          <p className="text-xs text-muted-foreground">DT Nexus Architecture + {indName}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-full border border-border px-3 py-1 text-xs">
            <input type="checkbox" checked={demoMode} disabled={active} onChange={(e) => setDemoMode(e.target.checked)} className="accent-primary" />
            Demo Mode (simulation)
          </label>
          <span className={`rounded-full px-3 py-1 font-mono text-xs ${account && !account.virtual ? "bg-destructive text-destructive-foreground" : "bg-secondary text-primary"}`}>
            ● {conn}{account && ` · ${account.loginid} · ${account.balance} ${account.currency}`}
          </span>
          <button onClick={() => setShowCfg(true)} className="rounded-md border border-primary px-3 py-1 text-xs text-primary hover:bg-primary hover:text-primary-foreground">API & App Config</button>
        </div>
      </header>
      {demoMode && <div className="bg-accent/30 px-5 py-1 text-center text-xs text-accent-foreground">Demo Mode: prices and trades below are SIMULATED — not live market data. Turn off Demo Mode to stream real Deriv ticks.</div>}
      {msg && <div className="bg-secondary px-5 py-1 text-center text-xs text-primary">{msg}</div>}

      <div className="grid gap-3 p-3 lg:grid-cols-[260px_1fr_280px]">
        {/* Left */}
        <aside className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm">
          <h2 className="font-display text-primary">Strategy Settings</h2>
          <Field label="Base Stake ($)"><Num v={stake} set={setStake} step={0.01} /></Field>
          <Field label="Profit Target ($)"><Num v={target} set={setTarget} step={0.1} /></Field>
          <Field label="Target Timeframe">
            <Sel v={tf} set={setTf} opts={[["60", "60 min"], ["15", "15 min"], ["5", "5 min"], ["tick", "1 Tick"]]} />
          </Field>
          <Field label="Primary Strategy">
            <Sel v={mode} set={(v) => setMode(v as StrategyMode)} opts={[["classic", "Classic: Differs → Over 2 → Under 7"], ["overunder", "Over-Under Only"], ["differs", "Differs Only"], ["evenodd", "Even-Odd"]]} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Over Barrier"><Num v={over} set={setOver} /></Field>
            <Field label="Under Barrier"><Num v={under} set={setUnder} /></Field>
          </div>
          {!demoMode && (
            <Field label="Market">
              <Sel v={symbol} set={setSymbol} opts={(symbols.length ? symbols : [{ symbol: "R_100", name: "Volatility 100 Index" }]).map((s) => [s.symbol, s.name])} />
            </Field>
          )}
          <div className="space-y-2 rounded-md border border-border bg-muted p-3">
            <p className="text-xs font-bold text-primary">RISK MODE: MARTINGALE</p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Multiplier"><Num v={mult} set={setMult} step={0.05} /></Field>
              <Field label="Max Levels"><Num v={maxLv} set={setMaxLv} /></Field>
              <Field label="Start after loss #"><Num v={startAfter} set={setStartAfter} /></Field>
              <Field label="Stop loss $ (0=off)"><Num v={stopLoss} set={setStopLoss} /></Field>
            </div>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="accent-primary" checked={stopMax} onChange={(e) => setStopMax(e.target.checked)} />Stop after max levels</label>
          </div>
          <button onClick={toggle} className={`w-full rounded-md py-3 font-display font-extrabold tracking-wider shadow-gold ${active ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"}`}>
            {active ? "STOP STRATEGY" : "ACTIVATE STRATEGY"}
          </button>
          <p className="text-center font-mono text-[10px] text-muted-foreground">Duration: 1 Tick | Execution: Fast | Source: Digit Edge</p>
        </aside>

        {/* Center */}
        <main className="flex min-w-0 flex-col gap-3">
          <div className="relative h-[460px] rounded-lg border border-border bg-card p-2">
            <div className="absolute left-3 top-3 z-10 w-56 space-y-2 rounded-md border border-border bg-popover/95 p-3 text-xs">
              <p className="font-display text-primary">Indicator Engine</p>
              <input className="w-full rounded border border-input bg-background px-2 py-1" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              {(["bull", "bear", "poc"] as const).map((k) => (
                <label key={k} className="flex items-center justify-between">{k === "bull" ? "Bullish" : k === "bear" ? "Bearish" : "POC / Highlight"}
                  <input type="color" value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} /></label>
              ))}
              <button className="w-full rounded bg-primary py-1 font-bold text-primary-foreground" onClick={() => { setIndName(draft.name); setColors({ bull: draft.bull, bear: draft.bear, poc: draft.poc }); }}>Apply & Rebrand</button>
            </div>
            <span className="absolute right-3 top-3 z-10 font-mono text-xs text-muted-foreground">{demoMode ? "SIM" : symbol} · tick volume</span>
            <PriceChart candles={candles} bull={colors.bull} bear={colors.bear} poc={colors.poc} pocPrice={profile?.poc} />
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-display text-primary">Sessions Ledger</h2>
              <button className="text-xs text-muted-foreground hover:text-primary" onClick={() => { setLedger([]); setProfit(0); }}>Clear</button>
            </div>
            <div className="max-h-56 overflow-auto">
              <table className="w-full font-mono text-xs">
                <thead className="text-muted-foreground"><tr>{["Time", "Symbol", "Type", "Stake", "Result", "Net Profit"].map((h) => <th key={h} className="py-1 text-left">{h}</th>)}</tr></thead>
                <tbody>
                  {ledger.map((l, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="py-1">{l.time}</td><td>{l.symbol}{l.sim && " (sim)"}</td><td>{l.type}</td><td>${l.stake.toFixed(2)}</td>
                      <td className={l.result === "WIN" ? "text-primary" : "text-accent"}>{l.result}</td>
                      <td className={l.profit >= 0 ? "text-primary" : "text-accent"}>{l.profit.toFixed(2)}</td>
                    </tr>
                  ))}
                  {!ledger.length && <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">No trades yet</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </main>

        {/* Right */}
        <aside className="space-y-3">
          <div className="space-y-2 rounded-lg border border-border bg-card p-4">
            <h2 className="font-display text-primary">Market Profile (Va-Mod)</h2>
            {[["Point of Control (POC)", profile?.poc], ["Value Area High (VAH)", profile?.vah], ["Value Area Low (VAL)", profile?.val]].map(([l, v]) => (
              <div key={l as string} className="rounded-md bg-muted p-2"><p className="text-[11px] text-muted-foreground">{l}</p><p className="font-mono text-lg text-primary">{fmt(v as number | undefined)}</p></div>
            ))}
            <p className="text-[10px] text-muted-foreground">From last {Math.min(500, ticks.length)} {demoMode ? "simulated" : "real"} ticks</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-2 font-display text-primary">Digit Frequency (last 100)</h2>
            <div className="flex h-28 items-end gap-1">
              {freq.map((v, d) => (
                <div key={d} className="flex flex-1 flex-col items-center gap-1">
                  <span className="font-mono text-[9px] text-muted-foreground">{v}</span>
                  <div className={`w-full rounded-t ${v === hot && hot ? "bg-primary shadow-gold" : v === cold ? "bg-accent/50" : "bg-accent"}`} style={{ height: `${hot ? (v / hot) * 80 : 0}px` }} />
                  <span className="font-mono text-xs">{d}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-1 rounded-lg border border-border bg-card p-4 font-mono text-xs">
            <h2 className="mb-2 font-display text-sm text-primary">System Status</h2>
            <Row k="Connection" v={conn} />
            <Row k="Next Signal" v={`${LABEL[nextC.type]}${nextC.barrier !== undefined ? " " + nextC.barrier : ""} @ $${stakeFor(mgCfg, mg).toFixed(2)}`} />
            <Row k="Current MG Level" v={`${mg.level} / ${maxLv}`} />
            <Row k="Total Profit" v={`$${profit.toFixed(2)}`} />
            <div className="mt-2 h-2 rounded bg-muted"><div className="h-2 rounded bg-primary" style={{ width: `${Math.max(0, Math.min(100, (profit / target) * 100))}%` }} /></div>
            <p className="text-[10px] text-muted-foreground">Progress to ${target.toFixed(2)} target</p>
          </div>
        </aside>
      </div>
      {showCfg && <ConfigModal cfg={cfg} onClose={() => setShowCfg(false)} onSave={(c) => { setCfg(c); localStorage.setItem(CFG_KEY, JSON.stringify(c)); setShowCfg(false); }} />}
    </div>
  );
}

function ConfigModal({ cfg, onClose, onSave }: { cfg: Cfg; onClose: () => void; onSave: (c: Cfg) => void }) {
  const [c, setC] = useState({ ...cfg, token: "" });
  const [err, setErr] = useState("");
  const save = () => {
    if (!isValidAppId(c.appId)) return setErr("App ID must be numeric.");
    if (c.token && !isValidToken(c.token)) return setErr("Token format looks invalid (letters and numbers only).");
    onSave({ ...c, token: c.token || cfg.token });
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4">
      <div className="w-full max-w-md space-y-3 rounded-lg border border-primary bg-card p-5 text-sm shadow-gold">
        <h2 className="font-display text-lg text-primary">API & App Config</h2>
        <p className="rounded bg-destructive/20 p-2 text-xs">Never share your Deriv API token. Use a token from your DEMO (virtual) account. It is stored only in this browser and never shown again after saving.</p>
        <Field label="Deriv App ID"><input className="inp" value={c.appId} onChange={(e) => setC({ ...c, appId: e.target.value })} /></Field>
        <Field label={`Deriv API Token ${cfg.token ? "(saved — enter a new one to replace)" : ""}`}>
          <input type="password" autoComplete="off" className="inp" placeholder={cfg.token ? "••••••••••••" : "Paste token"} value={c.token} onChange={(e) => setC({ ...c, token: e.target.value })} />
        </Field>
        {cfg.token && <button className="text-xs text-accent" onClick={() => onSave({ ...cfg, token: "" })}>Remove saved token</button>}
        <Field label="FCS API Key (optional, reserved)"><input type="password" className="inp" value={c.fcs} onChange={(e) => setC({ ...c, fcs: e.target.value })} /></Field>
        <Field label="Odds API Key (optional, reserved)"><input type="password" className="inp" value={c.odds} onChange={(e) => setC({ ...c, odds: e.target.value })} /></Field>
        <label className="flex items-center gap-2 rounded border border-destructive p-2 text-xs">
          <input type="checkbox" checked={c.allowLive} onChange={(e) => setC({ ...c, allowLive: e.target.checked })} />
          Allow trading on a REAL-money account (off = demo only)
        </label>
        {err && <p className="text-xs text-destructive">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded border border-border px-3 py-1">Cancel</button>
          <button onClick={save} className="rounded bg-primary px-3 py-1 font-bold text-primary-foreground">Save</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1"><span className="text-[11px] text-muted-foreground">{label}</span>{children}</label>;
}
function Num({ v, set, step = 1 }: { v: number; set: (n: number) => void; step?: number }) {
  return <input type="number" step={step} className="inp" value={v} onChange={(e) => set(Number(e.target.value))} />;
}
function Sel({ v, set, opts }: { v: string; set: (s: string) => void; opts: string[][] }) {
  return <select className="inp" value={v} onChange={(e) => set(e.target.value)}>{opts.map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select>;
}
function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between"><span className="text-muted-foreground">{k}</span><span className="text-primary">{v}</span></div>;
}
