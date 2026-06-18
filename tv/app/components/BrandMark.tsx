"use client";

// Cyber Arena logo mark. Replaces the old ◆ glyph on a red→blue gradient (which
// muddied through purple — the AI-slop cliché). A real Phosphor crosshair sits on
// a red→ink→blue split squircle: tells the red-vs-blue story, no purple midpoint,
// with an inner top highlight + drop shadow so it reads as a physical tile.

import { Crosshair } from "@phosphor-icons/react";

export default function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <div
      className="relative grid place-items-center shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        background: "linear-gradient(135deg, #ff3b50 0%, #0b1120 50%, #2e90ff 100%)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.28), inset 0 0 0 1px rgba(255,255,255,0.06), 0 8px 20px -10px rgba(0,0,0,0.85)",
      }}
    >
      <Crosshair weight="bold" size={Math.round(size * 0.52)} color="#fff" />
    </div>
  );
}
