import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearApiKey, getApiKey, hasApiKey, setApiKey } from "../lib/storage/apiKey";

// Node's test environment has no global `localStorage` (that's a browser/
// jsdom API) — stand in with a minimal in-memory fake so the module's
// `typeof localStorage === "undefined"` guard takes the real path.
class FakeStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new FakeStorage());
});

describe("apiKey storage wrapper", () => {
  it("round-trips a key through set and get", () => {
    setApiKey("sk-ant-test123");
    expect(getApiKey()).toBe("sk-ant-test123");
  });

  it("clear removes the stored key", () => {
    setApiKey("sk-ant-test123");
    clearApiKey();
    expect(getApiKey()).toBeNull();
  });

  it("hasApiKey reflects presence correctly", () => {
    expect(hasApiKey()).toBe(false);
    setApiKey("sk-ant-test123");
    expect(hasApiKey()).toBe(true);
    clearApiKey();
    expect(hasApiKey()).toBe(false);
  });

  it("setApiKey('') clears rather than stores an empty string", () => {
    setApiKey("sk-ant-test123");
    setApiKey("");
    expect(getApiKey()).toBeNull();
    expect(hasApiKey()).toBe(false);
  });

  it("setApiKey(whitespace) clears rather than stores it", () => {
    setApiKey("sk-ant-test123");
    setApiKey("   \t  ");
    expect(getApiKey()).toBeNull();
  });

  it("never logs the key value to console.log or console.error", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const key = "sk-ant-super-secret-value";

    setApiKey(key);
    getApiKey();
    hasApiKey();
    clearApiKey();

    const allArgs = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat();
    expect(allArgs.some((arg) => typeof arg === "string" && arg.includes(key))).toBe(false);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
