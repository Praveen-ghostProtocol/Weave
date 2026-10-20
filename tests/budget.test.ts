import { afterEach, describe, expect, it, vi } from "vitest";

// Mocks the thing crossing a real boundary, the house style across these
// tests (in tests/openai.test.ts, fetch; here, the Supabase admin client
// — rather than hitting the real DB, since usage_ledger's FK to auth.users
// means a fake user_id can't be inserted for real without a real signed-up
// user on hand).
const { fromMock, rpcMock, logUsageMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
  logUsageMock: vi.fn(),
}));

vi.mock("../lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: fromMock, rpc: rpcMock }),
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

// Spend summation goes through the `spend_since` Postgres function
// (migration 0002), NOT a row select summed in JS. These tests assert the
// window boundaries that are passed to it, because those two date
// expressions are the only non-obvious arithmetic in the module and nothing
// else would catch them being wrong: summing from last month, or from the
// epoch, or using the month start for the daily cap, are all silent
// failures that change when a cap fires.
describe("getMonthlySpend", () => {
  it("asks Postgres for the sum rather than summing rows here", async () => {
    // Regression guard. Selecting rows and reducing them in JS is what this
    // used to do, and PostgREST silently truncates at max-rows (1000 by
    // default), so the global cap stopped firing past that many rows.
    rpcMock.mockResolvedValue({ data: 3.75, error: null });

    const total = await getMonthlySpend({ userId: "user-1" });

    expect(rpcMock).toHaveBeenCalledWith("spend_since", expect.anything());
    expect(fromMock).not.toHaveBeenCalled();
    expect(total).toBeCloseTo(3.75, 9);
  });

  it("scopes to a user when given and is global when omitted", async () => {
    rpcMock.mockResolvedValue({ data: 5, error: null });

    await getMonthlySpend({ userId: "user-1" });
    expect(rpcMock).toHaveBeenLastCalledWith(
      "spend_since",
      expect.objectContaining({ p_user: "user-1" })
    );

    await getMonthlySpend({});
    expect(rpcMock).toHaveBeenLastCalledWith(
      "spend_since",
      expect.objectContaining({ p_user: null })
    );
  });

  it("starts the window at the first instant of the current UTC month", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-17T08:30:00.000Z"));
    rpcMock.mockResolvedValue({ data: 0, error: null });

    await getMonthlySpend({});

    expect(rpcMock).toHaveBeenCalledWith(
      "spend_since",
      expect.objectContaining({ p_start: "2026-03-01T00:00:00.000Z" })
    );
    vi.useRealTimers();
  });

  it("throws if the rpc errors", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "query failed" } });
    await expect(getMonthlySpend({})).rejects.toThrow(/query failed/);
  });

  it("throws rather than reading a missing total as zero spent", async () => {
    // Failing open here would silently disable every cap that reads it.
    rpcMock.mockResolvedValue({ data: null, error: null });
    await expect(getMonthlySpend({})).rejects.toThrow(/no value/);
  });

  it("accepts a numeric returned as a string", async () => {
    // PostgREST serialises Postgres `numeric` as a string past JS safe range.
    rpcMock.mockResolvedValue({ data: "12.345678", error: null });
    expect(await getMonthlySpend({})).toBeCloseTo(12.345678, 9);
  });

  it("throws on a non-numeric total instead of coercing it to NaN", async () => {
    rpcMock.mockResolvedValue({ data: "not-a-number", error: null });
    await expect(getMonthlySpend({})).rejects.toThrow(/non-numeric/);
  });
});

describe("getDailySpend", () => {
  it("starts the window at midnight UTC today, not the month start", async () => {
    // The specific regression this catches: reusing the month boundary here
    // would turn the $0.05 daily cap into a second monthly one.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-17T08:30:00.000Z"));
    rpcMock.mockResolvedValue({ data: 0, error: null });

    await getDailySpend("user-1");

    expect(rpcMock).toHaveBeenCalledWith("spend_since", {
      p_start: "2026-03-17T00:00:00.000Z",
      p_user: "user-1",
    });
    vi.useRealTimers();
  });

  it("throws if the rpc errors", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "query failed" } });
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
