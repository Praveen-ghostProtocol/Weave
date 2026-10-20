import { beforeEach, describe, expect, it, vi } from "vitest";

// Same philosophy as tests/budget.test.ts: mock the things that cross a
// real boundary (Supabase auth, the ledger, OpenAI) and exercise the
// route's own decision-making for real. The point of this file is the
// money path — specifically that a reservation lands BEFORE any cap is
// read, which is what stops concurrent requests overspending a quota.
const { getUserMock, budgetMocks, draftBriefMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  budgetMocks: {
    isKillSwitchActive: vi.fn(),
    getMonthlySpend: vi.fn(),
    getDailySpend: vi.fn(),
    reserve: vi.fn(),
    settle: vi.fn(),
    refund: vi.fn(),
  },
  draftBriefMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: getUserMock } }),
}));

vi.mock("@/lib/llm/budget", () => budgetMocks);

vi.mock("@/lib/llm/openai", () => ({
  draftBrief: draftBriefMock,
  DraftBriefError: class DraftBriefError extends Error {
    kind: string;
    constructor(kind: string) {
      super(kind);
      this.kind = kind;
    }
  },
  MODEL: "gpt-5.4-nano",
  MAX_OUTPUT_TOKENS: 1024,
  PRICE_PER_MILLION_INPUT: 0.2,
  PRICE_PER_MILLION_OUTPUT: 1.25,
}));

import { POST } from "@/app/api/ai/draft-brief/route";

const GLOBAL_CAP = 20;
const USER_MONTHLY_CAP = 0.25;
const USER_DAILY_CAP = 0.05;

function post(markdown = "# Grad school\n\nSecond year, graph layout research.") {
  return POST(
    new Request("http://localhost/api/ai/draft-brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown }),
    })
  );
}

/** Totals the ledger reports *after* this request's reservation lands. */
function spendAfterReserving(opts: { global?: number; userMonthly?: number; userDaily?: number }) {
  budgetMocks.getMonthlySpend.mockImplementation(async (scope: { userId?: string }) =>
    scope.userId ? (opts.userMonthly ?? 0) : (opts.global ?? 0)
  );
  budgetMocks.getDailySpend.mockImplementation(async () => opts.userDaily ?? 0);
}

beforeEach(() => {
  vi.clearAllMocks();
  budgetMocks.isKillSwitchActive.mockReturnValue(false);
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  budgetMocks.reserve.mockResolvedValue({ id: "res-1", reservedCostUsd: 0.016 });
  budgetMocks.settle.mockResolvedValue({ costUsd: 0.005 });
  budgetMocks.refund.mockResolvedValue(undefined);
  draftBriefMock.mockResolvedValue({ text: "A brief.", inputTokens: 100, outputTokens: 50 });
  spendAfterReserving({});
});

describe("POST /api/ai/draft-brief — quota enforcement", () => {
  it("reserves BEFORE reading any cap, so concurrent requests can't both pass a stale total", async () => {
    await post();

    // The whole fix in one assertion. If a cap read ever happens first,
    // two concurrent requests each see a pre-reservation total, each
    // passes, and together they overspend the quota.
    const reserveOrder = budgetMocks.reserve.mock.invocationCallOrder[0];
    expect(reserveOrder).toBeLessThan(budgetMocks.getMonthlySpend.mock.invocationCallOrder[0]);
    expect(reserveOrder).toBeLessThan(budgetMocks.getDailySpend.mock.invocationCallOrder[0]);
  });

  it("proceeds when the reservation still fits under every cap", async () => {
    spendAfterReserving({ global: 1, userMonthly: 0.02, userDaily: 0.016 });

    const res = await post();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "A brief." });
    expect(draftBriefMock).toHaveBeenCalledOnce();
    expect(budgetMocks.settle).toHaveBeenCalledOnce();
    expect(budgetMocks.refund).not.toHaveBeenCalled();
  });

  it("refunds and 429s when the reservation pushes the daily total over the cap", async () => {
    spendAfterReserving({ userDaily: USER_DAILY_CAP + 0.001 });

    const res = await post();

    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/today/i);
    expect(budgetMocks.refund).toHaveBeenCalledWith("res-1");
    // The money assertion: nothing was actually bought.
    expect(draftBriefMock).not.toHaveBeenCalled();
    expect(budgetMocks.settle).not.toHaveBeenCalled();
  });

  it("refunds and 429s when the reservation pushes the monthly total over the cap", async () => {
    spendAfterReserving({ userMonthly: USER_MONTHLY_CAP + 0.001 });

    const res = await post();

    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/this month/i);
    expect(budgetMocks.refund).toHaveBeenCalledWith("res-1");
    expect(draftBriefMock).not.toHaveBeenCalled();
  });

  it("refunds and 503s when the reservation pushes the global total over the cap", async () => {
    spendAfterReserving({ global: GLOBAL_CAP + 0.001 });

    const res = await post();

    expect(res.status).toBe(503);
    expect(budgetMocks.refund).toHaveBeenCalledWith("res-1");
    expect(draftBriefMock).not.toHaveBeenCalled();
  });

  it("allows a total that lands exactly on a cap — a cap is a ceiling, not an exclusive bound", async () => {
    spendAfterReserving({ userDaily: USER_DAILY_CAP });

    expect((await post()).status).toBe(200);
  });
});

describe("POST /api/ai/draft-brief — guards before any spend", () => {
  it("503s on the kill switch without touching the ledger", async () => {
    budgetMocks.isKillSwitchActive.mockReturnValue(true);

    expect((await post()).status).toBe(503);
    expect(budgetMocks.reserve).not.toHaveBeenCalled();
  });

  it("401s when there is no session, without touching the ledger", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });

    expect((await post()).status).toBe(401);
    expect(budgetMocks.reserve).not.toHaveBeenCalled();
  });

  it("400s on empty markdown, without touching the ledger", async () => {
    expect((await post("   ")).status).toBe(400);
    expect(budgetMocks.reserve).not.toHaveBeenCalled();
  });

  it("refunds the reservation when the OpenAI call itself fails", async () => {
    draftBriefMock.mockRejectedValue(
      Object.assign(new Error("rate_limited"), { kind: "rate_limited" })
    );

    // The thrown object isn't a real DraftBriefError instance, so the route
    // rethrows it — the refund still has to have happened first.
    await expect(post()).rejects.toThrow();
    expect(budgetMocks.refund).toHaveBeenCalledWith("res-1");
    expect(budgetMocks.settle).not.toHaveBeenCalled();
  });
});
