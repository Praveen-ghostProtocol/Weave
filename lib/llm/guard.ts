// Everything a fixed task endpoint has to do around an OpenAI call, in one
// place: kill switch, auth, tester allowlist, reserve-then-check, settle,
// refund. Extracted when node drafting added two more callers — the caps
// and the reserve/settle ordering are the only code here that can lose real
// money, and SPEC.md requires the quota numbers to move in lockstep, so
// three copies of them was the wrong shape.
//
// A route is left owning only what is genuinely its own: validating its
// request body, building its prompt, and parsing its response.

import { NextResponse } from "next/server";
import { createClient } from "../supabase/server";
import * as budget from "./budget";
import {
  LlmError,
  MODEL,
  PRICE_PER_MILLION_INPUT,
  PRICE_PER_MILLION_OUTPUT,
} from "./openai";

// Ratified by the founder 2026-10-20 and recorded in SPEC.md's spend
// controls. These are shared by every AI endpoint: the quotas are per user,
// not per feature, so drafting a node and drafting a brief draw on the same
// allowance. Changing them is an "Ask first" item, and they must stay in
// step with the numbers written in SPEC.md.
const MONTHLY_GLOBAL_CAP_USD = 20;
const MONTHLY_USER_CAP_USD = 0.25;
const DAILY_USER_CAP_USD = 0.05;

/**
 * Optional tester allowlist, comma-separated emails in AI_ALLOWED_EMAILS.
 *
 * OpenAI offers this project spend alerts but no enforceable hard cap, so
 * the app's own ceiling is the only thing bounding the bill, and Google
 * sign-in does not restrict who may create an account. Capping who can
 * spend is therefore the largest reduction available.
 *
 * Unset means every signed-in user may use AI, deliberately: failing closed
 * on a missing env var would take AI down for everyone, including the
 * founder, on the first deploy that forgot it. SET IT IN EVERY DEPLOYED
 * ENVIRONMENT. It is a spend boundary, not a security boundary.
 */
function isAllowedTester(email: string | undefined): boolean {
  const raw = process.env.AI_ALLOWED_EMAILS;
  if (!raw || raw.trim() === "") return true;
  const allowed = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return true;
  return typeof email === "string" && allowed.includes(email.trim().toLowerCase());
}

/**
 * Refund that never throws. Refunds run on paths that are already failing,
 * and letting one throw replaces the real error with a bookkeeping error
 * while stranding the reservation anyway. Migration 0002's TTL is the
 * backstop if it genuinely fails, so the loud log is the actionable part.
 */
export async function safeRefund(reservationId: string): Promise<void> {
  try {
    await budget.refund(reservationId);
  } catch (err) {
    console.error(`llm guard: refund failed for reservation ${reservationId}`, err);
  }
}

export type Authorized = { ok: true; userId: string };
export type Rejected = { ok: false; response: NextResponse };

/**
 * Kill switch, then authentication, then the tester allowlist — in that
 * order, so the cheapest check that can refuse the request runs first and
 * nothing reaches a DB round trip until all three pass.
 */
export async function authorizeAiRequest(): Promise<Authorized | Rejected> {
  if (budget.isKillSwitchActive()) {
    return {
      ok: false,
      response: NextResponse.json({ error: "AI is temporarily unavailable." }, { status: 503 }),
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }),
    };
  }

  if (!isAllowedTester(user.email)) {
    // 403 not 401: the user IS signed in, so the client should show this
    // message rather than its sign-in prompt.
    return {
      ok: false,
      response: NextResponse.json(
        { error: "AI is limited to invited testers right now. Export still works." },
        { status: 403 }
      ),
    };
  }

  return { ok: true, userId: user.id };
}

/** Returns the first cap this request breaches, or null if within all of them. */
async function capExceeded(
  userId: string
): Promise<{ error: string; status: number } | null> {
  if ((await budget.getMonthlySpend({})) > MONTHLY_GLOBAL_CAP_USD) {
    return { error: "AI budget exhausted this month, try again next month.", status: 503 };
  }
  if ((await budget.getMonthlySpend({ userId })) > MONTHLY_USER_CAP_USD) {
    return { error: "You've used your AI quota for this month. It resets on the 1st, UTC.", status: 429 };
  }
  if ((await budget.getDailySpend(userId)) > DAILY_USER_CAP_USD) {
    return { error: "You've used your AI quota for today. It resets at midnight UTC.", status: 429 };
  }
  return null;
}

