import { afterEach, describe, expect, it, vi } from "vitest";
import { draftContext, DraftContextError } from "../lib/llm/anthropic";

function mockFetch(init: { ok: boolean; status: number; json?: unknown }) {
  const fn = vi.fn().mockResolvedValue({
    ok: init.ok,
    status: init.status,
    json: async () => init.json ?? {},
  } as Response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("draftContext", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the response text on success", async () => {
    mockFetch({ ok: true, status: 200, json: { content: [{ type: "text", text: "Hi, I'm..." }] } });
    const result = await draftContext("persona markdown", "sk-ant-test");
    expect(result).toBe("Hi, I'm...");
  });

  it("sends the required headers and the markdown as the user message", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      json: { content: [{ type: "text", text: "brief" }] },
    });
    await draftContext("my persona markdown", "sk-ant-key123");

    const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = requestInit.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-key123");
    expect(headers["anthropic-version"]).toBeTruthy();
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");

    const body = JSON.parse(requestInit.body as string);
    expect(body.messages).toEqual([{ role: "user", content: "my persona markdown" }]);
    expect(typeof body.system).toBe("string");
    expect(typeof body.model).toBe("string");
  });

  it("throws the invalid_key variant on 401", async () => {
    mockFetch({ ok: false, status: 401 });
    await expect(draftContext("md", "bad-key")).rejects.toMatchObject({ kind: "invalid_key" });
    mockFetch({ ok: false, status: 401 });
    await expect(draftContext("md", "bad-key")).rejects.toBeInstanceOf(DraftContextError);
  });

  it("throws the rate_limited variant on 429", async () => {
    mockFetch({ ok: false, status: 429 });
    await expect(draftContext("md", "key")).rejects.toMatchObject({ kind: "rate_limited" });
  });

  it("throws the network variant on other error statuses", async () => {
    mockFetch({ ok: false, status: 500 });
    await expect(draftContext("md", "key")).rejects.toMatchObject({ kind: "network" });
  });

  it("throws the network variant when fetch itself rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(draftContext("md", "key")).rejects.toMatchObject({ kind: "network" });
  });
});
