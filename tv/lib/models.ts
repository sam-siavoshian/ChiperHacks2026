// Model catalog for the match-setup screen. Edit freely — this is just the menu
// the operator picks from; the chosen `{lab, model}` is forwarded to the arena on
// launch. `id` is the value sent to the backend; `name` is what the audience sees.

export interface ModelOption { id: string; name: string; tag: string; }
export interface Lab { id: string; name: string; glyph: string; accent: string; models: ModelOption[]; }

export const LABS: Lab[] = [
  {
    id: "anthropic", name: "Anthropic", glyph: "✶", accent: "#d2a679",
    models: [
      { id: "claude-opus-4-8", name: "Claude Opus 4.8", tag: "flagship" },
      { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", tag: "balanced" },
      { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", tag: "fast" },
    ],
  },
  {
    id: "openai", name: "OpenAI", glyph: "◍", accent: "#10a37f",
    models: [
      { id: "gpt-5", name: "GPT-5", tag: "flagship" },
      { id: "gpt-5-mini", name: "GPT-5 mini", tag: "fast" },
      { id: "o3", name: "o3", tag: "reasoning" },
      { id: "o4-mini", name: "o4-mini", tag: "reasoning" },
    ],
  },
  {
    id: "google", name: "Google DeepMind", glyph: "◆", accent: "#4d8bf5",
    models: [
      { id: "gemini-3-pro", name: "Gemini 3 Pro", tag: "flagship" },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", tag: "balanced" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", tag: "fast" },
    ],
  },
  {
    id: "xai", name: "xAI", glyph: "✕", accent: "#c8ccd2",
    models: [
      { id: "grok-4", name: "Grok 4", tag: "flagship" },
      { id: "grok-3", name: "Grok 3", tag: "balanced" },
    ],
  },
  {
    id: "meta", name: "Meta", glyph: "∞", accent: "#3b7cff",
    models: [
      { id: "llama-4-maverick", name: "Llama 4 Maverick", tag: "open" },
      { id: "llama-4-scout", name: "Llama 4 Scout", tag: "open · fast" },
    ],
  },
  {
    id: "mistral", name: "Mistral", glyph: "▲", accent: "#fa7315",
    models: [
      { id: "mistral-large-latest", name: "Mistral Large 3", tag: "flagship" },
      { id: "mistral-medium-latest", name: "Mistral Medium", tag: "balanced" },
    ],
  },
  {
    id: "deepseek", name: "DeepSeek", glyph: "⬡", accent: "#5b7cfa",
    models: [
      { id: "deepseek-chat", name: "DeepSeek V3.2", tag: "flagship" },
      { id: "deepseek-reasoner", name: "DeepSeek R1", tag: "reasoning" },
    ],
  },
];

export function findLab(labId: string): Lab | undefined {
  return LABS.find((l) => l.id === labId);
}
export function findModel(labId: string, modelId: string): ModelOption | undefined {
  return findLab(labId)?.models.find((m) => m.id === modelId);
}
export function labAccent(labId: string): string {
  return findLab(labId)?.accent ?? "#8aa0c4";
}
export function modelName(labId: string, modelId: string): string {
  return findModel(labId, modelId)?.name ?? modelId;
}
