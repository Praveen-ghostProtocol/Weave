// Direct browser -> Anthropic Messages API call for "Draft with AI" (SPEC.md's
// AI draft assist addendum). Deliberately a raw `fetch`, not the Anthropic SDK
// — see plan.md's Phase 5 architecture notes (one endpoint, no dependency).
// Pure aside from the network call: no DOM, no localStorage — caller passes
// the key in and owns persistence.

export type DraftContextErrorKind = "invalid_key" | "rate_limited" | "network";

export class DraftContextError extends Error {
  readonly kind: DraftContextErrorKind;

  constructor(kind: DraftContextErrorKind, message: string) {
    super(message);
    this.name = "DraftContextError";
    this.kind = kind;
  }
}

const SYSTEM_PROMPT =
  "You turn a user's persona notes into context for pasting into another AI " +
  "chat. Given the notes below, write a concise, first-person context brief " +
  "(a few short paragraphs, written as the user introducing themselves) that " +
  "synthesizes the notes into something ready to paste. Output only the " +
  "brief itself — no headers, preamble, or commentary.";

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicMessageResponse {
  content?: AnthropicContentBlock[];
}

export async function draftContext(markdown: string, apiKey: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-opus-5-5",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: markdown }],
      }),
    });
  } catch {
    throw new DraftContextError("network", "Could not reach Anthropic's API.");
  }

  if (response.status === 401) {
    throw new DraftContextError("invalid_key", "That API key was rejected by Anthropic.");
  }
  if (response.status === 429) {
    throw new DraftContextError("rate_limited", "Anthropic's API is rate-limiting this key right now.");
  }
  if (!response.ok) {
    throw new DraftContextError("network", `Anthropic's API returned an error (${response.status}).`);
  }

  const data = (await response.json()) as AnthropicMessageResponse;
  const text = data.content?.find((block) => block.type === "text")?.text;
  if (typeof text !== "string") {
    throw new DraftContextError("network", "Anthropic's API returned an unexpected response.");
  }
  return text;
}
