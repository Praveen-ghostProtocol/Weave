import { afterEach, describe, expect, it, vi } from "vitest";

// Mocks the thing crossing a real boundary, the house style across these
// tests (in tests/openai.test.ts, fetch; here, the Supabase admin client
// — rather than hitting the real DB, since usage_ledger's FK to auth.users
// means a fake user_id can't be inserted for real without a real signed-up
// user on hand).
const { fromMock, logUsageMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  logUsageMock: vi.fn(),
}));

vi.mock("../lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

vi.mock("../lib/log", () => ({
  logUsage: logUsageMock,
}));

import { getDailySpend, getMonthlySpend, isKillSwitchActive, reserve, refund, settle } from "../lib/llm/budget";

// A chainable stub standing in for a PostgREST query builder: every filter
// method returns itself, `.single()` resolves the configured result, and
// the builder is itself thenable so `await query` works when the code never
// calls `.single()` (refund, getMonthlySpend).
function makeQueryBuilder(result: { data: unknown; error: { message: string } | null }) {
  const builder: Record<string, unknown> = {
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    neq: vi.fn(() => builder),
    single: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("reserve", () => {
  it("inserts a 'reserved' row priced at worst-case tokens and returns id + cost", async () => {
    const builder = makeQueryBuilder({ data: { id: "res-1" }, error: null });
    fromMock.mockReturnValue(builder);

    const result = await reserve({
      userId: "user-1",
      task: "draft",
      model: "gpt-nano",
      estimatedInputTokens: 1_000_000,
      maxOutputTokens: 500_000,
      pricePerMillionInput: 0.1,
      pricePerMillionOutput: 0.4,
    });

    expect(fromMock).toHaveBeenCalledWith("usage_ledger");
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        task: "draft",
        model: "gpt-nano",
        input_tokens: 1_000_000,
        output_tokens: 500_000,
        status: "reserved",
      })
    );
    // 1_000_000 tok @ $0.1/M + 500_000 tok @ $0.4/M = 0.1 + 0.2 = 0.3
    expect(result.reservedCostUsd).toBeCloseTo(0.3, 9);
    expect(result.id).toBe("res-1");
  });

  it("throws if the insert fails", async () => {
    fromMock.mockReturnValue(
      makeQueryBuilder({ data: null, error: { message: "insert failed" } })
    );
    await expect(
      reserve({
        userId: "user-1",
        task: "draft",
        model: "gpt-nano",
        estimatedInputTokens: 10,
        maxOutputTokens: 10,
        pricePerMillionInput: 1,
        pricePerMillionOutput: 1,
      })
    ).rejects.toThrow(/insert failed/);
  });
});

describe("settle", () => {
  it("updates the row to 'settled' at the real cost and logs usage", async () => {
    const builder = makeQueryBuilder({
      data: { user_id: "user-1", task: "draft", model: "gpt-nano" },
      error: null,
    });
    fromMock.mockReturnValue(builder);

    const result = await settle("res-1", {
      actualInputTokens: 100,
      actualOutputTokens: 50,
      pricePerMillionInput: 1,
      pricePerMillionOutput: 2,
    });

    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "settled", input_tokens: 100, output_tokens: 50 })
    );
    expect(builder.eq).toHaveBeenCalledWith("id", "res-1");
    expect(builder.eq).toHaveBeenCalledWith("status", "reserved");
    // 100 tok @ $1/M + 50 tok @ $2/M = 0.0001 + 0.0001 = 0.0002
    expect(result.costUsd).toBeCloseTo(0.0002, 9);
    expect(logUsageMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", task: "draft", model: "gpt-nano", costUsd: result.costUsd })
    );
  });

  it("throws if the reservation can't be settled (wrong id or already settled/refunded)", async () => {
    fromMock.mockReturnValue(makeQueryBuilder({ data: null, error: null }));
    await expect(
      settle("missing", {
        actualInputTokens: 1,
        actualOutputTokens: 1,
        pricePerMillionInput: 1,
        pricePerMillionOutput: 1,
      })
    ).rejects.toThrow(/budget.settle/);
    expect(logUsageMock).not.toHaveBeenCalled();
  });
});

describe("refund", () => {
  it("updates the row to 'refunded', guarded on status = reserved", async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    fromMock.mockReturnValue(builder);

    await refund("res-1");

    expect(builder.update).toHaveBeenCalledWith({ status: "refunded" });
    expect(builder.eq).toHaveBeenCalledWith("id", "res-1");
    expect(builder.eq).toHaveBeenCalledWith("status", "reserved");
  });

  it("throws if the update errors", async () => {
    fromMock.mockReturnValue(makeQueryBuilder({ data: null, error: { message: "boom" } }));
    await expect(refund("res-1")).rejects.toThrow(/boom/);
  });
});

describe("getMonthlySpend", () => {
  it("sums cost_usd excluding refunded rows, scoped to a user when given", async () => {
    const builder = makeQueryBuilder({
      data: [{ cost_usd: 1.5 }, { cost_usd: 2.25 }],
      error: null,
    });
    fromMock.mockReturnValue(builder);

    const total = await getMonthlySpend({ userId: "user-1" });

    expect(builder.neq).toHaveBeenCalledWith("status", "refunded");
    expect(builder.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(total).toBeCloseTo(3.75, 9);
  });

  it("is global (no user filter) when userId is omitted", async () => {
    const builder = makeQueryBuilder({ data: [{ cost_usd: 5 }], error: null });
    fromMock.mockReturnValue(builder);

    const total = await getMonthlySpend({});

    expect(builder.eq).not.toHaveBeenCalled();
    expect(total).toBe(5);
  });

  it("throws if the query errors", async () => {
    fromMock.mockReturnValue(makeQueryBuilder({ data: null, error: { message: "query failed" } }));
    await expect(getMonthlySpend({})).rejects.toThrow(/query failed/);
  });
});

describe("getDailySpend", () => {
  it("sums cost_usd excluding refunded rows, scoped to the given user and day", async () => {
    const builder = makeQueryBuilder({
      data: [{ cost_usd: 0.01 }, { cost_usd: 0.02 }],
      error: null,
    });
    fromMock.mockReturnValue(builder);

    const total = await getDailySpend("user-1");

    expect(builder.neq).toHaveBeenCalledWith("status", "refunded");
    expect(builder.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(total).toBeCloseTo(0.03, 9);
  });

  it("throws if the query errors", async () => {
    fromMock.mockReturnValue(makeQueryBuilder({ data: null, error: { message: "query failed" } }));
    await expect(getDailySpend("user-1")).rejects.toThrow(/query failed/);
  });
});

describe("isKillSwitchActive", () => {
  const ORIGINAL = process.env.AI_KILL_SWITCH;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.AI_KILL_SWITCH;
    else process.env.AI_KILL_SWITCH = ORIGINAL;
  });

  it("is false when unset", () => {
    delete process.env.AI_KILL_SWITCH;
    expect(isKillSwitchActive()).toBe(false);
  });

  it("is true for any truthy string value", () => {
    process.env.AI_KILL_SWITCH = "true";
    expect(isKillSwitchActive()).toBe(true);
    process.env.AI_KILL_SWITCH = "1";
    expect(isKillSwitchActive()).toBe(true);
  });
});
