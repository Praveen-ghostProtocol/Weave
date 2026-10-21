import { afterEach, describe, expect, it, vi } from "vitest";
import {
  draftBrief,
  LlmError,
  inputTokenBound,
  MODEL,
  PRICE_PER_MILLION_INPUT,
  PRICE_PER_MILLION_OUTPUT,
} from "../lib/llm/openai";

vi.stubEnv("OPENAI_API_KEY", "sk-test-key");

function mockFetch(init: { ok: boolean; status: number; json?: unknown }) {
  const fn = vi.fn().mockResolvedValue({
    ok: init.ok,
    status: init.status,
    json: async () => init.json ?? {},
  } as Response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

function responsePayload(text: string, inputTokens = 100, outputTokens = 50) {
  return {
    output: [{ type: "message", content: [{ type: "output_text", text }] }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

describe("draftBrief", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the response text and real token usage on success", async () => {
    mockFetch({ ok: true, status: 200, json: responsePayload("Hi, I'm...", 123, 45) });
    const result = await draftBrief("persona markdown", "user-1");
    expect(result).toEqual({ text: "Hi, I'm...", inputTokens: 123, outputTokens: 45 });
  });

  it("sends the Responses API request shape: model, static instructions, variable input last, reasoning effort, output cap, hashed safety_identifier", async () => {
    const fetchMock = mockFetch({ ok: true, status: 200, json: responsePayload("brief") });
    await draftBrief("my persona markdown", "user-123");

    const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/responses");
    const headers = requestInit.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-test-key");

    const body = JSON.parse(requestInit.body as string);
    // Assert against the exported constant, not a literal: the model is a
    // cost decision that lives in one place, and a second copy here just
    // turns every deliberate swap into a spurious test failure. What this
    // line is really checking is that the request sends the configured
    // model at all.
    expect(body.model).toBe(MODEL);
    expect(typeof body.instructions).toBe("string");
    expect(body.instructions.length).toBeGreaterThan(0);
    expect(body.input).toBe("my persona markdown");
    expect(body.reasoning).toEqual({ effort: "none" });
    expect(typeof body.max_output_tokens).toBe("number");
    expect(body.max_output_tokens).toBeGreaterThan(0);

    // safety_identifier must be a hash, never the raw user id.
    expect(typeof body.safety_identifier).toBe("string");
    expect(body.safety_identifier).not.toBe("user-123");
    expect(body.safety_identifier.length).toBeLessThanOrEqual(64);
  });

  it("hashes the same userId to the same safety_identifier, and different ids to different hashes", async () => {
    const first = mockFetch({ ok: true, status: 200, json: responsePayload("a") });
    await draftBrief("md", "same-user");
    const firstId = JSON.parse((first.mock.calls[0][1] as RequestInit).body as string).safety_identifier;

    const second = mockFetch({ ok: true, status: 200, json: responsePayload("a") });
    await draftBrief("md", "same-user");
    const secondId = JSON.parse((second.mock.calls[0][1] as RequestInit).body as string).safety_identifier;
    expect(secondId).toBe(firstId);

    const third = mockFetch({ ok: true, status: 200, json: responsePayload("a") });
    await draftBrief("md", "different-user");
    const thirdId = JSON.parse((third.mock.calls[0][1] as RequestInit).body as string).safety_identifier;
    expect(thirdId).not.toBe(firstId);
  });

  it("throws the invalid_key variant on 401", async () => {
    mockFetch({ ok: false, status: 401 });
    await expect(draftBrief("md", "user-1")).rejects.toMatchObject({ kind: "invalid_key" });
    mockFetch({ ok: false, status: 401 });
    await expect(draftBrief("md", "user-1")).rejects.toBeInstanceOf(LlmError);
  });

  it("throws the rate_limited variant on 429", async () => {
    mockFetch({ ok: false, status: 429 });
    await expect(draftBrief("md", "user-1")).rejects.toMatchObject({ kind: "rate_limited" });
  });

  it("throws the network variant on other error statuses", async () => {
    mockFetch({ ok: false, status: 500 });
    await expect(draftBrief("md", "user-1")).rejects.toMatchObject({ kind: "network" });
  });

  it("throws the network variant when fetch itself rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(draftBrief("md", "user-1")).rejects.toMatchObject({ kind: "network" });
  });

  it("throws the network variant when the response has no output_text", async () => {
    mockFetch({ ok: true, status: 200, json: { output: [], usage: { input_tokens: 1, output_tokens: 0 } } });
    await expect(draftBrief("md", "user-1")).rejects.toMatchObject({ kind: "network" });
  });
});

// SPEC.md says twice, and the module header repeats, that MODEL and the two
// price constants must always change together — budget.ts reserves and
// settles against these prices, so swapping the model alone silently
// mis-bills the ledger and every cap derived from it. That is the documented
// failure mode and nothing tested it. `expect(body.model).toBe(MODEL)` above
// cannot: it compares the constant to itself.
describe("model and pricing stay in step", () => {
  const PRICES: Record<string, { input: number; output: number }> = {
    "gpt-5.4-nano": { input: 0.2, output: 1.25 },
    "gpt-5.4-mini": { input: 0.75, output: 4.5 },
  };

  it("prices match the model actually configured", () => {
    const expected = PRICES[MODEL];
    expect(
      expected,
      `No pricing recorded for model "${MODEL}". Add it to this table in the ` +
        "same change that swaps the model, or the ledger bills at the old rate."
    ).toBeDefined();
    expect(PRICE_PER_MILLION_INPUT).toBe(expected.input);
    expect(PRICE_PER_MILLION_OUTPUT).toBe(expected.output);
  });
});

describe("inputTokenBound", () => {
  it("is a bound, not a chars/4 estimate", () => {
    // The regression it exists to prevent: 500 CJK characters are ~500
    // tokens, which chars/4 would have reserved as 125.
    expect(inputTokenBound("漢".repeat(500))).toBe(500);
    expect(inputTokenBound("hello")).toBe(5);
    expect(inputTokenBound("")).toBe(0);
  });
});
