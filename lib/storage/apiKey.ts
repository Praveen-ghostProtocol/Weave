// Anthropic API key, stored under one localStorage key, read at call time.
// Never logged, never persisted anywhere else (SPEC.md Boundaries).
const STORAGE_KEY = "weave:anthropicApiKey";

export function getApiKey(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
}

export function setApiKey(key: string): void {
  if (typeof localStorage === "undefined") return;
  if (key.trim().length === 0) {
    clearApiKey();
    return;
  }
  localStorage.setItem(STORAGE_KEY, key);
}

export function clearApiKey(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export function hasApiKey(): boolean {
  return getApiKey() !== null;
}
