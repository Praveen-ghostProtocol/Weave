import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same philosophy as tests/budget.test.ts: mock the things that cross a
// real boundary (Supabase auth, the ledger, OpenAI) and exercise the
// route's own decision-making for real. The point of this file is the
// money path — specifically that a reservation lands BEFORE any cap is
// read, which is what stops concurrent requests overspending a quota.
const { getUserMock, budgetMocks, draftBriefMock, MockLlmError } = vi.hoisted(() => ({
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
  // The route does `err instanceof LlmError` against the module it
  // imports — which is this mock. Declaring the class here (rather than
  // inline in the factory) lets the tests construct the *same* class the
  // route will compare against, so the error-mapping branches are actually
  // entered. A separately-declared lookalike silently skips all of them.
  MockLlmError: class LlmError extends Error {
    kind: string;
    constructor(kind: string) {
      super(kind);
      this.name = "LlmError";
      this.kind = kind;
    }
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: getUserMock } }),
}));

vi.mock("@/lib/llm/budget", () => budgetMocks);

vi.mock("@/lib/llm/openai", () => ({
  draftBrief: draftBriefMock,
  LlmError: MockLlmError,
  // The real bound, not a stub: the route reserves with it, so a test that
  // stubbed it couldn't catch the reservation being under-priced.
  inputTokenBound: (markdown: string) => markdown.length,
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
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1", email: "founder@example.com" } }, error: null });
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

  it("400s on markdown over the character cap, without touching the ledger", async () => {
    // The character cap is what bounds per-call cost; nothing tested it.
    const res = await post("x".repeat(60_001));

    expect(res.status).toBe(400);
    expect(budgetMocks.reserve).not.toHaveBeenCalled();
  });

  it("rethrows a non-LlmError from the call, refunding first", async () => {
    draftBriefMock.mockRejectedValue(new Error("something unexpected"));

    await expect(post()).rejects.toThrow();
    expect(budgetMocks.refund).toHaveBeenCalledWith("res-1");
    expect(budgetMocks.settle).not.toHaveBeenCalled();
  });
});

// SPEC's live criterion is that every failure shows a clear inline message,
// and ExportPanel delegates all wording to the route — so this mapping IS
// the implementation of that criterion. It previously had no coverage at
// all: the suite's only failure test threw an object that wasn't a
// LlmError, so the whole branch was skipped and all three arms could
// have been deleted with the suite still green.
// The only control bounding *who* can draw on the founder's budget.
// OpenAI offers this project no enforceable spend cap, so an unbounded
// signup path is an unbounded bill.
describe("POST /api/ai/draft-brief — tester allowlist", () => {
  const ORIGINAL = process.env.AI_ALLOWED_EMAILS;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.AI_ALLOWED_EMAILS;
    else process.env.AI_ALLOWED_EMAILS = ORIGINAL;
  });

  function signedInAs(email: string | undefined) {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1", email } }, error: null });
  }

  it("allows everyone when the list is unset, preserving prior behaviour", async () => {
    delete process.env.AI_ALLOWED_EMAILS;
    signedInAs("anyone@example.com");
    expect((await post()).status).toBe(200);
  });

  it("allows an email on the list", async () => {
    process.env.AI_ALLOWED_EMAILS = "friend@example.com, founder@example.com";
    signedInAs("founder@example.com");
    expect((await post()).status).toBe(200);
  });

  it("403s an email that is not on the list, without touching the ledger", async () => {
    process.env.AI_ALLOWED_EMAILS = "friend@example.com";
    signedInAs("stranger@example.com");

    const res = await post();

    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/invited testers/i);
    // The whole point: a stranger costs nothing, not even a DB write.
    expect(budgetMocks.reserve).not.toHaveBeenCalled();
    expect(draftBriefMock).not.toHaveBeenCalled();
  });

  it("matches case-insensitively and ignores surrounding whitespace", async () => {
    process.env.AI_ALLOWED_EMAILS = "  Friend@Example.COM  ,  ";
    signedInAs("friend@example.com");
    expect((await post()).status).toBe(200);
  });

  it("403s a session with no email at all when a list is set", async () => {
    process.env.AI_ALLOWED_EMAILS = "friend@example.com";
    signedInAs(undefined);
    expect((await post()).status).toBe(403);
  });
});

describe("POST /api/ai/draft-brief — upstream error mapping", () => {
  it.each([
    ["rate_limited", 503, /busy/i],
    ["network", 502, /could not reach/i],
    ["invalid_key", 500, /unavailable/i],
  ])("maps %s to %i with its own message", async (kind, status, messageRe) => {
    draftBriefMock.mockRejectedValue(new MockLlmError(kind as string));

    const res = await post();

    expect(res.status).toBe(status);
    expect((await res.json()).error).toMatch(messageRe as RegExp);
    expect(budgetMocks.refund).toHaveBeenCalledWith("res-1");
    expect(budgetMocks.settle).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai/draft-brief — reservation is never stranded", () => {
  it("refunds when the cap check itself throws", async () => {
    budgetMocks.getDailySpend.mockRejectedValue(new Error("supabase down"));

    await expect(post()).rejects.toThrow(/supabase down/);
    expect(budgetMocks.refund).toHaveBeenCalledWith("res-1");
    expect(draftBriefMock).not.toHaveBeenCalled();
  });

  it("still returns the draft when settling fails after a billed call", async () => {
    // The money is already spent. 500ing here would withhold output the
    // user paid for AND leave the reservation standing.
    budgetMocks.settle.mockRejectedValue(new Error("ledger write failed"));

    const res = await post();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "A brief." });
  });

  it("does not let a failing refund mask the original error", async () => {
    budgetMocks.getDailySpend.mockRejectedValue(new Error("supabase down"));
    budgetMocks.refund.mockRejectedValue(new Error("refund also failed"));

    await expect(post()).rejects.toThrow(/supabase down/);
  });
});

describe("POST /api/ai/draft-brief — the reservation is a bound, not an estimate", () => {
  it("reserves at one token per character, so non-ASCII can't under-reserve", async () => {
    // A chars/4 estimate under-reserved CJK by ~4x, letting settled cost
    // exceed the quota the pre-call check had just approved.
    const cjk = "漢".repeat(500);
    await post(cjk);

    expect(budgetMocks.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ estimatedInputTokens: 500 })
    );
  });
});
