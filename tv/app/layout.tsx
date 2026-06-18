import type { Metadata } from "next";
import { Saira_Condensed, Manrope, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Display: sporty condensed grotesk — EA-style headlines + big numbers.
const display = Saira_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});
// UI / body: clean modern startup sans.
const ui = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-ui",
  display: "swap",
});
// Mono: only for console/data readouts.
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CYBER ARENA",
  description: "AI red attacker vs AI blue defender. Live.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
