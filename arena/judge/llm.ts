// Optional LLM reasoning for the judge (reading a patch diff against the answer
// sheet's criteria). Advisory only — the deterministic probes are ground truth.
// Degrades to null with no API key or on any error, so the judge always works.

const MODEL = process.env.JUDGE_MODEL ?? "claude-sonnet-4-6";
const TIMEOUT_MS = 8000;

export interface LlmVerdict {
  isTargetedFix: boolean;
  reasoning: string;
}

export async function reviewPatchDiff(args: {
  vulnTitle: string;
  patchCriteria: string;
  diff: string;
  exploitStillWorks: boolean;
  featureBroken: boolean;
}): Promise<LlmVerdict | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const system =
    "You are a security review judge in a live attack/defense match. You are given a vulnerability, the criteria for a correct fix, and a code diff. Decide if the diff is a real, targeted fix for THAT vulnerability (not an unrelated change, not disabling the feature, not a no-op). Respond ONLY as compact JSON: {\"isTargetedFix\": boolean, \"reasoning\": \"<one sentence>\"}.";
  const user = `Vulnerability: ${args.vulnTitle}
Correct-fix criteria: ${args.patchCriteria}
Automated checks: exploitStillWorks=${args.exploitStillWorks}, featureBroken=${args.featureBroken}
Diff:
\`\`\`diff
${args.diff.slice(0, 12000)}
\`\`\``;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 256,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const data: any = await resp.json();
    const text = data?.content?.[0]?.text ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    return { isTargetedFix: !!parsed.isTargetedFix, reasoning: String(parsed.reasoning ?? "") };
  } catch {
    return null;
  }
}
