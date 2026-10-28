import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PriceChart, type Candle } from "@/components/PriceChart";
import { MatrixRain } from "@/components/MatrixRain";
import { DerivClient } from "@/lib/deriv";
import { DEFAULT_DERIV_APP_ID, validateCredentials } from "@/lib/deriv-config";
import { Button } from "@/components/ui/button";
import {
  applyRecovery, applyResult, digitFrequency, digitWins, initialMg, initialRecovery, lastDigit,
  marketProfile, phasesFor, recoveryStake, resolveContract, stakeFor,
  type ContractKind, type MgState, type RecoveryState, type StrategyMode,
} from "@/lib/strategy";
import { computeSignal, digitStats, trendStrength } from "@/lib/signals";
import { clampRunTicks, detectRunDir, runSupported, runWins, type RunDir } from "@/lib/runs";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MWASE AI AGENT HACKING BOT | Hybrid Scan Engine" },
      { name: "description", content: "Hybrid Deriv trading terminal: multi-market scan engine, digit radar, system recovery, multi-strike bulk execution and a martingale strategy core. Demo account first." },
      { property: "og:title", content: "MWASE AI AGENT HACKING BOT" },
      { property: "og:description", content: "Hybrid scan engine, system recovery and multi-strike digit execution on real Deriv ticks." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Hub,
});

type Tick = { epoch: number; quote: number; digit: number };
type Ledger = { time: string; symbol: string; type: string; stake: number; result: "WIN" | "LOSS"; profit: number; sim: boolean };
type Cfg = { appId: string; token: string; fcs: string; odds: string; allowLive: boolean; aiModel?: string; aiKeys?: Record<string, string> };
type ScanRow = { symbol: string; name: string; trend: number; conf: number; dir: string; coldDigit: number; diffConf: number };
type BulkKind = "MATCH_DIFF" | "OVER_UNDER" | "EVEN_ODD";
type Tab = "strategy" | "runs" | "scanner" | "bulk";

