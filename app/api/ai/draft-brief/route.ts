import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as budget from "@/lib/llm/budget";
import { draftBrief, DraftBriefError, MODEL, MAX_OUTPUT_TOKENS, PRICE_PER_MILLION_INPUT, PRICE_PER_MILLION_OUTPUT } from "@/lib/llm/openai";

// llm-proxy's first fixed task endpoint (tasks/plan.md's llm-proxy section).
// Client sends only { markdown } — never a prompt — this route is the only
// caller of openai.draftBrief, and budget.ts's reserve/settle/refund is the
// only thing allowed to touch usage_ledger. Order matters: kill-switch and
// auth are checked before anything that costs a DB round trip or money.
const TASK = "draft-brief";

// ~15k tokens per plan.md's input cap, as a character count. ~4 chars/token
// is the same rough heuristic lib/graph/export.ts already uses for its own
// estimate (estimate: Math.ceil(markdown.length / 4)) — 15,000 * 4 = 60,000.
const MAX_MARKDOWN_CHARS = 60_000;

const MONTHLY_GLOBAL_CAP_USD = 20;
const MONTHLY_USER_CAP_USD = 0.25;
const DAILY_USER_CAP_USD = 0.05;

/**
 * Returns the first cap this request breaches, or null if it's within all
 * of them. Called AFTER the reservation lands, so every total it reads
 * already includes this request's own worst-case cost.
 *
 * Why that order: checking first and reserving second leaves a
 * read-then-write gap that concurrent requests slip through together —
 * each reads a pre-reservation total, each passes, and between them they
 * overspend. Reserving first puts every in-flight request's worst case in
 * the ledger before anyone reads a total, so a burst can't collectively
 * exceed a cap. Under contention this over-rejects rather than overspends,
 * which is the right side to err on in the one path that costs money.
 *
 * Accepted cost: while a cap is blown, each request still writes and then
 * refunds a ledger row. Negligible at this scale; revisit if the ledger
 * ever gets hot.
 */
async function capExceeded(
  userId: string
): Promise<{ error: string; status: number } | null> {
  if ((await budget.getMonthlySpend({})) > MONTHLY_GLOBAL_CAP_USD) {
    return { error: "AI budget exhausted this month, try again next month.", status: 503 };
  }
  if ((await budget.getMonthlySpend({ userId })) > MONTHLY_USER_CAP_USD) {
    return { error: "You've used your AI quota for this month.", status: 429 };
  }
  if ((await budget.getDailySpend(userId)) > DAILY_USER_CAP_USD) {
    return { error: "You've used your AI quota for today.", status: 429 };
  }
  return null;
}

export async function POST(request: Request) {
  if (budget.isKillSwitchActive()) {
    return NextResponse.json({ error: "AI is temporarily unavailable." }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

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

  // Reserve first, then check the caps against totals that include this
  // reservation — see capExceeded's comment for why this order is the one
  // that actually holds the quota under concurrency.
  const { id: reservationId } = await budget.reserve({
    userId: user.id,
    task: TASK,
    model: MODEL,
    estimatedInputTokens: Math.ceil(markdown.length / 4), // same heuristic as lib/graph/export.ts
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    pricePerMillionInput: PRICE_PER_MILLION_INPUT,
    pricePerMillionOutput: PRICE_PER_MILLION_OUTPUT,
  });

  const exceeded = await capExceeded(user.id);
  if (exceeded) {
    await budget.refund(reservationId);
    return NextResponse.json({ error: exceeded.error }, { status: exceeded.status });
  }

  let result: { text: string; inputTokens: number; outputTokens: number };
  try {
    result = await draftBrief(markdown, user.id);
  } catch (err) {
    await budget.refund(reservationId);

    if (err instanceof DraftBriefError) {
      if (err.kind === "rate_limited") {
        return NextResponse.json({ error: "AI is busy, try again shortly." }, { status: 503 });
      }
      if (err.kind === "network") {
        return NextResponse.json({ error: "Could not reach the AI service, try again shortly." }, { status: 502 });
      }
      // invalid_key: the server's own OpenAI key is bad — a config problem,
      // not this request's fault, and it means AI is broken for everyone.
      // Loud in server logs on purpose, not swallowed behind a generic 500.
      console.error("draft-brief: OpenAI rejected the server's API key (invalid_key) — AI feature is down", err);
      return NextResponse.json({ error: "AI is temporarily unavailable." }, { status: 500 });
    }
    throw err;
  }

  await budget.settle(reservationId, {
    actualInputTokens: result.inputTokens,
    actualOutputTokens: result.outputTokens,
    pricePerMillionInput: PRICE_PER_MILLION_INPUT,
    pricePerMillionOutput: PRICE_PER_MILLION_OUTPUT,
  });

  return NextResponse.json({ text: result.text });
}
