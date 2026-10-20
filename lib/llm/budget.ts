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
 * Sums cost_usd for the current calendar month, excluding refunded rows.
 * Scoped to one user, or global (all users) when userId is omitted — the
 * figure the $20/mo global cap check reads.
 */
export async function getMonthlySpend(scope: { userId?: string }): Promise<number> {
  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  let query = createAdminClient()
    .from("usage_ledger")
    .select("cost_usd")
    .gte("created_at", startOfMonth)
    .neq("status", "refunded");

  if (scope.userId) {
    query = query.eq("user_id", scope.userId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`budget.getMonthlySpend: query failed: ${error.message}`);
  }

  return (data ?? []).reduce((sum: number, row: { cost_usd: number }) => sum + Number(row.cost_usd), 0);
}

/**
 * Sums cost_usd for the current calendar day (UTC), excluding refunded rows,
 * for one user — the figure the $0.05/day per-user cap check reads. Same
 * shape as getMonthlySpend, just day-scoped instead of month-scoped.
 */
export async function getDailySpend(userId: string): Promise<number> {
  const now = new Date();
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();

  const { data, error } = await createAdminClient()
    .from("usage_ledger")
    .select("cost_usd")
    .gte("created_at", startOfDay)
    .neq("status", "refunded")
    .eq("user_id", userId);

  if (error) {
    throw new Error(`budget.getDailySpend: query failed: ${error.message}`);
  }

  return (data ?? []).reduce((sum: number, row: { cost_usd: number }) => sum + Number(row.cost_usd), 0);
}

/** AI_KILL_SWITCH env var — any truthy string means active, nothing should call OpenAI. */
export function isKillSwitchActive(): boolean {
  return Boolean(process.env.AI_KILL_SWITCH);
}
