"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

type Side = "top" | "bottom";
type Align = "center" | "start" | "end";

// Small "?" affordance. Hover or focus to read a short, plain explanation of the
// thing it sits next to. Keyboard accessible; tap-toggles on touch.
export default function HelpTip({
  text, title, side = "top", align = "center", tone = "#b8ff3b", className = "",
}: { text: string; title?: string; side?: Side; align?: Align; tone?: string; className?: string }) {
  const [open, setOpen] = useState(false);

  const pos = side === "top" ? "bottom-full mb-2" : "top-full mt-2";
  const ax = align === "center" ? "left-1/2 -translate-x-1/2" : align === "start" ? "left-0" : "right-0";

  return (
    <span className={`relative inline-flex align-middle ${className}`}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={title ? `What is ${title}` : "Help"}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="w-[15px] h-[15px] rounded-full grid place-items-center text-[9px] font-bold leading-none text-mute border border-white/20 hover:text-text transition-colors"
        style={open ? { color: tone, borderColor: `${tone}88` } : undefined}>
        ?
      </button>
      <AnimatePresence>
        {open && (
          <motion.span
            initial={{ opacity: 0, y: side === "top" ? 4 : -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.14 }}
            className={`absolute z-[80] ${pos} ${ax} w-[240px] glass rounded-xl px-3.5 py-3 text-left pointer-events-none shadow-pop`}>
            {title && <span className="block font-display font-bold text-[13px] tracking-wide mb-1" style={{ color: tone }}>{title}</span>}
            <span className="block text-[12px] leading-snug text-[#c7d1e6] font-normal normal-case tracking-normal">{text}</span>
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