/**
 * Reserves worst-case cost, THEN checks the caps against totals that
 * already include that reservation.
 *
 * The order is the point. Checking first and reserving second leaves a
 * read-then-write gap that concurrent requests slip through together: each
 * reads a pre-reservation total, each passes, and between them they
 * overspend. Reserving first puts every in-flight request's worst case in
 * the ledger before anyone reads a total, so a burst cannot collectively
 * exceed a cap. Under contention this over-rejects rather than overspends,
 * which is the right side to err on in the one path that costs money.
 *
 * Every failure here refunds before returning, so no exit leaves a
 * reservation standing.
 */
export async function reserveAndCheckCaps(params: {
  userId: string;
  task: string;
  estimatedInputTokens: number;
  maxOutputTokens: number;
}): Promise<{ ok: true; reservationId: string } | Rejected> {
  const { id: reservationId } = await budget.reserve({
    userId: params.userId,
    task: params.task,
    model: MODEL,
    estimatedInputTokens: params.estimatedInputTokens,
    maxOutputTokens: params.maxOutputTokens,
    pricePerMillionInput: PRICE_PER_MILLION_INPUT,
    pricePerMillionOutput: PRICE_PER_MILLION_OUTPUT,
  });

  let exceeded: { error: string; status: number } | null;
  try {
    exceeded = await capExceeded(params.userId);
  } catch (err) {
    // A failing spend query would otherwise strand the reservation at
    // worst-case price for the whole window.
    await safeRefund(reservationId);
    throw err;
  }

  if (exceeded) {
    await safeRefund(reservationId);
    return {
      ok: false,
      response: NextResponse.json({ error: exceeded.error }, { status: exceeded.status }),
    };
  }

  return { ok: true, reservationId };
}

/**
 * Maps an upstream failure to a response, refunding first. Any error that
 * isn't an LlmError is rethrown — after the refund, so an unexpected bug
 * still can't leave the reservation standing.
 */
export async function refundAndMapError(
  reservationId: string,
  err: unknown
): Promise<NextResponse> {
  await safeRefund(reservationId);

  if (err instanceof LlmError) {
    if (err.kind === "rate_limited") {
      return NextResponse.json({ error: "AI is busy, try again shortly." }, { status: 503 });
    }
    if (err.kind === "network") {
      return NextResponse.json(
        { error: "Could not reach the AI service, try again shortly." },
        { status: 502 }
      );
    }
    // invalid_key: the server's own OpenAI key is bad — a config problem,
    // not this request's fault, and it means AI is broken for everyone.
    // Loud in server logs on purpose, not swallowed behind a generic 500.
    console.error("llm guard: OpenAI rejected the server's API key — AI is down for everyone", err);
    return NextResponse.json({ error: "AI is temporarily unavailable." }, { status: 500 });
  }
  throw err;
}

/**
 * Settles the reservation at actual cost. Never throws: the OpenAI call has
 * already happened and is already billed, so failing here is a bookkeeping
 * problem, not the user's. Withholding output they have paid for helps
 * nobody, and the reservation would be left standing too.
 *
 * ponytail: the accepted ceiling is that a failed settle under-records real
 * spend once migration 0002's TTL expires the row. Rare, logged, and safer
 * than locking a paying user out. Volume in the logs is the signal to add a
 * retry.
 */
export async function settleQuietly(
  reservationId: string,
  usage: { inputTokens: number; outputTokens: number }
): Promise<void> {
  try {
    await budget.settle(reservationId, {
      actualInputTokens: usage.inputTokens,
      actualOutputTokens: usage.outputTokens,
      pricePerMillionInput: PRICE_PER_MILLION_INPUT,
      pricePerMillionOutput: PRICE_PER_MILLION_OUTPUT,
    });
  } catch (err) {
    console.error(
      `llm guard: settle failed for reservation ${reservationId} after a billed call — ` +
        "the ledger may under-record this spend once the reservation TTL expires",
      err
    );
  }
}
