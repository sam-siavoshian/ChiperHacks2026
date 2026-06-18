import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#070a12",
        ink2: "#0b101c",
        surface: "#121a2c",
        surface2: "#18223a",
        line: "rgba(255,255,255,0.07)",
        line2: "rgba(255,255,255,0.12)",
        red: { DEFAULT: "#ff3b50", soft: "#ff6b7b", deep: "#b21f30" },
        blue: { DEFAULT: "#2e90ff", soft: "#6fb4ff", deep: "#1657a8" },
        lime: { DEFAULT: "#b6ff3f", soft: "#d6ff85", deep: "#7ab800" },
        gold: "#ffcf4a",
        win: "#36e0a0",
        text: "#eef2fb",
        mute: "#8a97b4",
        faint: "#566484",
        // backward-compat aliases so older components adopt the new palette cleanly
        panel: "#121a2c",
        panel2: "#18223a",
        edge: "rgba(255,255,255,0.07)",
        edge2: "rgba(255,255,255,0.12)",
        amber: "#ffcf4a",
      },
      fontFamily: {
        // display + legacy aliases (hud/cast) all resolve to the condensed display font
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        hud: ["var(--font-display)", "system-ui", "sans-serif"],
        cast: ["var(--font-display)", "system-ui", "sans-serif"],
        ui: ["var(--font-ui)", "system-ui", "sans-serif"],
        sans: ["var(--font-ui)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        xl: "14px",
        "2xl": "18px",
        "3xl": "24px",
      },
      boxShadow: {
        card: "inset 0 1px 0 rgba(255,255,255,0.06), 0 1px 2px rgba(0,0,0,0.45), 0 20px 44px -26px rgba(0,0,0,0.85)",
        pop: "inset 0 1px 0 rgba(255,255,255,0.08), 0 28px 64px -22px rgba(0,0,0,0.9)",
        "glow-red": "0 12px 36px -14px rgba(255,59,80,0.55)",
        "glow-blue": "0 12px 36px -14px rgba(46,144,255,0.55)",
        "glow-lime": "0 12px 34px -12px rgba(182,255,63,0.55)",
      },
      keyframes: {
        ticker: { from: { transform: "translateX(0)" }, to: { transform: "translateX(-50%)" } },
        sweep: { "0%": { transform: "translateX(-130%)" }, "60%,100%": { transform: "translateX(130%)" } },
        floaty: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-5px)" } },
        spinslow: { to: { transform: "rotate(360deg)" } },
      },
      animation: {
        ticker: "ticker 36s linear infinite",
        sweep: "sweep 2.6s cubic-bezier(.2,.7,.2,1) infinite",
        floaty: "floaty 4s ease-in-out infinite",
        spinslow: "spinslow 14s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
