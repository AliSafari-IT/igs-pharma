import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig says jsx: "preserve" (for Next); tests render with React's automatic runtime
  esbuild: { jsx: "automatic" },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
