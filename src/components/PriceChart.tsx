import { useEffect, useRef } from "react";

export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }
interface Props { candles: Candle[]; bull: string; bear: string; poc: string; pocPrice?: number }

export function PriceChart({ candles, bull, bear, poc, pocPrice }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<any>(null);

  useEffect(() => {
    let disposed = false;
    import("lightweight-charts").then((lc) => {
      if (disposed || !el.current) return;
      const css = getComputedStyle(document.documentElement);
      const chart = lc.createChart(el.current, {
        autoSize: true,
        layout: { background: { color: "transparent" }, textColor: css.getPropertyValue("--muted-foreground") || "#aaa" },
        grid: { vertLines: { color: "rgba(255,215,0,0.05)" }, horzLines: { color: "rgba(255,215,0,0.05)" } },
        timeScale: { timeVisible: true, secondsVisible: true },
      });
      const c = chart.addSeries(lc.CandlestickSeries, {});
      const v = chart.addSeries(lc.HistogramSeries, { priceScaleId: "", priceFormat: { type: "volume" } });
      v.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      api.current = { chart, c, v, line: null };
    });
    return () => { disposed = true; api.current?.chart.remove(); api.current = null; };
  }, []);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    a.c.applyOptions({ upColor: bull, downColor: bear, wickUpColor: bull, wickDownColor: bear, borderVisible: false });
    a.c.setData(candles.map(({ volume, ...k }) => k));
    a.v.setData(candles.map((k) => ({ time: k.time, value: k.volume, color: (k.close >= k.open ? bull : bear) + "88" })));
    if (a.line) a.c.removePriceLine(a.line);
    a.line = pocPrice ? a.c.createPriceLine({ price: pocPrice, color: poc, lineWidth: 2, title: "POC" }) : null;
  }, [candles, bull, bear, poc, pocPrice]);

  return <div ref={el} className="h-full w-full" />;
}
