// Server-only OpenAI Responses API call for the `llm-proxy` module's
// `draft-brief` fixed task endpoint (tasks/plan.md's "Weave v1: capability
// map" / llm-proxy section). Client sends data (markdown), never a prompt —
// this module builds the only prompt. Pure aside from the network call: no
// DOM, no ledger/budget access (that's lib/llm/budget.ts, built separately),
// no env reading beyond the server-only validated accessor. Mirrors
// lib/llm/anthropic.ts's shape (typed errors, raw fetch, no SDK) but is a
// fresh OpenAI-specific implementation — see that file's own header for why
// a raw fetch over a SDK dependency.
//
// Endpoint/param choices, verified against OpenAI's current docs (not
// memory) on 2026-10-20:
// - Responses API (`/v1/responses`), not Chat Completions — OpenAI's docs
//   recommend Responses for all new projects (developers.openai.com/api/docs
//   /guides/migrate-to-responses); Chat Completions stays supported but isn't
//   the current recommendation.
// - Model gpt-5.4-mini's reasoning.effort supports: none (default), low,
//   medium, high, xhigh (developers.openai.com/docs/models/gpt-5.4-mini).
//   "none" is both the lowest accepted value and the default — set
//   explicitly anyway per plan.md's "every call must set the lowest
//   reasoning effort" rule, so a future default change can't silently
//   regress cost.
// - max_output_tokens caps reasoning + visible output combined
//   (developers.openai.com/api/docs/guides/reasoning) — the hard cost cap
//   plan.md requires.
// - safety_identifier is a top-level string field, hashed-id recommended
//   (help.openai.com/en/articles/5428082-how-to-incorporate-a-safety-identifier).
// - `instructions` (static system prompt) + `input` (variable, last) maps
//   directly onto plan.md's prompt-caching ordering requirement — that's
//   exactly how the two fields are meant to be used.
// - usage.input_tokens / usage.output_tokens are the real token counts
//   (output_tokens includes reasoning tokens) per OpenAI's reasoning guide.

import { serverEnv } from "../env.server";

export type DraftBriefErrorKind = "invalid_key" | "rate_limited" | "network";

export class DraftBriefError extends Error {
  readonly kind: DraftBriefErrorKind;

  constructor(kind: DraftBriefErrorKind, message: string) {
    super(message);
    this.name = "DraftBriefError";
    this.kind = kind;
  }
}

const MODEL = "gpt-5.4-mini";
const MAX_OUTPUT_TOKENS = 1024; // hard cap; plan.md estimates ~500 for this task

const SYSTEM_PROMPT =
  "You turn a user's persona notes into context for pasting into another AI " +
  "chat. Given the notes below, write a concise, first-person context brief " +
  "(a few short paragraphs, written as the user introducing themselves) that " +
  "synthesizes the notes into something ready to paste. Output only the " +
  "brief itself — no headers, preamble, or commentary.";

interface OpenAIContentBlock {
  type: string;
  text?: string;
}

interface OpenAIOutputItem {
  type: string;
  content?: OpenAIContentBlock[];
}

interface OpenAIUsage {
  input_tokens?: number;
  output_tokens?: number;
}

interface OpenAIResponsesPayload {
  output?: OpenAIOutputItem[];
  usage?: OpenAIUsage;
}

function extractText(data: OpenAIResponsesPayload): string | undefined {
  for (const item of data.output ?? []) {
    if (item.type !== "message") continue;
    const block = item.content?.find((c) => c.type === "output_text");
    if (typeof block?.text === "string") return block.text;
  }
  return undefined;
}

// safety_identifier must never carry the raw user id (OpenAI only needs it
// for abuse-handling correlation, not to identify the user). Truncated
// SHA-256 hex, well under the API's 64-char limit.
async function hashUserId(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId));
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 32);
}

export async function draftBrief(
  markdown: string,
  userId: string
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${serverEnv.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        instructions: SYSTEM_PROMPT,
        input: markdown,
        reasoning: { effort: "none" },
        max_output_tokens: MAX_OUTPUT_TOKENS,
        safety_identifier: await hashUserId(userId),
      }),
    });
  } catch {
    throw new DraftBriefError("network", "Could not reach OpenAI's API.");
  }

  if (response.status === 401) {
    throw new DraftBriefError("invalid_key", "That API key was rejected by OpenAI.");
  }
  if (response.status === 429) {
    throw new DraftBriefError("rate_limited", "OpenAI's API is rate-limiting this key right now.");
  }
  if (!response.ok) {
    throw new DraftBriefError("network", `OpenAI's API returned an error (${response.status}).`);
  }

  const data = (await response.json()) as OpenAIResponsesPayload;
  const text = extractText(data);
  if (typeof text !== "string") {
    throw new DraftBriefError("network", "OpenAI's API returned an unexpected response.");
  }

  return {
    text,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  };
}
