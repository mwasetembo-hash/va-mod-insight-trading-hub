import { useEffect, useRef } from "react";

/** Matrix-style digital rain background: falling glyphs over a near-black green grid. */
export function MatrixRain() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const glyphs = "01アイウエオカキクケコサシスセソ0123456789$#%&";
    let w = 0, h = 0, raf = 0, last = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const fs = 14;
    let drops: number[] = [];
    const resize = () => {
      w = cv.width = innerWidth * dpr;
      h = cv.height = innerHeight * dpr;
      drops = Array(Math.ceil(w / (fs * dpr))).fill(0).map(() => Math.random() * -50);
    };
    resize();
    addEventListener("resize", resize);
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 50) return;
      last = t;
      ctx.fillStyle = "rgba(2, 8, 4, 0.14)";
      ctx.fillRect(0, 0, w, h);
      ctx.font = `${fs * dpr}px monospace`;
      for (let i = 0; i < drops.length; i++) {
        const ch = glyphs[Math.floor(Math.random() * glyphs.length)];
        const x = i * fs * dpr, y = drops[i]! * fs * dpr;
        ctx.fillStyle = Math.random() < 0.05 ? "rgba(180,255,200,0.9)" : "rgba(0,255,65,0.55)";
        ctx.fillText(ch, x, y);
        if (y > h && Math.random() > 0.975) drops[i] = 0;
        drops[i]!++;
      }
    };
    if (reduce) {
      ctx.fillStyle = "#020804";
      ctx.fillRect(0, 0, w, h);
    } else {
      raf = requestAnimationFrame(draw);
    }
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 -z-10 h-full w-full opacity-60" />;
}
