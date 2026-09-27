import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globals: true,
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    sequence: {
      concurrent: false,
    },
    pool: "forks",
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
