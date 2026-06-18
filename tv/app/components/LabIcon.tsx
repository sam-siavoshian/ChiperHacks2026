"use client";

// Real AI-lab brand logos (OpenAI, Anthropic, Gemini, Grok/xAI, Meta, Mistral,
// DeepSeek) from @lobehub/icons — replaces the hand-drawn glyphs. Map keys match
// the lab ids in lib/models.ts.
//
//   <LabIcon labId="openai" size={20} />                 mono, inherits color
//   <LabIcon labId="openai" size={20} color="#fff" />    mono, fixed color
//   <LabIcon labId="openai" variant="avatar" size={28} /> logo on its brand tile

import { OpenAI, Anthropic, Gemini, Grok, Meta, Mistral, DeepSeek } from "@lobehub/icons";

// Each lobehub brand is a mono icon component with an .Avatar sub-component. Their
// exact per-brand compound types differ (color constants), so the map is typed
// loosely; we only ever call <Brand size color /> or <Brand.Avatar size />.
const LAB_ICON: Record<string, any> = {
  anthropic: Anthropic,
  openai: OpenAI,
  google: Gemini,
  xai: Grok,
  meta: Meta,
  mistral: Mistral,
  deepseek: DeepSeek,
};

export function hasLabIcon(labId: string): boolean {
  return labId in LAB_ICON;
}

export default function LabIcon({
  labId,
  size = 18,
  color,
  variant = "mono",
  className,
}: {
  labId: string;
  size?: number;
  color?: string;
  variant?: "mono" | "avatar";
  className?: string;
}) {
  const Brand = LAB_ICON[labId];
  if (!Brand) return null;
  if (variant === "avatar") return <Brand.Avatar size={size} className={className} />;
  return <Brand size={size} color={color} className={className} />;
}