const AI_MODELS = ["MiniMax-M2.1", "stepfun-ai/step-3.5-flash", "DeepSeek-V4-Flash", "gemini-3.1-flash-lite-preview", "moonshotai/kimi-k2.6", "kimi-k2.5", "gpt-4o-mini", "gpt-5-mini", "grok-4.20-fast", "grok-imagine-image-lite", "qwen3.6-27b", "Qwen3.6", "glm-4.6", "z-ai/glm-5.1", "openai/zai-org/GLM-4.7"];
const SETTINGS_KEY = "mwase-settings";
const CFG_KEY = "vamod-config";
const TF: Record<string, number> = { "60": 3600, "15": 900, "5": 300, tick: 10 };
const LABEL: Record<string, string> = { DIGITDIFF: "Differs", DIGITMATCH: "Matches", DIGITOVER: "Over", DIGITUNDER: "Under", DIGITEVEN: "Even", DIGITODD: "Odd" };
const BULK_TYPES: Record<BulkKind, { label: string; sides: [string, string]; types: [ContractKind, ContractKind]; digitBarrier: boolean }> = {
  MATCH_DIFF: { label: "Matches / Differs", sides: ["Matches", "Differs"], types: ["DIGITMATCH", "DIGITDIFF"], digitBarrier: true },
  OVER_UNDER: { label: "Over / Under", sides: ["Over", "Under"], types: ["DIGITOVER", "DIGITUNDER"], digitBarrier: true },
  EVEN_ODD: { label: "Even / Odd", sides: ["Even", "Odd"], types: ["DIGITEVEN", "DIGITODD"], digitBarrier: false },
};
const r2 = (n: number) => Math.round(n * 100) / 100;
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
  // system recovery
  const [recOn, setRecOn] = useState(true);
  const [recPerTrade, setRecPerTrade] = useState(0.5);
  const [recMaxStake, setRecMaxStake] = useState(10);
  const [rec, setRec] = useState<RecoveryState>(initialRecovery);
  // indicator
  const [indName, setIndName] = useState("MWASE Insight Engine");
  const [colors, setColors] = useState({ bull: "#00FF41", bear: "#FF3131", poc: "#CCFF00" });
  const [draft, setDraft] = useState({ name: indName, ...colors });
  // data & connection
  const [cfg, setCfg] = useState<Cfg>({ appId: DEFAULT_DERIV_APP_ID, token: "", fcs: "", odds: "", allowLive: false });
  const [showCfg, setShowCfg] = useState(false);
  const [demoMode, setDemoMode] = useState(true);
  const [status, setStatus] = useState<"idle" | "connecting" | "open" | "closed">("idle");
  const [account, setAccount] = useState<{ loginid: string; virtual: boolean; balance: number; currency: string } | null>(null);
  const [symbols, setSymbols] = useState<{ symbol: string; name: string }[]>([]);
  const [symbol, setSymbol] = useState("R_100");
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [msg, setMsg] = useState("");
  // engine
  const [tab, setTab] = useState<Tab>("strategy");
  const [active, setActive] = useState(false);
  const [mg, setMg] = useState<MgState>(initialMg);
  const [phase, setPhase] = useState(0);
  const [ledger, setLedger] = useState<Ledger[]>([]);
  const [profit, setProfit] = useState(0);
  // hybrid scan engine
  const [scan, setScan] = useState<ScanRow[]>([]);
  const [scanning, setScanning] = useState(false);
  const [hybridAuto, setHybridAuto] = useState(false);
  const [minConf, setMinConf] = useState(70);
  // bulk multi-strike
  const [bulkKind, setBulkKind] = useState<BulkKind>("MATCH_DIFF");
  const [bulkSide, setBulkSide] = useState<0 | 1>(1);
  const [strikeDigits, setStrikeDigits] = useState<number[]>([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const [bulkStake, setBulkStake] = useState(1);
  const [bulkTicks, setBulkTicks] = useState(1);
  const [bulkTP, setBulkTP] = useState(50);
  const [bulkSL, setBulkSL] = useState(20);
  const [bulkN, setBulkN] = useState(10);
  const [markets, setMarkets] = useState<string[]>(["R_100"]);
  const [bulkRunning, setBulkRunning] = useState(false);
  // only ups / only downs
  const [runAuto, setRunAuto] = useState(false);
  const [runTicks, setRunTicks] = useState(3);
  const [runStake, setRunStake] = useState(0.35);
  const [runDirMode, setRunDirMode] = useState<"auto" | RunDir>("auto");
  const [runTP, setRunTP] = useState(2);
  const [runSL, setRunSL] = useState(5);
  const [runPnl, setRunPnl] = useState(0);
  const runRef = useRef(false);
  const specCache = useRef<Record<string, any[]>>({});

  const client = useRef<DerivClient | null>(null);
  const unsubTicks = useRef<(() => void) | null>(null);
  const tickWaiters = useRef<((t: Tick) => void)[]>([]);
  const st = useRef({ active, mg, phase, profit, ticks, symbol, demoMode, account, rec, bulkRunning });
  st.current = { active, mg, phase, profit, ticks, symbol, demoMode, account, rec, bulkRunning };

  useEffect(() => {
    try { const s = localStorage.getItem(CFG_KEY); if (s) setCfg((c) => ({ ...c, ...JSON.parse(s) })); } catch {}
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        const set: Record<string, (v: any) => void> = { stake: setStake, target: setTarget, tf: setTf, mode: setMode, over: setOver, under: setUnder, mult: setMult, maxLv: setMaxLv, startAfter: setStartAfter, stopMax: setStopMax, stopLoss: setStopLoss, recOn: setRecOn, recPerTrade: setRecPerTrade, recMaxStake: setRecMaxStake, minConf: setMinConf, bulkStake: setBulkStake, bulkTicks: setBulkTicks, bulkTP: setBulkTP, bulkSL: setBulkSL, bulkN: setBulkN, runTicks: setRunTicks, runStake: setRunStake, runDirMode: setRunDirMode, runSL: setRunSL, runTP: setRunTP };
        Object.entries(s).forEach(([k, v]) => set[k]?.(v));
      }
    } catch {}
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
    setAccount(null);
    setMsg("");
    const c = new DerivClient(cfg.appId || DEFAULT_DERIV_APP_ID, (s) => {
      setStatus(s);
      if (s === "closed") setAccount(null);
    }, async () => {
      try {
        const syms = await c.send({ active_symbols: "brief" });
        setSymbols(syms.active_symbols.filter((s: any) => s.market === "synthetic_index" || (s.underlying_symbol ?? s.symbol) === "frxXAUUSD")
          .map((s: any) => ({ symbol: s.underlying_symbol ?? s.symbol, name: s.underlying_symbol_name ?? s.display_name ?? s.underlying_symbol ?? s.symbol })));
        if (cfg.token && !c.modern) {
          const a = await c.send({ authorize: cfg.token });
          setAccount({ loginid: a.authorize.loginid, virtual: !!a.authorize.is_virtual, balance: a.authorize.balance, currency: a.authorize.currency });
        }
        if (cfg.token) c.subscribe({ balance: 1 }, (m) => m.balance && setAccount((p) => p && { ...p, balance: Number(m.balance.balance) }));
        subscribeTicks(st.current.symbol);
      } catch (e: any) { setMsg(e.message); }
    }, { token: cfg.token, allowLive: cfg.allowLive, onAccount: setAccount, onError: setMsg });
    client.current = c;
    c.connect();
  }, [cfg.appId, cfg.token, cfg.allowLive, subscribeTicks]);

  useEffect(() => {
    if (demoMode) { client.current?.close(); client.current = null; setStatus("idle"); setAccount(null); return; }
    setTicks([]);
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
  const recCfg = { enabled: recOn, perTrade: recPerTrade, maxStake: recMaxStake };
  const phases = phasesFor(mode);
  const nextKind: ContractKind = phases[phase % phases.length];
  const nextC = resolveContract(nextKind, freq, over, under);

  /** Record a settled trade: ledger, profit, recovery pool. Returns net. */
  const record = useCallback((entry: Omit<Ledger, "time">) => {
    const net = r2(entry.profit);
    setLedger((l) => [{ time: new Date().toLocaleTimeString(), ...entry, profit: net }, ...l].slice(0, 300));
    setProfit((p) => r2(p + net));
    setRec((r) => applyRecovery(recCfg, r, net));
    st.current.profit = r2(st.current.profit + net);
    st.current.rec = applyRecovery(recCfg, st.current.rec, net);
    return net;
  }, [recCfg.enabled, recCfg.perTrade, recCfg.maxStake]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Execute one digit contract (real via Deriv, or simulated on the demo feed). */
  const execute = useCallback(async (kind: ContractKind, barrier: number | undefined, amount: number, sym: string, ticksDur = 1): Promise<number> => {
    if (st.current.demoMode) {
      const t = await nextTick();
      const won = digitWins(kind, barrier, t.digit);
      return won ? r2(amount * 0.95) : -amount;
    }
    const cl = client.current;
    const acc = st.current.account;
    if (!cl || !acc) throw new Error("Connect a Deriv account before trading.");
    const prop = await cl.send({ proposal: 1, amount, basis: "stake", contract_type: kind, currency: acc.currency,
      duration: ticksDur, duration_unit: "t", symbol: sym, ...(barrier !== undefined ? { barrier: String(barrier) } : {}) });
    const buy = await cl.send({ buy: prop.proposal.id, price: prop.proposal.ask_price ?? amount });
    return new Promise<number>((res, rej) => {
      const to = setTimeout(() => rej(new Error("Contract timeout")), 60000);
      const un = cl.subscribe({ proposal_open_contract: 1, contract_id: buy.buy.contract_id }, (m) => {
        const p = m.proposal_open_contract;
        if (p?.is_sold) { clearTimeout(to); un(); res(Number(p.profit)); }
      });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const guardLive = () => {
    if (!demoMode && (!account || status !== "open")) { setMsg("Connect a Deriv token first (API & App Config)."); return false; }
    if (liveBlocked) { setMsg("This token is a REAL account. Enable live trading in config to proceed."); return false; }
    return true;
  };

  // ---- Strategy engine (martingale + phase cycle + recovery) ----
  async function runOne(): Promise<boolean> {
    const s = st.current;
    const f = digitFrequency(s.ticks.slice(-100).map((t) => t.digit));
    const kind = phasesFor(mode)[s.phase % phasesFor(mode).length];
    const c = resolveContract(kind, f, over, under);
    const base = stakeFor(mgCfg, s.mg);
    const amt = recoveryStake(recCfg, base, s.rec);
    const net = await execute(c.type, c.barrier, amt, s.symbol);
    const won = net > 0;
    const nm = applyResult(mgCfg, s.mg, won);
    record({ symbol: s.demoMode ? "SIM" : s.symbol, type: `${LABEL[c.type]}${c.barrier !== undefined ? " " + c.barrier : ""}${s.rec.active ? " [REC]" : ""}`, stake: amt, result: won ? "WIN" : "LOSS", profit: net, sim: s.demoMode });
    setMg(nm); setPhase((p) => p + 1);
    st.current.mg = nm; st.current.phase = s.phase + 1;
    if (nm.stopped) { setMsg("Stopped: max martingale levels reached."); return false; }
    if (st.current.profit >= target) { setMsg(`Profit target $${target.toFixed(2)} reached.`); return false; }
    if (stopLoss > 0 && st.current.profit <= -stopLoss) { setMsg("Stop loss hit."); return false; }
    return true;
  }

  async function toggle() {
    if (active) { setActive(false); return; }
    if (!guardLive()) return;
    setMg(initialMg); setMsg(""); setActive(true);
    st.current.active = true; st.current.mg = initialMg;
    while (st.current.active) {
      try { if (!(await runOne())) break; } catch (e: any) { setMsg(e.message); break; }
      await sleep(400);
    }
    setActive(false);
  }

  // ---- Hybrid scan engine ----
  async function runScan(autoTrade = false) {
    const cl = client.current;
    if (demoMode || !cl || status !== "open") { setMsg("Turn off Demo Mode and connect to scan real markets."); return; }
    setScanning(true);
    const rows: ScanRow[] = [];
    for (const s of symbols.slice(0, 40)) {
      try {
        const h = await cl.send({ ticks_history: s.symbol, count: 200, end: "latest", style: "ticks" });
        const p = (h.history.prices as number[]).map(Number);
        const pip = h.pip_size ?? 2;
        const dec = Math.max(0, Math.round(-Math.log10(pip)));
        const sig = computeSignal(p);
        const ds = digitStats(p, dec);
        const cold = ds.counts.indexOf(Math.min(...ds.counts));
        const diffConf = Math.round(100 - (ds.counts[cold]! / ds.total) * 100);
        rows.push({ symbol: s.symbol, name: s.name, trend: trendStrength(p), conf: sig.confidence, dir: sig.dir === "CALL" ? "UP" : sig.dir === "PUT" ? "DOWN" : "—", coldDigit: cold, diffConf });
        setScan([...rows].sort((a, b) => (b.conf + b.trend + b.diffConf) - (a.conf + a.trend + a.diffConf)));
      } catch { /* skip market */ }
    }
    setScanning(false);
    setMsg(`Scan complete: ${rows.length} markets ranked across all parameters.`);
    if (autoTrade && rows.length) {
      const best = rows.sort((a, b) => (b.conf + b.trend + b.diffConf) - (a.conf + a.trend + a.diffConf))[0]!;
      if (best.diffConf >= minConf) {
        setSymbol(best.symbol);
        const amt = recoveryStake(recCfg, stake, st.current.rec);
        try {
          const net = await execute("DIGITDIFF", best.coldDigit, amt, best.symbol);
          record({ symbol: best.symbol, type: `Differs ${best.coldDigit} [HYBRID]`, stake: amt, result: net > 0 ? "WIN" : "LOSS", profit: net, sim: false });
          setMsg(`Hybrid traded ${best.name}: Differs ${best.coldDigit} → ${net > 0 ? "WIN" : "LOSS"} ${net.toFixed(2)}`);
        } catch (e: any) { setMsg(e.message); }
      } else {
        setMsg(`Best market ${best.name} at ${best.diffConf}% — below min confidence ${minConf}%. No trade.`);
      }
    }
  }

  async function toggleHybrid() {
    if (hybridAuto) { setHybridAuto(false); return; }
    if (!guardLive()) return;
    setHybridAuto(true);
    while (st.current.bulkRunning || hybridAutoRef.current) {
      await runScan(true);
      if (!hybridAutoRef.current) break;
      if (stopLoss > 0 && st.current.profit <= -stopLoss) { setMsg("Stop loss hit."); break; }
      if (st.current.profit >= target) { setMsg(`Profit target $${target.toFixed(2)} reached.`); break; }
      await sleep(3000);
    }
    setHybridAuto(false);
  }
  const hybridAutoRef = useRef(hybridAuto);
  hybridAutoRef.current = hybridAuto;

  // ---- Bulk multi-strike engine ----
  async function toggleBulk() {
    if (bulkRunning) { setBulkRunning(false); st.current.bulkRunning = false; return; }
    if (!guardLive()) return;
    if (!markets.length || (BULK_TYPES[bulkKind].digitBarrier && !strikeDigits.length)) { setMsg("Select at least one market and one strike digit."); return; }
    setBulkRunning(true); st.current.bulkRunning = true;
    setMsg("");
    const def = BULK_TYPES[bulkKind];
    const kind = def.types[bulkSide];
    let round = 0;
    while (st.current.bulkRunning && round < bulkN) {
      round++;
      const jobs: Promise<void>[] = [];
      for (const mkt of markets) {
        for (const d of def.digitBarrier ? strikeDigits : [undefined as unknown as number]) {
          const barrier = def.digitBarrier ? d : undefined;
          const amt = recoveryStake(recCfg, bulkStake, st.current.rec);
          jobs.push(execute(kind, barrier, amt, mkt, bulkTicks)
            .then((net) => { record({ symbol: st.current.demoMode ? "SIM" : mkt, type: `${def.sides[bulkSide]}${barrier !== undefined ? " " + barrier : ""}`, stake: amt, result: net > 0 ? "WIN" : "LOSS", profit: net, sim: st.current.demoMode }); })
            .catch((e) => setMsg(e.message)));
        }
      }
      await Promise.all(jobs); // double execution: every strike fires at the same time
      if (st.current.profit >= bulkTP) { setMsg(`Bulk take-profit $${bulkTP} reached.`); break; }
      if (bulkSL > 0 && st.current.profit <= -bulkSL) { setMsg("Bulk stop-loss hit."); break; }
    }
    setBulkRunning(false); st.current.bulkRunning = false;
  }

  // ---- Only Ups / Only Downs engine ----
  const runSignal = useMemo(() => {
    if (runDirMode !== "auto") return runDirMode;
    const p = ticks.slice(-300).map((t) => t.quote);
    return detectRunDir(p, p.length >= 60 ? computeSignal(p).dir : null);
  }, [ticks, runDirMode]);

  async function execRun(dir: RunDir, amount: number, n: number): Promise<number> {
    if (st.current.demoMode) {
      const entry = st.current.ticks[st.current.ticks.length - 1]?.quote ?? 0;
      const path: number[] = [];
      for (let i = 0; i < n; i++) path.push((await nextTick()).quote);
      return runWins(dir, entry, path) ? r2(amount * (Math.pow(2, n) * 0.9 - 1)) : -amount;
    }
    const cl = client.current, acc = st.current.account, sym = st.current.symbol;
    if (!cl || !acc) throw new Error("Connect a Deriv account before trading.");
    if (!specCache.current[sym]) {
      const r = await cl.send({ contracts_for: sym, currency: acc.currency });
      specCache.current[sym] = r.contracts_for?.available ?? [];
    }
    const bad = runSupported(specCache.current[sym], dir, n);
    if (bad) throw new Error(`${sym}: ${bad} Order blocked.`);
    const prop = await cl.send({ proposal: 1, amount, basis: "stake", contract_type: dir, currency: acc.currency, duration: n, duration_unit: "t", symbol: sym });
    const buy = await cl.send({ buy: prop.proposal.id, price: prop.proposal.ask_price ?? amount });
    return new Promise<number>((res, rej) => {
      const to = setTimeout(() => rej(new Error("Contract timeout")), 60000);
      const un = cl.subscribe({ proposal_open_contract: 1, contract_id: buy.buy.contract_id }, (m) => {
        const p = m.proposal_open_contract;
        if (p?.is_sold) { clearTimeout(to); un(); res(Number(p.profit)); }
      });
    });
  }

  async function toggleRuns() {
    if (runRef.current) { runRef.current = false; setRunAuto(false); return; }
    if (!guardLive()) return;
    runRef.current = true; setRunAuto(true); setMsg("");
    let pnl = 0; setRunPnl(0);
    while (runRef.current) {
      const p = st.current.ticks.slice(-300).map((t) => t.quote);
      const dir = runDirMode !== "auto" ? runDirMode : detectRunDir(p, p.length >= 60 ? computeSignal(p).dir : null);
      if (!dir) { await nextTick(); continue; }
      try {
        const net = await execRun(dir, runStake, runTicks);
        pnl = r2(pnl + net); setRunPnl(pnl);
        record({ symbol: st.current.demoMode ? "SIM" : st.current.symbol, type: `${dir === "RUNHIGH" ? "Only Ups" : "Only Downs"} ${runTicks}t`, stake: runStake, result: net > 0 ? "WIN" : "LOSS", profit: net, sim: st.current.demoMode });
      } catch (e: any) { setMsg(e.message); break; }
      if (pnl >= runTP) { setMsg(`Ups/Downs take-profit $${runTP} reached.`); break; }
      if (runSL > 0 && pnl <= -runSL) { setMsg("Ups/Downs stop-loss hit."); break; }
    }
    runRef.current = false; setRunAuto(false);
  }

  // ---- Save / load settings ----
  function saveSettings() {
    const s = { stake, target, tf, mode, over, under, mult, maxLv, startAfter, stopMax, stopLoss, recOn, recPerTrade, recMaxStake, minConf, bulkStake, bulkTicks, bulkTP, bulkSL, bulkN, runTicks, runStake, runDirMode, runSL, runTP };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); setMsg("Settings saved in this browser."); } catch { setMsg("Your browser blocked saving settings."); }
  }

  const ranked = useMemo(() => freq.map((v, d) => ({ d, v })).sort((a, b) => b.v - a.v), [freq]);
  const rankOf = (d: number) => ranked.findIndex((r) => r.d === d);
  const hot = Math.max(...freq), cold = Math.min(...freq);
  const conn = demoMode ? "SIMULATION" : status === "open" ? (account ? (account.virtual ? "DEMO ACCOUNT" : "REAL ACCOUNT") : "CONNECTED (no token)") : status.toUpperCase();
  const fmt = (n?: number) => (n === undefined ? "—" : n.toFixed(2));
  const marketList = symbols.length ? symbols : [{ symbol: "R_100", name: "Volatility 100 Index" }, { symbol: "1HZ100V", name: "Volatility 100 (1s) Index" }, { symbol: "RDBEAR", name: "Bear Market Index" }, { symbol: "RDBULL", name: "Bull Market Index" }];

  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <MatrixRain />
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/80 px-5 py-3 backdrop-blur">
        <div>
          <h1 className="font-display text-xl font-extrabold tracking-widest text-primary drop-shadow-[0_0_10px_var(--color-primary)]">MWASE AI AGENT HACKING BOT</h1>
          <p className="text-xs text-muted-foreground">Hybrid Scan Engine · System Recovery · Multi-Strike Execution · {indName}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-full border border-border px-3 py-1 text-xs">
            <input type="checkbox" checked={demoMode} disabled={active || bulkRunning} onChange={(e) => setDemoMode(e.target.checked)} className="accent-primary" />
            Demo Mode (simulation)
          </label>
          <span className={`rounded-full px-3 py-1 font-mono text-xs ${account && !account.virtual ? "bg-destructive text-destructive-foreground" : "bg-secondary text-primary"}`}>
            ● {conn}{account && ` · ${account.loginid} · ${account.balance} ${account.currency}`}
          </span>
          <Button variant="outline" size="sm" disabled={active || bulkRunning} onClick={() => setShowCfg(true)} className="border-primary text-primary">API & App Config</Button>
        </div>
      </header>
      {demoMode && <div className="bg-accent/30 px-5 py-1 text-center text-xs text-accent-foreground">Demo Mode: prices and trades below are SIMULATED — not live market data. Turn off Demo Mode to stream real Deriv ticks.</div>}
      {msg && <div className="bg-secondary px-5 py-1 text-center text-xs text-primary">{msg}</div>}

      <nav className="flex gap-1 border-b border-border bg-card/60 px-5 pt-2 backdrop-blur">
        {([["strategy", "STRATEGY ENGINE"], ["runs", "ONLY UPS / DOWNS"], ["scanner", "HYBRID SCAN ENGINE"], ["bulk", "BULK MULTI-STRIKE"]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-t-md px-4 py-2 font-mono text-xs font-bold tracking-wider ${tab === k ? "bg-primary text-primary-foreground shadow-gold" : "text-muted-foreground hover:text-primary"}`}>{l}</button>
        ))}
      </nav>

      <div className="grid gap-3 p-3 lg:grid-cols-[280px_1fr_300px]">
        {/* Left */}
        <aside className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm backdrop-blur">
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
            <Field label="Over Barrier (0-9)"><Num v={over} set={(n) => setOver(Math.max(0, Math.min(9, Math.round(n))))} /></Field>
            <Field label="Under Barrier (0-9)"><Num v={under} set={(n) => setUnder(Math.max(0, Math.min(9, Math.round(n))))} /></Field>
          </div>
          {!demoMode && (
            <Field label="Market">
              <Sel v={symbol} set={setSymbol} opts={marketList.map((s) => [s.symbol, s.name])} />
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
          <div className="space-y-2 rounded-md border border-primary/50 bg-muted p-3">
            <p className="text-xs font-bold text-primary">SYSTEM RECCOVERY</p>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="accent-primary" checked={recOn} onChange={(e) => setRecOn(e.target.checked)} />Recovery engine enabled</label>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Recover / trade"><Num v={recPerTrade} set={(n) => setRecPerTrade(Math.max(0, Math.min(1, n)))} step={0.1} /></Field>
              <Field label="Max recovery stake"><Num v={recMaxStake} set={setRecMaxStake} step={0.5} /></Field>
            </div>
            <p className="font-mono text-[10px] text-muted-foreground">
              Pool: ${rec.drawdown.toFixed(2)} {rec.active ? "· RECOVERING" : "· idle"} — wins pay losses back, then stakes return to base.
            </p>
          </div>
          <button onClick={toggle} className={`w-full rounded-md py-3 font-display font-extrabold tracking-wider shadow-gold ${active ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"}`}>
            {active ? "STOP STRATEGY" : "ACTIVATE STRATEGY"}
          </button>
          <Button variant="outline" className="w-full border-primary text-primary" onClick={saveSettings}>SAVE SETTINGS</Button>
          <p className="text-center font-mono text-[10px] text-muted-foreground">Duration: 1 Tick | Execution: Fast | Source: Digit Edge</p>
        </aside>

        {/* Center */}
        <main className="flex min-w-0 flex-col gap-3">
          <div className="relative h-[420px] rounded-lg border border-border bg-card p-2 backdrop-blur">
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

          {tab === "runs" && (
            <div className="rounded-lg border border-border bg-card p-4 backdrop-blur">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-primary">Only Ups / Only Downs</h2>
                <button onClick={toggleRuns} className={`rounded-md px-4 py-2 font-mono text-xs font-bold ${runAuto ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"}`}>
                  {runAuto ? "STOP AUTO" : "START AUTO TRADING"}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <Field label="Direction"><Sel v={runDirMode} set={(v) => setRunDirMode(v as typeof runDirMode)} opts={[["auto", "Both (auto-detect)"], ["RUNHIGH", "Only Ups"], ["RUNLOW", "Only Downs"]]} /></Field>
                <Field label="Ticks (2-5)"><Num v={runTicks} set={(n) => setRunTicks(clampRunTicks(n))} /></Field>
                <Field label="Stake ($)"><Num v={runStake} set={setRunStake} step={0.01} /></Field>
                <Field label="Take profit $"><Num v={runTP} set={setRunTP} step={0.5} /></Field>
                <Field label="Stop loss $"><Num v={runSL} set={setRunSL} step={0.5} /></Field>
              </div>
              <div className="mt-3 grid gap-1 font-mono text-xs">
                <Row k="Detected direction" v={runSignal ? (runSignal === "RUNHIGH" ? "▲ ONLY UPS" : "▼ ONLY DOWNS") : "NO TRADE — waiting for streak"} />
                <Row k="Session P/L" v={`$${runPnl.toFixed(2)}`} />
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground">Every tick must close higher (Ups) or lower (Downs) than the one before. Before each live order the bot checks Deriv lists this contract and tick count for the market, and blocks it otherwise. Real-money accounts are blocked unless you allow them in config.</p>
            </div>
          )}

          {tab === "scanner" && (
            <div className="rounded-lg border border-border bg-card p-4 backdrop-blur">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-primary">Hybrid Scan Engine</h2>
                <div className="flex items-center gap-2">
                  <Field label="Min conf %"><input type="number" className="inp w-16" value={minConf} onChange={(e) => setMinConf(Number(e.target.value))} /></Field>
                  <Button size="sm" disabled={demoMode || status !== "open" || scanning} onClick={() => runScan(false)}>{scanning ? `Scanning… ${scan.length}` : "SCAN ALL MARKETS"}</Button>
                  <button onClick={toggleHybrid} disabled={demoMode || status !== "open"} className={`rounded-md px-3 py-1.5 font-mono text-xs font-bold disabled:opacity-40 ${hybridAuto ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"}`}>
                    {hybridAuto ? "STOP HYBRID AUTO" : "HYBRID AUTO-TRADE"}
                  </button>
                </div>
              </div>
              <p className="mb-2 text-xs text-muted-foreground">Ranks every market by trend strength, signal confluence and digit edge across all parameters. Hybrid auto-trade scans, picks the best market and fires Differs on its coldest digit.</p>
              <div className="max-h-72 overflow-auto">
                <table className="w-full font-mono text-xs">
                  <thead className="text-muted-foreground"><tr>{["#", "Market", "Trend", "Conf", "Bias", "Cold digit", "Differs edge", ""].map((h) => <th key={h} className="py-1 text-left">{h}</th>)}</tr></thead>
                  <tbody>
                    {scan.map((r, i) => (
                      <tr key={r.symbol} className="border-t border-border">
                        <td className="py-1">{i + 1}</td><td>{r.name}</td><td>{r.trend}</td><td>{r.conf}%</td>
                        <td className={r.dir === "UP" ? "text-primary" : r.dir === "DOWN" ? "text-destructive" : ""}>{r.dir}</td>
                        <td>{r.coldDigit}</td><td className="text-primary">{r.diffConf}%</td>
                        <td><button onClick={() => { setSymbol(r.symbol); setTab("strategy"); }} className="rounded border border-primary px-2 text-primary">Open</button></td>
                      </tr>
                    ))}
                    {!scan.length && <tr><td colSpan={8} className="py-4 text-center text-muted-foreground">{demoMode ? "Connect a real feed to scan live markets." : "Press SCAN ALL MARKETS."}</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === "bulk" && (
            <div className="space-y-3 rounded-lg border border-border bg-card p-4 backdrop-blur">
              <h2 className="font-display text-primary">Bulk Multi-Strike Engine</h2>
              <p className="text-xs text-muted-foreground">Double execution: every selected strike digit fires at the same time, on every selected market.</p>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Field label="Trade Type"><Sel v={bulkKind} set={(v) => setBulkKind(v as BulkKind)} opts={(Object.keys(BULK_TYPES) as BulkKind[]).map((k) => [k, BULK_TYPES[k].label])} /></Field>
                <Field label="Contract Type"><Sel v={String(bulkSide)} set={(v) => setBulkSide(Number(v) as 0 | 1)} opts={[["0", BULK_TYPES[bulkKind].sides[0]], ["1", BULK_TYPES[bulkKind].sides[1]]]} /></Field>
                <Field label="Stake (USD)"><Num v={bulkStake} set={setBulkStake} step={0.01} /></Field>
                <Field label="Ticks (Duration)"><Num v={bulkTicks} set={(n) => setBulkTicks(Math.max(1, Math.min(10, Math.round(n))))} /></Field>
                <Field label="Take Profit (USD)"><Num v={bulkTP} set={setBulkTP} /></Field>
                <Field label="Stop Loss (USD)"><Num v={bulkSL} set={setBulkSL} /></Field>
                <Field label="Number of Rounds"><Num v={bulkN} set={(n) => setBulkN(Math.max(1, Math.round(n)))} /></Field>
              </div>
              {BULK_TYPES[bulkKind].digitBarrier && (
                <div>
                  <p className="mb-1 text-[11px] text-muted-foreground">Strike digits (all fire simultaneously)</p>
                  <div className="flex flex-wrap gap-1">
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
                      <button key={d} onClick={() => setStrikeDigits((p) => p.includes(d) ? p.filter((x) => x !== d) : [...p, d].sort())}
                        className={`h-9 w-9 rounded-full border font-mono text-sm font-bold ${strikeDigits.includes(d) ? "border-primary bg-primary text-primary-foreground shadow-gold" : "border-border text-muted-foreground"}`}>{d}</button>
                    ))}
                    <button onClick={() => setStrikeDigits([1, 2, 3, 4, 5, 6, 7, 8, 9])} className="rounded border border-border px-2 font-mono text-xs text-primary">1-9</button>
                  </div>
                </div>
              )}
              <div>
                <p className="mb-1 text-[11px] text-muted-foreground">Markets (select multiple)</p>
                <div className="flex max-h-28 flex-wrap gap-1 overflow-auto">
                  {marketList.map((m) => (
                    <button key={m.symbol} onClick={() => setMarkets((p) => p.includes(m.symbol) ? p.filter((x) => x !== m.symbol) : [...p, m.symbol])}
                      className={`rounded-md border px-2 py-1 font-mono text-xs ${markets.includes(m.symbol) ? "border-primary bg-primary/20 text-primary" : "border-border text-muted-foreground"}`}>{m.name}</button>
                  ))}
                </div>
              </div>
              <button onClick={toggleBulk} className={`w-full rounded-md py-3 font-display font-extrabold tracking-wider shadow-gold ${bulkRunning ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"}`}>
                {bulkRunning ? "STOP BULK" : `FIRE ${BULK_TYPES[bulkKind].digitBarrier ? strikeDigits.length : 1} STRIKE${(BULK_TYPES[bulkKind].digitBarrier ? strikeDigits.length : 1) === 1 ? "" : "S"} × ${markets.length} MARKET${markets.length === 1 ? "" : "S"}`}
              </button>
            </div>
          )}

          <div className="rounded-lg border border-border bg-card p-3 backdrop-blur">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-display text-primary">Sessions Ledger</h2>
              <button className="text-xs text-muted-foreground hover:text-primary" onClick={() => { setLedger([]); setProfit(0); setRec(initialRecovery); }}>Clear</button>
            </div>
            <div className="max-h-56 overflow-auto">
              <table className="w-full font-mono text-xs">
                <thead className="text-muted-foreground"><tr>{["Time", "Symbol", "Type", "Stake", "Result", "Net Profit"].map((h) => <th key={h} className="py-1 text-left">{h}</th>)}</tr></thead>
                <tbody>
                  {ledger.map((l, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="py-1">{l.time}</td><td>{l.symbol}{l.sim && " (sim)"}</td><td>{l.type}</td><td>${l.stake.toFixed(2)}</td>
                      <td className={l.result === "WIN" ? "text-primary" : "text-destructive"}>{l.result}</td>
                      <td className={l.profit >= 0 ? "text-primary" : "text-destructive"}>{l.profit.toFixed(2)}</td>
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
          <div className="space-y-2 rounded-lg border border-border bg-card p-4 backdrop-blur">
            <h2 className="font-display text-primary">Market Profile</h2>
            {[["Point of Control (POC)", profile?.poc], ["Value Area High (VAH)", profile?.vah], ["Value Area Low (VAL)", profile?.val]].map(([l, v]) => (
              <div key={l as string} className="rounded-md bg-muted p-2"><p className="text-[11px] text-muted-foreground">{l}</p><p className="font-mono text-lg text-primary">{fmt(v as number | undefined)}</p></div>
            ))}
            <p className="text-[10px] text-muted-foreground">From last {Math.min(500, ticks.length)} {demoMode ? "simulated" : "real"} ticks</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 backdrop-blur">
            <h2 className="mb-2 font-display text-primary">Digit Radar (last 100)</h2>
            <div className="grid grid-cols-5 gap-2">
              {freq.map((v, d) => {
                const p = ticks.length ? (v / Math.min(100, ticks.length)) * 100 : 0;
                const r = rankOf(d);
                const ring = r === 0 ? "border-primary shadow-gold" : r === 1 ? "border-accent" : r === 8 ? "border-accent/60" : r === 9 ? "border-destructive" : "border-border";
                return (
                  <div key={d} className={`flex flex-col items-center rounded-full border-2 bg-muted py-2 ${ring}`}>
                    <span className="font-mono text-sm font-bold">{d}</span>
                    <span className="font-mono text-[9px] text-muted-foreground">{p.toFixed(1)}%</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 font-mono text-[9px] text-muted-foreground">
              <span className="text-primary">● Most</span><span className="text-accent">● 2nd Most</span><span className="text-accent/60">● 2nd Least</span><span className="text-destructive">● Least</span>
            </div>
            <div className="mt-2 flex h-20 items-end gap-1">
              {freq.map((v, d) => (
                <div key={d} className="flex flex-1 flex-col items-center gap-1">
                  <div className={`w-full rounded-t ${v === hot && hot ? "bg-primary shadow-gold" : v === cold ? "bg-destructive/60" : "bg-secondary"}`} style={{ height: `${hot ? (v / hot) * 60 : 0}px` }} />
                  <span className="font-mono text-[10px]">{d}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-1 rounded-lg border border-border bg-card p-4 font-mono text-xs backdrop-blur">
            <h2 className="mb-2 font-display text-sm text-primary">System Status</h2>
            <Row k="Connection" v={conn} />
            <Row k="Next Signal" v={`${LABEL[nextC.type]}${nextC.barrier !== undefined ? " " + nextC.barrier : ""} @ $${recoveryStake(recCfg, stakeFor(mgCfg, mg), rec).toFixed(2)}`} />
            <Row k="Current MG Level" v={`${mg.level} / ${maxLv}`} />
            <Row k="Recovery Pool" v={`$${rec.drawdown.toFixed(2)}${rec.active ? " RECOVERING" : ""}`} />
            <Row k="Total Profit" v={`$${profit.toFixed(2)}`} />
            <div className="mt-2 h-2 rounded bg-muted"><div className="h-2 rounded bg-primary" style={{ width: `${Math.max(0, Math.min(100, (profit / target) * 100))}%` }} /></div>
            <p className="text-[10px] text-muted-foreground">Progress to ${target.toFixed(2)} target</p>
          </div>
        </aside>
      </div>
      {showCfg && <ConfigModal cfg={cfg} onClose={() => setShowCfg(false)} onSave={(c) => {
        try {
          localStorage.setItem(CFG_KEY, JSON.stringify(c));
          setCfg(c);
          setShowCfg(false);
          setMsg("Deriv configuration saved. Real-money trading remains " + (c.allowLive ? "enabled by your choice." : "disabled."));
          return null;
        } catch { return "Your browser blocked saving. Allow browser storage and try again."; }
      }} />}
    </div>
  );
}

function ConfigModal({ cfg, onClose, onSave }: { cfg: Cfg; onClose: () => void; onSave: (c: Cfg) => string | null }) {
  const [c, setC] = useState({ ...cfg, token: "" });
  const [aiDraft, setAiDraft] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const save = () => {
    const aiKeys = { ...(cfg.aiKeys ?? {}) };
    Object.entries(aiDraft).forEach(([k, v]) => { if (v.trim()) aiKeys[k] = v.trim(); });
    const updated = { ...c, aiKeys, appId: c.appId.trim(), token: c.token.trim() || cfg.token };
    const error = validateCredentials(updated.appId, updated.token);
    if (error) return setErr(error);
    const saveError = onSave(updated);
    if (saveError) setErr(saveError);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="config-title" className="w-full max-w-md space-y-3 rounded-lg border border-primary bg-card p-5 text-sm shadow-gold">
        <h2 id="config-title" className="font-display text-lg text-primary">API & App Config</h2>
        <p className="rounded bg-destructive/20 p-2 text-xs">Never share your Deriv API token. Use a token from your DEMO (virtual) account. It is stored only in this browser and never shown again after saving.</p>
        <Field label="Deriv App ID"><input className="inp" value={c.appId} onChange={(e) => setC({ ...c, appId: e.target.value })} /></Field>
        <Field label={`Deriv API Token ${cfg.token ? "(saved — enter a new one to replace)" : ""}`}>
          <input type="password" autoComplete="off" spellCheck={false} className="inp" placeholder={cfg.token ? "••••••••••••" : "Paste token or pat_…"} value={c.token} onChange={(e) => setC({ ...c, token: e.target.value })} />
        </Field>
        {cfg.token && <Button variant="ghost" size="sm" className="text-accent" onClick={() => { const error = onSave({ ...cfg, token: "" }); if (error) setErr(error); }}>Remove saved token</Button>}
        <Field label="FCS API Key (optional, reserved)"><input type="password" className="inp" value={c.fcs} onChange={(e) => setC({ ...c, fcs: e.target.value })} /></Field>
        <Field label="Odds API Key (optional, reserved)"><input type="password" className="inp" value={c.odds} onChange={(e) => setC({ ...c, odds: e.target.value })} /></Field>
        <div className="space-y-2 rounded border border-primary/50 p-2">
          <p className="text-xs font-bold text-primary">AI MODELS</p>
          <Field label="Active AI model"><Sel v={c.aiModel ?? AI_MODELS[0]} set={(v) => setC({ ...c, aiModel: v })} opts={AI_MODELS.map((m) => [m, m])} /></Field>
          <Field label={`API key for ${c.aiModel ?? AI_MODELS[0]} ${cfg.aiKeys?.[c.aiModel ?? AI_MODELS[0]] ? "(saved — enter new to replace)" : ""}`}>
            <input type="password" autoComplete="off" className="inp" placeholder={cfg.aiKeys?.[c.aiModel ?? AI_MODELS[0]] ? "••••••••••••" : "Paste API key"}
              value={aiDraft[c.aiModel ?? AI_MODELS[0]] ?? ""} onChange={(e) => setAiDraft({ ...aiDraft, [c.aiModel ?? AI_MODELS[0]]: e.target.value })} />
          </Field>
          <p className="text-[10px] text-muted-foreground">Keys are stored only in this browser. Saved: {Object.keys(cfg.aiKeys ?? {}).filter((k) => cfg.aiKeys?.[k]).length} model(s).</p>
        </div>
        <label className="flex items-center gap-2 rounded border border-destructive p-2 text-xs">
          <input type="checkbox" checked={c.allowLive} onChange={(e) => setC({ ...c, allowLive: e.target.checked })} />
          Allow trading on a REAL-money account (off = demo only)
        </label>
        {err && <p className="text-xs text-destructive">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={save}>Save</Button>
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
