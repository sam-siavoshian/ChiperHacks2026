"use client";

import { useEffect, useRef, useState } from "react";

// cheap count-up without spamming React: animates locally on value change
export default function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const [disp, setDisp] = useState(value);
  const from = useRef(value);
  const raf = useRef(0);

  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    const b = value;
    if (a === b) return;
    const dur = 520;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setDisp(Math.round(a + (b - a) * e));
      if (k < 1) raf.current = requestAnimationFrame(tick);
      else from.current = b;
    };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value]);

  return <span className={`tabular ${className || ""}`}>{disp}</span>;
}
