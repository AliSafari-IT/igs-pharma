import { defineConfig } from "vitest/config";

// Unit tests for the parts of the app that do not need React Native: the API client, texts,
// formatting, My list and stored settings. Screens are checked on a phone (play-release.md).
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
