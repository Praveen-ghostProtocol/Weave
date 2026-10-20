// llm-proxy's accounting layer: reserve-then-settle against usage_ledger.
// Pure bookkeeping — no OpenAI calls, no prompt/task knowledge beyond the
// (user, task, model, tokens, cost) tuple logged by lib/log.ts's spirit.
//
// Why reserve-then-settle: a naive "check remaining budget, then call" has
// a race under concurrent requests (two requests both pass the check before
// either's cost lands). Reserving worst-case cost via a single INSERT closes
// that race — the insert itself is atomic, no read-then-write gap.

import { createAdminClient } from "../supabase/admin";
import { logUsage } from "../log";

function costUsd(
  inputTokens: number,
  outputTokens: number,
  pricePerMillionInput: number,
  pricePerMillionOutput: number
): number {
  return (inputTokens * pricePerMillionInput + outputTokens * pricePerMillionOutput) / 1_000_000;
}

export interface ReserveParams {
  userId: string;
  task: string;
  model: string;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  pricePerMillionInput: number;
  pricePerMillionOutput: number;
}

export interface ReserveResult {
  id: string;
  reservedCostUsd: number;
}

/** Reserves worst-case cost (estimated input + max output tokens) before the OpenAI call. */
export async function reserve(params: ReserveParams): Promise<ReserveResult> {
  const reservedCostUsd = costUsd(
    params.estimatedInputTokens,
    params.maxOutputTokens,
    params.pricePerMillionInput,
    params.pricePerMillionOutput
  );

  const { data, error } = await createAdminClient()
    .from("usage_ledger")
    .insert({
      user_id: params.userId,
      task: params.task,
      model: params.model,
      input_tokens: params.estimatedInputTokens,
      output_tokens: params.maxOutputTokens,
      cost_usd: reservedCostUsd,
      status: "reserved",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`budget.reserve: insert failed: ${error?.message ?? "no row returned"}`);
  }

  return { id: data.id as string, reservedCostUsd };
}

export interface SettleParams {
  actualInputTokens: number;
  actualOutputTokens: number;
  pricePerMillionInput: number;
  pricePerMillionOutput: number;
}

/** Moves a reservation to 'settled' at the real cost, computed from actual token counts. */
export async function settle(reservationId: string, params: SettleParams): Promise<{ costUsd: number }> {
  const settledCostUsd = costUsd(
    params.actualInputTokens,
    params.actualOutputTokens,
    params.pricePerMillionInput,
    params.pricePerMillionOutput
  );

  const { data, error } = await createAdminClient()
    .from("usage_ledger")
    .update({
      status: "settled",
      input_tokens: params.actualInputTokens,
      output_tokens: params.actualOutputTokens,
      cost_usd: settledCostUsd,
    })
    .eq("id", reservationId)
    .eq("status", "reserved")
    .select("user_id, task, model")
    .single();

  if (error || !data) {
    throw new Error(`budget.settle: update failed: ${error?.message ?? "reservation not found or not 'reserved'"}`);
  }

  logUsage({
    userId: data.user_id as string,
    task: data.task as string,
    model: data.model as string,
    inputTokens: params.actualInputTokens,
    outputTokens: params.actualOutputTokens,
    costUsd: settledCostUsd,
  });

  return { costUsd: settledCostUsd };
}

/** Moves a reservation to 'refunded' — the OpenAI call failed, so it shouldn't count against budget. */
export async function refund(reservationId: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("usage_ledger")
    .update({ status: "refunded" })
    .eq("id", reservationId)
    .eq("status", "reserved");

  if (error) {
    throw new Error(`budget.refund: update failed: ${error.message}`);
  }
}

/**
 * Sums spend in Postgres via the `spend_since` function (migration 0002).
 *
 * This MUST stay a database-side aggregate. Selecting the rows and summing
 * them here is what the previous version did, and PostgREST silently
 * truncates at the project's max-rows setting (1000 by default) with a 200
 * and no ORDER BY — so past that many rows in the window the total stops
 * growing and whatever cap reads it quietly stops firing. A scalar from the
 * database cannot truncate.
 *
 * `spend_since` also drops reservations older than its TTL, so a request
 * killed between reserve and settle stops counting as spend. See the
 * migration for why, and for the ceiling that carries.
 */
async function spendSince(startIso: string, userId?: string): Promise<number> {
  const { data, error } = await createAdminClient().rpc("spend_since", {
    p_start: startIso,
    p_user: userId ?? null,
  });

  if (error) {
    throw new Error(`budget.spendSince: rpc failed: ${error.message}`);
  }
  // numeric comes back as a string from PostgREST when it exceeds JS safe
  // range; Number() handles both that and the normal numeric case. A null
  // would mean the function returned nothing, which coalesce(…, 0) prevents
  // — treat it as an error rather than silently reading it as $0 spent.
  if (data === null || data === undefined) {
    throw new Error("budget.spendSince: rpc returned no value");
  }
  const total = Number(data);
  if (!Number.isFinite(total)) {
    throw new Error(`budget.spendSince: rpc returned a non-numeric total: ${String(data)}`);
  }
  return total;
}

function startOfUtcMonthIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function startOfUtcDayIso(now = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  ).toISOString();
}

/**
 * Spend for the current calendar month (UTC). Scoped to one user, or global
 * across all users when userId is omitted — the figure the $20/mo global cap
 * reads.
 */
export async function getMonthlySpend(scope: { userId?: string }): Promise<number> {
  return spendSince(startOfUtcMonthIso(), scope.userId);
}

/**
 * Spend for the current calendar day (UTC) for one user — the figure the
 * $0.05/day per-user cap reads. Same aggregate as getMonthlySpend, just a
 * different window start; both go through spendSince so a fix to one is a
 * fix to both.
 */
export async function getDailySpend(userId: string): Promise<number> {
  return spendSince(startOfUtcDayIso(), userId);
}

/** AI_KILL_SWITCH env var — any truthy string means active, nothing should call OpenAI. */
export function isKillSwitchActive(): boolean {
  return Boolean(process.env.AI_KILL_SWITCH);
}
