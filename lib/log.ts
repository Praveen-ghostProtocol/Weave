// Content-safe usage logging. The parameter type has no field that could
// ever hold node/persona content — it's structurally impossible to pass
// arbitrary text through this function, which is the point: llm-proxy must
// log (user, task, model, tokens, cost), never prompt/response content.
type UsageLogEntry = {
  userId: string;
  task: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export function logUsage(entry: UsageLogEntry): void {
  // Vercel captures stdout as logs — no external logging service needed yet.
  console.log(JSON.stringify({ type: "usage", ...entry, at: new Date().toISOString() }));
}
