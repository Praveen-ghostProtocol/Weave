import { NextResponse } from "next/server";
import {
  authorizeAiRequest,
  reserveAndCheckCaps,
  refundAndMapError,
  settleQuietly,
} from "@/lib/llm/guard";
import { draftBrief, inputTokenBound, MAX_OUTPUT_TOKENS } from "@/lib/llm/openai";

// llm-proxy's first fixed task endpoint (tasks/plan.md's llm-proxy section).
// The client sends only { markdown } — never a prompt. Everything that can
// cost money lives in lib/llm/guard.ts; what is left here is this task's
// own input validation and its call.
const TASK = "draft-brief";

// ~15k tokens per plan.md's input cap, as a character count. ~4 chars/token
// is the same rough heuristic lib/graph/export.ts already uses for its own
// estimate (estimate: Math.ceil(markdown.length / 4)) — 15,000 * 4 = 60,000.
const MAX_MARKDOWN_CHARS = 60_000;

export async function POST(request: Request) {
  const auth = await authorizeAiRequest();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const markdown = (body as { markdown?: unknown })?.markdown;
  if (typeof markdown !== "string" || markdown.trim().length === 0) {
    return NextResponse.json({ error: "markdown must be a non-empty string" }, { status: 400 });
  }
  if (markdown.length > MAX_MARKDOWN_CHARS) {
    return NextResponse.json({ error: "markdown is too large (max ~15k tokens)" }, { status: 400 });
  }

  const reservation = await reserveAndCheckCaps({
    userId: auth.userId,
    task: TASK,
    estimatedInputTokens: inputTokenBound(markdown),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });
  if (!reservation.ok) return reservation.response;

  let result;
  try {
    result = await draftBrief(markdown, auth.userId);
  } catch (err) {
    return refundAndMapError(reservation.reservationId, err);
  }

  await settleQuietly(reservation.reservationId, result);
  return NextResponse.json({ text: result.text });
}
