import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Route handlers import via the project's "@/*" alias (tsconfig paths).
  // Vitest doesn't read tsconfig paths, so mirror the one alias here —
  // without it `tests/draftBrief.route.test.ts` can't resolve the route
  // or the modules it mocks.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
